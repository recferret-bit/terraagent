import type { ResourceKey } from '@terra/contracts';
import { ENTITY_KIND, ENTITY_STATE } from '../../ecs/columns';
import { rowOf, setField } from '../../ecs/store';
import { isBuildablePrepared } from '../../grid/tileModel';
import type { StepContext } from '../../kernel/context';
import { setBlob, type PlanetState } from '../../kernel/state';
import { colonyWho } from '../find';
import { onCommandHubCompleted } from '../progression';
import { resolveHqT1Row, rowNum } from '../rows';
import { claimTerritoryRadius } from '../territory-claim';
import { buildingKindName, ensureColony, getFootprintTileIndices, resolveBuildingRow } from './buildingRows';
import { maxAffordableProgress, payProgressiveSlice, recomputeFamilyCaps } from './ledger';

/**
 * W02 building jobs (`blobs.construction.jobs`, keyed by the building's entity id) as builder work (W02-16, `UO-D-03`,
 * `UO-L-05`). The job says WHAT is built; the W01 `build` unit command does it (`construction/work.ts`): a builder walks
 * into build reach of the site, and each step it stands there it advances the job and pays the matching slice of the
 * cost. Nothing builds itself: a job no builder works waits (`worker`), one whose footprint is not prepared yet waits
 * for its linked prep (`site`), one the stock cannot pay waits (`resources`) and frees its builder until it can.
 */

/** Why a job is not advancing: its site is not prepared, the stock cannot pay the next slice, or no builder is on it. */
export type BuildJobWait = 'site' | 'resources' | 'worker';

export interface BuildingJobRecord {
  entityId: number;
  building: string;
  owner: number;
  q: number;
  r: number;
  rot: number;
  footprintW: number;
  footprintD: number;
  buildTicks: number;
  elapsedWeightedTicks: number;
  /** Work rate of the builder that was named at the start (informational: progress uses the builder on site). */
  workRate: number;
  workerEntityId?: number;
  cost: Partial<Record<ResourceKey, number>>;
  totalCost?: Partial<Record<ResourceKey, number>>;
  spentCost?: Partial<Record<ResourceKey, number>>;
  status?: 'in_progress' | 'waiting';
  waitReason?: BuildJobWait;
  /** The linked site-prep terraform order (`job:<entityId>/prep`), when the footprint needed preparing. */
  prepOrderId?: string;
  preparedCount?: number;
  totalTiles?: number;
  /** Last tick a builder worked the job (the site bookkeeping tells "builder on it" from "waiting for one"). */
  workedAt?: number;
  paid: boolean;
}

const JOB_KEY_PREFIX = 'job:';

/** The `build` command's id of the W02 job of building `entityId` (W01 orders use their `build#<n>` order id). */
export const buildJobKey = (entityId: number): string => `${JOB_KEY_PREFIX}${entityId}`;

/** The building entity id a `build` command id names when it is a W02 job key, else `null`. */
export function buildJobEntityId(key: string): number | null {
  if (!key.startsWith(JOB_KEY_PREFIX)) return null;
  const id = Number(key.slice(JOB_KEY_PREFIX.length));
  return Number.isInteger(id) && id > 0 ? id : null;
}

function rawJobs(state: PlanetState): Readonly<Record<number, BuildingJobRecord>> {
  return (state.blobs.construction?.value as { jobs?: Record<number, BuildingJobRecord> } | undefined)?.jobs ?? {};
}

/** A mutable copy of every W02 building job. */
export function getBuildingJobs(state: PlanetState): Record<number, BuildingJobRecord> {
  return { ...rawJobs(state) };
}

export function saveBuildingJobs(state: PlanetState, jobs: Record<number, BuildingJobRecord>, tick: number): void {
  setBlob(state, 'construction', { jobs }, tick);
}

/** `job` with `status` / `waitReason` set (no `waitReason` key while it advances). */
function withWait(job: BuildingJobRecord, wait: BuildJobWait | undefined): BuildingJobRecord {
  const { waitReason: _drop, ...rest } = job;
  return wait ? { ...rest, status: 'waiting', waitReason: wait } : { ...rest, status: 'in_progress' };
}

function isUnderConstruction(state: PlanetState, entityId: number): number {
  const row = rowOf(state.entities, entityId);
  const cols = state.entities.cols;
  return row >= 0 && cols.state[row] === ENTITY_STATE.constructing && cols.hp[row] > 0 ? row : -1;
}

const isReady = (state: PlanetState, job: BuildingJobRecord): boolean =>
  job.waitReason !== 'site' && job.waitReason !== 'resources' && isUnderConstruction(state, job.entityId) >= 0;

/** The colony's jobs a builder can work now (site prepared, stock can pay), oldest building first. */
export function readyBuildingJobs(state: PlanetState, owner: number): BuildingJobRecord[] {
  return Object.values(rawJobs(state))
    .filter((j) => j.owner === owner && isReady(state, j))
    .sort((a, b) => a.entityId - b.entityId);
}

/** The colony's job of building `entityId` when a builder can work it now, else `null` (read-only). */
export function readyBuildingJob(state: PlanetState, owner: number, entityId: number): BuildingJobRecord | null {
  const job = rawJobs(state)[entityId];
  return job && job.owner === owner && isReady(state, job) ? job : null;
}

/** What one step of a builder's work did to a job. */
export type BuildJobStep = 'running' | 'paused' | 'completed';

/**
 * One step of work on the job of building `entityId` by the builder at `builderRow` (standing in reach, see
 * `construction/work.ts`): progress at the builder's work rate and the matching slice of the cost. When the stock cannot
 * pay the whole slice it builds as far as it can pay and the job waits on `resources`. Returns `null` when there is no
 * such job under construction.
 */
export function advanceBuildingJob(state: PlanetState, entityId: number, builderRow: number, ctx: StepContext): BuildJobStep | null {
  const jobs = getBuildingJobs(state);
  const job = jobs[entityId];
  const row = isUnderConstruction(state, entityId);
  if (!job || row < 0) return null;
  const e = state.entities, cols = e.cols, tick = ctx.tick;
  const rate = cols.workRate[builderRow] > 0 ? cols.workRate[builderRow] : rowNum(resolveHqT1Row(ctx.data), 'workRate');
  const prevProgress = job.elapsedWeightedTicks / job.buildTicks;
  let weighted = job.elapsedWeightedTicks + ctx.dt * rate;
  let progress = Math.min(1, weighted / job.buildTicks);
  const colony = ensureColony(state, job.owner, tick);
  const totalCost = job.totalCost ?? job.cost ?? {};
  const spentCost = { ...(job.spentCost ?? {}) };
  const paidUpfront = Boolean(job.paid && !job.spentCost); // saves from before progressive payment
  let short = false;
  if (!paidUpfront && Object.keys(totalCost).length > 0 && !payProgressiveSlice(colony, totalCost, spentCost, progress, tick).ok) {
    short = true;
    progress = maxAffordableProgress(colony, totalCost, spentCost, progress);
    if (progress <= prevProgress + 1e-6) {
      jobs[entityId] = { ...withWait(job, 'resources'), workedAt: tick };
      saveBuildingJobs(state, jobs, tick);
      return 'paused';
    }
    payProgressiveSlice(colony, totalCost, spentCost, progress, tick);
    weighted = progress * job.buildTicks;
  }
  const done = !short && progress >= 1 - 1e-6;
  setField(e, row, 'progress', done ? 1 : Math.fround(progress), tick);
  setField(e, builderRow, 'progress', done ? 0 : Math.fround(progress), tick);
  if (done) {
    completeBuildingJob(state, row, job.owner, ctx);
    delete jobs[entityId];
  } else {
    const paid = job.paid || Object.values(spentCost).some((v) => (v ?? 0) > 0);
    jobs[entityId] = { ...withWait(job, short ? 'resources' : undefined), elapsedWeightedTicks: weighted, spentCost, paid, workedAt: tick };
  }
  saveBuildingJobs(state, jobs, tick);
  return done ? 'completed' : short ? 'paused' : 'running';
}

/** A finished building: active, a Hub claims its territory, `buildingCompleted` (the W01 event shape). */
function completeBuildingJob(state: PlanetState, row: number, owner: number, ctx: StepContext): void {
  const cols = state.entities.cols, tick = ctx.tick;
  setField(state.entities, row, 'state', ENTITY_STATE.active, tick);
  const bName = buildingKindName(cols.kind[row]);
  if (cols.kind[row] === ENTITY_KIND.commandHub) {
    const radius = Number(resolveBuildingRow(bName, ctx.data)?.row.claimRadius ?? 10);
    claimTerritoryRadius(state, { colonyId: owner, q: cols.q[row], r: cols.r[row], radius, tick });
    recomputeFamilyCaps(ensureColony(state, owner, tick), true, 0, tick);
    onCommandHubCompleted(state, owner, ctx);
  }
  const { colonyIdStr, who } = colonyWho(state, owner);
  ctx.emit({
    kind: 'buildingCompleted',
    severity: 'info',
    colonyIds: [colonyIdStr],
    data: { ...who, entityId: cols.id[row], building: bName, kind: bName, tier: cols.tier[row] || 1, q: cols.q[row], r: cols.r[row] },
  });
}

function countPrepared(state: PlanetState, job: BuildingJobRecord): { preparedCount: number; totalTiles: number } {
  const fp = getFootprintTileIndices(state, job.q, job.r, job.footprintW, job.footprintD, job.rot);
  return { preparedCount: fp.indices.filter((i) => isBuildablePrepared(state.grid, i)).length, totalTiles: fp.indices.length };
}

/** Whether the stock now pays at least some progress of a job that waits on `resources`. */
function canResume(state: PlanetState, job: BuildingJobRecord, tick: number): boolean {
  const colony = ensureColony(state, job.owner, tick);
  return maxAffordableProgress(colony, job.totalCost ?? job.cost ?? {}, job.spentCost ?? {}, 1) > job.elapsedWeightedTicks / job.buildTicks + 1e-6;
}

/** The job's site state this step: footprint prepared count and why it waits (a builder that worked it keeps its status). */
function siteState(state: PlanetState, job: BuildingJobRecord, tick: number): BuildingJobRecord {
  const counts = countPrepared(state, job);
  const next = { ...job, ...counts };
  if (counts.preparedCount < counts.totalTiles) return withWait(next, 'site'); // also mid-build (`UO-Q-04`)
  if (job.workedAt === tick) return next;
  if (job.waitReason === 'resources' && !canResume(state, job, tick)) return next;
  return withWait(next, 'worker');
}

const statusKey = (j: BuildingJobRecord): string => `${j.status}|${j.waitReason ?? ''}|${j.preparedCount}/${j.totalTiles}`;

/**
 * Site bookkeeping of every job under construction (construction slot 6, after the builders' work): prepared footprint
 * tiles, and why a job waits. The blob is written only when a job's status changed (GP-07).
 */
export function stepBuildingSites(state: PlanetState, ctx: StepContext): void {
  const jobs = getBuildingJobs(state);
  let changed = false;
  for (const job of Object.values(jobs)) {
    if (isUnderConstruction(state, job.entityId) < 0) continue;
    const next = siteState(state, job, ctx.tick);
    if (statusKey(next) === statusKey(job)) continue;
    jobs[job.entityId] = next;
    changed = true;
  }
  if (changed) saveBuildingJobs(state, jobs, ctx.tick);
}

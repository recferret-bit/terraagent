import type { RejectCode, ResourceKey } from '@terra/contracts';
import type { WorkIntent } from '@terra/contracts/commands/enqueue-task';
import { compileData } from '../../data';
import { TERRAFORM_TIME_TABLE } from '../../data/ops-basic';
import { ENTITY_KIND, ENTITY_STATE } from '../../ecs/columns';
import { removeRow, rowOf } from '../../ecs/store';
import { hexDistance, hexIndex } from '../../grid/hex';
import { bumpPathEpoch } from '../../grid/tileModel';
import type { CompiledDataLike } from '../../kernel/config';
import { type PlanetState, type SimState } from '../../kernel/state';
import { isUnitKind } from '../../units/mobility';
import { isWorkerEligibleForJob } from '../dispatch/eligibility';
import { workCrewRow } from '../dispatch/crew';
import { buildingKindName, getFootprintTileIndices, resolveBuildingRow } from '../economy/construction';
import { resolveWorkerRow } from '../harvest';
import { rowNum } from '../rows';
import { joinJobAsHelper } from './crewHelpers';
import { dismantleTargetReject } from './dismantleRule';
import { createDismantleJob, mirrorDismantleQueueEntry } from './dismantleJob';
import {
  dismantleJobOf,
  getWorkJobsMap,
  hasActiveWorkJobForWorker,
  hasWorkJob,
  isWorkerAtJob,
  leadJobOn,
  saveWorkJobsMap,
  type WorkJobRecord,
} from './workJobs';
import { classifyGroundWorkTile, createGroundWorkJob, primeWorkerForWorkJob, selectWorkerForWorkOp } from './workTile';

export {
  cancelWorkerJobs, cancelWorkJobs, getWorkJobsMap, hasActiveWorkJobForWorker, hasWorkJob, saveWorkJobsMap, workJobDrawPerS, type WorkJobRecord,
} from './workJobs';
export { classifyGroundWorkTile, evaluateGroundWorkTile, planGroundWorkTiles } from './workTile';
export { workJobsSystem } from './workSystem';

let cachedDefaultCostData: CompiledDataLike | null = null;
function defaultBuildCostData(): CompiledDataLike {
  cachedDefaultCostData ??= compileData(new Set(['W00', 'W01', 'W02', 'W03', 'W10']));
  return cachedDefaultCostData;
}

/** The base build cost of an entity kind (repair is priced and dismantle refunded from it); the client preview reads it too. */
export function getEntityBaseBuildCost(kind: number, data?: CompiledDataLike, tier = 1): Partial<Record<ResourceKey, number>> {
  const src = data ?? defaultBuildCostData();
  if (kind === ENTITY_KIND.worker) {
    return (resolveWorkerRow(src, tier).cost ?? { 'metals.t1': 40, 'minerals.t1': 15, 'bio.biomass': 5 }) as Partial<Record<ResourceKey, number>>;
  }
  if (kind === ENTITY_KIND.hq) return { 'metals.t1': 100, 'minerals.t1': 50 };
  const bName = buildingKindName(kind);
  const resolved = resolveBuildingRow(bName, src) ?? resolveBuildingRow(bName, defaultBuildCostData());
  return ((resolved?.row.cost ?? { 'metals.t1': 50, 'minerals.t1': 25 }) as Partial<Record<ResourceKey, number>>);
}

/** Finds player-owned entities at `(q, r)` for `colonyId` (non-HQ entities sorted before HQ/CommandHub). */
export function findOwnEntitiesAtTile(
  state: SimState,
  colonyId: number,
  q: number,
  r: number,
  data?: CompiledDataLike,
  preferredEntityId?: number,
): number[] {
  const e = state.entities, cols = e.cols;
  const matches: number[] = [];
  for (let row = 0; row < e.count; row++) {
    if (cols.owner[row] !== colonyId || cols.hp[row] <= 0) continue;
    const id = cols.id[row];
    if (preferredEntityId !== undefined && id === preferredEntityId) {
      matches.unshift(row);
      continue;
    }
    const kind = cols.kind[row];
    if (isUnitKind(kind)) {
      if ((Math.round(cols.q[row]) === q && Math.round(cols.r[row]) === r) || hexDistance(cols.q[row], cols.r[row], q, r) < 0.6) {
        matches.push(row);
      }
    } else if (kind === ENTITY_KIND.pod) {
      // The landed pod (the wreck) is one hex and can be scrapped: it matches its own tile only.
      if (cols.state[row] !== ENTITY_STATE.descending && Math.round(cols.q[row]) === q && Math.round(cols.r[row]) === r) matches.push(row);
    } else {
      const defFp =
        kind === ENTITY_KIND.commandHub
          ? 3
          : kind === ENTITY_KIND.metalsExtractor || kind === ENTITY_KIND.solar || kind === ENTITY_KIND.tradeHub
            ? 2
            : 1;
      const w = Math.max(1, cols.footprintW[row] || defFp);
      const d = Math.max(1, cols.footprintD[row] || defFp);
      const fp = getFootprintTileIndices(state as PlanetState, cols.q[row], cols.r[row], w, d, cols.rot[row]);
      const tIdx = hexIndex(state.grid.radius).indexOf(q, r);
      if ((tIdx >= 0 && fp.indices.includes(tIdx)) || (cols.q[row] === q && cols.r[row] === r)) {
        matches.push(row);
      }
    }
  }
  // Others first, then the pod (the HQ Drone stands on it right after landing), the protected HQ / Hub last.
  const rank = (row: number): number => cols.kind[row] === ENTITY_KIND.hq || cols.kind[row] === ENTITY_KIND.commandHub ? 2 : cols.kind[row] === ENTITY_KIND.pod ? 1 : 0;
  matches.sort((a, b) => rank(a) - rank(b));
  return matches;
}

/** Whether `colonyId` owns an alive, finished Command Hub (either hub kind). */
export function colonyHasActiveHub(state: SimState, colonyId: number): boolean {
  const e = state.entities, cols = e.cols;
  for (let row = 0; row < e.count; row++) {
    const k = cols.kind[row];
    if (cols.owner[row] === colonyId && (k === ENTITY_KIND.hub || k === ENTITY_KIND.commandHub) && cols.hp[row] > 0 && cols.state[row] === ENTITY_STATE.active) return true;
  }
  return false;
}

/** What a dismantle order did: `jobId` names the dismantle job of a building (refunded step by step as it advances). */
export type DismantleResult = { ok: true; entityId: number; refunded: Partial<Record<ResourceKey, number>>; jobId?: string } | { ok: false; reason: RejectCode };

/**
 * Orders the dismantle of a player-owned finished building at `(q, r)` (`op: 'dismantle'`), the one entry point of every
 * dismantle form (`enqueueTask { terraform }`, the queue's `task` form, `enqueueTerraformOrder`). The target rule is
 * `dismantleRule.ts` (shared with the client preview); a typed reject names why not:
 * - a unit / drone `'cannot_dismantle_unit'` (never instant, never remote), the worker itself `'cannot_dismantle_self'`,
 *   Command Hub and HQ Drone `'cannot_dismantle_hq'`, a site still under construction `'dismantle_unfinished'` (cancel
 *   it in the queue), a foreign or unknown `entityId` `'not_own_colony'` / `'unknown_entity'`, a building already being
 *   dismantled `'already_dismantling'`.
 * - A finished building: orders a dismantle job (`dismantleJob.ts`, job id `taskId`): a Worker Drone or the HQ walks
 *   there and takes it apart on site in half its build time, refunding 50 % of its cost step by step. No worker, no
 *   progress.
 * - The landed pod is scrapped (no refund) once an active Hub stands and an own Builder / HQ is next to it.
 * `workerId` is the worker the order names (the selected unit); when it is the target the order is `'cannot_dismantle_self'`.
 */
export function executeDismantleAtTile(
  state: SimState,
  colonyId: number,
  q: number,
  r: number,
  tick: number = state.meta.tick,
  data?: CompiledDataLike,
  preferredEntityId?: number,
  taskId?: string,
  workerId?: number,
): DismantleResult {
  const cols = state.entities.cols;
  const picked = pickDismantleTarget(state, colonyId, q, r, data, preferredEntityId);
  if (typeof picked === 'string') return { ok: false, reason: picked };
  const targetRow = picked;
  const kind = cols.kind[targetRow];
  const entityId = cols.id[targetRow];
  if (dismantleJobOf(state, entityId)) return { ok: false, reason: 'already_dismantling' }; // a site again while it comes down
  const verdict = dismantleTargetReject(kind, cols.state[targetRow], { isSelf: workerId !== undefined && workerId === entityId });
  if (verdict) return { ok: false, reason: verdict };

  if (kind === ENTITY_KIND.pod) {
    // The pod is the colony's reference until its Hub stands: the pre-Hub terraform radius and the Hub's landing distance
    // read it. So it is scrapped only once the colony has an active Hub (reject `site_blocked` before), and by a worker
    // standing next to it (`no_worker_in_reach`): nothing is taken apart remotely.
    if (!colonyHasActiveHub(state, colonyId)) return { ok: false, reason: 'site_blocked' };
    if (!hasWorkerInReach(state, colonyId, targetRow)) return { ok: false, reason: 'no_worker_in_reach' };
    removeRow(state.entities, entityId, tick);
    bumpPathEpoch(state.meta);
    return { ok: true, entityId, refunded: {} };
  }
  return orderBuildingDismantle(state, targetRow, tick, data, taskId);
}

/** Whether an own alive worker that can dismantle (Worker Drone, HQ) is in reach of entity row `row`. */
function hasWorkerInReach(state: SimState, colonyId: number, row: number): boolean {
  const cols = state.entities.cols;
  for (let w = 0; w < state.entities.count; w++) {
    if (cols.owner[w] !== colonyId || cols.hp[w] <= 0 || w === row) continue;
    if (!isWorkerEligibleForJob(cols.kind[w], 1, { kind: 'terraform', op: 'dismantle' })) continue;
    if (isWorkerAtJob(state, w, cols.q[row], cols.r[row], row)) return true;
  }
  return false;
}

/**
 * The entity row a dismantle order at `(q, r)` means, or the reject. `entityId` names one entity (unknown / foreign
 * rejected); else the tile's building or pod, never a unit standing there (units only explain the reject).
 */
function pickDismantleTarget(state: SimState, colonyId: number, q: number, r: number, data?: CompiledDataLike, entityId?: number): number | RejectCode {
  const cols = state.entities.cols;
  if (entityId !== undefined) {
    const row = rowOf(state.entities, entityId);
    if (row < 0 || cols.hp[row] <= 0) return 'unknown_entity';
    return cols.owner[row] === colonyId ? row : 'not_own_colony';
  }
  const rows = findOwnEntitiesAtTile(state, colonyId, q, r, data);
  if (rows.length === 0) return 'site_blocked';
  return rows.find((row) => !isUnitKind(cols.kind[row]) && cols.kind[row] !== ENTITY_KIND.hq) ?? rows[0]!;
}

/**
 * The queue's `task` forms of a dismantle (`enqueueTask { task }`): `{ kind: 'dismantle', entityId }` or
 * `{ kind: 'terraform', op: 'dismantle', q, r }`. Returns a reject code or nothing.
 */
export function dismantleQueueTask(
  state: SimState,
  colonyId: number,
  task: { entityId?: number; q?: number; r?: number; workerId?: number },
  taskId: string,
  tick: number,
  data?: CompiledDataLike,
): RejectCode | undefined {
  if (hasWorkJob(state, taskId)) return 'invalid_args';
  let { q, r } = task;
  if (typeof task.entityId === 'number') {
    const row = rowOf(state.entities, task.entityId);
    if (row < 0) return 'unknown_entity';
    if (state.entities.cols.owner[row] !== colonyId) return 'not_own_colony';
    q = state.entities.cols.q[row];
    r = state.entities.cols.r[row];
  }
  if (typeof q !== 'number' || typeof r !== 'number') return 'invalid_args';
  const res = executeDismantleAtTile(state, colonyId, q, r, tick, data, task.entityId, taskId, task.workerId);
  return res.ok ? undefined : res.reason;
}

/**
 * Orders the dismantle of finished building row `row`: a Worker Drone (else the HQ) gets the job, the building becomes
 * an offline site and the construction lane shows it. `site_blocked` when the colony has no such worker.
 */
function orderBuildingDismantle(state: SimState, row: number, tick: number, data?: CompiledDataLike, taskId?: string): DismantleResult {
  const cols = state.entities.cols;
  const entityId = cols.id[row], colonyId = cols.owner[row];
  const jobId = taskId ?? `work-dismantle-${colonyId}-${tick}-${entityId}`;
  if (hasWorkJob(state, jobId)) return { ok: false, reason: 'invalid_args' };
  const workerId = selectWorkerForWorkOp(state, colonyId, cols.q[row], cols.r[row], undefined, entityId, 'dismantle');
  if (workerId === null) return { ok: false, reason: 'site_blocked' };
  const job = createDismantleJob(state, row, workerId, jobId, getEntityBaseBuildCost(cols.kind[row], data, cols.tier[row] || 1), tick, data);
  if (!job) return { ok: false, reason: 'invalid_args' };
  const stored = storeWorkJob(state, job, tick, data);
  if (!stored.ok) return stored;
  mirrorDismantleQueueEntry(state as PlanetState, job, tick);
  return { ok: true, entityId, refunded: {}, jobId };
}

/** The repair cost rate (`workCrew.repair.costRate`): the share of the build cost a full repair costs. */
export const repairCostRate = (data?: CompiledDataLike): number => rowNum(workCrewRow(data, 'repair'), 'costRate');

/** Creates a repair `WorkJobRecord` for a damaged entity row (`repairCostRate` × base cost × missing HP fraction). */
export function createRepairWorkJobRecord(
  state: SimState,
  colonyId: number,
  damagedRow: number,
  workerId: number,
  jobId: string,
  data?: CompiledDataLike,
  chainRootId?: string,
): WorkJobRecord {
  const cols = state.entities.cols;
  const targetId = cols.id[damagedRow];
  const hpMax = cols.hpMax[damagedRow], startHp = cols.hp[damagedRow];
  const missingFraction = Math.max(0, (hpMax - startHp) / Math.max(1, hpMax));
  const baseCost = getEntityBaseBuildCost(cols.kind[damagedRow], data, cols.tier[damagedRow] || 1);
  const totalCost: Partial<Record<ResourceKey, number>> = {};
  for (const [k, v] of Object.entries(baseCost) as [ResourceKey, number][]) {
    if (v && v > 0) totalCost[k] = Number((v * repairCostRate(data) * missingFraction).toFixed(6));
  }
  const durationTicks = Math.max(1, Math.round(TERRAFORM_TIME_TABLE.repair.durationTicks * missingFraction));
  const tileIdx = Math.max(0, hexIndex(state.grid.radius).indexOf(cols.q[damagedRow], cols.r[damagedRow]));
  return {
    jobId, colonyId, mode: 'repair', workerEntityId: workerId, targetEntityId: targetId,
    q: cols.q[damagedRow], r: cols.r[damagedRow], tileIdx, durationTicks, elapsedTicks: 0, progress: 0,
    startHp, hpMax, energyCost: 0, yields: {}, totalCost, spentCost: {}, status: 'in_progress',
    ...(chainRootId !== undefined ? { chainRootId } : {}),
  };
}

/** Enqueues or reuses an open repair `WorkJobRecord` targeting `entityId`. */
export function enqueueRepairForEntity(
  state: SimState,
  colonyId: number,
  entityId: number,
  opts?: { workerId?: number; taskId?: string; tick?: number; data?: CompiledDataLike },
): { ok: true; job: WorkJobRecord } | { ok: false; reason: RejectCode } {
  const tick = opts?.tick ?? state.meta.tick;
  const cols = state.entities.cols;
  const row = rowOf(state.entities, entityId);
  if (row < 0) return { ok: false, reason: 'unknown_entity' };
  if (cols.owner[row] !== colonyId) return { ok: false, reason: 'not_own_colony' };
  if (cols.hp[row] <= 0 || cols.hp[row] >= cols.hpMax[row] || cols.state[row] === ENTITY_STATE.constructing) {
    return { ok: false, reason: 'site_blocked' };
  }
  const existing = leadJobOn(getWorkJobsMap(state), 'repair', entityId);
  if (existing) {
    // An open repair: a named worker joins it as a helper (faster, same cost), never a second paid job.
    if (opts?.workerId !== undefined) joinRepairCrew(state, colonyId, existing, opts.workerId, tick, opts.data);
    return { ok: true, job: existing };
  }
  const workerId = selectWorkerForWorkOp(state, colonyId, cols.q[row], cols.r[row], opts?.workerId, entityId, 'repair');
  if (workerId === null) return { ok: false, reason: 'site_blocked' };
  const jobId = opts?.taskId ?? `work-repair-${colonyId}-${tick}-${entityId}`;
  const job = createRepairWorkJobRecord(state, colonyId, row, workerId, jobId, opts?.data);
  return storeWorkJob(state, job, tick, opts?.data);
}

/** A terraform `work` job (not a helper) already targets `(q, r)` for this colony. */
function terraformWorkQueued(state: SimState, colonyId: number, q: number, r: number): boolean {
  for (const j of Object.values(getWorkJobsMap(state))) {
    if (j.helpOf === undefined && j.mode === 'terraform' && j.colonyId === colonyId && j.q === q && j.r === r) return true;
  }
  return false;
}

/**
 * Enqueues a simplified `work` job at `(q, r)` (`op: 'work'`, available to the HQ and every Worker Drone):
 * - Case A: Target tile `(q, r)` has a damaged friendly unit or building (`hp < hpMax`) -> starts a repair job at 40% base cost scaled by missing HP.
 * - Case B: Target tile `(q, r)` is un-terraformed ground (forest, rock, slope, hole, wild flat, shallow water, deep water with a T2+ worker) -> a terraforming job. Water takes its time and cost from the `reclaim` / `deepReclaim` op.
 * `intent: 'repair'` allows only case A (no damaged target → `site_blocked`), `'terraform'` only case B; absent = A else B.
 * `chain`: a terraform job continues on the nearest obstacles when done (`chain.ts`; repair never chains).
 */
export function enqueueWorkAtTile(
  state: SimState,
  colonyId: number,
  q: number,
  r: number,
  opts?: {
    workerId?: number; entityId?: number; taskId?: string; tick?: number; data?: CompiledDataLike; intent?: WorkIntent; chain?: boolean;
    /** The order (command) id when it differs from `taskId` (a multi-tile order): `cancelTask` by it ends every job. */
    chainRootId?: string;
  },
): { ok: true; job: WorkJobRecord } | { ok: false; reason: RejectCode } {
  const tick = opts?.tick ?? state.meta.tick;
  const tileIdx = hexIndex(state.grid.radius).indexOf(q, r);
  if (tileIdx < 0) return { ok: false, reason: 'invalid_args' };
  const rootOf = opts?.chainRootId !== undefined ? { chainRootId: opts.chainRootId } : {};

  const cols = state.entities.cols;
  const ownRows = opts?.intent === 'terraform' ? [] : findOwnEntitiesAtTile(state, colonyId, q, r, opts?.data, opts?.entityId);
  const damagedRow = ownRows.find((row) => cols.hp[row] > 0 && cols.hp[row] < cols.hpMax[row] && cols.state[row] !== ENTITY_STATE.constructing);
  if (damagedRow === undefined && opts?.intent === 'repair') return { ok: false, reason: 'site_blocked' };

  if (damagedRow !== undefined) {
    const targetId = cols.id[damagedRow];
    const open = leadJobOn(getWorkJobsMap(state), 'repair', targetId);
    if (open) {
      if (opts?.workerId !== undefined) joinRepairCrew(state, colonyId, open, opts.workerId, tick, opts.data);
      return { ok: true, job: open };
    }
    const workerId = selectWorkerForWorkOp(state, colonyId, cols.q[damagedRow], cols.r[damagedRow], opts?.workerId, targetId, 'repair');
    if (workerId === null) return { ok: false, reason: 'site_blocked' };
    const jobId = opts?.taskId ?? `work-repair-${colonyId}-${tick}-${targetId}`;
    const job = createRepairWorkJobRecord(state, colonyId, damagedRow, workerId, jobId, opts?.data, opts?.chainRootId);
    return storeWorkJob(state, job, tick, opts?.data);
  }

  if (terraformWorkQueued(state, colonyId, q, r)) return { ok: false, reason: 'already_queued' };
  const ground = classifyGroundWorkTile(state, colonyId, tileIdx, { data: opts?.data });
  if (!ground.ok) return ground;
  const workerId = selectWorkerForWorkOp(state, colonyId, q, r, opts?.workerId);
  if (workerId === null) return { ok: false, reason: 'site_blocked' };

  const jobId = opts?.taskId ?? `work-tf-${colonyId}-${tick}-${q},${r}`;
  const job = createGroundWorkJob(jobId, colonyId, workerId, { q, r, tileIdx }, ground);
  if (opts?.chain) Object.assign(job, { chain: true, chainSeq: 0 }, rootOf);
  return storeWorkJob(state, job, tick, opts?.data);
}

/** Puts `workerId` (an own HQ, Builder or Worker other than the target) on open repair `lead` as a helper. */
function joinRepairCrew(state: SimState, colonyId: number, lead: WorkJobRecord, workerId: number, tick: number, data?: CompiledDataLike): void {
  if (workerId === lead.targetEntityId) return;
  if (selectWorkerForWorkOp(state, colonyId, lead.q, lead.r, workerId, lead.targetEntityId, 'repair') !== workerId) return;
  joinJobAsHelper(state, lead, workerId, tick, data);
}

/**
 * Stores a new job (an id that names an open job is rejected: never overwrite one, e.g. another colony's). A worker
 * with no job yet is pointed at it now; one that already has jobs works them in order (insertion order, one at a time),
 * so the new job waits behind them.
 */
function storeWorkJob(
  state: SimState,
  job: WorkJobRecord,
  tick: number,
  data?: CompiledDataLike,
): { ok: true; job: WorkJobRecord } | { ok: false; reason: RejectCode } {
  if (hasWorkJob(state, job.jobId)) return { ok: false, reason: 'invalid_args' };
  const busy = hasActiveWorkJobForWorker(state, job.workerEntityId);
  const jobs = getWorkJobsMap(state);
  jobs[job.jobId] = job;
  saveWorkJobsMap(state, jobs, tick);
  if (!busy) primeWorkerForWorkJob(state as PlanetState, job.workerEntityId, job.q, job.r, tick, data);
  return { ok: true, job };
}

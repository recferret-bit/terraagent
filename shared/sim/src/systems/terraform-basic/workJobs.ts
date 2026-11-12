import type { ResourceKey } from '@terra/contracts';
import { DISMANTLE_REFUND_RATE, type TerraformTimeKey } from '../../data/ops-basic';
import { ENTITY_KIND, ENTITY_STATE } from '../../ecs/columns';
import { rowOf, setField } from '../../ecs/store';
import { hexDistance } from '../../grid/hex';
import { TICK_MS } from '../../kernel/constants';
import { setBlob, type ColonyState, type PlanetState, type SimState } from '../../kernel/state';
import { cancelMove } from '../../units/movement/orchestrator';
import type { CrewTally } from '../dispatch/crew';
import { ensureColonyLedger, refundCost } from '../economy/ledger';
import { restoreDismantleSite } from './dismantleSite';

/**
 * One `work` job (`blobs.workJobs`): a repair of an own entity, the terraforming of one ground tile (`op: 'work'`), or
 * the dismantling of an own building (`op: 'dismantle'`, `dismantleJob.ts`). A helper record (`helpOf`) puts one more
 * worker on another job (its lead): it walks there and adds its crew share to the lead's progress (`crewHelpers.ts`).
 */
export interface WorkJobRecord extends CrewTally {
  jobId: string;
  colonyId: number;
  mode: 'repair' | 'terraform' | 'dismantle';
  workerEntityId: number;
  targetEntityId?: number;
  /** Time-table key, `shallow` / `deep` for water reclaim (`workOp`), or `'pod'` when clearing a landed drop pod. */
  terrainKey?: TerraformTimeKey | 'shallow' | 'deep' | 'pod';
  /** Water reclaim: duration and cost come from this op (`reclaim` / `deepReclaim`). */
  workOp?: 'reclaim' | 'deepReclaim';
  q: number;
  r: number;
  tileIdx: number;
  durationTicks: number;
  elapsedTicks: number;
  progress: number;
  startHp: number;
  hpMax: number;
  /** Energy (E) the job takes, drawn evenly from the colony grid over its work time ({@link workJobDrawPerS}). */
  energyCost: number;
  yields: Partial<Record<ResourceKey, number>>;
  totalCost: Partial<Record<ResourceKey, number>>;
  spentCost: Partial<Record<ResourceKey, number>>;
  status: 'in_progress' | 'waiting';
  /** Why it waits: `resources` (repair cost unpaid), `power` (shed in a brownout, shed group 1; progress is kept). */
  waitReason?: string;
  /** Terraform chain ("infinite terraform"): on completion the worker moves on to the obstacle closest to the clicked tile (`chain.ts`). */
  chain?: boolean;
  /**
   * The chain's root id (`cancelTask` by this id ends the whole chain): the player's command id. Absent on a single-tile
   * order's own job (its job id is the command id); set on every job of a multi-tile order (`${commandId}:${i}`).
   */
  chainRootId?: string;
  /** Position in the chain: 0 = the player's own tile, n = the n-th automatic follow-up (`${chainRootId}~${n}`). */
  chainSeq?: number;
  /** The tile the player clicked: the chain works outward from it, closest first (`chain.ts`). */
  chainOrigin?: { q: number; r: number };
  /** Follow-up tiles with no path right now: skipped until the chain next finishes a tile, then tried again. */
  chainSkipped?: number[];
  /** Tiles still an obstacle after their own job (levelled but uneven, or no longer workable): never picked again. */
  chainGiveUp?: number[];
  /** A helper record: the id of the job (the lead) this worker helps. It has no cost or progress of its own. */
  helpOf?: string;
  /** Dismantle: the whole refund (refund rate × build cost) and what was credited so far (step by step). */
  refundTotal?: Partial<Record<ResourceKey, number>>;
  refunded?: Partial<Record<ResourceKey, number>>;
  /** Dismantle: the building's `state` / `progress` before it became a dismantling site (restored on cancel). */
  prevState?: number;
  prevProgress?: number;
  /** Dismantle: share of the hull a cancel takes off per unit of progress (`dismantleSite.ts`). */
  hpLossRate?: number;
}

/** Whether `job` is a job of its own (not a helper record). */
export const isLeadJob = (job: Pick<WorkJobRecord, 'helpOf'>): boolean => job.helpOf === undefined;

/** The open lead job of `mode` on entity `targetId`, if any. */
export function leadJobOn(
  jobs: Readonly<Record<string, WorkJobRecord>>,
  mode: WorkJobRecord['mode'],
  targetId: number,
): WorkJobRecord | undefined {
  for (const id in jobs) {
    const j = jobs[id]!;
    if (j.mode === mode && j.targetEntityId === targetId && isLeadJob(j)) return j;
  }
  return undefined;
}

/** The open dismantle job of building `entityId`, if it is being dismantled. */
export const dismantleJobOf = (state: SimState, entityId: number): WorkJobRecord | undefined =>
  leadJobOn(storedJobs(state), 'dismantle', entityId);

/** The stored jobs, read-only (no copy: callers that edit use {@link getWorkJobsMap}). */
const storedJobs = (state: SimState): Readonly<Record<string, WorkJobRecord>> =>
  (state.blobs.workJobs?.value as { byId?: Record<string, WorkJobRecord> } | undefined)?.byId ?? {};

export function getWorkJobsMap(state: SimState): Record<string, WorkJobRecord> {
  return { ...storedJobs(state) };
}

export function saveWorkJobsMap(state: SimState, byId: Record<string, WorkJobRecord>, tick: number): void {
  setBlob(state, 'workJobs', { byId }, tick);
}

/** Whether `workerEntityId` carries out a work job (cheap: no copy; the unit work providers ask it per unit per step). */
export function hasActiveWorkJobForWorker(state: SimState, workerEntityId: number): boolean {
  const jobs = storedJobs(state);
  for (const id in jobs) if (jobs[id]!.workerEntityId === workerEntityId) return true;
  return false;
}

/**
 * The job each worker carries out now: its first job in insertion order (a worker works its jobs one at a time). The
 * work-jobs system steps exactly these; the power core meters exactly these (`power-core/workLoad.ts`).
 */
export function activeWorkJobs<T extends Pick<WorkJobRecord, 'workerEntityId'>>(jobs: Readonly<Record<string, T>>): T[] {
  const seen = new Set<number>();
  const out: T[] = [];
  for (const id in jobs) {
    const job = jobs[id]!;
    if (seen.has(job.workerEntityId)) continue;
    seen.add(job.workerEntityId);
    out.push(job);
  }
  return out;
}

/** The stored jobs each worker carries out now (read-only, no copy). */
export function storedActiveWorkJobs(state: SimState): WorkJobRecord[] {
  return activeWorkJobs(storedJobs(state));
}

/**
 * The grid load (E/s) of a job while it is worked: its energy spread evenly over its work time (`UO-TF-02`).
 * 0 for a job without energy (repair).
 */
export function workJobDrawPerS(job: Pick<WorkJobRecord, 'energyCost' | 'durationTicks'>): number {
  const workS = Math.max(1, job.durationTicks) * (TICK_MS / 1000);
  return job.energyCost > 0 ? Number((job.energyCost / workS).toFixed(4)) : 0;
}

/** How far (hexes) a worker works a job from: the HQ Drone 2, any other worker 1 (or 2 for a 3x3 structure). */
export function workReach(kind: number, targetRow = -1, state?: SimState): number {
  const base = kind === ENTITY_KIND.hq ? 2 : 1;
  if (targetRow >= 0 && state) {
    const cols = state.entities.cols;
    const fp = Math.max(cols.footprintW[targetRow] || 1, cols.footprintD[targetRow] || 1, cols.kind[targetRow] === ENTITY_KIND.commandHub ? 3 : 1);
    if (fp >= 3) return Math.max(base, 2);
  }
  return base;
}

/** Whether worker row `wRow` is in reach of `(q, r)`: it works the job there (and draws power) instead of walking. */
export function isWorkerAtJob(state: SimState, wRow: number, q: number, r: number, targetRow = -1): boolean {
  const cols = state.entities.cols;
  return hexDistance(cols.q[wRow], cols.r[wRow], q, r) <= workReach(cols.kind[wRow], targetRow, state);
}

/** Whether `id` names an open work job: its own id, or the root id of a terraform chain. */
export function hasWorkJob(state: SimState, id: string): boolean {
  const jobs = storedJobs(state);
  if (jobs[id]) return true;
  for (const k in jobs) if (jobs[k]!.chainRootId === id) return true;
  return false;
}

export function ensureWorkColony(state: SimState, owner: number, tick: number): ColonyState {
  state.colonies[owner] ??= { index: owner, id: `p${owner}`, name: `Colony ${owner + 1}`, color: 0xff6b00, status: 'active', active: true, changedAt: tick };
  return ensureColonyLedger(state.colonies[owner]);
}

/**
 * Cancels work jobs of `colonyId` (any colony when null/undefined): one job id (also every job of the chain rooted at
 * that id), every job of a worker (or targeting that entity), or all. Refunds `DISMANTLE_REFUND_RATE` of spent cost and
 * idles the worker.
 */
export function cancelWorkJobs(
  state: SimState,
  colonyId: number | null | undefined,
  filter: { jobId?: string; workerEntityId?: number; all?: boolean },
  tick: number = state.meta.tick,
): { cancelled: number; refunded: Partial<Record<ResourceKey, number>> } {
  const jobs = getWorkJobsMap(state);
  const refunded: Partial<Record<ResourceKey, number>> = {};
  let cancelled = 0;
  const e = state.entities, cols = e.cols;

  const ended = new Set<string>();
  for (const [id, job] of Object.entries(jobs)) {
    if (colonyId !== undefined && colonyId !== null && job.colonyId !== colonyId) continue;
    const match = Boolean(filter.all) || (filter.jobId !== undefined && (id === filter.jobId || job.chainRootId === filter.jobId)) ||
      (filter.workerEntityId !== undefined && (job.workerEntityId === filter.workerEntityId || (isLeadJob(job) && job.targetEntityId === filter.workerEntityId)));
    if (!match) continue;
    ended.add(id);
    if (Object.keys(job.spentCost).length > 0) {
      const colony = ensureWorkColony(state, job.colonyId, tick);
      refundCost(colony, job.spentCost, DISMANTLE_REFUND_RATE, tick);
      for (const [k, v] of Object.entries(job.spentCost) as [ResourceKey, number][]) {
        if (v && v > 0) refunded[k] = Number(((refunded[k] ?? 0) + v * DISMANTLE_REFUND_RATE).toFixed(6));
      }
    }
    const wRow = rowOf(e, job.workerEntityId);
    if (wRow >= 0) {
      cancelMove(state as PlanetState, job.workerEntityId, tick);
      setField(e, wRow, 'progress', 0, tick);
      setField(e, wRow, 'state', ENTITY_STATE.idle, tick);
    }
    if (job.mode === 'dismantle' && isLeadJob(job)) restoreDismantleSite(state, job, tick);
    else if (job.targetEntityId !== undefined && isLeadJob(job)) {
      const tRow = rowOf(e, job.targetEntityId);
      if (tRow >= 0 && cols.state[tRow] !== ENTITY_STATE.constructing) setField(e, tRow, 'progress', 0, tick);
    }
    delete jobs[id];
    cancelled++;
  }
  // The helpers of an ended job stop with it.
  for (const [id, job] of Object.entries(jobs)) {
    if (job.helpOf === undefined || !ended.has(job.helpOf)) continue;
    const wRow = rowOf(e, job.workerEntityId);
    if (wRow >= 0) {
      cancelMove(state as PlanetState, job.workerEntityId, tick);
      setField(e, wRow, 'progress', 0, tick);
      setField(e, wRow, 'state', ENTITY_STATE.idle, tick);
    }
    delete jobs[id];
  }
  if (cancelled > 0) saveWorkJobsMap(state, jobs, tick);
  return { cancelled, refunded };
}

/**
 * Ends the work jobs `workerId` carries out (not those targeting it): every one, or with `onlyChain` its terraform
 * chain only; jobs in `keep` stay. Called when the player gives the worker another order.
 */
export function cancelWorkerJobs(
  state: SimState,
  workerId: number,
  tick: number,
  opts: { onlyChain?: boolean; keep?: ReadonlySet<string> } = {},
): number {
  let n = 0;
  for (const job of Object.values(getWorkJobsMap(state))) {
    if (job.workerEntityId !== workerId || (opts.onlyChain && !job.chain) || opts.keep?.has(job.jobId)) continue;
    n += cancelWorkJobs(state, job.colonyId, { jobId: job.jobId }, tick).cancelled;
  }
  return n;
}

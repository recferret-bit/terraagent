import { ENTITY_KIND, ENTITY_STATE } from '../../ecs/columns';
import { rowOf, setField } from '../../ecs/store';
import { hexDistance, hexIndex } from '../../grid/hex';
import { TERRAIN } from '../../grid/layers';
import { setBlob, type PlanetState } from '../../kernel/state';
import { defineSystem } from '../../kernel/system';
import { UnitBook } from '../../units/book';
import { defineSimModule } from '../define';
import { buildJobKey } from '../economy/buildJob';
import { assignHarvesterSubJob } from '../harvest';
import { hasActiveWorkJobForWorker } from '../terraform-basic/workJobs';
import { checkWorkerBuildTier, isWorkerEligibleForJob } from './eligibility';

export { canDoWork, checkWorkerBuildTier, colonyHasEligibleWorker, isWorkerEligibleForJob, type WorkEligibilitySpec, type WorkKind } from './eligibility';

export type DispatchPrecedence = 'system' | 'player' | 'auto';

const PRECEDENCE_SCORE: Readonly<Record<DispatchPrecedence, number>> = {
  system: 3,
  player: 2,
  auto: 1,
};

export interface DispatchJobSpec {
  jobId?: string;
  colonyIndex?: number;
  kind: 'build' | 'terraform' | 'linkedPrep';
  op?: string;
  tier?: number;
  q: number;
  r: number;
  precedence?: DispatchPrecedence;
}

export interface WorkerDispatchRecord {
  workerEntityId: number;
  colonyIndex: number;
  jobId: string;
  kind: 'build' | 'terraform' | 'linkedPrep';
  op?: string;
  q: number;
  r: number;
  precedence: DispatchPrecedence;
  preEmptedFrom?: DispatchPrecedence;
  assignedAtTick: number;
}

interface CandidateWorker {
  entityId: number;
  row: number;
  kind: number;
  tier: number;
  maxBuildTier: number;
  q: number;
  r: number;
  dist: number;
  isIdle: boolean;
  currentPrecedence: DispatchPrecedence | null;
}

function getDispatchMap(state: PlanetState): Record<number, WorkerDispatchRecord> {
  const raw = (state.blobs.dispatch?.value as { byWorker?: Record<number, WorkerDispatchRecord> } | undefined)?.byWorker;
  return raw ? { ...raw } : {};
}

function saveDispatchMap(state: PlanetState, byWorker: Record<number, WorkerDispatchRecord>, tick: number): void {
  setBlob(state, 'dispatch', { byWorker }, tick);
}

function determineWorkerPrecedence(
  state: PlanetState,
  row: number,
  byWorker: Record<number, WorkerDispatchRecord>,
): { isIdle: boolean; currentPrecedence: DispatchPrecedence | null } {
  const cols = state.entities.cols;
  const id = cols.id[row];
  const st = cols.state[row];

  if (st === ENTITY_STATE.idle) {
    return { isIdle: true, currentPrecedence: null };
  }
  if (st === ENTITY_STATE.harvesting) {
    return { isIdle: false, currentPrecedence: 'auto' };
  }
  const activeAssign = (state.blobs.harvest?.value as { assignments?: Record<number, { mode?: string }> } | undefined)?.assignments?.[id];
  if (cols.kind[row] === ENTITY_KIND.harvester && activeAssign?.mode === 'harvest' && !byWorker[id]) {
    return { isIdle: false, currentPrecedence: 'auto' };
  }
  return { isIdle: false, currentPrecedence: byWorker[id]?.precedence ?? 'player' };
}

/**
 * Selects the best worker for `job` (`UO-D`):
 * 1. Nearest idle eligible worker (`hexDistance` ascending, lowest `tier` / `maxBuildTier` on ties).
 * 2. If no idle eligible worker exists and `job.precedence` is `'player'` (or `'system'`), pre-empts the nearest
 *    eligible worker currently running lower-precedence work (such as `'auto'` standing harvest).
 */
export function selectWorkerForDispatch(
  state: PlanetState,
  job: DispatchJobSpec,
): { workerEntityId: number; preEmptedFrom?: DispatchPrecedence } | null {
  const colonyIndex = job.colonyIndex ?? 0;
  const precedence: DispatchPrecedence = job.precedence ?? 'player';
  const byWorker = getDispatchMap(state);
  const e = state.entities, cols = e.cols;

  const idleCandidates: CandidateWorker[] = [];
  const preEmptCandidates: CandidateWorker[] = [];

  for (let row = 0; row < e.count; row++) {
    if (cols.owner[row] !== colonyIndex || cols.hp[row] <= 0) continue;
    const kind = cols.kind[row];
    if (
      kind !== ENTITY_KIND.hq &&
      kind !== ENTITY_KIND.builder &&
      kind !== ENTITY_KIND.harvester &&
      kind !== ENTITY_KIND.terraformer
    ) {
      continue;
    }
    if (hasActiveWorkJobForWorker(state, cols.id[row])) continue; // on a `work` job / terraform chain (never pre-empted)
    const tier = cols.tier[row] || 1;
    if (!isWorkerEligibleForJob(kind, tier, job)) continue;

    const maxBuildTier = kind === ENTITY_KIND.hq ? tier : kind === ENTITY_KIND.builder ? 1 : 0;
    const dist = hexDistance(cols.q[row], cols.r[row], job.q, job.r);
    const { isIdle, currentPrecedence } = determineWorkerPrecedence(state, row, byWorker);

    const cand: CandidateWorker = {
      entityId: cols.id[row],
      row,
      kind,
      tier,
      maxBuildTier,
      q: cols.q[row],
      r: cols.r[row],
      dist,
      isIdle,
      currentPrecedence,
    };

    if (isIdle) {
      idleCandidates.push(cand);
    } else if (
      precedence !== 'auto' &&
      currentPrecedence !== null &&
      PRECEDENCE_SCORE[precedence] > PRECEDENCE_SCORE[currentPrecedence]
    ) {
      preEmptCandidates.push(cand);
    }
  }

  const cmp = (a: CandidateWorker, b: CandidateWorker) =>
    a.dist - b.dist || a.tier - b.tier || a.maxBuildTier - b.maxBuildTier || a.entityId - b.entityId;

  if (idleCandidates.length > 0) {
    idleCandidates.sort(cmp);
    return { workerEntityId: idleCandidates[0].entityId };
  }
  if (preEmptCandidates.length > 0) {
    preEmptCandidates.sort(cmp);
    return {
      workerEntityId: preEmptCandidates[0].entityId,
      preEmptedFrom: preEmptCandidates[0].currentPrecedence ?? 'auto',
    };
  }
  return null;
}

/** Dispatches `job` to the best eligible worker (or pre-empts an `'auto'` worker if `job` has `'player'` precedence). */
export function dispatchJob(
  state: PlanetState,
  job: DispatchJobSpec,
  tick: number = state.meta.tick,
): { ok: true; record: WorkerDispatchRecord } | { ok: false; code: 'no_worker' | 'invalid_args' } {
  const chosen = selectWorkerForDispatch(state, job);
  if (!chosen) return { ok: false, code: 'no_worker' };

  const row = rowOf(state.entities, chosen.workerEntityId);
  if (row < 0) return { ok: false, code: 'no_worker' };
  const cols = state.entities.cols;
  const colonyIndex = job.colonyIndex ?? cols.owner[row];
  const precedence: DispatchPrecedence = job.precedence ?? 'player';

  if (cols.kind[row] === ENTITY_KIND.harvester && job.kind === 'terraform' && (job.op === 'clear' || job.op === 'break' || job.op === 'work')) {
    const idx = hexIndex(state.grid.radius);
    const tileIdx = idx.indexOf(job.q, job.r);
    if (tileIdx >= 0) {
      if (job.op === 'clear' && state.grid.layers.terrain[tileIdx] !== TERRAIN.forest) {
        state.grid.layers.terrain[tileIdx] = TERRAIN.forest;
      } else if (job.op === 'break' && state.grid.layers.terrain[tileIdx] !== TERRAIN.rock) {
        state.grid.layers.terrain[tileIdx] = TERRAIN.rock;
      }
    }
    assignHarvesterSubJob(state, chosen.workerEntityId, job.op, job.q, job.r, tick);
  } else {
    setField(state.entities, row, 'targetQ', job.q, tick);
    setField(state.entities, row, 'targetR', job.r, tick);
    const dist = hexDistance(cols.x[row], cols.y[row], job.q, job.r);
    const nextState = dist <= 1e-4 ? (job.kind === 'build' ? ENTITY_STATE.constructing : ENTITY_STATE.working) : ENTITY_STATE.moving;
    setField(state.entities, row, 'state', nextState, tick);
  }

  const record: WorkerDispatchRecord = {
    workerEntityId: chosen.workerEntityId,
    colonyIndex,
    jobId: job.jobId ?? `disp-${colonyIndex}-${tick}-${chosen.workerEntityId}`,
    kind: job.kind,
    op: job.op,
    q: job.q,
    r: job.r,
    precedence,
    preEmptedFrom: chosen.preEmptedFrom,
    assignedAtTick: tick,
  };

  const byWorker = getDispatchMap(state);
  byWorker[chosen.workerEntityId] = record;
  saveDispatchMap(state, byWorker, tick);
  return { ok: true, record };
}

export function getWorkerDispatch(state: PlanetState, workerEntityId: number): WorkerDispatchRecord | null {
  return getDispatchMap(state)[workerEntityId] ?? null;
}

export interface AssignBuilderSiteSpec {
  entityId?: number;
  orderId?: string;
  q: number;
  r: number;
  tier?: number;
  precedence?: DispatchPrecedence;
}

/**
 * Assigns a specific worker (`workerEntityId`) to construct `site`, enforcing `maxBuildTier` (`worker_tier_locked`
 * when `site.tier` exceeds the worker's `maxBuildTier`, e.g. Builder Drone on a T2+ site).
 */
export function assignBuilderToSite(
  state: PlanetState,
  workerEntityId: number,
  site: AssignBuilderSiteSpec,
  tick: number = state.meta.tick,
): { ok: true; record: WorkerDispatchRecord } | { ok: false; code: 'worker_tier_locked' | 'unknown_entity' } {
  const row = rowOf(state.entities, workerEntityId);
  if (row < 0 || state.entities.cols.hp[row] <= 0) {
    return { ok: false, code: 'unknown_entity' };
  }
  const cols = state.entities.cols;
  const siteRow = site.entityId !== undefined ? rowOf(state.entities, site.entityId) : -1;
  const siteTier = site.tier ?? (siteRow >= 0 ? cols.tier[siteRow] || 1 : 1);
  const tierCheck = checkWorkerBuildTier(cols.kind[row], cols.tier[row] || 1, siteTier);
  if (!tierCheck.ok) return tierCheck;

  const colonyIndex = cols.owner[row];
  const precedence: DispatchPrecedence = site.precedence ?? 'player';
  setField(state.entities, row, 'targetQ', site.q, tick);
  setField(state.entities, row, 'targetR', site.r, tick);
  const dist = hexDistance(cols.x[row], cols.y[row], site.q, site.r);
  const nextState = dist <= 1e-4 ? ENTITY_STATE.constructing : ENTITY_STATE.moving;
  setField(state.entities, row, 'state', nextState, tick);

  const orderId = site.orderId ?? (site.entityId !== undefined ? buildJobKey(site.entityId) : undefined);
  if (orderId) {
    const book = new UnitBook(state);
    const uRec = book.get(workerEntityId);
    uRec.current = { kind: 'build', source: 'player', orderId, q: site.q, r: site.r };
    uRec.queue = [];
    book.touch();
    book.flush(tick);
  }

  const record: WorkerDispatchRecord = {
    workerEntityId,
    colonyIndex,
    jobId: orderId ?? `disp-${colonyIndex}-${tick}-${workerEntityId}`,
    kind: 'build',
    q: site.q,
    r: site.r,
    precedence,
    assignedAtTick: tick,
  };
  const byWorker = getDispatchMap(state);
  byWorker[workerEntityId] = record;
  saveDispatchMap(state, byWorker, tick);
  return { ok: true, record };
}

export const dispatchSystem = defineSystem({
  id: 'dispatch.manager',
  slot: 5,
  wave: 'W02',
  run(state, ctx) {
    const byWorker = getDispatchMap(state);
    let changed = false;
    for (const [idStr, rec] of Object.entries(byWorker)) {
      const id = Number(idStr);
      const r = rowOf(state.entities, id);
      if (r < 0 || state.entities.cols.state[r] === ENTITY_STATE.idle) {
        delete byWorker[id];
        changed = true;
      } else if (rec.assignedAtTick > ctx.tick) {
        changed = true;
      }
    }
    if (changed) saveDispatchMap(state, byWorker, ctx.tick);
  },
});

export default defineSimModule({
  id: 'dispatch',
  wave: 'W02',
  systems: [dispatchSystem],
});

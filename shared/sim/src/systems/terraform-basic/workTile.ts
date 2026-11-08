import type { RejectCode } from '@terra/contracts';
import { ENTITY_KIND, ENTITY_STATE } from '../../ecs/columns';
import { rowOf, setField } from '../../ecs/store';
import { hexDistance, hexIndex } from '../../grid/hex';
import type { CompiledDataLike } from '../../kernel/config';
import type { PlanetState, SimState } from '../../kernel/state';
import { cancelWorkerTask, syncWorkerView as syncWorkerUnitView } from '../harvest';
import { syncHqView } from '../hq/view';
import { UnitBook } from '../../units/book';
import { cancelMove } from '../../units/movement/orchestrator';
import { occupiedGroundTiles } from '../construction/occupancy';
import { isWorkerEligibleForJob } from '../dispatch/eligibility';
import { evaluateGroundWorkTile, type GroundWork } from './groundWorkRule';
import { terraformWorldFromState, type TerraformWorld } from './rules';
import { getWorkJobsMap, type WorkJobRecord } from './workJobs';

export type { GroundTerrainKey, GroundWork } from './groundWorkRule';
export {
  evaluateGroundWorkTile,
  METEOR_CRATER_TERRAFORM_MULTIPLIER,
  planGroundWorkTiles,
  scaleMeteorCraterWork,
  timedGroundWork,
} from './groundWorkRule';

/** Precomputed inputs of {@link classifyGroundWorkTile} for callers that check many tiles (the chain's scan). */
export interface GroundWorkCheckOpts {
  world?: TerraformWorld;
  occupied?: ReadonlySet<number>;
  data?: CompiledDataLike;
}

/**
 * Whether `colonyId` may terraform ground tile `tileIdx` with `work` and what it takes
 * ({@link evaluateGroundWorkTile}: the one ground rule). Checked on enqueue, by the chain and again on completion.
 */
export function classifyGroundWorkTile(
  state: SimState,
  colonyId: number,
  tileIdx: number,
  opts: GroundWorkCheckOpts = {},
): ({ ok: true } & GroundWork) | { ok: false; reason: RejectCode } {
  const world = opts.world ?? terraformWorldFromState(state, colonyId, opts.data);
  const hx = hexIndex(state.grid.radius);
  const q = hx.q[tileIdx];
  const r = hx.r[tileIdx];
  if (q === undefined || r === undefined) return { ok: false, reason: 'invalid_args' };
  const occupied = (opts.occupied ?? occupiedGroundTiles(state, opts.data)).has(tileIdx);
  return evaluateGroundWorkTile(world, colonyId, tileIdx, q, r, {
    deposit: state.grid.layers.deposit,
    occupied,
    weather: state.blobs?.weather,
    data: opts.data,
  });
}

/** A fresh terraform `work` job record for ground tile `(q, r)` (not yet stored). */
export function createGroundWorkJob(
  jobId: string,
  colonyId: number,
  workerEntityId: number,
  tile: { q: number; r: number; tileIdx: number },
  ground: GroundWork,
): WorkJobRecord {
  return {
    jobId, colonyId, mode: 'terraform', terrainKey: ground.terrainKey, workerEntityId,
    q: tile.q, r: tile.r, tileIdx: tile.tileIdx, durationTicks: ground.durationTicks, elapsedTicks: 0, progress: 0,
    startHp: 0, hpMax: 0, energyCost: ground.energyCost, yields: { ...ground.yields },
    ...(ground.workOp ? { workOp: ground.workOp } : {}),
    totalCost: { ...ground.totalCost }, spentCost: {}, status: 'in_progress',
  };
}

/**
 * Selects a Worker Drone or the HQ for a work job at `(q, r)`:
 * - Uses `preferredWorkerId` if valid and alive.
 * - Repair and dismantle are open to every tier; tier 2 is preferred (1.5x repair).
 * - Terraform prefers tier 3, then tier 1, then tier 2.
 */
export function selectWorkerForWorkOp(
  state: SimState,
  colonyId: number,
  q: number,
  r: number,
  preferredWorkerId?: number,
  avoidEntityId?: number,
  mode: 'repair' | 'terraform' | 'dismantle' = avoidEntityId !== undefined ? 'repair' : 'terraform',
): number | null {
  const e = state.entities, cols = e.cols;
  const takes = (kind: number, tier: number): boolean =>
    isWorkerEligibleForJob(kind, tier, {
      kind: 'terraform',
      op: mode === 'repair' ? 'repair' : mode === 'dismantle' ? 'dismantle' : undefined,
    });
  if (preferredWorkerId !== undefined) {
    const r0 = rowOf(e, preferredWorkerId);
    if (r0 >= 0 && cols.owner[r0] === colonyId && cols.hp[r0] > 0 && takes(cols.kind[r0], cols.tier[r0] || 1)) {
      return preferredWorkerId;
    }
  }
  const busyWorkers = new Set(Object.values(getWorkJobsMap(state)).map((j) => j.workerEntityId));
  let bestId: number | null = null;
  let bestScore = Infinity;

  for (let row = 0; row < e.count; row++) {
    if (cols.owner[row] !== colonyId || cols.hp[row] <= 0) continue;
    const kind = cols.kind[row];
    const tier = cols.tier[row] || 1;
    if (!takes(kind, tier)) continue;
    const id = cols.id[row];
    const dist = hexDistance(cols.q[row], cols.r[row], q, r);
    const busyPenalty = busyWorkers.has(id) ? 500 : cols.state[row] === ENTITY_STATE.idle ? 0 : 100;
    const rolePenalty = mode !== 'terraform' ? (tier === 2 ? 0 : 50) : tier >= 3 ? -10 : tier === 2 ? 25 : 0;
    const selfPenalty = avoidEntityId !== undefined && id === avoidEntityId ? 1000 : 0;
    const score = dist + busyPenalty + rolePenalty + selfPenalty;
    if (score < bestScore) {
      bestScore = score;
      bestId = id;
    }
  }
  return bestId;
}

export function syncWorkerView(state: PlanetState, wRow: number, tick: number, data?: CompiledDataLike): void {
  const k = state.entities.cols.kind[wRow];
  if (k === ENTITY_KIND.hq) syncHqView(state, wRow, tick, data);
  else if (k === ENTITY_KIND.worker) syncWorkerUnitView(state, wRow, tick, data);
}

/** Drops the worker's unit commands (an auto terraform / build command, a player move): its work job drives it now. */
function clearUnitCommands(state: PlanetState, workerId: number, tick: number): void {
  cancelMove(state, workerId, tick);
  const book = new UnitBook(state);
  const rec = book.peek(workerId);
  if (!rec || (rec.current === null && rec.queue.length === 0)) return;
  rec.current = null;
  rec.queue = [];
  book.touch();
  book.flush(tick);
}

/**
 * Points the worker at its (first) job tile: a Worker Drone drops its harvest task, any worker its unit commands (the
 * work providers leave a worker with a work job alone, `systems/units/registry.ts`); the work-jobs system walks it there.
 */
export function primeWorkerForWorkJob(state: PlanetState, workerId: number, q: number, r: number, tick: number, data?: CompiledDataLike): void {
  const wRow = rowOf(state.entities, workerId);
  if (wRow < 0) return;
  const cols = state.entities.cols;
  if (cols.kind[wRow] === ENTITY_KIND.worker) cancelWorkerTask(state, workerId, tick);
  else clearUnitCommands(state, workerId, tick);
  setField(state.entities, wRow, 'targetQ', q, tick);
  setField(state.entities, wRow, 'targetR', r, tick);
  const dist = hexDistance(cols.q[wRow], cols.r[wRow], q, r);
  setField(state.entities, wRow, 'state', dist <= 1 ? ENTITY_STATE.working : ENTITY_STATE.moving, tick);
  syncWorkerView(state, wRow, tick, data);
}

import type { RejectCode, ResourceKey } from '@terra/contracts';
import { TERRAFORM_TIME_TABLE, type TerraformTimeKey } from '../../data/ops-basic';
import { ENTITY_KIND, ENTITY_STATE } from '../../ecs/columns';
import { rowOf, setField } from '../../ecs/store';
import { isTileUneven } from '../../grid/geo';
import { hexDistance, hexIndex } from '../../grid/hex';
import { DEPOSIT, PREP, TERRAIN } from '../../grid/layers';
import type { CompiledDataLike } from '../../kernel/config';
import type { PlanetState, SimState } from '../../kernel/state';
import { syncBuilderView } from '../factories-hub';
import { cancelHarvesterTask, syncHarvesterView } from '../harvest';
import { syncHqView } from '../hq/view';
import { UnitBook } from '../../units/book';
import { cancelMove } from '../../units/movement/orchestrator';
import { occupiedGroundTiles } from '../construction/occupancy';
import { isWorkerEligibleForJob } from '../dispatch/eligibility';
import { groundWorkYields } from './ops';
import { terraformOwnershipBlock, terraformWorldFromState, type TerraformWorld } from './rules';
import { getWorkJobsMap, type WorkJobRecord } from './workJobs';

/** What terraforming a ground tile by `work` takes and yields. */
export type GroundWork = { terrainKey: TerraformTimeKey; durationTicks: number; energyCost: number; yields: Partial<Record<ResourceKey, number>> };

function groundWork(key: TerraformTimeKey, data?: CompiledDataLike): { ok: true } & GroundWork {
  const spec = TERRAFORM_TIME_TABLE[key];
  return { ok: true, terrainKey: key, durationTicks: spec.durationTicks, energyCost: spec.energyCost, yields: groundWorkYields(key, data) };
}

/** Precomputed inputs of {@link classifyGroundWorkTile} for callers that check many tiles (the chain's scan). */
export interface GroundWorkCheckOpts {
  world?: TerraformWorld;
  occupied?: ReadonlySet<number>;
  data?: CompiledDataLike;
}

/**
 * Whether `colonyId` may terraform ground tile `tileIdx` with `work` and what it takes. The territory rule of every
 * terraform (`terraformOwnershipBlock`: own tiles; before territory unclaimed ones within `preHubTerraformRadius` of the
 * pod; never foreign), then the ground: no building footprint (`occupiedGroundTiles`), no deposit, not already level prepared Flat;
 * forest, rock, slope, hole, or Flat that is wild or uneven. Checked on enqueue, by the chain and again on completion.
 */
export function classifyGroundWorkTile(
  state: SimState,
  colonyId: number,
  tileIdx: number,
  opts: GroundWorkCheckOpts = {},
): ({ ok: true } & GroundWork) | { ok: false; reason: RejectCode } {
  const world = opts.world ?? terraformWorldFromState(state, colonyId, opts.data);
  if (tileIdx < 0 || tileIdx >= state.grid.count || (world.valid && world.valid[tileIdx] === 0)) return { ok: false, reason: 'invalid_args' };
  const hx = hexIndex(state.grid.radius);
  const territory = terraformOwnershipBlock(world, colonyId, tileIdx, hx.q[tileIdx]!, hx.r[tileIdx]!);
  if (territory) return { ok: false, reason: territory };
  const { terrain, prep, deposit, height } = state.grid.layers;
  if (deposit[tileIdx] !== DEPOSIT.none) return { ok: false, reason: 'site_blocked' };
  if ((opts.occupied ?? occupiedGroundTiles(state, opts.data)).has(tileIdx)) return { ok: false, reason: 'site_blocked' };

  const t = terrain[tileIdx];
  if (t === TERRAIN.forest) return groundWork('forest', opts.data);
  if (t === TERRAIN.rock) return groundWork('rock', opts.data);
  if (t === TERRAIN.slope) return groundWork('slope', opts.data);
  if (t === TERRAIN.hole) return groundWork('hole', opts.data);
  if (t === TERRAIN.flat) {
    if (prep[tileIdx] === PREP.prepared && !isTileUneven(state.grid.radius, tileIdx, terrain, height)) {
      return { ok: false, reason: 'site_blocked' };
    }
    return groundWork('flat', opts.data);
  }
  return { ok: false, reason: 'site_blocked' };
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
    totalCost: {}, spentCost: {}, status: 'in_progress',
  };
}

/**
 * Selects a worker (`builder`, `hq`, or `harvester`) for a work job at `(q, r)`:
 * - Uses `preferredWorkerId` if valid and alive.
 * - For `mode === 'repair'`, prefers idle `ENTITY_KIND.builder` workers first (since Builder repairs at 1.5x),
 *   falling back to nearest idle `hq` or `harvester` if no idle builder is free (or nearest candidate if all are busy).
 * - For `mode === 'dismantle'`, only a Builder Drone or the HQ (`dispatch/eligibility.ts`), a Builder first.
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
  const takes = (kind: number): boolean =>
    mode === 'dismantle'
      ? isWorkerEligibleForJob(kind, 1, { kind: 'terraform', op: 'dismantle' })
      : kind === ENTITY_KIND.hq || kind === ENTITY_KIND.builder || kind === ENTITY_KIND.harvester;
  if (preferredWorkerId !== undefined) {
    const r0 = rowOf(e, preferredWorkerId);
    if (r0 >= 0 && cols.owner[r0] === colonyId && cols.hp[r0] > 0 && takes(cols.kind[r0])) {
      return preferredWorkerId;
    }
  }
  const busyWorkers = new Set(Object.values(getWorkJobsMap(state)).map((j) => j.workerEntityId));
  let bestId: number | null = null;
  let bestScore = Infinity;

  for (let row = 0; row < e.count; row++) {
    if (cols.owner[row] !== colonyId || cols.hp[row] <= 0) continue;
    const kind = cols.kind[row];
    if (!takes(kind)) continue;
    const id = cols.id[row];
    const dist = hexDistance(cols.q[row], cols.r[row], q, r);
    const busyPenalty = busyWorkers.has(id) ? 500 : cols.state[row] === ENTITY_STATE.idle ? 0 : 100;
    const rolePenalty =
      mode !== 'terraform'
        ? kind === ENTITY_KIND.builder
          ? 0
          : 50
        : kind === ENTITY_KIND.builder
          ? 25
          : 0;
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
  else if (k === ENTITY_KIND.harvester) syncHarvesterView(state, wRow, tick, data);
  else if (k === ENTITY_KIND.builder) syncBuilderView(state, wRow, tick, data);
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
 * Points the worker at its (first) job tile: a Harvester drops its harvest task, any worker its unit commands (the work
 * providers leave a worker with a work job alone, `systems/units/registry.ts`); the work-jobs system walks it there.
 */
export function primeWorkerForWorkJob(state: PlanetState, workerId: number, q: number, r: number, tick: number, data?: CompiledDataLike): void {
  const wRow = rowOf(state.entities, workerId);
  if (wRow < 0) return;
  const cols = state.entities.cols;
  if (cols.kind[wRow] === ENTITY_KIND.harvester) cancelHarvesterTask(state, workerId, tick);
  else clearUnitCommands(state, workerId, tick);
  setField(state.entities, wRow, 'targetQ', q, tick);
  setField(state.entities, wRow, 'targetR', r, tick);
  const dist = hexDistance(cols.q[wRow], cols.r[wRow], q, r);
  setField(state.entities, wRow, 'state', dist <= 1 ? ENTITY_STATE.working : ENTITY_STATE.moving, tick);
  syncWorkerView(state, wRow, tick, data);
}

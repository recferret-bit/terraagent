import { compileData, dataRow, type CompiledRow } from '../../data';
import { ENTITY_KIND, ENTITY_STATE } from '../../ecs/columns';
import { insertRow } from '../../ecs/store';
import { hexIndex } from '../../grid/hex';
import type { CompiledDataLike } from '../../kernel/config';
import type { StepContext } from '../../kernel/context';
import { setBlob, touchTile, type PlanetState, type SimState } from '../../kernel/state';
import { defineSimModule } from '../define';

export type { SimState };

export type HqJob = 'idle' | 'moving' | 'working' | 'constructing';

export interface HqUnitView {
  entityId: number;
  owner: number;
  tier: number;
  q: number;
  r: number;
  x: number;
  y: number;
  hp: number;
  hpMax: number;
  cell: number;
  cellMax: number;
  workRate: number;
  viewRadius: number;
  targetQ: number;
  targetR: number;
  currentJob: HqJob;
  queueCount: number;
}

export interface SpawnHqOpts {
  owner: number;
  q: number;
  r: number;
  tick?: number;
  data?: CompiledDataLike;
}

let cachedW01Data: CompiledDataLike | null = null;

export function defaultW01Data(): CompiledDataLike {
  if (!cachedW01Data) cachedW01Data = compileData(new Set(['W00', 'W01']));
  return cachedW01Data;
}

export function resolveHqT1Row(data?: CompiledDataLike): CompiledRow {
  const table = data?.tables.hq as Record<string, CompiledRow> | undefined;
  if (table?.t1) return table.t1;
  return dataRow(defaultW01Data(), 'hq', 't1');
}

export function hqJobFromState(stateCode: number): HqJob {
  if (stateCode === ENTITY_STATE.moving) return 'moving';
  if (stateCode === ENTITY_STATE.working) return 'working';
  if (stateCode === ENTITY_STATE.constructing) return 'constructing';
  return 'idle';
}

/** Marks all tiles within `viewRadius` of `(centerQ, centerR)` as explored for `owner`. */
export function revealVision(
  state: PlanetState,
  owner: number,
  centerQ: number,
  centerR: number,
  viewRadius: number,
  tick: number,
): void {
  if (owner < 0 || owner >= 8) return;
  const mask = 1 << owner;
  const idx = hexIndex(state.grid.radius);
  const explored = state.grid.layers.explored as Uint8Array;
  for (let dr = -viewRadius; dr <= viewRadius; dr++) {
    const dqMin = Math.max(-viewRadius, -dr - viewRadius);
    const dqMax = Math.min(viewRadius, -dr + viewRadius);
    for (let dq = dqMin; dq <= dqMax; dq++) {
      const tileIdx = idx.indexOf(centerQ + dq, centerR + dr);
      if (tileIdx < 0) continue;
      const prev = explored[tileIdx];
      const next = prev | mask;
      if (next !== prev) {
        explored[tileIdx] = next;
        touchTile(state, tileIdx, tick);
      }
    }
  }
}

/** Updates `state.blobs.hq` and colony HQ panel fields for row `row`. */
export function syncHqView(state: PlanetState, row: number, tick: number, data?: CompiledDataLike): HqUnitView {
  const cols = state.entities.cols;
  const hqRow = resolveHqT1Row(data);
  const owner = cols.owner[row];
  const currentJob = hqJobFromState(cols.state[row]);
  const queueCount = currentJob === 'idle' ? 0 : 1;
  const unitView: HqUnitView = {
    entityId: cols.id[row],
    owner,
    tier: cols.tier[row],
    q: cols.q[row],
    r: cols.r[row],
    x: cols.x[row],
    y: cols.y[row],
    hp: cols.hp[row],
    hpMax: cols.hpMax[row],
    cell: cols.cell[row],
    cellMax: cols.cellMax[row],
    workRate: cols.workRate[row],
    viewRadius: Number(hqRow.viewRadius),
    targetQ: cols.targetQ[row],
    targetR: cols.targetR[row],
    currentJob,
    queueCount,
  };
  const prevBlob = (state.blobs.hq?.value as { byColony?: Record<number, HqUnitView> } | undefined)?.byColony ?? {};
  setBlob(state, 'hq', { ...unitView, byColony: { ...prevBlob, [owner]: unitView } }, tick);
  const col = state.colonies[owner];
  if (col) {
    col.hq = unitView;
    col.currentJob = currentJob;
    col.queueCount = queueCount;
    col.changedAt = tick;
  }
  return unitView;
}

/** Returns the current HQ panel view for `owner` (defaults to the first HQ found when `owner` is omitted). */
export function getHqView(state: PlanetState, owner?: number): HqUnitView | null {
  const e = state.entities, cols = e.cols;
  for (let row = 0; row < e.count; row++) {
    if (cols.kind[row] !== ENTITY_KIND.hq) continue;
    if (owner !== undefined && cols.owner[row] !== owner) continue;
    const hqRow = resolveHqT1Row();
    const currentJob = hqJobFromState(cols.state[row]);
    return {
      entityId: cols.id[row],
      owner: cols.owner[row],
      tier: cols.tier[row],
      q: cols.q[row],
      r: cols.r[row],
      x: cols.x[row],
      y: cols.y[row],
      hp: cols.hp[row],
      hpMax: cols.hpMax[row],
      cell: cols.cell[row],
      cellMax: cols.cellMax[row],
      workRate: cols.workRate[row],
      viewRadius: Number(hqRow.viewRadius),
      targetQ: cols.targetQ[row],
      targetR: cols.targetR[row],
      currentJob,
      queueCount: currentJob === 'idle' ? 0 : 1,
    };
  }
  return null;
}

/**
 * Spawns an HQ T1 Commander Drone at `(opts.q, opts.r)` for `opts.owner`, initializes its stats from `hq.t1`,
 * reveals initial fog-of-war within `viewRadius` (9), and returns the spawned `entityId`.
 */
export function spawnHqUnit(state: PlanetState, opts: SpawnHqOpts, ctx?: StepContext): number {
  const tick = opts.tick ?? ctx?.tick ?? state.meta.tick;
  const data = opts.data ?? ctx?.data;
  const hq = resolveHqT1Row(data);
  const id = ctx ? ctx.newEntityId() : state.meta.nextEntityId++;
  const row = insertRow(state.entities, id, tick);
  const cols = state.entities.cols;

  cols.kind[row] = ENTITY_KIND.hq;
  cols.owner[row] = opts.owner;
  cols.tier[row] = Number(hq.tier);
  cols.q[row] = opts.q;
  cols.r[row] = opts.r;
  cols.x[row] = Math.fround(opts.q);
  cols.y[row] = Math.fround(opts.r);
  cols.rot[row] = 0;
  cols.hp[row] = Math.fround(Number(hq.hp));
  cols.hpMax[row] = Math.fround(Number(hq.hp));
  cols.state[row] = ENTITY_STATE.idle;
  cols.progress[row] = 0;
  cols.cell[row] = Math.fround(Number(hq.cellCapacity));
  cols.cellMax[row] = Math.fround(Number(hq.cellCapacity));
  cols.targetQ[row] = opts.q;
  cols.targetR[row] = opts.r;
  cols.workRate[row] = Math.fround(Number(hq.workRate));
  cols.createdAt[row] = tick;
  cols.changedAt[row] = tick;

  revealVision(state, opts.owner, opts.q, opts.r, Number(hq.viewRadius), tick);
  syncHqView(state, row, tick, data);
  return id;
}

export default defineSimModule({ id: 'hq', wave: 'W01' });

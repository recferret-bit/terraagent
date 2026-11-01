import { ENTITY_KIND, ENTITY_STATE } from '../../ecs/columns';
import type { CompiledDataLike } from '../../kernel/config';
import { setBlob, type PlanetState } from '../../kernel/state';
import { resolveHqT1Row, rowNum } from '../rows';
import { colonyTerraformOrders } from '../terraform-basic/orders';

/**
 * The HQ panel view (`col.hq`, mirrored in `blobs.hq.byColony`): what the client's HQ panel and HUD show. It is
 * rebuilt from the HQ's columns and the colony's terraform queue, and written only when it changed (GP-15), so an idle
 * planet sends no HQ data in its deltas.
 */

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

export function hqJobFromState(stateCode: number): HqJob {
  if (stateCode === ENTITY_STATE.moving) return 'moving';
  if (stateCode === ENTITY_STATE.working) return 'working';
  if (stateCode === ENTITY_STATE.constructing) return 'constructing';
  return 'idle';
}

/** `row` when it is an HQ entity row, else -1 (no guessing between rows and ids, GP-16). */
export function resolveHqRow(state: PlanetState, row: number): number {
  const e = state.entities;
  return Number.isInteger(row) && row >= 0 && row < e.count && e.cols.kind[row] === ENTITY_KIND.hq ? row : -1;
}

function queueCountOf(state: PlanetState, owner: number, currentJob: HqJob): number {
  const orders = colonyTerraformOrders(state, owner).length;
  if (orders > 0) return orders;
  return currentJob === 'idle' ? 0 : 1;
}

/** Builds the panel view of HQ row `row` (the one view builder: `syncHqView` and `getHqView` both use it). */
function buildHqView(state: PlanetState, row: number, data?: CompiledDataLike): HqUnitView {
  const cols = state.entities.cols;
  const owner = cols.owner[row];
  const currentJob = hqJobFromState(cols.state[row]);
  return {
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
    viewRadius: rowNum(resolveHqT1Row(data), 'viewRadius'),
    targetQ: cols.targetQ[row],
    targetR: cols.targetR[row],
    currentJob,
    queueCount: queueCountOf(state, owner, currentJob),
  };
}

function sameView(a: HqUnitView | undefined, b: HqUnitView): boolean {
  if (!a) return false;
  for (const k of Object.keys(b) as (keyof HqUnitView)[]) if (a[k] !== b[k]) return false;
  return true;
}

/**
 * Refreshes the panel view of HQ row `row` in `col.hq` / `col.currentJob` / `col.queueCount` and in
 * `blobs.hq.byColony[owner]`, stamping both at `tick` only when the view changed. Returns the view (or `null` when
 * `row` is not an HQ).
 */
export function syncHqView(state: PlanetState, row: number, tick: number, data?: CompiledDataLike): HqUnitView | null {
  if (resolveHqRow(state, row) < 0) return null;
  const view = buildHqView(state, row, data);
  const col = state.colonies[view.owner];
  const byColony = (state.blobs.hq?.value as { byColony?: Record<number, HqUnitView> } | undefined)?.byColony ?? {};
  if (sameView(byColony[view.owner], view) && (!col || sameView(col.hq as HqUnitView | undefined, view))) return view;
  setBlob(state, 'hq', { byColony: { ...byColony, [view.owner]: view } }, tick);
  if (col) {
    col.hq = view;
    col.currentJob = view.currentJob;
    col.queueCount = view.queueCount;
    col.changedAt = tick;
  }
  return view;
}

/** The current panel view of `owner`'s HQ (the first HQ found when `owner` is omitted), or `null`. */
export function getHqView(state: PlanetState, owner?: number): HqUnitView | null {
  const e = state.entities, cols = e.cols;
  for (let row = 0; row < e.count; row++) {
    if (cols.kind[row] !== ENTITY_KIND.hq) continue;
    if (owner !== undefined && cols.owner[row] !== owner) continue;
    return buildHqView(state, row);
  }
  return null;
}

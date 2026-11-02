import { getColonyStock } from '../../economy';
import { ENTITY_STATE } from '../../ecs/columns';
import { rowOf, setField } from '../../ecs/store';
import { hexIndex } from '../../grid/hex';
import { isBuildablePrepared } from '../../grid/tileModel';
import type { StepContext } from '../../kernel/context';
import type { PlanetState } from '../../kernel/state';
import { payConstructionCost } from './build';
import { readConstructionOrders, setOrderStatus, writeConstructionOrders, type ConstructionOrder } from './orders';
import { getBuildingFootprintTiles } from './placement';

function countPreparedFootprintTiles(state: PlanetState, order: ConstructionOrder): { preparedCount: number; totalTiles: number } {
  const hex = hexIndex(state.grid.radius);
  const coords = getBuildingFootprintTiles(order.q, order.r, order.footprint);
  let preparedCount = 0;
  for (const pos of coords) {
    const tileIdx = hex.indexOf(pos.q, pos.r);
    if (tileIdx >= 0 && isBuildablePrepared(state.grid, tileIdx)) preparedCount++;
  }
  return { preparedCount, totalTiles: coords.length };
}

function setEntityState(state: PlanetState, entityRow: number, code: number, tick: number): void {
  if (entityRow >= 0) setField(state.entities, entityRow, 'state', code, tick);
}

/** One open order's site / payment state; returns whether the order changed. */
function stepOrder(state: PlanetState, order: ConstructionOrder, tick: number): boolean {
  const { preparedCount, totalTiles } = countPreparedFootprintTiles(state, order);
  const entityRow = rowOf(state.entities, order.entityId);
  let changed = order.preparedCount !== preparedCount || order.totalTiles !== totalTiles;
  order.preparedCount = preparedCount;
  order.totalTiles = totalTiles;
  if (preparedCount < totalTiles) {
    // A site that is (or became) unprepared waits for it, also mid-build (`UO-Q-04`).
    changed = setOrderStatus(order, 'waiting_site', `waiting(site: ${preparedCount}/${totalTiles})`) || changed;
    setEntityState(state, entityRow, ENTITY_STATE.waiting, tick);
    return changed;
  }
  if (!order.costPaid) {
    const pay = payConstructionCost(state, order);
    if (!pay.ok) {
      changed = setOrderStatus(order, 'waiting_resources', pay.waitingReason ?? 'waiting(resources)') || changed;
      setEntityState(state, entityRow, ENTITY_STATE.waiting, tick);
      return changed;
    }
    changed = true;
  } else if (order.status === 'waiting_resources') {
    // Paused mid-build by a shortage: resumes once stock covers the slice it waited on (a blocked cost never does).
    const w = order.waitingFor;
    if (!w || (getColonyStock(state, order.colonyId)[w.resource as keyof ReturnType<typeof getColonyStock>] ?? 0) < w.need) return changed;
  }
  if (order.status !== 'in_progress') {
    changed = setOrderStatus(order, 'in_progress') || changed;
    setEntityState(state, entityRow, ENTITY_STATE.constructing, tick);
  }
  // In progress: the `build` unit command walks a builder into reach and advances the order (./work.ts).
  return changed;
}

/**
 * Steps construction orders (`UO-TF-03`, `UO-Q-01/02/04`, `UO-L-05`, `W01-15`, `W01-16`): recounts prepared footprint
 * tiles (`waiting(site: n/m)`), passes the start gate once every footprint tile is prepared (the full cost must be
 * affordable), resumes an order paused by a shortage once stock covers it. The queue is written only when an order
 * changed (GP-07), so an order that waits sends nothing.
 */
export function stepConstruction(state: PlanetState, ctx?: Partial<StepContext>): void {
  const tick = ctx?.tick ?? state.meta.tick;
  const orders = readConstructionOrders(state);
  let changed = false;
  for (const order of orders) changed = stepOrder(state, order, tick) || changed;
  if (changed) writeConstructionOrders(state, orders, tick);
}

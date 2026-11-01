import { rowOf } from '../../ecs/store';
import { approach, atGoal } from '../../units/approach';
import { faceTowards } from '../../units/movement/locomotion';
import { defineUnitCommand, type BuildCommand, type UnitCtx, type UnitWorkProvider } from '../../units/types';
import { advanceConstructionProgress } from './build';
import { readConstructionOrders, writeConstructionOrders } from './index';

/**
 * Construction as unit work (`UO-L-05`, `UO-Q-01`). The construction queue (`state.blobs.constructionQueue`) says WHAT
 * to build; the `build` unit command does it: the builder walks (movement orchestrator) to a tile within its build
 * reach of the site centre, outside the footprint, then advances the order each step. Payment starts when the site is
 * ready (construction system); the cost is spent as progress is made.
 */

const EN_ROUTE = 'waiting(builder: HQ en route)';

const reachOf = (u: UnitCtx, order: { q: number; r: number }) => ({ q: order.q, r: order.r, minDist: u.stats.buildReach[0], maxDist: u.stats.buildReach[1] });

function readyOrder(u: UnitCtx, c: BuildCommand) {
  const orders = readConstructionOrders(u.state);
  const order = orders.find((o) => o.orderId === c.orderId && o.colonyId === u.owner);
  return order && order.status === 'in_progress' ? { orders, order } : null;
}

export const buildCommand = defineUnitCommand<BuildCommand>({
  kind: 'build',
  phase: 'construction',
  key: (c) => `build:${c.orderId}`,
  /** Units slot: walk to a tile within build reach of the site (outside its footprint) and face it. */
  execute(u, c) {
    const found = readyOrder(u, c);
    if (!found) return 'done';
    const { orders, order } = found;
    const status = approach(u, reachOf(u, order));
    if (status !== 'arrived') {
      if (order.statusText !== EN_ROUTE) {
        order.statusText = EN_ROUTE;
        writeConstructionOrders(u.state, orders, u.ctx.tick);
      }
      return status === 'failed' ? 'failed' : 'running';
    }
    faceTowards(u.state, u.row, order.q, order.r, u.ctx.tick);
    return 'running';
  },
  /** Construction slot: one step of build progress (and the matching slice of the cost). */
  work(u, c) {
    const found = readyOrder(u, c);
    if (!found) return 'done';
    const { orders, order } = found;
    if (!atGoal(u, reachOf(u, order))) return 'running';
    advanceConstructionProgress(u.state, order, rowOf(u.state.entities, order.entityId), u.row, u.ctx.tick, u.ctx);
    writeConstructionOrders(u.state, orders, u.ctx.tick);
    return (order.status as string) === 'completed' ? 'done' : 'running'; // advanced above (TS narrowed the type)
  },
});

/** Hands an idle builder the colony's oldest construction order that is ready for work (site prepared, started). */
export const buildProvider: UnitWorkProvider = {
  id: 'build',
  propose(u) {
    const cur = u.record.current;
    const ready = readConstructionOrders(u.state).filter((o) => o.colonyId === u.owner && o.status === 'in_progress');
    const skipped = (key: string) => (u.record.skip[`build:${key}`] ?? 0) > u.ctx.tick;
    if (cur?.kind === 'build' && !skipped(cur.orderId) && ready.some((o) => o.orderId === cur.orderId)) return cur;
    const next = ready.find((o) => !skipped(o.orderId));
    return next ? { kind: 'build', source: 'auto', orderId: next.orderId, q: next.q, r: next.r } : null;
  },
};

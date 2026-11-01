import { ENTITY_STATE } from '../../ecs/columns';
import { rowOf } from '../../ecs/store';
import { approach, atGoal, setUnitActivity } from '../../units/approach';
import { faceTowards } from '../../units/movement/locomotion';
import { defineUnitCommand, type BuildCommand, type UnitCtx, type UnitWorkProvider } from '../../units/types';
import { syncHqView } from '../hq/view';
import { advanceConstructionProgress } from './build';
import { constructionOrdersOf, readConstructionOrders, writeConstructionOrders } from './orders';

/**
 * Construction as unit work (`UO-L-05`, `UO-Q-01`). The construction queue (`state.blobs.constructionQueue`) says WHAT
 * to build; the `build` unit command does it: the builder walks (movement orchestrator) to a tile within its build
 * reach of the site centre, outside the footprint, then advances the order each step. Payment starts when the site is
 * ready (construction system); the cost is spent as progress is made. The command sets the builder's state; build
 * code only reports progress (GP-16).
 */

const EN_ROUTE = 'waiting(builder: HQ en route)';

const reachOf = (u: UnitCtx, order: { q: number; r: number }) => ({ q: order.q, r: order.r, minDist: u.stats.buildReach[0], maxDist: u.stats.buildReach[1] });

/** The colony's order `c` names while it is in progress (read-only). */
function readyOrder(u: UnitCtx, c: BuildCommand) {
  const order = constructionOrdersOf(u.state.blobs.constructionQueue?.value, u.owner).find((o) => o.orderId === c.orderId);
  return order && order.status === 'in_progress' ? order : null;
}

export const buildCommand = defineUnitCommand<BuildCommand>({
  kind: 'build',
  phase: 'construction',
  key: (c) => `build:${c.orderId}`,
  /** Units slot: walk to a tile within build reach of the site (outside its footprint) and face it. */
  execute(u, c) {
    const order = readyOrder(u, c);
    if (!order) return 'done';
    const status = approach(u, reachOf(u, order));
    if (status !== 'arrived') {
      if (order.statusText !== EN_ROUTE) {
        const orders = readConstructionOrders(u.state);
        const own = orders.find((o) => o.orderId === order.orderId);
        if (own) own.statusText = EN_ROUTE;
        writeConstructionOrders(u.state, orders, u.ctx.tick);
      }
      return status === 'failed' ? 'failed' : 'running';
    }
    faceTowards(u.state, u.row, order.q, order.r, u.ctx.tick);
    return 'running';
  },
  /** Construction slot: one step of build progress (and the matching slice of the cost). */
  work(u, c) {
    const ready = readyOrder(u, c);
    if (!ready) return 'done';
    if (!atGoal(u, reachOf(u, ready))) return 'running';
    const orders = readConstructionOrders(u.state);
    const order = orders.find((o) => o.orderId === ready.orderId);
    if (!order) return 'done';
    setUnitActivity(u, ENTITY_STATE.constructing, order.q, order.r);
    const res = advanceConstructionProgress(u.state, order, rowOf(u.state.entities, order.entityId), u.row, u.ctx.tick, u.ctx);
    writeConstructionOrders(u.state, orders, u.ctx.tick);
    if (res !== 'running') {
      const cols = u.state.entities.cols;
      setUnitActivity(u, ENTITY_STATE.idle, cols.q[u.row], cols.r[u.row]);
    }
    syncHqView(u.state, u.row, u.ctx.tick, u.ctx.data);
    return res === 'running' ? 'running' : 'done';
  },
});

/** Hands an idle builder the colony's oldest construction order that is ready for work (site prepared, started). */
export const buildProvider: UnitWorkProvider = {
  id: 'build',
  propose(u) {
    const cur = u.record.current;
    const ready = constructionOrdersOf(u.state.blobs.constructionQueue?.value, u.owner).filter((o) => o.status === 'in_progress');
    const skipped = (key: string) => (u.record.skip[`build:${key}`] ?? 0) > u.ctx.tick;
    if (cur?.kind === 'build' && !skipped(cur.orderId) && ready.some((o) => o.orderId === cur.orderId)) return cur;
    const next = ready.find((o) => !skipped(o.orderId));
    return next ? { kind: 'build', source: 'auto', orderId: next.orderId, q: next.q, r: next.r } : null;
  },
};

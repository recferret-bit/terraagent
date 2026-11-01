import { rowOf } from '../../ecs/store';
import { approach } from '../../units/approach';
import { faceTowards } from '../../units/movement/locomotion';
import { defineUnitCommand, type BuildCommand, type UnitWorkProvider } from '../../units/types';
import { advanceConstructionProgress } from './build';
import { readConstructionOrders, writeConstructionOrders } from './index';

/**
 * Construction as unit work (`UO-L-05`, `UO-Q-01`). The construction queue (`state.blobs.constructionQueue`) says WHAT
 * to build; the `build` unit command does it: the builder walks (movement orchestrator) to a tile within its build
 * reach of the site centre, outside the footprint, then advances the order each step. Payment starts when the site is
 * ready (construction system); the cost is spent as progress is made.
 */

const EN_ROUTE = 'waiting(builder: HQ en route)';

export const buildCommand = defineUnitCommand<BuildCommand>({
  kind: 'build',
  key: (c) => `build:${c.orderId}`,
  execute(u, c) {
    const orders = readConstructionOrders(u.state);
    const order = orders.find((o) => o.orderId === c.orderId && o.colonyId === u.owner);
    if (!order || order.status !== 'in_progress') return 'done';
    const [minDist, maxDist] = u.stats.buildReach;
    const status = approach(u, { q: order.q, r: order.r, minDist, maxDist });
    if (status !== 'arrived') {
      if (order.statusText !== EN_ROUTE) {
        order.statusText = EN_ROUTE;
        writeConstructionOrders(u.state, orders, u.ctx.tick);
      }
      return status === 'failed' ? 'failed' : 'running';
    }
    faceTowards(u.state, u.row, order.q, order.r, u.ctx.tick);
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

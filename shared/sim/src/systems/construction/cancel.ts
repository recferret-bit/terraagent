import { treasuryCtx } from '../../economy';
import { removeRow } from '../../ecs/store';
import { bumpPathEpoch } from '../../grid/tileModel';
import type { CompiledDataLike } from '../../kernel/config';
import type { StepContext } from '../../kernel/context';
import type { SimState } from '../../kernel/state';
import { findColonyHqRow } from '../find';
import { syncHqView } from '../hq/view';
import { removeTerraformOrder } from '../terraform-basic/queue';
import { refundCancelledConstruction } from './build';
import { constructionOrdersOf, findConstructionOrder, readConstructionOrders, writeConstructionOrders } from './orders';

/**
 * Cancels the colony's open construction order `id` (order id, the client's task id or the building's entity id;
 * `'current'` = the colony's first open order). Refunds 75 % of what was paid when payment had started, removes its
 * linked site prep and the pending building entity; tiles already prepared stay prepared (`UO-TF-03`, `UO-Q-02`,
 * `W01-16`). A builder working on it notices in its next step and goes idle (GP-16). Returns whether an order was
 * cancelled.
 */
export function cancelConstructionOrder(
  state: SimState,
  colonyId: number,
  id: string,
  tick: number = state.meta.tick,
  data?: CompiledDataLike,
  ctx?: Pick<StepContext, 'record'> & Partial<Pick<StepContext, 'emit'>>,
): boolean {
  const target = id === 'current' ? constructionOrdersOf(state.blobs.constructionQueue?.value, colonyId)[0] : findConstructionOrder(state, colonyId, id);
  if (!target) return false;
  writeConstructionOrders(state, readConstructionOrders(state).filter((o) => o.orderId !== target.orderId), tick);
  if (target.costPaid) refundCancelledConstruction(state, target, data, treasuryCtx(tick, ctx));
  if (target.linkedPrepOrderId) removeTerraformOrder(state, colonyId, target.linkedPrepOrderId, tick, data);
  removeRow(state.entities, target.entityId, tick);
  bumpPathEpoch(state.meta);
  const hqRow = findColonyHqRow(state, colonyId);
  if (hqRow >= 0) syncHqView(state, hqRow, tick, data);
  return true;
}

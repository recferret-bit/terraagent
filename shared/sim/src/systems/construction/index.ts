import { defineCommandHandler } from '../../kernel/commands';
import type { SimState } from '../../kernel/state';
import { defineSystem } from '../../kernel/system';
import { commandColony, parseArgs } from '../command';
import { defineSimModule } from '../define';
import { checkItemUnlockStage } from '../progression/validate';
import { colonyTerraformOrders } from '../terraform-basic/orders';
import './occupancy';
import { placeBuildingOrder } from './place';
import { placementBlockText } from './placement';
import { constructionOrdersOf } from './orders';
import { stepConstruction } from './site';

export * from './build';
export * from './cancel';
export * from './orders';
export * from './place';
export * from './placement';
export * from './placementWorld';
export * from './prep';
export * from './site';
export * from './validate';

/**
 * Whether `id` already names one of the colony's open orders in either lane (order id or the client's task id): a
 * client id is used once, so a cancel by it never hits two orders (GP-09).
 */
export function isOrderIdTaken(state: SimState, colonyId: number, id: string): boolean {
  const names = (o: { orderId: string; taskId: string }) => o.orderId === id || o.taskId === id;
  return constructionOrdersOf(state.blobs.constructionQueue?.value, colonyId).some(names) || colonyTerraformOrders(state, colonyId).some(names);
}

export const placeBuilding = defineCommandHandler({
  kind: 'placeBuilding',
  wave: 'W01',
  handle(state, cmd, ctx) {
    const colonyId = commandColony(cmd);
    if (typeof colonyId === 'string') return colonyId;
    const args = parseArgs('placeBuilding', cmd.args);
    if (!args) return 'invalid_args';
    if (isOrderIdTaken(state, colonyId, cmd.commandId)) return 'invalid_args';
    if (cmd.source !== 'system' && (cmd.source as string) !== 'module') {
      const stageCheck = checkItemUnlockStage(state, colonyId, args.building, ctx.flags);
      if (!stageCheck.ok) {
        return { code: stageCheck.code, detail: stageCheck.detail, unlocksAt: stageCheck.unlocksAt };
      }
    }
    const res = placeBuildingOrder(
      state,
      { colonyId, q: args.q, r: args.r, buildingKind: args.building, tier: args.tier, taskId: cmd.commandId, tick: ctx.tick, data: ctx.data },
      ctx,
    );
    if (res.ok) return;
    const block = res.validation.block;
    return { code: res.reason ?? 'site_blocked', ...(block ? { detail: placementBlockText(block) } : {}) };
  },
});

/**
 * Construction slot (6), after `constructionProgress` (same slot, id order): site / payment state. A site finished this
 * step goes `in_progress` now and a builder takes it up from the next step's units slot.
 */
export const construction = defineSystem({
  id: 'constructionSite',
  slot: 6,
  wave: 'W01',
  run(state, ctx) {
    stepConstruction(state, ctx);
  },
});

export default defineSimModule({
  id: 'construction',
  wave: 'W01',
  systems: [construction],
  handlers: [placeBuilding],
});

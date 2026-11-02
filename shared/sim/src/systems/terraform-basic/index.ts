import { defineCommandHandler } from '../../kernel/commands';
import { commandColony, parseArgs } from '../command';
import { cancelConstructionOrder, isOrderIdTaken } from '../construction';
import { defineSimModule } from '../define';
import { cancelQueueTask, enqueueTaskHandler, getAllQueueEntries, normalizeEnqueueArgs } from '../queue';
import { cancelTerraformOrder, enqueueTerraformOrder, findTerraformOrder } from './queue';
import { enqueueAutoPrepares } from './rules';

export * from './ops';
export * from './orders';
export * from './queue';
export * from './rules';
export { linkedPrepProvider, terraformCommand, terraformProvider } from './work';

export const enqueueTask = defineCommandHandler({
  kind: 'enqueueTask',
  wave: 'W01',
  handle(state, cmd, ctx) {
    const raw = (cmd.args ?? {}) as Record<string, unknown>;
    if (!('terraform' in raw)) {
      const norm = normalizeEnqueueArgs(raw);
      if (!norm.task || typeof norm.task.kind !== 'string') return 'invalid_args';
      if (!ctx.flags.has('W02')) return 'wave_disabled';
      return enqueueTaskHandler.handle(state, cmd, ctx);
    }
    const colonyId = commandColony(cmd);
    if (typeof colonyId === 'string') return colonyId;
    const args = parseArgs('enqueueTask', cmd.args);
    if (!args || !('terraform' in args)) return 'invalid_args';
    if (isOrderIdTaken(state, colonyId, cmd.commandId)) return 'invalid_args';
    const { op, tiles } = args.terraform;
    const res = enqueueTerraformOrder(state, {
      colonyId,
      op,
      autoPrepare: enqueueAutoPrepares(op, tiles.length),
      tiles,
      taskId: cmd.commandId,
      tick: ctx.tick,
      data: ctx.data,
    });
    if (!res.ok) return res.reason ?? 'site_blocked';
  },
});

/**
 * `cancelTask { taskId }` (GP-10): cancels one order in its own lane. `taskId` names an order by its order id, the
 * client's id (the command id that created it) or, for a building, its entity id. Lane wildcards: `'active'` = the
 * colony's first manual terraform order, `'current'` = its open construction order; they never cross lanes. A Hub's
 * linked prep cancels the Hub's construction order (refund rules). Nothing matched → `unknown_entity`.
 */
export const cancelTask = defineCommandHandler({
  kind: 'cancelTask',
  wave: 'W01',
  handle(state, cmd, ctx) {
    const args = parseArgs('cancelTask', cmd.args);
    if (!args) return 'invalid_args';
    const id = args.taskId;
    if (ctx.flags.has('W02')) {
      const hasQueueEntry = getAllQueueEntries(state).some(
        (e) => e.taskId === id && e.state !== 'done' && e.state !== 'cancelled',
      );
      if (hasQueueEntry) {
        const res = cancelQueueTask(state, id, cmd.colonyIndex, ctx.tick, ctx.data);
        return res.ok ? undefined : res.code;
      }
    }
    const colonyId = commandColony(cmd);
    if (typeof colonyId === 'string') return colonyId;
    const cancelBuild = (key: string) => cancelConstructionOrder(state, colonyId, key, ctx.tick, ctx.data, ctx);
    let done: boolean;
    if (id === 'current') done = cancelBuild('current');
    else if (id === 'active') done = cancelTerraformOrder(state, colonyId, 'active', ctx.tick, ctx.data);
    else {
      const tf = findTerraformOrder(state, colonyId, id);
      if (tf?.isLinkedPrep) done = tf.linkedOrderId !== undefined && cancelBuild(tf.linkedOrderId);
      else if (tf) done = cancelTerraformOrder(state, colonyId, tf.orderId, ctx.tick, ctx.data);
      else done = cancelBuild(id);
    }
    if (!done) return 'unknown_entity';
  },
});

export default defineSimModule({
  id: 'terraform-basic',
  wave: 'W01',
  handlers: [enqueueTask, cancelTask],
});

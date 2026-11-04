import type { RejectCode } from '@terra/contracts';
import { rowOf } from '../../ecs/store';
import { defineCommandHandler } from '../../kernel/commands';
import { commandColony, parseArgs } from '../command';
import { cancelConstructionOrder, isOrderIdTaken } from '../construction';
import { defineSimModule } from '../define';
import type { StepContext } from '../../kernel/context';
import type { PlanetState } from '../../kernel/state';
import { cancelQueueTask, enqueueAuthority, enqueueTaskHandler, getAllQueueEntries, normalizeEnqueueArgs } from '../queue';
import { sameKindTaskIds } from '../queue/cancelGroup';
import { mirrorRepairQueueEntry } from './autoRepair';
import { enqueueWorkAtTile, executeDismantleAtTile, hasWorkJob, workJobsSystem } from './dismantleAndWork';
import { checkItemUnlockStage, resolveItemUnlockStage } from '../progression/validate';
import { isTerraformOpKind } from './ops';
import { cancelTerraformOrder, enqueueTerraformOrder, findTerraformOrder } from './queue';
import { enqueueAutoPrepares } from './rules';
import { enqueueWorkOrder } from './workOrder';

export * from './autoRepair';
export * from './chain';
export * from './dismantleAndWork';
export * from './ops';
export * from './orders';
export * from './queue';
export * from './resourceSpawn';
export * from './rules';
export { enqueueWorkOrder, type WorkOrderArgs } from './workOrder';
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
    const rawTf = raw.terraform as { op?: unknown; tiles?: unknown } | undefined;
    if (
      cmd.source !== 'system' &&
      (cmd.source as string) !== 'module' &&
      rawTf &&
      typeof rawTf === 'object' &&
      typeof rawTf.op === 'string' &&
      Array.isArray(rawTf.tiles) &&
      rawTf.tiles.length > 0
    ) {
      const stageCheck = checkItemUnlockStage(state, colonyId, rawTf.op, ctx.flags, ctx.data);
      if (!stageCheck.ok) {
        return { code: stageCheck.code, detail: stageCheck.detail, unlocksAt: stageCheck.unlocksAt };
      }
      if (ctx.flags.has('W02') && !isTerraformOpKind(rawTf.op) && resolveItemUnlockStage(rawTf.op) >= 2 && rawTf.op !== 'dismantle') {
        return enqueueTaskHandler.handle(state, cmd, ctx);
      }
    }
    const args = parseArgs('enqueueTask', cmd.args);
    if (!args || !('terraform' in args)) return 'invalid_args';
    const { op, tiles, entityId } = args.terraform;

    if (op === 'dismantle') {
      if (hasWorkJob(state, cmd.commandId)) return 'invalid_args';
      let anyOk = false;
      let firstReject: RejectCode | undefined;
      for (let i = 0; i < tiles.length; i++) {
        const t = tiles[i]!;
        const taskId = tiles.length > 1 ? `${cmd.commandId}:${i}` : cmd.commandId; // a dismantle job's id (cancelTask)
        const dRes = executeDismantleAtTile(state, colonyId, t.q, t.r, ctx.tick, ctx.data, entityId, taskId);
        if (dRes.ok) anyOk = true;
        else if (!firstReject || dRes.reason === 'cannot_dismantle_hq') firstReject = dRes.reason;
      }
      return anyOk ? undefined : (firstReject ?? 'site_blocked');
    }

    // A client id names one order or job (GP-09): a cancel by it never hits two.
    if (isOrderIdTaken(state, colonyId, cmd.commandId) || hasWorkJob(state, cmd.commandId)) return 'invalid_args';
    if (op === 'work') return enqueueWorkOrder(state, colonyId, args.terraform, cmd.commandId, ctx.tick, ctx.data);
    const res = enqueueTerraformOrder(state, {
      colonyId,
      op,
      autoPrepare: enqueueAutoPrepares(op, tiles.length),
      tiles,
      taskId: cmd.commandId,
      tick: ctx.tick,
      data: ctx.data,
    });
    if (!res.ok) {
      if (
        res.reason === 'site_blocked' &&
        ctx.flags.has('W08') &&
        typeof state.colonies[colonyId]?.stage === 'number' &&
        resolveItemUnlockStage(op) >= 2
      ) {
        return enqueueTaskHandler.handle(state, cmd, ctx);
      }
      return res.reason ?? 'site_blocked';
    }
  },
});

/**
 * `cancelTask { taskId, scope? }` (GP-10): cancels one order (`scope: 'sameKind'`: every open order, job and entry of the
 * same kind in the colony, one host path, see `queue/cancelGroup.ts`) in its own lane. `taskId` names an order by its order id, the
 * client's id (the command id that created it) or, for a building, its entity id. Lane wildcards: `'active'` = the
 * colony's first manual terraform order, `'current'` = its open construction order; they never cross lanes. A Hub's
 * linked prep cancels the Hub's construction order (refund rules). Nothing matched → `unknown_entity` (W01) /
 * `unknown_task` (with W02 on: no order, queue entry or task of the colony has that id).
 */
export const cancelTask = defineCommandHandler({
  kind: 'cancelTask',
  wave: 'W01',
  handle(state, cmd, ctx) {
    const args = parseArgs('cancelTask', cmd.args);
    if (!args) return 'invalid_args';
    const colonyId = commandColony(cmd);
    if (typeof colonyId === 'string') return colonyId;
    if (args.scope !== 'sameKind') return cancelOneTask(state, colonyId, args.taskId, ctx);
    // One host path for "cancel all of this kind": every same-kind order / job / entry goes through the one-order cancel.
    let firstError: string | undefined;
    let any = false;
    for (const id of sameKindTaskIds(state, args.taskId, colonyId)) {
      const err = cancelOneTask(state, colonyId, id, ctx);
      if (err === undefined) any = true;
      else firstError ??= err;
    }
    return any ? undefined : firstError ?? 'unknown_entity';
  },
});

/** Cancels the one order `id` (rules in {@link cancelTask}); a reject code, or undefined when it was cancelled. */
function cancelOneTask(state: PlanetState, colonyId: number, id: string, ctx: StepContext): string | undefined {
  if (ctx.flags.has('W02')) {
    const isSpecialW02Id =
      id === 'all' ||
      id.startsWith('building:') ||
      id.startsWith('harvester:') ||
      id.startsWith('unit:') ||
      hasWorkJob(state, id) ||
      getAllQueueEntries(state).some((e) => e.taskId === id && e.state !== 'done' && e.state !== 'cancelled');
    if (isSpecialW02Id) {
      const res = cancelQueueTask(state, id, colonyId, ctx.tick, ctx.data);
      return res.ok ? undefined : res.code;
    }
  }
  const cancelBuild = (key: string) => cancelConstructionOrder(state, colonyId, key, ctx.tick, ctx.data, ctx);
  let done: boolean;
  // A W02 building's linked prep names its building (`building:<entityId>`): cancelling the prep cancels the building.
  let w02Id = id;
  if (id === 'current') done = cancelBuild('current');
  else if (id === 'active') done = cancelTerraformOrder(state, colonyId, 'active', ctx.tick, ctx.data);
  else {
    const tf = findTerraformOrder(state, colonyId, id);
    if (tf?.isLinkedPrep) done = tf.linkedOrderId !== undefined && cancelBuild(tf.linkedOrderId);
    else if (tf) done = cancelTerraformOrder(state, colonyId, tf.orderId, ctx.tick, ctx.data);
    else done = cancelBuild(id);
    if (tf?.isLinkedPrep && tf.linkedOrderId !== undefined) w02Id = tf.linkedOrderId;
  }
  if (!done && ctx.flags.has('W02')) {
    const w02Res = cancelQueueTask(state, w02Id, colonyId, ctx.tick, ctx.data);
    if (w02Res.ok) return undefined;
    if (w02Res.code === 'not_own_colony' || w02Res.code === 'unknown_task') return w02Res.code;
  }
  return done ? undefined : 'unknown_entity';
}

export const repair = defineCommandHandler({
  kind: 'repair',
  wave: 'W03',
  handle(state, cmd, ctx) {
    if (!ctx.flags.has('W03')) return 'wave_disabled';
    const colonyId = commandColony(cmd);
    if (typeof colonyId === 'string') return colonyId;
    const args = parseArgs('repair', cmd.args);
    if (!args) return 'invalid_args';
    let q = args.q;
    let r = args.r;
    if ((q === undefined || r === undefined) && args.entityId !== undefined) {
      const row = rowOf(state.entities, args.entityId);
      if (row < 0) return 'unknown_entity';
      if (state.entities.cols.owner[row] !== colonyId) return 'not_own_colony';
      q = state.entities.cols.q[row];
      r = state.entities.cols.r[row];
    }
    if (q === undefined || r === undefined) return 'invalid_args';
    const res = enqueueWorkAtTile(state, colonyId, q, r, {
      workerId: args.workerId,
      entityId: args.entityId,
      taskId: args.taskId ?? cmd.commandId,
      tick: ctx.tick,
      data: ctx.data,
      intent: 'repair',
    });
    if (!res.ok) return res.reason;
    const { precedence } = enqueueAuthority(cmd.source, { precedence: args.precedence });
    mirrorRepairQueueEntry(state, res.job, precedence ?? 'player', ctx.tick, ctx.data);
  },
});

export default defineSimModule({
  id: 'terraform-basic',
  wave: 'W01',
  systems: [workJobsSystem],
  handlers: [enqueueTask, cancelTask, repair],
});

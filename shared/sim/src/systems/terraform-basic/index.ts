import { defineCommandHandler } from '../../kernel/commands';
import { cancelConstructionOrder } from '../construction';
import { defineSimModule } from '../define';
import {
  cancelTerraformOrder,
  canRunTerraformOpOnTile,
  enqueueTerraformOrder,
  getColonyTerraformOrders,
  getManualTerraformLaneCount,
  getTerraformOpSpec,
  hasColonyClaimedTerritory,
  isTerraformOpKind,
  resolveTerraformOpForTile,
  type EnqueueTerraformOrderOpts,
  type EnqueueTerraformOrderResult,
  type TerraformJob,
  type TerraformOpKind,
  type TerraformOpSpec,
  type TerraformOrder,
  type TerraformTasksBlobValue,
} from './queue';

export { terraformCommand, terraformProvider } from './work';

export {
  cancelTerraformOrder,
  canRunTerraformOpOnTile,
  enqueueTerraformOrder,
  getColonyTerraformOrders,
  getManualTerraformLaneCount,
  getTerraformOpSpec,
  hasColonyClaimedTerritory,
  isTerraformOpKind,
  resolveTerraformOpForTile,
  type EnqueueTerraformOrderOpts,
  type EnqueueTerraformOrderResult,
  type TerraformJob,
  type TerraformOpKind,
  type TerraformOpSpec,
  type TerraformOrder,
  type TerraformTasksBlobValue,
};

function parseEnqueueArgs(args: unknown): {
  op?: TerraformOpKind | 'auto';
  autoPrepare?: boolean;
  tiles?: Array<{ q: number; r: number; op?: TerraformOpKind }>;
  taskId?: string;
  allowUnclaimed?: boolean;
} {
  if (typeof args !== 'object' || args === null) return {};
  const raw = args as Record<string, unknown>;
  const inner =
    typeof raw.terraform === 'object' && raw.terraform !== null
      ? (raw.terraform as Record<string, unknown>)
      : raw;
  const op = isTerraformOpKind(inner.op)
    ? inner.op
    : isTerraformOpKind(raw.op)
      ? raw.op
      : inner.op === 'auto' || raw.op === 'auto'
        ? 'auto'
        : undefined;
  const rawAuto = inner.autoPrepare ?? raw.autoPrepare;
  const autoPrepare = typeof rawAuto === 'boolean' ? rawAuto : undefined;
  const taskId =
    typeof inner.taskId === 'string'
      ? inner.taskId
      : typeof raw.taskId === 'string'
        ? raw.taskId
        : typeof raw.orderId === 'string'
          ? raw.orderId
          : undefined;
  const allowUnclaimed = Boolean(inner.allowUnclaimed ?? raw.allowUnclaimed);
  if (Array.isArray(inner.tiles)) {
    return {
      op,
      autoPrepare,
      tiles: inner.tiles as Array<{ q: number; r: number; op?: TerraformOpKind }>,
      taskId,
      allowUnclaimed,
    };
  }
  if (typeof inner.q === 'number' && typeof inner.r === 'number') {
    return { op, autoPrepare, tiles: [{ q: inner.q, r: inner.r }], taskId, allowUnclaimed };
  }
  return { op, autoPrepare, taskId, allowUnclaimed };
}

export const enqueueTask = defineCommandHandler({
  kind: 'enqueueTask',
  wave: 'W01',
  handle(state, cmd, ctx) {
    const colonyId = cmd.colonyIndex ?? (cmd as { colony?: number }).colony ?? 0;
    const parsed = parseEnqueueArgs(cmd.args);
    if ((!parsed.op && !parsed.autoPrepare) || !parsed.tiles || parsed.tiles.length === 0) {
      return 'invalid_args';
    }
    const autoPrepare =
      parsed.autoPrepare ?? (parsed.op === 'auto' || (parsed.op === 'grade' && parsed.tiles.length > 1));
    const res = enqueueTerraformOrder(state, {
      colonyId,
      op: parsed.op,
      autoPrepare,
      tiles: parsed.tiles,
      orderId: parsed.taskId ?? cmd.commandId,
      allowUnclaimed: parsed.allowUnclaimed,
      tick: ctx.tick,
      data: ctx.data,
    });
    if (!res.ok) return res.reason ?? 'site_blocked';
  },
});

export const cancelTask = defineCommandHandler({
  kind: 'cancelTask',
  wave: 'W01',
  handle(state, cmd, ctx) {
    const colonyId = cmd.colonyIndex ?? (cmd as { colony?: number }).colony ?? 0;
    const raw = (cmd.args ?? {}) as { taskId?: unknown; orderId?: unknown; entityId?: unknown };
    const id = raw.taskId ?? raw.orderId ?? raw.entityId;
    if (id !== undefined && typeof id !== 'string' && typeof id !== 'number') {
      return 'invalid_args';
    }
    if (id !== undefined && cancelConstructionOrder(state, colonyId, id, ctx.tick, ctx.data, ctx)) {
      return;
    }
    const cancelledTf = cancelTerraformOrder(
      state,
      colonyId,
      id as string | number | undefined,
      ctx.tick,
      ctx.data,
    );
    if (!cancelledTf && id === undefined) {
      cancelConstructionOrder(state, colonyId, undefined, ctx.tick, ctx.data, ctx);
    }
  },
});

export default defineSimModule({
  id: 'terraform-basic',
  wave: 'W01',
  handlers: [enqueueTask, cancelTask],
});

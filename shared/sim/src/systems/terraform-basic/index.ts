import { ENTITY_STATE } from '../../ecs/columns';
import { setField } from '../../ecs/store';
import { hexIndex } from '../../grid/hex';
import { PREP, TERRAIN } from '../../grid/layers';
import { revealSubsurface } from '../../grid/subsurface';
import { setTilePrep, setTileTerrain } from '../../grid/tileModel';
import { defineCommandHandler } from '../../kernel/commands';
import { TICK_MS } from '../../kernel/constants';
import type { StepContext } from '../../kernel/context';
import type { PlanetState } from '../../kernel/state';
import { defineSystem } from '../../kernel/system';
import { cancelConstructionOrder } from '../construction';
import { defineSimModule } from '../define';
import { stepTerraformWorkWithCell, syncHqView } from '../hq';
import {
  cancelTerraformOrder,
  canRunTerraformOpOnTile,
  enqueueTerraformOrder,
  findColonyHqSlot,
  getColonyTerraformOrders,
  getManualTerraformLaneCount,
  getTerraformOpSpec,
  hasColonyClaimedTerritory,
  isTerraformOpKind,
  readOrdersByColony,
  resolveTerraformOpForTile,
  writeOrdersByColony,
  type EnqueueTerraformOrderOpts,
  type EnqueueTerraformOrderResult,
  type TerraformJob,
  type TerraformOpKind,
  type TerraformOpSpec,
  type TerraformOrder,
  type TerraformTasksBlobValue,
} from './queue';
import { addColonyResource } from './stock';

export {
  addColonyResource,
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
    if (id !== undefined && cancelConstructionOrder(state, colonyId, id, ctx.tick, ctx.data)) {
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
      cancelConstructionOrder(state, colonyId, undefined, ctx.tick, ctx.data);
    }
  },
});

function completeTerraformJob(
  state: PlanetState,
  colonyId: number,
  job: TerraformJob,
  tick: number,
  ctx?: Partial<StepContext>,
): void {
  const tileIdx = hexIndex(state.grid.radius).indexOf(job.q, job.r);
  if (tileIdx < 0) return;

  const col = state.colonies[colonyId];
  const colonyIdStr = col?.id ?? `col_${colonyId}`;
  const playerId = typeof col?.playerId === 'string' ? col.playerId : undefined;
  const spec = getTerraformOpSpec(job.op, ctx?.data);

  if (job.op === 'grade') {
    setTilePrep(state.grid, tileIdx, PREP.prepared, tick);
    ctx?.emit?.({
      kind: 'tilePrepared',
      severity: 'info',
      colonyIds: [colonyIdStr],
      data: {
        colonyId: colonyIdStr,
        ...(playerId ? { playerId } : {}),
        count: 1,
        q: job.q,
        r: job.r,
      },
    });
    return;
  }

  setTileTerrain(state.grid, tileIdx, TERRAIN.flat, tick);
  setTilePrep(state.grid, tileIdx, PREP.flat, tick);
  // Removing the obstacle uncovers what world generation buried under it (D-38, `grid/subsurface.ts`).
  const found = revealSubsurface(state, tileIdx, tick);
  if (found) {
    ctx?.emit?.({
      kind: 'groundRevealed',
      severity: 'info',
      colonyIds: [colonyIdStr],
      data: { colonyId: colonyIdStr, ...(playerId ? { playerId } : {}), q: job.q, r: job.r, ...found },
    });
  }
  if (spec.yieldResource && spec.yieldAmount > 0) {
    addColonyResource(state, colonyId, spec.yieldResource, spec.yieldAmount, tick);
  }
  ctx?.emit?.({
    kind: 'obstacleRemoved',
    severity: 'info',
    colonyIds: [colonyIdStr],
    data: {
      colonyId: colonyIdStr,
      ...(playerId ? { playerId } : {}),
      op: job.op,
      count: 1,
      q: job.q,
      r: job.r,
    },
  });
}

/** Steps active S0 terraform jobs (`grade`, `clear`, `break`) for each colony using its HQ power cell. */
export function stepTerraformBasic(state: PlanetState, ctx?: Partial<StepContext>): void {
  const tick = ctx?.tick ?? state.meta.tick;
  const dtTicks = ctx?.dt ?? 1;
  const dtS = (TICK_MS / 1000) * dtTicks;
  const byColony = readOrdersByColony(state);
  const colonyKeys = Object.keys(byColony)
    .map(Number)
    .sort((a, b) => a - b);
  if (colonyKeys.length === 0) return;

  let anyModified = false;
  for (const colonyId of colonyKeys) {
    const orders = byColony[colonyId];
    if (!orders || orders.length === 0) continue;
    const hqSlot = findColonyHqSlot(state, colonyId);
    if (hqSlot < 0) continue;
    const cols = state.entities.cols;
    if (cols.state[hqSlot] === ENTITY_STATE.descending) continue;

    const order = orders[0];
    const job = order.jobs[0];
    if (!job) continue;

    anyModified = true;
    setField(state.entities, hqSlot, 'state', ENTITY_STATE.working, tick);
    setField(state.entities, hqSlot, 'targetQ', job.q, tick);
    setField(state.entities, hqSlot, 'targetR', job.r, tick);
    setField(state.entities, hqSlot, 'q', job.q, tick);
    setField(state.entities, hqSlot, 'r', job.r, tick);
    setField(state.entities, hqSlot, 'x', Math.fround(job.q), tick);
    setField(state.entities, hqSlot, 'y', Math.fround(job.r), tick);

    const remainingProgress = Math.max(0, 1 - job.progress);
    const remainingEnergyE = Math.max(0, job.totalEnergyE - job.energyDrawnE);
    const workRes = stepTerraformWorkWithCell(state, hqSlot, {
      baseTimeS: job.baseTimeS,
      totalEnergyE: job.totalEnergyE,
      dtS,
      remainingProgress,
      remainingEnergyE,
      tick,
    });
    job.progress = Math.min(1, job.progress + workRes.progressDelta);
    job.energyDrawnE += workRes.energyDrawnE;

    if (job.progress >= 1 - 1e-6) {
      completeTerraformJob(state, colonyId, job, tick, ctx);
      order.totalJobs = order.totalJobs ?? order.jobs.length;
      order.completedJobs = (order.completedJobs ?? 0) + 1;
      order.jobs.shift();
      if (order.jobs.length === 0) {
        orders.shift();
      }
      const hasMore = orders.length > 0 && orders[0].jobs.length > 0;
      setField(state.entities, hqSlot, 'state', hasMore ? ENTITY_STATE.working : ENTITY_STATE.idle, tick);
      setField(state.entities, hqSlot, 'progress', 0, tick);
    } else {
      setField(state.entities, hqSlot, 'progress', Math.fround(job.progress), tick);
    }
  }

  if (anyModified) {
    writeOrdersByColony(state, byColony, tick);
    for (const colonyId of colonyKeys) {
      const hqSlot = findColonyHqSlot(state, colonyId);
      if (hqSlot >= 0) syncHqView(state, hqSlot, tick, ctx?.data);
    }
  }
}

export const terraformBasic = defineSystem({
  id: 'terraformBasic',
  slot: 10,
  wave: 'W01',
  run(state, ctx) {
    stepTerraformBasic(state, ctx);
  },
});

export default defineSimModule({
  id: 'terraform-basic',
  wave: 'W01',
  systems: [terraformBasic],
  handlers: [enqueueTask, cancelTask],
});

import type { ResourceKey } from '@terra/contracts';
import { commandColony } from '../command';
import { ENTITY_STATE } from '../../ecs/columns';
import { rowOf } from '../../ecs/store';
import { defineCommandHandler } from '../../kernel/commands';
import type { CompiledDataLike } from '../../kernel/config';
import type { StepContext } from '../../kernel/context';
import { setBlob, type ColonyState, type PlanetState } from '../../kernel/state';
import { defineSystem } from '../../kernel/system';
import { defineSimModule } from '../define';
import { buildSiteTerrainBlock } from '../economy/siteTerrain';
import { resolveBuildingRow, startBuildingConstruction, type BuildingJobRecord } from '../economy/construction';
import { checkCostAffordability, payProgressiveSlice } from '../economy/ledger';
import { getColonySupply, resolveHubProducerRows, spawnHarvesterAtHubEdge } from '../factories-hub';
import {
  applyReorderQueueTask,
  CANCEL_IN_PROGRESS_REFUND_RATIO,
  cancelAllColonyTasks,
  ensureColony,
  refundEntrySpent,
  tryCancelSpecialTaskId,
} from './cancel';
import { executeDismantleAtTile } from '../terraform-basic/dismantleAndWork';
import { enqueueWorkOrder, type WorkOrderArgs } from '../terraform-basic/workOrder';
import {
  PRECEDENCE_RANK,
  type QueueEntry,
  type QueueLane,
  type QueuePrecedence,
  type QueueTaskPayload,
} from './types';
import { computeResourceWaitState, isBlockedByPower, normalizeEnqueueArgs } from './wait';

export * from './types';
export * from './wait';
export { CANCEL_IN_PROGRESS_REFUND_RATIO };

export const CONSTRUCTION_LANE_LIMIT = 20;
export const UNITS_LANE_LIMIT = 10;
export const PRODUCER_BUFFER_LIMIT = 5;

export function getColonyQueue(state: PlanetState, colonyIndex = 0, lane?: QueueLane): QueueEntry[] {
  const all = getAllQueueEntries(state).filter(
    (e) => e.colonyIndex === colonyIndex && e.state !== 'done' && e.state !== 'cancelled',
  );
  return lane ? all.filter((e) => e.lane === lane) : all;
}

export function getAllQueueEntries(state: PlanetState): QueueEntry[] {
  const raw = (state.blobs.queue?.value as { entries?: QueueEntry[] } | undefined)?.entries;
  return raw
    ? raw.map((e) => ({
        ...e,
        cost: { ...e.cost },
        totalCost: e.totalCost ? { ...e.totalCost } : { ...e.cost },
        spentCost: e.spentCost ? { ...e.spentCost } : {},
      }))
    : [];
}

export function saveQueueEntries(state: PlanetState, entries: QueueEntry[], tick: number): void {
  const active = entries.filter((e) => e.state !== 'done' && e.state !== 'cancelled');
  setBlob(state, 'queue', { entries: active }, tick);
  const colonies = new Set<number>([0]);
  for (const c of state.colonies) if (c) colonies.add(c.index);
  for (const e of active) colonies.add(e.colonyIndex);
  for (const idx of colonies) {
    const col = ensureColony(state, idx, tick);
    col.queue = active.filter((e) => e.colonyIndex === idx);
    col.constructionQueue = active.filter((e) => e.colonyIndex === idx && e.lane === 'construction');
    col.unitQueue = active.filter((e) => e.colonyIndex === idx && e.lane === 'units');
    col.changedAt = tick;
  }
}

function laneForTask(task: QueueTaskPayload): QueueLane {
  if (task.kind === 'buildUnit') return 'units';
  if (task.kind === 'terraform') return 'terraform';
  return 'construction';
}

function resolveTaskCostAndTicks(
  task: QueueTaskPayload,
  data?: CompiledDataLike,
): { cost: Partial<Record<ResourceKey, number>>; buildTicks: number; workRate: number } {
  if (task.kind === 'build') {
    const res = resolveBuildingRow(task.building, data);
    if (!res) return { cost: {}, buildTicks: 50, workRate: 1.5 };
    return {
      cost: { ...((res.row.cost ?? {}) as Partial<Record<ResourceKey, number>>) },
      buildTicks: Math.max(1, Number(res.row.buildS ?? 50)),
      workRate: 1.5,
    };
  }
  if (task.kind === 'buildUnit') {
    const { harvester } = resolveHubProducerRows(data);
    return {
      cost: { ...((harvester.cost ?? {}) as Partial<Record<ResourceKey, number>>) },
      buildTicks: Math.max(1, Number(harvester.buildS ?? 50)),
      workRate: 1.0,
    };
  }
  return { cost: {}, buildTicks: 25, workRate: 1.5 };
}

export interface EnqueueQueueTaskOptions {
  colonyIndex?: number;
  task: QueueTaskPayload;
  precedence?: QueuePrecedence;
  taskId?: string;
  costOverride?: Partial<Record<ResourceKey, number>>;
  tick?: number;
  data?: CompiledDataLike;
}

function markWaiting(entry: QueueEntry, reason: QueueEntry['waitReason'], detail: string, eta: number | null = null): void {
  entry.state = 'waiting';
  entry.waitReason = reason;
  entry.etaSeconds = eta;
  entry.waitDetail = detail;
}

function checkStartMissing(
  state: PlanetState,
  colony: ColonyState,
  entry: QueueEntry,
  allEntries: QueueEntry[],
): Partial<Record<ResourceKey, number>> | null {
  const totalCost = entry.totalCost ?? entry.cost;
  const spentCost = entry.spentCost ?? {};
  const stock = (colony.stock ?? {}) as Partial<Record<ResourceKey, number>>;
  const committed: Partial<Record<ResourceKey, number>> = {};
  const jobs = (state.blobs.construction?.value as { jobs?: Record<number, BuildingJobRecord> } | undefined)?.jobs ?? {};

  for (const other of allEntries) {
    if (other.colonyIndex !== entry.colonyIndex || other.state !== 'in_progress' || other.taskId === entry.taskId) continue;
    if (other.entityId !== undefined) {
      const eRow = rowOf(state.entities, other.entityId);
      if (eRow < 0 || state.entities.cols.state[eRow] !== ENTITY_STATE.constructing) continue;
    }
    const oTotal = other.totalCost ?? other.cost;
    const oSpent = (other.entityId !== undefined ? jobs[other.entityId]?.spentCost : undefined) ?? other.spentCost ?? {};
    for (const [k, v] of Object.entries(oTotal) as [ResourceKey, number][]) {
      if (!v || v <= 0) continue;
      const rem = Math.max(0, v - (oSpent[k] ?? 0));
      if (rem > 0) committed[k] = (committed[k] ?? 0) + rem;
    }
  }

  const missing: Partial<Record<ResourceKey, number>> = {};
  let short = false;
  for (const [k, v] of Object.entries(totalCost) as [ResourceKey, number][]) {
    if (!v || v <= 0) continue;
    const needed = Math.max(0, v - (spentCost[k] ?? 0));
    const avail = Math.max(0, (stock[k] ?? 0) - (committed[k] ?? 0));
    if (avail + 1e-6 < needed) {
      missing[k] = needed - avail;
      short = true;
    }
  }
  return short ? missing : null;
}

function tryStartQueueEntry(
  state: PlanetState,
  entry: QueueEntry,
  allEntries: QueueEntry[],
  tick: number,
  data?: CompiledDataLike,
  ctx?: StepContext,
): void {
  const colony = ensureColony(state, entry.colonyIndex, tick);
  const afford = checkCostAffordability(colony, entry.cost);

  if (Object.keys(afford.exceedsCap).length > 0) {
    entry.exceedsCap = afford.exceedsCap;
    entry.missingResources = undefined;
    markWaiting(entry, 'storage', 'waiting: storage (no ETA)');
    return;
  }
  if (isBlockedByPower(state, colony, entry)) {
    markWaiting(entry, 'power', 'waiting: power');
    return;
  }
  if (entry.lane === 'units') {
    const supply = getColonySupply(state, entry.colonyIndex, [], data);
    const inProgUnits = allEntries.filter(
      (e) => e.colonyIndex === entry.colonyIndex && e.lane === 'units' && e.state === 'in_progress',
    ).length;
    if (supply.activeUnits + inProgUnits + 1 > supply.cap) {
      markWaiting(entry, 'supply', 'waiting: supply');
      return;
    }
  }
  const missingForStart = checkStartMissing(state, colony, entry, allEntries);
  if (missingForStart) {
    entry.missingResources = missingForStart;
    entry.exceedsCap = undefined;
    const waitInfo = computeResourceWaitState(state, colony, entry.totalCost ?? entry.cost, missingForStart);
    markWaiting(entry, 'resources', waitInfo.waitDetail, waitInfo.etaSeconds);
    return;
  }
  const activeInLane = allEntries.some(
    (e) => e.colonyIndex === entry.colonyIndex && e.lane === entry.lane && e.state === 'in_progress' && e.taskId !== entry.taskId,
  );
  if (activeInLane) {
    markWaiting(entry, 'worker', 'waiting: worker');
    return;
  }

  if (entry.task.kind === 'build' && entry.entityId === undefined) {
    const started = startBuildingConstruction(
      state,
      { owner: entry.colonyIndex, building: entry.task.building, q: entry.task.q, r: entry.task.r, rot: entry.task.rotation ?? 0, workRate: entry.workRate, tick, data, costOverride: entry.cost },
      ctx,
    );
    if (!started.ok) {
      const reason = started.code === 'site_blocked' ? 'site' : 'resources';
      const detail = started.code === 'site_blocked' && started.detail ? `waiting: site (${started.detail})` : `waiting: ${reason}`;
      markWaiting(entry, reason, detail);
      return;
    }
    entry.entityId = started.entityId;
  }
  entry.totalCost ??= { ...entry.cost };
  entry.spentCost ??= {};
  entry.state = 'in_progress';
  entry.waitReason = undefined;
  entry.waitDetail = undefined;
  entry.missingResources = undefined;
  entry.exceedsCap = undefined;
  entry.etaSeconds = undefined;
}

export function scanAndStartQueueEntries(
  state: PlanetState,
  entries: QueueEntry[],
  colonyIndex: number,
  tick: number,
  data?: CompiledDataLike,
  ctx?: StepContext,
): QueueEntry[] {
  const indexed = entries
    .map((entry, idx) => ({ entry, idx }))
    .filter(({ entry }) => entry.colonyIndex === colonyIndex && (entry.state === 'queued' || entry.state === 'waiting'))
    .sort((a, b) => {
      const rankDiff = PRECEDENCE_RANK[b.entry.precedence] - PRECEDENCE_RANK[a.entry.precedence];
      return rankDiff !== 0 ? rankDiff : a.idx - b.idx;
    });

  const started: QueueEntry[] = [];
  for (const { entry } of indexed) {
    tryStartQueueEntry(state, entry, entries, tick, data, ctx);
    if (entry.state === 'in_progress') {
      started.push(entry);
    }
  }
  return started;
}

export const scanQueueNonBlocking = scanAndStartQueueEntries;

export function enqueueQueueTask(
  state: PlanetState,
  opts: EnqueueQueueTaskOptions,
  ctx?: StepContext,
): { ok: true; entry: QueueEntry } | { ok: false; code: string; detail?: string } {
  const tick = opts.tick ?? ctx?.tick ?? state.meta.tick;
  const colonyIndex = opts.colonyIndex ?? 0;
  const lane = laneForTask(opts.task);
  const entries = getAllQueueEntries(state);
  const activeLane = entries.filter(
    (e) => e.colonyIndex === colonyIndex && e.lane === lane && e.state !== 'done' && e.state !== 'cancelled',
  );
  const limit = lane === 'units' ? UNITS_LANE_LIMIT : CONSTRUCTION_LANE_LIMIT;
  if (activeLane.length >= limit) {
    return { ok: false, code: 'queue_full', detail: `${lane} lane full` };
  }
  if (opts.task.kind === 'buildUnit' && typeof opts.task.producerId === 'number') {
    const producerId = opts.task.producerId;
    const producerEntries = activeLane.filter(
      (e) => e.task.kind === 'buildUnit' && e.task.producerId === producerId,
    );
    if (producerEntries.length >= PRODUCER_BUFFER_LIMIT) {
      return { ok: false, code: 'producer_buffer_full', detail: 'producer buffer full' };
    }
  }

  if (opts.task.kind === 'build') {
    const site = buildSiteTerrainBlock(state, opts.task, opts.data ?? ctx?.data);
    if (site) return { ok: false, code: 'terrain_unbuildable', detail: site };
  }
  const { cost, buildTicks, workRate } = resolveTaskCostAndTicks(opts.task, opts.data ?? ctx?.data);
  const resolvedCost = opts.costOverride ? { ...opts.costOverride } : cost;
  const entry: QueueEntry = {
    taskId: opts.taskId ?? `q-${colonyIndex}-${tick}-${entries.length + 1}`,
    colonyIndex,
    lane,
    precedence: opts.precedence ?? 'player',
    state: 'queued',
    task: opts.task,
    cost: resolvedCost,
    totalCost: { ...resolvedCost },
    spentCost: {},
    paid: false,
    progress: 0,
    buildTicks,
    elapsedTicks: 0,
    workRate,
    createdAt: tick,
  };

  entries.push(entry);
  scanAndStartQueueEntries(state, entries, colonyIndex, tick, opts.data ?? ctx?.data, ctx);
  saveQueueEntries(state, entries, tick);
  return { ok: true, entry };
}

/**
 * Cancels a queue entry, building construction, hub unit production, harvester task, or `'all'` tasks:
 * refunds `50 %` (`0.50`) of `spentCost` and removes any unfinished building entity.
 */
export function cancelQueueTask(
  state: PlanetState,
  taskId: string,
  colonyIndex?: number | null,
  tick: number = state.meta.tick,
  data?: CompiledDataLike,
): { ok: true; refunded: boolean } | { ok: false; code: string } {
  const entries = getAllQueueEntries(state);
  if (taskId === 'all') {
    return cancelAllColonyTasks(state, colonyIndex ?? 0, entries, tick, data, saveQueueEntries);
  }

  const idx = entries.findIndex((e) => e.taskId === taskId && e.state !== 'done' && e.state !== 'cancelled');
  if (idx < 0) {
    const special = tryCancelSpecialTaskId(state, taskId, colonyIndex, entries, tick, data, (colIdx) => {
      scanAndStartQueueEntries(state, entries, colIdx, tick, data);
      saveQueueEntries(state, entries, tick);
    });
    return special ?? { ok: false, code: 'unknown_task' };
  }

  const entry = entries[idx];
  if (colonyIndex !== undefined && colonyIndex !== null && entry.colonyIndex !== colonyIndex) {
    return { ok: false, code: 'not_own_colony' };
  }

  const colony = ensureColony(state, entry.colonyIndex, tick);
  const refunded = refundEntrySpent(state, entry, colony, tick, data);

  entry.state = 'cancelled';
  entries.splice(idx, 1);
  scanAndStartQueueEntries(state, entries, entry.colonyIndex, tick, data);
  saveQueueEntries(state, entries, tick);
  return { ok: true, refunded };
}

/** Reorders a player queue entry within its lane (`toIndex` or `direction`). */
export function reorderQueueTask(
  state: PlanetState,
  taskId: string,
  opts: { toIndex?: number; direction?: 'up' | 'down' | 'top' | 'bottom'; colonyIndex?: number | null; tick?: number },
): { ok: true; entries: QueueEntry[] } | { ok: false; code: string } {
  const tick = opts.tick ?? state.meta.tick;
  const all = getAllQueueEntries(state);
  const res = applyReorderQueueTask(all, taskId, opts);
  if (!res.ok) return res;
  saveQueueEntries(state, all, tick);
  return { ok: true, entries: getColonyQueue(state, res.colonyIndex, res.lane) };
}

export const enqueueTaskHandler = defineCommandHandler({
  kind: 'enqueueTask',
  wave: 'W01',
  handle(state, cmd, ctx) {
    const norm = normalizeEnqueueArgs((cmd.args ?? {}) as Record<string, unknown>);
    if (!norm.task || typeof norm.task.kind !== 'string') return 'invalid_args';
    const colIdx = commandColony(cmd);
    if (typeof colIdx === 'string') return colIdx;
    if (norm.task.kind === 'terraform' && norm.task.op === 'dismantle') {
      const dRes = executeDismantleAtTile(state, colIdx, norm.task.q, norm.task.r, ctx.tick, ctx.data);
      return dRes.ok ? undefined : dRes.reason;
    }
    if (norm.task.kind === 'terraform' && norm.task.op === 'work') {
      return enqueueWorkOrder(state, colIdx, { ...(norm.task as Partial<WorkOrderArgs>), tiles: [norm.task] }, norm.taskId ?? cmd.commandId, ctx.tick, ctx.data);
    }
    const res = enqueueQueueTask(state, { colonyIndex: colIdx, task: norm.task, precedence: norm.precedence, taskId: norm.taskId, costOverride: norm.costOverride, tick: ctx.tick, data: ctx.data }, ctx);
    return res.ok ? undefined : res.code;
  },
});

export const cancelTaskHandler = defineCommandHandler({
  kind: 'cancelTask',
  wave: 'W01',
  handle(state, cmd, ctx) {
    const { taskId } = (cmd.args ?? {}) as { taskId?: string };
    if (typeof taskId !== 'string') return 'invalid_args';
    const colIdx = commandColony(cmd);
    if (typeof colIdx === 'string') return colIdx;
    const res = cancelQueueTask(state, taskId, colIdx, ctx.tick, ctx.data);
    return res.ok ? undefined : res.code;
  },
});

export const reorderTaskHandler = defineCommandHandler({
  kind: 'reorderTask',
  wave: 'W02',
  handle(state, cmd, ctx) {
    const args = (cmd.args ?? {}) as { taskId?: string; toIndex?: number; direction?: 'up' | 'down' | 'top' | 'bottom' };
    if (typeof args.taskId !== 'string') return 'invalid_args';
    const colIdx = commandColony(cmd);
    if (typeof colIdx === 'string') return colIdx;
    const res = reorderQueueTask(state, args.taskId, { toIndex: args.toIndex, direction: args.direction, colonyIndex: colIdx, tick: ctx.tick });
    return res.ok ? undefined : res.code;
  },
});

function stepQueueEntry(state: PlanetState, entry: QueueEntry, colIdx: number, ctx: StepContext): void {
  const colony = ensureColony(state, colIdx, ctx.tick);
  if (entry.task.kind === 'build' && entry.entityId !== undefined) {
    const eRow = rowOf(state.entities, entry.entityId);
    const jobs = (state.blobs.construction?.value as { jobs?: Record<number, BuildingJobRecord> } | undefined)?.jobs ?? {};
    const job = jobs[entry.entityId];
    if (job?.spentCost) {
      entry.spentCost = { ...job.spentCost };
      entry.paid = Object.values(entry.spentCost).some((v) => (v ?? 0) > 0);
    }
    if (eRow < 0 || state.entities.cols.state[eRow] !== ENTITY_STATE.constructing || state.entities.cols.progress[eRow] >= 1) {
      entry.spentCost = { ...(entry.totalCost ?? entry.cost) };
      entry.paid = true;
      entry.progress = 1;
      entry.state = 'done';
    } else {
      entry.progress = state.entities.cols.progress[eRow];
      if (job?.status === 'waiting') {
        entry.waitReason = 'resources';
        entry.waitDetail = 'waiting: resources';
      } else {
        entry.waitReason = undefined;
        entry.waitDetail = undefined;
      }
    }
    return;
  }

  const nextElapsed = entry.elapsedTicks + ctx.dt * entry.workRate;
  const nextProgress = Math.min(1, nextElapsed / entry.buildTicks);
  const totalCost = entry.totalCost ?? entry.cost;
  const spentCost = { ...(entry.spentCost ?? {}) };
  if (Object.keys(totalCost).length > 0) {
    const pay = payProgressiveSlice(colony, totalCost, spentCost, nextProgress, ctx.tick);
    if (!pay.ok) {
      const waitInfo = computeResourceWaitState(state, colony, totalCost, pay.missing);
      markWaiting(entry, 'resources', waitInfo.waitDetail, waitInfo.etaSeconds);
      return;
    }
    entry.spentCost = spentCost;
    entry.paid = Object.values(spentCost).some((v) => (v ?? 0) > 0);
  }
  entry.elapsedTicks = nextElapsed;
  entry.progress = Math.min(1, Number(nextProgress.toFixed(4)));
  if (entry.elapsedTicks >= entry.buildTicks - 1e-6) {
    if (entry.task.kind === 'buildUnit') {
      const spawned = spawnHarvesterAtHubEdge(state, colIdx, ctx.tick, ctx.data, ctx);
      ctx.emit({ kind: 'unitProduced', colonyIds: [colIdx], data: { entityId: spawned.entityId, unit: 'harvester', q: spawned.q, r: spawned.r } });
    }
    entry.progress = 1;
    entry.state = 'done';
  }
}

export const queueSystem = defineSystem({
  id: 'queue.manager',
  slot: 4,
  wave: 'W02',
  run(state, ctx) {
    const entries = getAllQueueEntries(state);
    if (entries.length === 0) return;
    const colonies = new Set<number>(entries.map((e) => e.colonyIndex));

    for (const colIdx of colonies) {
      for (const entry of entries) {
        if (entry.colonyIndex !== colIdx || entry.state !== 'in_progress') continue;
        stepQueueEntry(state, entry, colIdx, ctx);
      }
      scanAndStartQueueEntries(state, entries, colIdx, ctx.tick, ctx.data, ctx);
    }

    saveQueueEntries(state, entries, ctx.tick);
  },
});

export default defineSimModule({
  id: 'queue',
  wave: 'W02',
  systems: [queueSystem],
  handlers: [reorderTaskHandler],
});

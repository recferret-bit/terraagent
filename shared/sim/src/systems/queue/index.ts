import type { ResourceKey } from '@terra/contracts';
import { commandColony } from '../command';
import { defineCommandHandler } from '../../kernel/commands';
import type { CompiledDataLike } from '../../kernel/config';
import type { StepContext } from '../../kernel/context';
import { setBlob, type PlanetState } from '../../kernel/state';
import { defineSystem } from '../../kernel/system';
import { defineSimModule } from '../define';
import { buildSiteReject } from '../economy/siteTerrain';
import { startBuildingConstruction } from '../economy/construction';
import { checkCostAffordability } from '../economy/ledger';
import { checkUnitSupply, unitSupplyOfName } from '../supply';
import {
  applyReorderQueueTask,
  CANCEL_IN_PROGRESS_REFUND_RATIO,
  cancelAllColonyTasks,
  ensureColony,
  refundEntrySpent,
  tryCancelSpecialTaskId,
} from './cancel';
import { dismantleQueueTask, enqueueRepairForEntity } from '../terraform-basic/dismantleAndWork';
import { enqueueWorkOrder, type WorkOrderArgs } from '../terraform-basic/workOrder';
import { checkItemUnlockStage } from '../progression/validate';
import {
  PRECEDENCE_RANK,
  type QueueEntry,
  type QueueLane,
  type QueuePrecedence,
  type QueueTaskPayload,
} from './types';
import { markWaiting, stepQueueEntry } from './step';
import {
  checkStartMissing,
  compareEarmarkPriority,
  hasActiveEarmark,
  updateColonyEarmarks,
} from './earmarks';
import {
  computeResourceWaitState,
  enqueueAuthority,
  findOldestAutoIndex,
  isBlockedByPower,
  isW03QueueActive,
  laneForTask,
  laneLimitFor,
  maxConcurrentInLane,
  nextAutoTaskId,
  normalizeEnqueueArgs,
  PRODUCER_BUFFER_LIMIT,
  resolveTaskCostAndTicks,
} from './wait';

export * from './types';
export * from './wait';
export * from './earmarks';
export { CANCEL_IN_PROGRESS_REFUND_RATIO };

/** `startBuildingConstruction` codes that mean the site (not the stock) holds the entry back. */
const SITE_CODES: ReadonlySet<string> = new Set(['site_blocked', 'terrain_unbuildable', 'not_own_territory', 'outside_power_zone', 'invalid_args']);

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
        earmarked: e.earmarked ? { ...e.earmarked } : undefined,
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
    const colActive = active.filter((e) => e.colonyIndex === idx);
    col.queue = colActive;
    col.constructionQueue = colActive.filter((e) => e.lane === 'construction');
    col.terraformQueue = colActive.filter((e) => e.lane === 'terraform');
    col.unitQueue = colActive.filter((e) => e.lane === 'units');
    col.hqGoalQueue = colActive.filter((e) => e.lane === 'hqGoals');
    const earmarks: Partial<Record<ResourceKey, number>> = {};
    for (const e of colActive) {
      if (!e.earmarked) continue;
      for (const [k, v] of Object.entries(e.earmarked) as [ResourceKey, number][]) {
        if (v && v > 0) earmarks[k] = (earmarks[k] ?? 0) + v;
      }
    }
    col.earmarks = earmarks;
    col.changedAt = tick;
  }
}

export interface EnqueueQueueTaskOptions {
  colonyIndex?: number;
  task: QueueTaskPayload;
  precedence?: QueuePrecedence;
  taskId?: string;
  goalId?: string;
  costOverride?: Partial<Record<ResourceKey, number>>;
  tick?: number;
  data?: CompiledDataLike;
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
    markWaiting(entry, 'storage', 'waiting: storage (no ETA)', null, tick);
    return;
  }
  if (isBlockedByPower(state, colony, entry)) {
    markWaiting(entry, 'power', 'waiting: power', null, tick);
    return;
  }
  if (entry.task.kind === 'buildUnit' && !checkUnitSupply(state, entry.colonyIndex, entry.task.unit, data, { pending: { queue: allEntries }, excludeTaskId: entry.taskId }).ok) {
    markWaiting(entry, 'supply', 'waiting: supply', null, tick);
    return;
  }
  const missingForStart = checkStartMissing(state, colony, entry, allEntries, data);
  if (missingForStart) {
    entry.missingResources = missingForStart;
    entry.exceedsCap = undefined;
    const waitInfo = computeResourceWaitState(state, colony, entry.totalCost ?? entry.cost, missingForStart);
    markWaiting(entry, 'resources', waitInfo.waitDetail, waitInfo.etaSeconds, tick);
    return;
  }
  const activeCountInLane = allEntries.filter(
    (e) => e.colonyIndex === entry.colonyIndex && e.lane === entry.lane && e.state === 'in_progress' && e.taskId !== entry.taskId,
  ).length;
  if (activeCountInLane >= maxConcurrentInLane(state, entry.colonyIndex, entry.lane)) {
    markWaiting(entry, 'worker', 'waiting: worker', null, tick);
    return;
  }

  if (entry.task.kind === 'build' && entry.entityId === undefined) {
    const started = startBuildingConstruction(
      state,
      { owner: entry.colonyIndex, building: entry.task.building, q: entry.task.q, r: entry.task.r, rot: entry.task.rotation ?? 0, workRate: entry.workRate, tick, data, costOverride: entry.cost },
      ctx,
    );
    if (!started.ok) {
      const reason = SITE_CODES.has(started.code) ? 'site' : started.code === 'storage_cap' ? 'storage' : 'resources';
      const detail = reason === 'site' && started.detail ? `waiting: site (${started.detail})` : `waiting: ${reason}`;
      markWaiting(entry, reason, detail, null, tick);
      return;
    }
    entry.entityId = started.entityId;
  } else if (entry.task.kind === 'repair') {
    const started = enqueueRepairForEntity(state, entry.colonyIndex, entry.task.entityId, {
      taskId: entry.taskId,
      tick,
      data,
    });
    if (started.ok) {
      entry.cost = { ...started.job.totalCost };
      entry.totalCost = { ...started.job.totalCost };
      entry.buildTicks = started.job.durationTicks;
      entry.workerEntityId = started.job.workerEntityId;
    } else if (started.reason !== 'unknown_entity') {
      markWaiting(entry, 'worker', 'waiting: worker', null, tick);
      return;
    }
  }
  entry.totalCost ??= { ...entry.cost };
  entry.spentCost ??= {};
  entry.state = 'in_progress';
  entry.waitReason = undefined;
  entry.waitDetail = undefined;
  entry.missingResources = undefined;
  entry.exceedsCap = undefined;
  entry.etaSeconds = undefined;
  entry.resourceWaitSinceTick = undefined;
  entry.earmarked = undefined;
}

export function scanAndStartQueueEntries(
  state: PlanetState,
  entries: QueueEntry[],
  colonyIndex: number,
  tick: number,
  data?: CompiledDataLike,
  ctx?: StepContext,
): QueueEntry[] {
  updateColonyEarmarks(state, entries, colonyIndex, tick, data);
  const indexed = entries
    .map((entry, idx) => ({ entry, idx }))
    .filter(({ entry }) => entry.colonyIndex === colonyIndex && (entry.state === 'queued' || entry.state === 'waiting'))
    .sort((a, b) => {
      const aEarmarked = hasActiveEarmark(a.entry) ? 1 : 0;
      const bEarmarked = hasActiveEarmark(b.entry) ? 1 : 0;
      if (aEarmarked !== bEarmarked) return bEarmarked - aEarmarked;
      if (aEarmarked && bEarmarked) {
        const cmp = compareEarmarkPriority(a.entry, b.entry);
        if (cmp !== 0) return cmp;
      }
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
  updateColonyEarmarks(state, entries, colonyIndex, tick, data);
  return started;
}

export const scanQueueNonBlocking = scanAndStartQueueEntries;

export function enqueueQueueTask(
  state: PlanetState,
  opts: EnqueueQueueTaskOptions,
  ctx?: StepContext,
): { ok: true; entry: QueueEntry } | { ok: false; code: string; detail?: string } {
  const data = opts.data ?? ctx?.data;
  const tick = opts.tick ?? ctx?.tick ?? state.meta.tick;
  const colonyIndex = opts.colonyIndex ?? 0;
  const lane = laneForTask(opts.task);
  const incomingPrecedence: QueuePrecedence =
    opts.precedence && Object.hasOwn(PRECEDENCE_RANK, opts.precedence) ? opts.precedence : 'player';
  const entries = getAllQueueEntries(state);
  const activeLane = entries.filter(
    (e) => e.colonyIndex === colonyIndex && e.lane === lane && e.state !== 'done' && e.state !== 'cancelled',
  );
  const limit = laneLimitFor(lane);
  const fullCode = isW03QueueActive(state, data) ? 'lane_full' : 'queue_full';

  if (opts.task.kind === 'buildUnit' && unitSupplyOfName(opts.task.unit, data) === undefined) {
    return { ok: false, code: 'invalid_args', detail: 'unknown unit' };
  }
  if (opts.task.kind === 'buildUnit' && typeof opts.task.producerId === 'number') {
    const producerId = opts.task.producerId;
    const producerEntries = activeLane.filter(
      (e) => e.task.kind === 'buildUnit' && e.task.producerId === producerId,
    );
    if (producerEntries.length >= PRODUCER_BUFFER_LIMIT) {
      return { ok: false, code: 'queue_full', detail: 'producer buffer full' };
    }
  }

  if (activeLane.length >= limit) {
    const oldestAutoIdx =
      PRECEDENCE_RANK[incomingPrecedence] > PRECEDENCE_RANK.auto
        ? findOldestAutoIndex(entries, colonyIndex, lane)
        : -1;
    if (oldestAutoIdx < 0) {
      return { ok: false, code: fullCode, detail: `${lane} lane full` };
    }
    if (opts.task.kind === 'build') {
      const site = buildSiteReject(state, colonyIndex, opts.task, data);
      if (site) return { ok: false, ...site };
    }
    const evicted = entries[oldestAutoIdx];
    const colony = ensureColony(state, colonyIndex, tick);
    refundEntrySpent(state, evicted, colony, tick, data);
    evicted.state = 'cancelled';
    entries.splice(oldestAutoIdx, 1);
  } else if (opts.task.kind === 'build') {
    const site = buildSiteReject(state, colonyIndex, opts.task, data);
    if (site) return { ok: false, ...site };
  }

  const { cost, buildTicks, workRate } = resolveTaskCostAndTicks(opts.task, data);
  const resolvedCost = opts.costOverride ? { ...opts.costOverride } : cost;
  const entry: QueueEntry = {
    taskId: opts.taskId ?? nextAutoTaskId(entries, colonyIndex, tick),
    colonyIndex,
    lane,
    precedence: incomingPrecedence,
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
    ...(opts.goalId ? { goalId: opts.goalId } : {}),
    createdAt: tick,
  };

  entries.push(entry);
  scanAndStartQueueEntries(state, entries, colonyIndex, tick, data, ctx);
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
    const { precedence, costOverride } = enqueueAuthority(cmd.source, norm); // a player never sets its own cost or jumps the queue
    if (cmd.source !== 'system' && (cmd.source as string) !== 'module' && precedence !== 'hq') {
      const itemId =
        norm.task.kind === 'build'
          ? norm.task.building
          : norm.task.kind === 'buildUnit'
            ? norm.task.unit
            : norm.task.kind === 'terraform'
              ? norm.task.op
              : undefined;
      if (itemId) {
        const stageCheck = checkItemUnlockStage(state, colIdx, itemId, ctx.flags, ctx.data);
        if (!stageCheck.ok) {
          return { code: stageCheck.code, detail: stageCheck.detail, unlocksAt: stageCheck.unlocksAt };
        }
      }
    }
    if (norm.task.kind === 'dismantle' || (norm.task.kind === 'terraform' && norm.task.op === 'dismantle')) {
      return dismantleQueueTask(state, colIdx, norm.task, norm.taskId ?? cmd.commandId, ctx.tick, ctx.data);
    }
    if (norm.task.kind === 'terraform' && (norm.task.op === 'work' || norm.task.op === 'repair')) {
      const intent = norm.task.op === 'repair' ? 'repair' : (norm.task as Partial<WorkOrderArgs>).intent;
      return enqueueWorkOrder(state, colIdx, { ...(norm.task as Partial<WorkOrderArgs>), intent, tiles: [norm.task] }, norm.taskId ?? cmd.commandId, ctx.tick, ctx.data);
    }
    if (norm.task.kind === 'buildUnit') { // the first unit must fit the supply cap now; the rest of a batch waits on `supply`
      const supply = checkUnitSupply(state, colIdx, norm.task.unit, ctx.data);
      if (!supply.ok) return { code: supply.code, detail: supply.detail };
    }
    const res = enqueueQueueTask(state, { colonyIndex: colIdx, task: norm.task, precedence, taskId: norm.taskId, costOverride, tick: ctx.tick, data: ctx.data }, ctx);
    return res.ok ? undefined : { code: res.code, detail: res.detail }; // e.g. the terrain block text (GP-31)
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

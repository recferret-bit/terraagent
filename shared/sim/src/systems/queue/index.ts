import type { ResourceKey } from '@terra/contracts';
import { ENTITY_KIND, ENTITY_STATE } from '../../ecs/columns';
import { removeRow, rowOf } from '../../ecs/store';
import { PREP } from '../../grid/layers';
import { setTilePrep } from '../../grid/tileModel';
import { defineCommandHandler } from '../../kernel/commands';
import type { CompiledDataLike } from '../../kernel/config';
import type { StepContext } from '../../kernel/context';
import { setBlob, type ColonyState, type PlanetState } from '../../kernel/state';
import { defineSystem } from '../../kernel/system';
import { defineSimModule } from '../define';
import { getFootprintTileIndices, resolveBuildingRow, startBuildingConstruction } from '../economy/construction';
import { checkCostAffordability, debitCost, ensureColonyLedger, refundCost } from '../economy/ledger';
import { getColonySupply, resolveHubProducerRows } from '../factories-hub';
import { revealVision } from '../hq';
import { insertRow } from '../../ecs/store';
import {
  PRECEDENCE_RANK,
  type QueueEntry,
  type QueueLane,
  type QueuePrecedence,
  type QueueTaskPayload,
} from './types';

export * from './types';

export const CONSTRUCTION_LANE_LIMIT = 20;
export const UNITS_LANE_LIMIT = 10;
export const PRODUCER_BUFFER_LIMIT = 5;
export const CANCEL_IN_PROGRESS_REFUND_RATIO = 0.75;

function ensureColony(state: PlanetState, colonyIndex: number, tick: number): ColonyState {
  let col = state.colonies[colonyIndex];
  if (!col) {
    col = { index: colonyIndex, id: `col-${colonyIndex}`, name: `Colony ${colonyIndex + 1}`, color: 0xff6b00, status: 'active', changedAt: tick };
    state.colonies[colonyIndex] = col;
  }
  return ensureColonyLedger(col);
}

export function getColonyQueue(state: PlanetState, colonyIndex = 0, lane?: QueueLane): QueueEntry[] {
  const all = getAllQueueEntries(state).filter(
    (e) => e.colonyIndex === colonyIndex && e.state !== 'done' && e.state !== 'cancelled',
  );
  return lane ? all.filter((e) => e.lane === lane) : all;
}

export function getAllQueueEntries(state: PlanetState): QueueEntry[] {
  const raw = (state.blobs.queue?.value as { entries?: QueueEntry[] } | undefined)?.entries;
  return raw ? raw.map((e) => ({ ...e, cost: { ...e.cost } })) : [];
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
    entry.state = 'waiting';
    entry.waitReason = 'storage';
    entry.exceedsCap = afford.exceedsCap;
    entry.missingResources = undefined;
    entry.etaSeconds = null;
    entry.waitDetail = 'waiting: storage (no ETA)';
    return;
  }

  if (entry.lane === 'units') {
    const supply = getColonySupply(state, entry.colonyIndex, [], data);
    const inProgUnits = allEntries.filter(
      (e) => e.colonyIndex === entry.colonyIndex && e.lane === 'units' && e.state === 'in_progress',
    ).length;
    if (supply.activeUnits + inProgUnits + 1 > supply.cap) {
      entry.state = 'waiting';
      entry.waitReason = 'supply';
      entry.waitDetail = 'waiting: supply';
      return;
    }
  }

  if (!afford.ok) {
    entry.state = 'waiting';
    entry.waitReason = 'resources';
    entry.missingResources = afford.missing;
    const firstKey = Object.keys(afford.missing)[0] as ResourceKey | undefined;
    const needAmt = firstKey ? (entry.cost[firstKey] ?? 0) : 0;
    const haveAmt = firstKey ? Math.floor(colony.stock[firstKey] ?? 0) : 0;
    entry.waitDetail = firstKey ? `waiting: ${firstKey} ${haveAmt}/${needAmt}` : 'waiting: resources';
    return;
  }

  // Check if another in-progress entry on the same single-worker/producer slot blocks starting right now
  const activeInLane = allEntries.some(
    (e) => e.colonyIndex === entry.colonyIndex && e.lane === entry.lane && e.state === 'in_progress' && e.taskId !== entry.taskId,
  );
  if (activeInLane) {
    entry.state = 'waiting';
    entry.waitReason = 'worker';
    entry.waitDetail = 'waiting: worker';
    return;
  }

  if (entry.task.kind === 'build') {
    const started = startBuildingConstruction(
      state,
      {
        owner: entry.colonyIndex,
        building: entry.task.building,
        q: entry.task.q,
        r: entry.task.r,
        rot: entry.task.rotation ?? 0,
        workRate: entry.workRate,
        tick,
        data,
      },
      ctx,
    );
    if (!started.ok) {
      entry.state = 'waiting';
      entry.waitReason = started.code === 'site_blocked' ? 'site' : 'resources';
      entry.waitDetail = `waiting: ${ entry.waitReason }`;
      return;
    }
    entry.entityId = started.entityId;
    entry.paid = true;
    entry.state = 'in_progress';
    entry.waitReason = undefined;
    entry.waitDetail = undefined;
    return;
  }

  // Units or Terraform task: debit cost at start
  debitCost(colony, entry.cost, tick);
  entry.paid = true;
  entry.state = 'in_progress';
  entry.waitReason = undefined;
  entry.waitDetail = undefined;
}

export function scanAndStartQueueEntries(
  state: PlanetState,
  entries: QueueEntry[],
  colonyIndex: number,
  tick: number,
  data?: CompiledDataLike,
  ctx?: StepContext,
): void {
  const candidates = entries
    .filter((e) => e.colonyIndex === colonyIndex && (e.state === 'queued' || e.state === 'waiting'))
    .sort((a, b) => PRECEDENCE_RANK[b.precedence] - PRECEDENCE_RANK[a.precedence]);

  for (const entry of candidates) {
    tryStartQueueEntry(state, entry, entries, tick, data, ctx);
  }
}

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

  const { cost, buildTicks, workRate } = resolveTaskCostAndTicks(opts.task, opts.data ?? ctx?.data);
  const entry: QueueEntry = {
    taskId: opts.taskId ?? `q-${colonyIndex}-${tick}-${entries.length + 1}`,
    colonyIndex,
    lane,
    precedence: opts.precedence ?? 'player',
    state: 'queued',
    task: opts.task,
    cost: opts.costOverride ? { ...opts.costOverride } : cost,
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
 * Cancels a queue entry (`UO-Q-03`):
 * - `waiting` / `queued` (`!paid`): cancelled for free (`100 %` stock unchanged).
 * - `in_progress` (`paid`): refunds `75 %` (`0.75`) of cost and removes any in-progress building entity.
 */
export function cancelQueueTask(
  state: PlanetState,
  taskId: string,
  colonyIndex?: number | null,
  tick: number = state.meta.tick,
  data?: CompiledDataLike,
): { ok: true; refunded: boolean } | { ok: false; code: string } {
  const entries = getAllQueueEntries(state);
  const idx = entries.findIndex((e) => e.taskId === taskId && e.state !== 'done' && e.state !== 'cancelled');
  if (idx < 0) return { ok: false, code: 'unknown_task' };
  const entry = entries[idx];
  if (colonyIndex !== undefined && colonyIndex !== null && entry.colonyIndex !== colonyIndex) {
    return { ok: false, code: 'not_own_colony' };
  }

  const colony = ensureColony(state, entry.colonyIndex, tick);
  let refunded = false;

  if (entry.state === 'in_progress' && entry.paid) {
    refundCost(colony, entry.cost, CANCEL_IN_PROGRESS_REFUND_RATIO, tick);
    refunded = true;
    if (entry.entityId !== undefined) {
      const eRow = rowOf(state.entities, entry.entityId);
      if (eRow >= 0) {
        const cols = state.entities.cols;
        const resolved = entry.task.kind === 'build' ? resolveBuildingRow(entry.task.building, data) : null;
        const w = cols.footprintW[eRow] || Number(resolved?.row.footprintW ?? 2);
        const d = cols.footprintD[eRow] || Number(resolved?.row.footprintD ?? 2);
        const fp = getFootprintTileIndices(state, cols.q[eRow], cols.r[eRow], w, d, cols.rot[eRow]);
        for (const tileIdx of fp.indices) {
          state.grid.layers.anchors[tileIdx] = 0;
          setTilePrep(state, tileIdx, PREP.prepared, tick);
        }
        removeRow(state.entities, entry.entityId, tick);
      }
    }
  }

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
  const currentIdx = all.findIndex((e) => e.taskId === taskId);
  if (currentIdx < 0) return { ok: false, code: 'unknown_task' };
  const target = all[currentIdx];
  if (opts.colonyIndex !== undefined && opts.colonyIndex !== null && target.colonyIndex !== opts.colonyIndex) {
    return { ok: false, code: 'not_own_colony' };
  }

  const sameLaneIndices = all
    .map((e, i) => (e.colonyIndex === target.colonyIndex && e.lane === target.lane ? i : -1))
    .filter((i) => i >= 0);
  const posInLane = sameLaneIndices.indexOf(currentIdx);
  if (posInLane < 0) return { ok: false, code: 'unknown_task' };

  let nextPos = posInLane;
  if (typeof opts.toIndex === 'number') {
    nextPos = Math.max(0, Math.min(sameLaneIndices.length - 1, opts.toIndex));
  } else if (opts.direction === 'up') nextPos = Math.max(0, posInLane - 1);
  else if (opts.direction === 'down') nextPos = Math.min(sameLaneIndices.length - 1, posInLane + 1);
  else if (opts.direction === 'top') nextPos = 0;
  else if (opts.direction === 'bottom') nextPos = sameLaneIndices.length - 1;

  if (nextPos !== posInLane) {
    const laneItems = sameLaneIndices.map((i) => all[i]);
    const [moved] = laneItems.splice(posInLane, 1);
    laneItems.splice(nextPos, 0, moved);
    for (let k = 0; k < sameLaneIndices.length; k++) {
      all[sameLaneIndices[k]] = laneItems[k];
    }
  }

  saveQueueEntries(state, all, tick);
  return { ok: true, entries: getColonyQueue(state, target.colonyIndex, target.lane) };
}

export const enqueueTaskHandler = defineCommandHandler({
  kind: 'enqueueTask',
  wave: 'W01',
  handle(state, cmd, ctx) {
    const args = (cmd.args ?? {}) as { task?: QueueTaskPayload; precedence?: QueuePrecedence; taskId?: string };
    if (!args.task || typeof args.task.kind !== 'string') return 'invalid_args';
    const res = enqueueQueueTask(
      state,
      { colonyIndex: cmd.colonyIndex ?? 0, task: args.task, precedence: args.precedence, taskId: args.taskId, tick: ctx.tick, data: ctx.data },
      ctx,
    );
    return res.ok ? undefined : res.code;
  },
});

export const cancelTaskHandler = defineCommandHandler({
  kind: 'cancelTask',
  wave: 'W01',
  handle(state, cmd, ctx) {
    const { taskId } = (cmd.args ?? {}) as { taskId?: string };
    if (typeof taskId !== 'string') return 'invalid_args';
    const res = cancelQueueTask(state, taskId, cmd.colonyIndex, ctx.tick, ctx.data);
    return res.ok ? undefined : res.code;
  },
});

export const reorderTaskHandler = defineCommandHandler({
  kind: 'reorderTask',
  wave: 'W02',
  handle(state, cmd, ctx) {
    const args = (cmd.args ?? {}) as { taskId?: string; toIndex?: number; direction?: 'up' | 'down' | 'top' | 'bottom' };
    if (typeof args.taskId !== 'string') return 'invalid_args';
    const res = reorderQueueTask(state, args.taskId, {
      toIndex: args.toIndex,
      direction: args.direction,
      colonyIndex: cmd.colonyIndex,
      tick: ctx.tick,
    });
    return res.ok ? undefined : res.code;
  },
});

export const queueSystem = defineSystem({
  id: 'queue.manager',
  slot: 4, // ruleEngine / queue slot
  wave: 'W02',
  run(state, ctx) {
    const entries = getAllQueueEntries(state);
    if (entries.length === 0) return;
    const colonies = new Set<number>(entries.map((e) => e.colonyIndex));

    for (const colIdx of colonies) {
      for (const entry of entries) {
        if (entry.colonyIndex !== colIdx || entry.state !== 'in_progress') continue;
        if (entry.task.kind === 'build' && entry.entityId !== undefined) {
          const eRow = rowOf(state.entities, entry.entityId);
          if (eRow < 0 || state.entities.cols.state[eRow] === ENTITY_STATE.active) {
            entry.progress = 1;
            entry.state = 'done';
          } else {
            entry.progress = state.entities.cols.progress[eRow];
          }
        } else {
          entry.elapsedTicks += ctx.dt * entry.workRate;
          entry.progress = Math.min(1, Number((entry.elapsedTicks / entry.buildTicks).toFixed(4)));
          if (entry.elapsedTicks >= entry.buildTicks - 1e-6) {
            if (entry.task.kind === 'buildUnit') {
              const { harvester } = resolveHubProducerRows(ctx.data);
              const id = ctx.newEntityId();
              const r = insertRow(state.entities, id, ctx.tick);
              state.entities.cols.kind[r] = ENTITY_KIND.harvester;
              state.entities.cols.owner[r] = colIdx;
              state.entities.cols.hp[r] = Number(harvester.hp ?? 160);
              state.entities.cols.hpMax[r] = Number(harvester.hp ?? 160);
              state.entities.cols.state[r] = ENTITY_STATE.idle;
              revealVision(state, colIdx, 0, 0, Number(harvester.viewRadius ?? 7), ctx.tick);
              ctx.emit({ kind: 'unitProduced', colonyIds: [colIdx], data: { entityId: id, unit: 'harvester', q: 0, r: 0 } });
            }
            entry.progress = 1;
            entry.state = 'done';
          }
        }
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
  handlers: [enqueueTaskHandler, cancelTaskHandler, reorderTaskHandler],
});

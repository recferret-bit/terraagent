import type { ResourceKey } from '@terra/contracts';
import type { CompiledDataLike } from '../../../kernel/config';
import type { StepContext } from '../../../kernel/context';
import { setBlob, type PlanetState } from '../../../kernel/state';
import { startBuildingConstruction } from '../../economy/construction';
import { buildSiteReject } from '../../economy/siteTerrain';
import { resolveUnitRowForHub } from '../../factories-hub/unit';
import { prestigeProjectRow } from '../../prestige/rows';
import { unitSupplyOfName } from '../../supply';
import { enqueueRepairForEntity } from '../../terraform-basic/dismantleAndWork';
import { ensureColony, refundEntrySpent } from '../cancel';
import type { EnqueueQueueTaskOptions } from '../index';
import { markWaiting, unitSupplyData } from '../step';
import {
  PRECEDENCE_RANK,
  type QueueEntry,
  type QueueLane,
  type QueuePrecedence,
  type QueueTaskPayload,
} from '../types';
import {
  findOldestAutoIndex,
  isW03QueueActive,
  laneLimitFor,
  nextAutoTaskId,
  resolveTaskCostAndTicks,
} from '../wait';

/** `startBuildingConstruction` codes that mean the site (not the stock) holds the entry back. */
const SITE_CODES: ReadonlySet<string> = new Set([
  'site_blocked',
  'terrain_unbuildable',
  'not_own_territory',
  'outside_power_zone',
  'invalid_args',
]);

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

export function validateEnqueuePayload(
  task: QueueTaskPayload,
  incomingPrecedence: QueuePrecedence,
  data?: CompiledDataLike,
): { ok: false; code: string; detail: string } | null {
  if (
    task.kind === 'buildUnit' &&
    ((task.unit === 'hq' && incomingPrecedence !== 'system') ||
      (!resolveUnitRowForHub(task.unit, data, task.tier) &&
        (task.unit === 'worker' || unitSupplyOfName(task.unit, unitSupplyData(task.unit, data)) === undefined)))
  ) {
    return { ok: false, code: 'invalid_args', detail: 'unknown unit' };
  }
  if (task.kind === 'project' && !prestigeProjectRow(task.project, data)) {
    return { ok: false, code: 'invalid_args', detail: 'unknown project' };
  }
  return null;
}

export function ensureQueueLaneCapacityAndSite(
  state: PlanetState,
  entries: QueueEntry[],
  activeLaneCount: number,
  colonyIndex: number,
  lane: QueueLane,
  incomingPrecedence: QueuePrecedence,
  task: QueueTaskPayload,
  tick: number,
  data?: CompiledDataLike,
): { ok: false; code: string; detail?: string } | null {
  const limit = laneLimitFor(lane);
  const fullCode = isW03QueueActive(state, data) ? 'lane_full' : 'queue_full';
  if (activeLaneCount >= limit) {
    const oldestAutoIdx =
      PRECEDENCE_RANK[incomingPrecedence] > PRECEDENCE_RANK.auto
        ? findOldestAutoIndex(entries, colonyIndex, lane)
        : -1;
    if (oldestAutoIdx < 0) {
      return { ok: false, code: fullCode, detail: `${lane} lane full` };
    }
    if (task.kind === 'build') {
      const site = buildSiteReject(state, colonyIndex, task, data);
      if (site) return { ok: false, ...site };
    }
    const evicted = entries[oldestAutoIdx];
    const colony = ensureColony(state, colonyIndex, tick);
    refundEntrySpent(state, evicted, colony, tick, data);
    evicted.state = 'cancelled';
    entries.splice(oldestAutoIdx, 1);
    return null;
  }
  if (task.kind === 'build') {
    const site = buildSiteReject(state, colonyIndex, task, data);
    if (site) return { ok: false, ...site };
  }
  return null;
}

export function buildNewQueueEntry(
  state: PlanetState,
  entries: readonly QueueEntry[],
  colonyIndex: number,
  lane: QueueLane,
  incomingPrecedence: QueuePrecedence,
  task: QueueTaskPayload,
  opts: EnqueueQueueTaskOptions,
  tick: number,
  data?: CompiledDataLike,
): QueueEntry {
  const { cost, buildTicks, workRate } = resolveTaskCostAndTicks(task, data, state, tick);
  const resolvedCost = opts.costOverride ? { ...opts.costOverride } : cost;
  return {
    taskId: opts.taskId ?? nextAutoTaskId(entries, colonyIndex, tick),
    colonyIndex,
    lane,
    precedence: incomingPrecedence,
    state: 'queued',
    task,
    cost: resolvedCost,
    totalCost: { ...resolvedCost },
    spentCost: {},
    paid: false,
    progress: 0,
    buildTicks,
    elapsedTicks: 0,
    workRate,
    ...(opts.goalId ? { goalId: opts.goalId } : {}),
    ...(opts.task.kind === 'project' && data ? { pinned: { dataHash: data.hash } } : {}),
    createdAt: tick,
  };
}

export function tryStartBuildOrRepairJob(
  state: PlanetState,
  entry: QueueEntry,
  tick: number,
  data?: CompiledDataLike,
  ctx?: StepContext,
): boolean {
  if (entry.task.kind === 'build' && entry.entityId === undefined) {
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
        costOverride: entry.cost,
      },
      ctx,
    );
    if (!started.ok) {
      const reason = SITE_CODES.has(started.code) ? 'site' : started.code === 'storage_cap' ? 'storage' : 'resources';
      const detail = reason === 'site' && started.detail ? `waiting: site (${started.detail})` : `waiting: ${reason}`;
      markWaiting(entry, reason, detail, null, tick);
      return false;
    }
    entry.entityId = started.entityId;
    return true;
  }
  if (entry.task.kind === 'repair') {
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
      return false;
    }
  }
  return true;
}

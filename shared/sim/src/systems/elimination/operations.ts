import { ENTITY_KIND } from '../../ecs/columns';
import { rowOf } from '../../ecs/store';
import { ensureColonyRecord } from '../../kernel/colonies';
import type { CompiledDataLike } from '../../kernel/config';
import type { StepContext } from '../../kernel/context';
import { setBlob, type PlanetState } from '../../kernel/state';
import { applyDamage, type ApplyDamageOptions } from '../combat/damage';
import { findHubEdgeSpawnTile } from '../factories-hub';
import { colonyWho } from '../find';
import { getColonyGoals, saveColonyGoals } from '../goals/store';
import { spawnHqUnit } from '../hq';
import type { HqUnitView } from '../hq/view';
import {
  getAllQueueEntries,
  saveQueueEntries,
  scanAndStartQueueEntries,
  type QueueEntry,
} from '../queue';
import { eliminateColony } from './ruins';
import {
  colonyHasAliveHub,
  ensureColonyEliminationRecord,
  findColonyEntityIdByKind,
  getEliminationStore,
  hqReprintCost,
  hqReprintRepeatWindowTicks,
  hqReprintTicks,
  saveEliminationStore,
} from './store';

export function clearColonyHqView(state: PlanetState, colonyIndex: number, tick: number): void {
  const col = state.colonies[colonyIndex];
  if (col) {
    col.hq = null;
    col.currentJob = 'idle';
    col.changedAt = tick;
  }
  const byColony = {
    ...((state.blobs.hq?.value as { byColony?: Record<number, HqUnitView> } | undefined)?.byColony ?? {}),
  };
  if (colonyIndex in byColony) {
    delete byColony[colonyIndex];
    setBlob(state, 'hq', { byColony }, tick);
  }
}

export function setColonyGoalsPaused(state: PlanetState, colonyIndex: number, paused: boolean, tick: number): void {
  const goals = getColonyGoals(state, colonyIndex);
  let changed = false;
  for (const g of goals) {
    if (g.status !== 'active') continue;
    const rec = g as unknown as { paused?: boolean };
    if (paused && !rec.paused) {
      rec.paused = true;
      changed = true;
    } else if (!paused && rec.paused) {
      delete rec.paused;
      changed = true;
    }
  }
  if (changed) {
    saveColonyGoals(state, colonyIndex, goals, tick);
  }
}

export function enqueueHqReprintAtFront(
  state: PlanetState,
  colonyIndex: number,
  tick: number,
  data?: CompiledDataLike,
  ctx?: StepContext,
): QueueEntry {
  const store = getEliminationStore(state);
  const rec = ensureColonyEliminationRecord(store, colonyIndex);
  const repeatWindow = hqReprintRepeatWindowTicks(data);
  const repeated =
    rec.lastHqDestroyedTick !== undefined &&
    tick >= rec.lastHqDestroyedTick &&
    tick - rec.lastHqDestroyedTick <= repeatWindow;

  rec.lastHqDestroyedTick = tick;
  rec.hqDown = true;

  const entries = getAllQueueEntries(state);
  const existing = entries.find(
    (e) =>
      e.colonyIndex === colonyIndex &&
      e.lane === 'units' &&
      e.task.kind === 'buildUnit' &&
      e.task.unit === 'hq' &&
      e.state !== 'done' &&
      e.state !== 'cancelled',
  );
  if (existing) {
    rec.hqReprintTaskId = existing.taskId;
    saveEliminationStore(state, store, tick);
    return existing;
  }

  for (const e of entries) {
    if (e.colonyIndex === colonyIndex && e.lane === 'units' && e.state === 'in_progress') {
      e.state = 'queued';
    }
  }

  const cost = hqReprintCost(data);
  const buildTicks = hqReprintTicks(data, repeated);
  const entry: QueueEntry = {
    taskId: `hq-reprint-${colonyIndex}-${tick}`,
    colonyIndex,
    lane: 'units',
    precedence: 'system',
    state: 'queued',
    task: { kind: 'buildUnit', unit: 'hq', tier: 1, count: 1 },
    cost: { ...cost },
    totalCost: { ...cost },
    spentCost: {},
    paid: false,
    progress: 0,
    buildTicks,
    elapsedTicks: 0,
    workRate: 1.0,
    createdAt: tick,
  };

  entries.unshift(entry);
  scanAndStartQueueEntries(state, entries, colonyIndex, tick, data, ctx);
  saveQueueEntries(state, entries, tick);

  rec.hqReprintTaskId = entry.taskId;
  saveEliminationStore(state, store, tick);

  const col = ensureColonyRecord(state, colonyIndex, tick);
  (col as Record<string, unknown>).hqDown = true;
  (col as Record<string, unknown>).hqReprintTaskId = entry.taskId;
  col.changedAt = tick;

  setColonyGoalsPaused(state, colonyIndex, true, tick);
  return entry;
}

export function completeHqReprint(
  state: PlanetState,
  colonyIndex: number,
  ctx: StepContext,
): { entityId: number; q: number; r: number } {
  const pos = findHubEdgeSpawnTile(state, colonyIndex, ctx.data);
  const entityId = spawnHqUnit(
    state,
    { owner: colonyIndex, q: pos.q, r: pos.r, tick: ctx.tick, data: ctx.data },
    ctx,
  );

  const store = getEliminationStore(state);
  const rec = ensureColonyEliminationRecord(store, colonyIndex);
  rec.hqDown = false;
  rec.hqReprintTaskId = undefined;
  saveEliminationStore(state, store, ctx.tick);

  const col = ensureColonyRecord(state, colonyIndex, ctx.tick);
  (col as Record<string, unknown>).hqDown = false;
  delete (col as Record<string, unknown>).hqReprintTaskId;
  col.changedAt = ctx.tick;

  setColonyGoalsPaused(state, colonyIndex, false, ctx.tick);

  const { colonyIdStr, who } = colonyWho(state, colonyIndex);
  ctx.emit({
    kind: 'unitProduced',
    colonyIds: [colonyIdStr],
    data: { ...who, entityId, unit: 'hq', tier: 1, q: pos.q, r: pos.r },
  });

  return { entityId, q: pos.q, r: pos.r };
}

export function onHqDestroyed(
  state: PlanetState,
  colonyIndex: number,
  tick: number,
  opts?: ApplyDamageOptions,
): void {
  if (colonyIndex < 0) return;
  clearColonyHqView(state, colonyIndex, tick);
  const data = opts?.data ?? opts?.ctx?.data;

  if (colonyHasAliveHub(state, colonyIndex)) {
    enqueueHqReprintAtFront(state, colonyIndex, tick, data, opts?.ctx);
    return;
  }

  eliminateColony(state, colonyIndex, 'both_lost', tick, opts);
}

export function killColonyHq(state: PlanetState, colonyIndex: number, ctx: StepContext): boolean {
  const hqId = findColonyEntityIdByKind(state, colonyIndex, ENTITY_KIND.hq);
  if (hqId < 0) return false;
  const row = rowOf(state.entities, hqId);
  const hp = row >= 0 ? Math.max(1, state.entities.cols.hp[row]) : 9999;
  applyDamage(state, hqId, hp + 1000, { tick: ctx.tick, ctx, data: ctx.data });
  return true;
}

export function killColonyHub(state: PlanetState, colonyIndex: number, ctx: StepContext): boolean {
  const hubId = findColonyEntityIdByKind(state, colonyIndex, ENTITY_KIND.commandHub);
  if (hubId < 0) return false;
  const row = rowOf(state.entities, hubId);
  const hp = row >= 0 ? Math.max(1, state.entities.cols.hp[row]) : 9999;
  applyDamage(state, hubId, hp + 1000, { tick: ctx.tick, ctx, data: ctx.data });
  return true;
}

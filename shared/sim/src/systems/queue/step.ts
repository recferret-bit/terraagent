import { ENTITY_STATE } from '../../ecs/columns';
import { rowOf } from '../../ecs/store';
import type { StepContext } from '../../kernel/context';
import type { PlanetState } from '../../kernel/state';
import type { BuildingJobRecord } from '../economy/construction';
import { payProgressiveSlice } from '../economy/ledger';
import { spawnHarvesterAtHubEdge } from '../factories-hub';
import { ensureColony } from './cancel';
import type { QueueEntry } from './types';
import { computeResourceWaitState } from './wait';

/** Marks `entry` waiting on `reason` with its status text and ETA (seconds, `null` = none). */
export function markWaiting(entry: QueueEntry, reason: QueueEntry['waitReason'], detail: string, eta: number | null = null): void {
  entry.state = 'waiting';
  entry.waitReason = reason;
  entry.etaSeconds = eta;
  entry.waitDetail = detail;
}

/** A build entry follows its building's construction job (`economy.construction` pays and advances it). */
function followBuildEntry(state: PlanetState, entry: QueueEntry & { entityId: number }): void {
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
    return;
  }
  entry.progress = state.entities.cols.progress[eRow];
  entry.waitReason = job?.status === 'waiting' ? 'resources' : undefined;
  entry.waitDetail = job?.status === 'waiting' ? 'waiting: resources' : undefined;
}

/**
 * A `buildUnit` entry finished one unit: with units of its `count` left, or `repeat` on, it starts the next one
 * (paid progressively again; `queued`, so the scan re-checks supply and resources first), else it is `done`.
 */
function finishUnit(state: PlanetState, entry: QueueEntry, colIdx: number, ctx: StepContext): void {
  const spawned = spawnHarvesterAtHubEdge(state, colIdx, ctx.tick, ctx.data, ctx);
  ctx.emit({ kind: 'unitProduced', colonyIds: [colIdx], data: { entityId: spawned.entityId, unit: 'harvester', q: spawned.q, r: spawned.r } });
  const task = entry.task.kind === 'buildUnit' ? entry.task : null;
  const count = Math.max(1, Math.floor(task?.count ?? 1));
  const left = (entry.remainingCount ?? count) - 1;
  if (left <= 0 && !task?.repeat) {
    entry.progress = 1;
    entry.state = 'done';
    return;
  }
  entry.remainingCount = left > 0 ? left : count;
  entry.elapsedTicks = 0;
  entry.progress = 0;
  entry.spentCost = {};
  entry.paid = false;
  entry.state = 'queued';
}

/** Advances one `in_progress` entry by `ctx.dt`: pays its next slice (or waits on resources) and completes it. */
export function stepQueueEntry(state: PlanetState, entry: QueueEntry, colIdx: number, ctx: StepContext): void {
  if (entry.task.kind === 'build' && entry.entityId !== undefined) {
    followBuildEntry(state, entry as QueueEntry & { entityId: number });
    return;
  }
  const colony = ensureColony(state, colIdx, ctx.tick);
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
  if (entry.elapsedTicks < entry.buildTicks - 1e-6) return;
  if (entry.task.kind === 'buildUnit') {
    finishUnit(state, entry, colIdx, ctx);
    return;
  }
  entry.progress = 1;
  entry.state = 'done';
}

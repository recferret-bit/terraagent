import { ENTITY_STATE } from '../../ecs/columns';
import { rowOf } from '../../ecs/store';
import type { StepContext } from '../../kernel/context';
import type { PlanetState } from '../../kernel/state';
import { colonyHasEligibleWorker } from '../dispatch/eligibility';
import type { BuildingJobRecord, BuildJobWait } from '../economy/buildJob';
import { payProgressiveSlice } from '../economy/ledger';
import { produceBuilderAtHubEdge, produceHarvesterAtHubEdge } from '../factories-hub';
import { getWorkJobsMap } from '../terraform-basic/workJobs';
import { ensureColony } from './cancel';
import type { QueueEntry } from './types';
import { computeResourceWaitState } from './wait';

/** Marks `entry` waiting on `reason` with its status text and ETA (seconds, `null` = none). */
export function markWaiting(
  entry: QueueEntry,
  reason: QueueEntry['waitReason'],
  detail: string,
  eta: number | null = null,
  tick?: number,
): void {
  entry.state = 'waiting';
  entry.waitReason = reason;
  entry.etaSeconds = eta;
  entry.waitDetail = detail;
  if (reason === 'resources') {
    if (tick !== undefined) entry.resourceWaitSinceTick ??= tick;
  } else {
    entry.resourceWaitSinceTick = undefined;
    entry.earmarked = undefined;
  }
}

/** What an in-progress build entry shows while its job does not advance (`../economy/buildJob.ts`). */
const BUILD_WAIT_DETAIL: Readonly<Record<BuildJobWait, (state: PlanetState, job: BuildingJobRecord) => string>> = {
  site: (_s, job) => `waiting: site (prep ${job.preparedCount ?? 0}/${job.totalTiles ?? 0})`,
  resources: () => 'waiting: resources',
  worker: (s, job) => (colonyHasEligibleWorker(s, job.owner, { kind: 'build' }) ? 'waiting: worker (HQ en route)' : 'waiting: worker (no builder)'),
};

/** A build entry follows its building's job (a builder on site advances and pays it, W02-16). */
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
  const wait = job?.status === 'waiting' ? (job.waitReason ?? 'resources') : undefined;
  entry.waitReason = wait;
  entry.waitDetail = wait && job ? BUILD_WAIT_DETAIL[wait](state, job) : undefined;
}

/** A repair entry follows its target entity's repair work job (W03-03). */
function followRepairEntry(state: PlanetState, entry: QueueEntry): boolean {
  if (entry.task.kind !== 'repair') return false;
  const targetId = entry.task.entityId;
  const eRow = rowOf(state.entities, targetId);
  const job = Object.values(getWorkJobsMap(state)).find((j) => j.mode === 'repair' && j.targetEntityId === targetId);
  if (job) {
    entry.workerEntityId = job.workerEntityId;
    entry.cost = { ...job.totalCost };
    entry.totalCost = { ...job.totalCost };
    entry.spentCost = { ...job.spentCost };
    entry.paid = Object.values(job.spentCost).some((v) => (v ?? 0) > 0);
    entry.buildTicks = job.durationTicks;
    entry.elapsedTicks = job.elapsedTicks;
    entry.progress = Math.min(1, Number(job.progress.toFixed(4)));
    entry.waitReason = job.status === 'waiting' ? ((job.waitReason as QueueEntry['waitReason']) ?? 'resources') : undefined;
    entry.waitDetail = entry.waitReason ? `waiting: ${entry.waitReason}` : undefined;
    return true;
  }
  if (eRow >= 0 && (state.entities.cols.hp[eRow] <= 0 || state.entities.cols.hp[eRow] >= state.entities.cols.hpMax[eRow])) {
    entry.spentCost = { ...(entry.totalCost ?? entry.cost) };
    entry.paid = Object.values(entry.spentCost).some((v) => (v ?? 0) > 0);
    entry.progress = 1;
    entry.state = 'done';
    return true;
  }
  return eRow >= 0;
}

/**
 * A `buildUnit` entry finished one unit: with units of its `count` left, or `repeat` on, it starts the next one
 * (paid progressively again; `queued`, so the scan re-checks supply and resources first), else it is `done`.
 */
function finishUnit(state: PlanetState, entry: QueueEntry, colIdx: number, ctx: StepContext): void {
  const task = entry.task.kind === 'buildUnit' ? entry.task : null;
  if (task?.unit === 'builder') {
    produceBuilderAtHubEdge(state, colIdx, ctx);
  } else {
    produceHarvesterAtHubEdge(state, colIdx, ctx);
  }
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
  if (entry.task.kind === 'repair' && followRepairEntry(state, entry)) {
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
      markWaiting(entry, 'resources', waitInfo.waitDetail, waitInfo.etaSeconds, ctx.tick);
      return;
    }
    entry.spentCost = spentCost;
    entry.paid = Object.values(spentCost).some((v) => (v ?? 0) > 0);
  }
  entry.elapsedTicks = nextElapsed;
  entry.progress = Math.min(1, Number(nextProgress.toFixed(4)));
  if (entry.task.kind === 'hqGoal') return;
  if (entry.elapsedTicks < entry.buildTicks - 1e-6) return;
  if (entry.task.kind === 'buildUnit') {
    finishUnit(state, entry, colIdx, ctx);
    return;
  }
  entry.progress = 1;
  entry.state = 'done';
  entry.resourceWaitSinceTick = undefined;
  entry.earmarked = undefined;
}

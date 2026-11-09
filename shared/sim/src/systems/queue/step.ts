import { ENTITY_STATE } from '../../ecs/columns';
import { rowOf } from '../../ecs/store';
import type { CompiledDataLike } from '../../kernel/config';
import type { StepContext } from '../../kernel/context';
import type { PlanetState } from '../../kernel/state';
import { colonyHasEligibleWorker } from '../dispatch/eligibility';
import type { BuildingJobRecord, BuildJobWait } from '../economy/buildJob';
import { startBuildingConstruction } from '../economy/construction';
import { checkCostAffordability, payProgressiveSlice } from '../economy/ledger';
import { produceReconAtFactoryEdge, produceWorkerAtHubEdge, selectRoboticsFactoryProducer } from '../factories-hub';
import { isCrewKind, isWorker, workerTierOf } from '../harvest/unit';
import { completePrestigeProject } from '../prestige/project';
import { checkUnitSupply } from '../supply';
import { enqueueRepairForEntity } from '../terraform-basic/dismantleAndWork';
import { getWorkJobsMap, leadJobOn } from '../terraform-basic/workJobs';
import { ensureColony } from './cancel';
import { checkStartMissing } from './earmarks';
import type { QueueEntry, QueueTaskPayload } from './types';
import { computeResourceWaitState, isBlockedByPower, maxConcurrentInLane, PRODUCER_BUFFER_LIMIT } from './wait';

/** `startBuildingConstruction` codes that mean the site (not the stock) holds the entry back. */
const SITE_CODES: ReadonlySet<string> = new Set([
  'site_blocked',
  'terrain_unbuildable',
  'not_own_territory',
  'outside_power_zone',
  'invalid_args',
]);

export function unitSupplyData(unit: string, data?: CompiledDataLike): CompiledDataLike | undefined {
  return unit === 'recon' && !data?.tables?.combatUnits ? undefined : data;
}

/** Highest-tier free Worker Drone, else the HQ, stamped onto a terraform queue entry. */
function assignTerraformQueueWorker(state: PlanetState, entry: QueueEntry, allEntries: QueueEntry[]): void {
  const busy = new Set(
    allEntries
      .filter((e) => e.colonyIndex === entry.colonyIndex && e.lane === 'terraform' && e.state === 'in_progress' && e.workerEntityId !== undefined)
      .map((e) => e.workerEntityId!),
  );
  const { count, cols } = state.entities;
  let best = -1;
  let bestScore = -1;
  for (let r = 0; r < count; r++) {
    if (cols.owner[r] !== entry.colonyIndex || cols.hp[r] <= 0 || busy.has(cols.id[r])) continue;
    const kind = cols.kind[r];
    if (!isCrewKind(kind)) continue;
    const score = (cols.tier[r] || 1) * 2 + (isWorker(kind) ? 1 : 0);
    if (score > bestScore) { bestScore = score; best = r; }
  }
  if (best < 0) return;
  entry.workerEntityId = cols.id[best];
  if (cols.workRate[best] > 0) entry.workRate = cols.workRate[best];
}

export function resolveUnitTaskProducer(
  state: PlanetState,
  colonyIndex: number,
  task: QueueTaskPayload,
  activeLane: readonly QueueEntry[],
): { ok: true; task: QueueTaskPayload } | { ok: false; code: string; detail: string } {
  if (task.kind !== 'buildUnit') return { ok: true, task };
  if (task.unit === 'recon') {
    const sel = selectRoboticsFactoryProducer(state, colonyIndex, activeLane, task.producerId);
    if (!sel.ok) return sel;
    if (sel.producerId !== undefined && task.producerId === undefined) {
      return { ok: true, task: { ...task, producerId: sel.producerId } };
    }
    return { ok: true, task };
  }
  if (typeof task.producerId === 'number') {
    const producerId = task.producerId;
    const producerEntries = activeLane.filter((e) => e.task.kind === 'buildUnit' && e.task.producerId === producerId);
    if (producerEntries.length >= PRODUCER_BUFFER_LIMIT) {
      return { ok: false, code: 'queue_full', detail: 'producer buffer full' };
    }
  }
  return { ok: true, task };
}

export function tryStartQueueEntry(
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
  if (
    entry.task.kind === 'buildUnit' &&
    !checkUnitSupply(state, entry.colonyIndex, entry.task.unit, unitSupplyData(entry.task.unit, data), {
      pending: { queue: allEntries },
      excludeTaskId: entry.taskId,
    }).ok
  ) {
    markWaiting(entry, 'supply', 'waiting: supply', null, tick);
    return;
  }
  if (isBlockedByPower(state, colony, entry)) {
    markWaiting(entry, 'power', 'waiting: power', null, tick);
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
  if (entry.lane === 'terraform' && entry.workerEntityId === undefined) assignTerraformQueueWorker(state, entry, allEntries);
  entry.state = 'in_progress';
  entry.waitReason = undefined;
  entry.waitDetail = undefined;
  entry.missingResources = undefined;
  entry.exceedsCap = undefined;
  entry.etaSeconds = undefined;
  entry.resourceWaitSinceTick = undefined;
  entry.earmarked = undefined;
}

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

/** The tier of the building a job raises (its entity's `tier` column; 1 when unset). */
function buildJobTier(state: PlanetState, job: BuildingJobRecord): number {
  const row = rowOf(state.entities, job.entityId);
  return row >= 0 ? state.entities.cols.tier[row] || 1 : 1;
}

/** What an in-progress build entry shows while its job does not advance (`../economy/buildJob.ts`). */
const BUILD_WAIT_DETAIL: Readonly<Record<BuildJobWait, (state: PlanetState, job: BuildingJobRecord) => string>> = {
  site: (_s, job) => `waiting: site (prep ${job.preparedCount ?? 0}/${job.totalTiles ?? 0})`,
  resources: () => 'waiting: resources',
  worker: (s, job) =>
    colonyHasEligibleWorker(s, job.owner, { kind: 'build', tier: buildJobTier(s, job) })
      ? 'waiting: worker (HQ en route)'
      : 'waiting: worker (none free)',
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

/** A dismantle entry follows its dismantle work job; the job gone = the building is down (or the dismantle ended). */
function followDismantleEntry(state: PlanetState, entry: QueueEntry & { task: { kind: 'dismantle' } }): void {
  const job = leadJobOn(getWorkJobsMap(state), 'dismantle', entry.task.entityId);
  if (!job) {
    entry.progress = rowOf(state.entities, entry.task.entityId) < 0 ? 1 : entry.progress;
    entry.state = 'done';
    return;
  }
  entry.workerEntityId = job.workerEntityId;
  entry.buildTicks = job.durationTicks;
  entry.elapsedTicks = job.elapsedTicks;
  entry.progress = Math.min(1, Number(job.progress.toFixed(4)));
  entry.waitReason = job.status === 'waiting' ? ((job.waitReason as QueueEntry['waitReason']) ?? 'worker') : undefined;
  entry.waitDetail = entry.waitReason === 'worker' ? 'waiting: worker (en route)' : entry.waitReason ? `waiting: ${entry.waitReason}` : undefined;
}

/** A repair entry follows its target entity's repair work job (W03-03). */
function followRepairEntry(state: PlanetState, entry: QueueEntry): boolean {
  if (entry.task.kind !== 'repair') return false;
  const targetId = entry.task.entityId;
  const eRow = rowOf(state.entities, targetId);
  const job = leadJobOn(getWorkJobsMap(state), 'repair', targetId);
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
  if (task?.unit === 'recon') {
    produceReconAtFactoryEdge(state, colIdx, ctx, task.producerId);
  } else {
    produceWorkerAtHubEdge(state, colIdx, ctx, task?.unit === 'worker' ? workerTierOf(task.tier) : 1);
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
  if (entry.task.kind === 'dismantle') {
    followDismantleEntry(state, entry as QueueEntry & { task: { kind: 'dismantle' } });
    return;
  }
  const colony = ensureColony(state, colIdx, ctx.tick);
  if (isBlockedByPower(state, colony, entry)) {
    markWaiting(entry, 'power', 'waiting: power', null, ctx.tick);
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
  if (entry.task.kind === 'project') completePrestigeProject(state, colIdx, entry.task.project, ctx);
  entry.progress = 1;
  entry.state = 'done';
  entry.resourceWaitSinceTick = undefined;
  entry.earmarked = undefined;
}

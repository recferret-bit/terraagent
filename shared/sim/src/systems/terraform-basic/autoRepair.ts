import { ENTITY_KIND, ENTITY_STATE } from '../../ecs/columns';
import { rowOf } from '../../ecs/store';
import type { CompiledDataLike } from '../../kernel/config';
import type { StepContext } from '../../kernel/context';
import type { PlanetState, SimState } from '../../kernel/state';
import { isUnitKind } from '../../units/mobility';
import { getAllQueueEntries, saveQueueEntries } from '../queue';
import { PRECEDENCE_RANK, type QueueEntry, type QueuePrecedence } from '../queue/types';
import { createRepairWorkJobRecord } from './dismantleAndWork';
import { isLeadJob, leadJobOn, type WorkJobRecord } from './workJobs';
import { primeWorkerForWorkJob, selectWorkerForWorkOp } from './workTile';

/** Whether W03 auto-repair is enabled in the active compiled data. */
export function isAutoRepairActive(data?: CompiledDataLike): boolean {
  return Boolean((data?.tables?.grid as Record<string, unknown> | undefined)?.queueConfig);
}

/** Critical HP ratio (`< 50 %` HP triggers `system` precedence). */
export function criticalRepairHpRatio(data?: CompiledDataLike): number {
  const qCfg = (data?.tables?.grid as Record<string, { criticalRepairHpRatio?: number }> | undefined)?.queueConfig;
  return Number(qCfg?.criticalRepairHpRatio ?? 0.5);
}

/** Precedence for an auto-queued repair job on a structure with `(hp, hpMax)`. */
export function repairPrecedenceForHp(hp: number, hpMax: number, data?: CompiledDataLike): 'system' | 'auto' {
  return hp < criticalRepairHpRatio(data) * Math.max(1, hpMax) ? 'system' : 'auto';
}

/** Repair rate multiplier for `workerEntityId` (`1.5x` for Worker Drone T2, `1.0x` for the HQ and other tiers). */
export function resolveWorkerRepairRate(state: SimState, workerEntityId: number, data?: CompiledDataLike): number {
  const wRow = rowOf(state.entities, workerEntityId);
  const cols = state.entities.cols;
  if (wRow >= 0 && cols.kind[wRow] === ENTITY_KIND.worker && (cols.tier[wRow] || 1) === 2) {
    const row = (data?.tables?.unitsWorkersBasic as Record<string, { repairRateMultiplier?: number }> | undefined)?.t2;
    return Number(row?.repairRateMultiplier ?? 1.5);
  }
  return 1.0;
}

function isDamagedConstructedStructure(state: SimState, row: number): boolean {
  const cols = state.entities.cols;
  if (cols.owner[row] < 0 || cols.hp[row] <= 0 || cols.hp[row] >= cols.hpMax[row]) return false;
  const kind = cols.kind[row];
  if (isUnitKind(kind) || kind === ENTITY_KIND.pod) return false;
  const st = cols.state[row];
  return st !== ENTITY_STATE.constructing && st !== ENTITY_STATE.descending && st !== ENTITY_STATE.inert;
}

function upsertRepairEntryInList(
  state: PlanetState,
  entries: QueueEntry[],
  job: WorkJobRecord,
  precedence?: QueuePrecedence,
  tick: number = state.meta.tick,
  data?: CompiledDataLike,
): QueueEntry | null {
  if (job.targetEntityId === undefined) return null;
  const targetId = job.targetEntityId;
  const tRow = rowOf(state.entities, targetId);
  const hpPrecedence =
    tRow >= 0 ? repairPrecedenceForHp(state.entities.cols.hp[tRow], state.entities.cols.hpMax[tRow], data) : 'auto';
  const workRate = resolveWorkerRepairRate(state, job.workerEntityId, data);
  const existing = entries.find(
    (e) =>
      e.colonyIndex === job.colonyId &&
      e.task.kind === 'repair' &&
      e.task.entityId === targetId &&
      e.state !== 'done' &&
      e.state !== 'cancelled',
  );

  if (existing) {
    if (hpPrecedence === 'system' && existing.precedence === 'auto') existing.precedence = 'system';
    if (precedence && PRECEDENCE_RANK[precedence] > PRECEDENCE_RANK[existing.precedence]) existing.precedence = precedence;
    existing.workerEntityId = job.workerEntityId;
    existing.workRate = workRate;
    existing.cost = { ...job.totalCost };
    existing.totalCost = { ...job.totalCost };
    existing.spentCost = { ...job.spentCost };
    existing.paid = Object.values(job.spentCost).some((v) => (v ?? 0) > 0);
    existing.buildTicks = job.durationTicks;
    existing.elapsedTicks = job.elapsedTicks;
    existing.progress = Math.min(1, Number(job.progress.toFixed(4)));
    existing.waitReason = job.status === 'waiting' ? ((job.waitReason as QueueEntry['waitReason']) ?? 'resources') : undefined;
    existing.waitDetail = existing.waitReason ? `waiting: ${existing.waitReason}` : undefined;
    return existing;
  }

  const entry: QueueEntry = {
    taskId: job.jobId,
    colonyIndex: job.colonyId,
    lane: 'construction',
    precedence: precedence ?? hpPrecedence,
    state: 'in_progress',
    task: { kind: 'repair', entityId: targetId, q: job.q, r: job.r },
    cost: { ...job.totalCost },
    totalCost: { ...job.totalCost },
    spentCost: { ...job.spentCost },
    paid: Object.values(job.spentCost).some((v) => (v ?? 0) > 0),
    progress: Math.min(1, Number(job.progress.toFixed(4))),
    buildTicks: job.durationTicks,
    elapsedTicks: job.elapsedTicks,
    workRate,
    workerEntityId: job.workerEntityId,
    createdAt: tick,
  };
  entries.push(entry);
  return entry;
}

/** Mirrors a repair `WorkJobRecord` into `state.blobs.queue` (creating or updating the `repair` queue entry). */
export function mirrorRepairQueueEntry(
  state: PlanetState,
  job: WorkJobRecord,
  precedence?: QueuePrecedence,
  tick: number = state.meta.tick,
  data?: CompiledDataLike,
): QueueEntry | null {
  const entries = getAllQueueEntries(state);
  const entry = upsertRepairEntryInList(state, entries, job, precedence, tick, data);
  saveQueueEntries(state, entries, tick);
  return entry;
}

/**
 * Scans alive, constructed own structures with `hp < hpMax` and auto-queues a repair job (`system` precedence when
 * `< 50 %` HP, `auto` otherwise; upgrades an open `auto` repair entry to `system` if HP drops below `50 %`).
 */
export function autoQueueDamagedStructures(
  state: PlanetState,
  jobs: Record<string, WorkJobRecord>,
  ctx: StepContext,
): boolean {
  if (!isAutoRepairActive(ctx.data)) return false;
  const e = state.entities, cols = e.cols;
  const damagedRows: number[] = [];
  for (let row = 0; row < e.count; row++) {
    if (isDamagedConstructedStructure(state, row)) damagedRows.push(row);
  }
  if (damagedRows.length === 0) return false;

  const critRatio = criticalRepairHpRatio(ctx.data);
  damagedRows.sort((a, b) => {
    const aCrit = cols.hp[a] < critRatio * Math.max(1, cols.hpMax[a]) ? 0 : 1;
    const bCrit = cols.hp[b] < critRatio * Math.max(1, cols.hpMax[b]) ? 0 : 1;
    return aCrit !== bCrit ? aCrit - bCrit : a - b;
  });

  let changed = false;
  const entries = getAllQueueEntries(state);
  let queueChanged = false;

  for (const row of damagedRows) {
    const targetId = cols.id[row], colonyId = cols.owner[row];
    const precedence = repairPrecedenceForHp(cols.hp[row], cols.hpMax[row], ctx.data);
    const existingJob = leadJobOn(jobs, 'repair', targetId);
    if (existingJob) {
      const wRow = rowOf(e, existingJob.workerEntityId);
      if (wRow < 0 || cols.hp[wRow] <= 0) {
        const nextWorker = selectWorkerForWorkOp(state, colonyId, cols.q[row], cols.r[row], undefined, targetId, 'repair');
        if (nextWorker !== null) {
          existingJob.workerEntityId = nextWorker;
          changed = true;
        }
      }
      upsertRepairEntryInList(state, entries, existingJob, undefined, ctx.tick, ctx.data);
      queueChanged = true;
      continue;
    }

    const workerWasBusy = (wId: number) => Object.values(jobs).some((j) => j.workerEntityId === wId);
    const workerId = selectWorkerForWorkOp(state, colonyId, cols.q[row], cols.r[row], undefined, targetId, 'repair');
    if (workerId === null) continue;
    const wasBusy = workerWasBusy(workerId);
    const jobId = `repair-${colonyId}-${targetId}`;
    const job = createRepairWorkJobRecord(state, colonyId, row, workerId, jobId, ctx.data);
    jobs[jobId] = job;
    changed = true;
    if (!wasBusy) primeWorkerForWorkJob(state, workerId, job.q, job.r, ctx.tick, ctx.data);
    upsertRepairEntryInList(state, entries, job, precedence, ctx.tick, ctx.data);
    queueChanged = true;
  }

  if (queueChanged) saveQueueEntries(state, entries, ctx.tick);
  return changed;
}

/** Syncs all open `repair` queue entries with `jobs` and marks completed repairs `done`. */
export function syncRepairQueueEntries(
  state: PlanetState,
  jobs: Readonly<Record<string, WorkJobRecord>>,
  tick: number,
  data?: CompiledDataLike,
): void {
  const entries = getAllQueueEntries(state);
  const repairJobs = Object.values(jobs).filter((j) => j.mode === 'repair' && isLeadJob(j));
  const hasRepairEntries = entries.some((e) => e.task.kind === 'repair');
  if (repairJobs.length === 0 && !hasRepairEntries) return;

  for (const job of repairJobs) {
    if (isAutoRepairActive(data) || entries.some((e) => e.task.kind === 'repair' && e.task.entityId === job.targetEntityId)) {
      upsertRepairEntryInList(state, entries, job, undefined, tick, data);
    }
  }
  for (const entry of entries) {
    if (entry.task.kind !== 'repair') continue;
    const targetId = entry.task.entityId;
    const job = repairJobs.find((j) => j.targetEntityId === targetId);
    if (job) continue;
    const tRow = rowOf(state.entities, targetId);
    if (tRow >= 0 && (state.entities.cols.hp[tRow] <= 0 || state.entities.cols.hp[tRow] >= state.entities.cols.hpMax[tRow])) {
      entry.spentCost = { ...(entry.totalCost ?? entry.cost) };
      entry.paid = Object.values(entry.spentCost).some((v) => (v ?? 0) > 0);
      entry.progress = 1;
      entry.state = 'done';
    }
  }
  saveQueueEntries(state, entries, tick);
}

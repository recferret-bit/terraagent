import type { ResourceKey } from '@terra/contracts';
import { rowOf, setField } from '../../ecs/store';
import { hexIndex } from '../../grid/hex';
import type { CompiledDataLike } from '../../kernel/config';
import type { StepContext } from '../../kernel/context';
import type { PlanetState, SimState } from '../../kernel/state';
import { nextCrewShare, workCrewRow } from '../dispatch/crew';
import { buildingKindName, demolishBuilding, resolveBuildingRow } from '../economy/construction';
import { getAllQueueEntries, saveQueueEntries } from '../queue';
import type { QueueEntry } from '../queue/types';
import { resolveHqT1Row, rowNum } from '../rows';
import { beginDismantleSite, creditDismantleRefund } from './dismantleSite';
import { ensureWorkColony, type WorkJobRecord } from './workJobs';

/**
 * Dismantle as builder work (owner feedback W03 #6). `DISMANTLE [Z]` on an own finished building orders a dismantle
 * job (`blobs.workJobs`, mode `dismantle`): a Worker Drone or the HQ walks there (the work-jobs system, movement
 * orchestrator) and takes it apart in `workCrew.dismantle.timeFactor` × the building's build time at its work rate
 * (a crew is faster, `../dispatch/crew.ts`). The refund (`refundRate` × build cost) is credited step by step as it
 * advances; at 100 % the building is removed. Meanwhile the building is an offline site (`dismantleSite.ts`) and the
 * construction lane shows a `dismantle` entry ("Dismantling n%"). Cancel: `dismantleSite.ts` → `restoreDismantleSite`.
 */

/** The dismantle settings of building row `building`: time factor and refund rate (the row's `demolishRefundRatio` wins). */
function dismantleTerms(building: string, data?: CompiledDataLike): { buildTicks: number; refundRate: number; hpLossRate: number } | null {
  const resolved = resolveBuildingRow(building, data);
  if (!resolved) return null;
  const terms = workCrewRow(data, 'dismantle');
  const repairCostRate = rowNum(workCrewRow(data, 'repair'), 'costRate');
  const buildTicks = Math.max(1, Number(resolved.row.buildS ?? 50));
  const refundRate = Number(resolved.row.demolishRefundRatio ?? rowNum(terms, 'refundRate'));
  return {
    buildTicks: Math.max(1, Math.round(buildTicks * rowNum(terms, 'timeFactor'))),
    refundRate,
    hpLossRate: repairCostRate > 0 ? refundRate / repairCostRate : 1,
  };
}

/**
 * A fresh dismantle job for finished building row `row` worked by `workerId` (not stored yet), and the building turned
 * into a dismantling site. `baseCost` is the building's build cost (`getEntityBaseBuildCost`). `null` = no building row.
 */
export function createDismantleJob(
  state: SimState,
  row: number,
  workerId: number,
  jobId: string,
  baseCost: Partial<Record<ResourceKey, number>>,
  tick: number,
  data?: CompiledDataLike,
): WorkJobRecord | null {
  const cols = state.entities.cols;
  const terms = dismantleTerms(buildingKindName(cols.kind[row]), data);
  if (!terms) return null;
  const refundTotal: Partial<Record<ResourceKey, number>> = {};
  for (const [k, v] of Object.entries(baseCost) as [ResourceKey, number][]) {
    if (v && v > 0) refundTotal[k] = Number((v * terms.refundRate).toFixed(6));
  }
  const q = cols.q[row], r = cols.r[row];
  const prev = beginDismantleSite(state, row, tick);
  return {
    jobId, colonyId: cols.owner[row], mode: 'dismantle', workerEntityId: workerId, targetEntityId: cols.id[row],
    q, r, tileIdx: Math.max(0, hexIndex(state.grid.radius).indexOf(q, r)), durationTicks: terms.buildTicks, elapsedTicks: 0, progress: 0,
    startHp: cols.hp[row], hpMax: cols.hpMax[row], energyCost: 0, yields: {}, totalCost: {}, spentCost: {},
    status: 'waiting', waitReason: 'worker', refundTotal, refunded: {}, hpLossRate: terms.hpLossRate, ...prev,
  };
}

/** The work rate of worker row `wRow` (its `workRate` column, else the HQ T1 row's). */
function workerRate(state: SimState, wRow: number, data?: CompiledDataLike): number {
  const rate = state.entities.cols.workRate[wRow];
  return rate > 0 ? rate : rowNum(resolveHqT1Row(data), 'workRate');
}

/**
 * One step of work on dismantle job `job` by the worker at `workerRow` (in reach): progress at its crew share of its
 * work rate, the refund slice, the site's remaining structure. Returns whether the job ended (done, or the building is
 * gone). At 100 % the building is removed (its refund was credited already).
 */
export function stepDismantleWorkJob(state: PlanetState, job: WorkJobRecord, workerRow: number, ctx: StepContext): boolean {
  const e = state.entities;
  const tRow = job.targetEntityId !== undefined ? rowOf(e, job.targetEntityId) : -1;
  if (tRow < 0 || e.cols.hp[tRow] <= 0) return true;
  const crew = nextCrewShare(job, ctx.tick, ctx.data);
  Object.assign(job, crew.tally);
  const elapsed = Math.min(job.durationTicks, job.elapsedTicks + ctx.dt * crew.share * workerRate(state, workerRow, ctx.data));
  const progress = elapsed >= job.durationTicks - 1e-6 ? 1 : elapsed / Math.max(1, job.durationTicks);
  job.elapsedTicks = elapsed;
  job.progress = progress;
  job.status = 'in_progress';
  job.waitReason = undefined;
  creditDismantleRefund(ensureWorkColony(state, job.colonyId, ctx.tick), job, progress, ctx.tick);
  if (progress >= 1) {
    demolishBuilding(state, job.targetEntityId!, job.colonyId, ctx.tick, ctx.data, 0);
    return true;
  }
  setField(e, tRow, 'progress', Math.fround(1 - progress), ctx.tick);
  setField(e, workerRow, 'progress', Math.fround(progress), ctx.tick);
  return false;
}

/** The construction-lane entry that shows dismantle job `job` ("Dismantling n%", `queue/step.ts` follows the job). */
export function mirrorDismantleQueueEntry(state: PlanetState, job: WorkJobRecord, tick: number): void {
  const entries = getAllQueueEntries(state);
  const row = job.targetEntityId !== undefined ? rowOf(state.entities, job.targetEntityId) : -1;
  const entry: QueueEntry = {
    taskId: job.jobId,
    colonyIndex: job.colonyId,
    lane: 'construction',
    precedence: 'player',
    state: 'in_progress',
    task: { kind: 'dismantle', entityId: job.targetEntityId ?? 0, building: row >= 0 ? buildingKindName(state.entities.cols.kind[row]) : undefined, q: job.q, r: job.r },
    cost: {},
    totalCost: {},
    spentCost: {},
    paid: false,
    progress: 0,
    buildTicks: job.durationTicks,
    elapsedTicks: 0,
    workRate: 1,
    workerEntityId: job.workerEntityId,
    waitReason: 'worker',
    waitDetail: 'waiting: worker (en route)',
    createdAt: tick,
  };
  entries.push(entry);
  saveQueueEntries(state, entries, tick);
}

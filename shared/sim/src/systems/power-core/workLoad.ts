import { ENTITY_KIND, ENTITY_STATE } from '../../ecs/columns';
import { rowOf } from '../../ecs/store';
import type { CompiledDataLike } from '../../kernel/config';
import type { SimState } from '../../kernel/state';
import { colonyTerraformOrders } from '../terraform-basic/orders';
import { isWorkerAtJob, storedActiveWorkJobs, workJobDrawPerS } from '../terraform-basic/workJobs';
import { resolvePowerRow } from './index';
import type { ShedCandidate } from './shedding';

const SHED_GROUP_ROWS = ['shedGroup1', 'shedGroup2', 'shedGroup3', 'shedGroup4'] as const;

/** The shed group whose `categories` list `terraformOp` (`economyT1Basic.shedGroup1`; 1 when no row lists it). */
export function terraformOpShedGroup(data?: CompiledDataLike): number {
  for (const id of SHED_GROUP_ROWS) {
    const row = resolvePowerRow(data, 'economyT1Basic', id);
    if (Array.isArray(row.categories) && (row.categories as unknown[]).includes('terraformOp')) return Number(row.group);
  }
  return 1;
}

/** The grid load of a colony's player work jobs (TERRAFORM / REPAIR, `blobs.workJobs`). */
export interface WorkLoad {
  /** Summed E/s of the jobs worked now (before shedding). */
  demand: number;
  /** One shed candidate per worked job (`jobId` set, `entityId` = its worker: newest worker shed first). */
  candidates: ShedCandidate[];
}

/**
 * The work jobs of `colonyIndex` that draw grid power now (`UO-TF-02`): each worker's current job, while the worker is
 * at it (walking draws nothing), with an energy cost (repair has none). A job paused for power still counts: it wants
 * the power, so it is re-evaluated every step and resumes once the grid can carry it.
 */
export function collectWorkLoad(state: SimState, colonyIndex: number, data?: CompiledDataLike): WorkLoad {
  const group = terraformOpShedGroup(data);
  const cols = state.entities.cols;
  const candidates: ShedCandidate[] = [];
  let demand = 0;
  for (const job of storedActiveWorkJobs(state)) {
    if (job.colonyId !== colonyIndex) continue;
    const drainPerS = workJobDrawPerS(job);
    if (drainPerS <= 0) continue;
    const wRow = rowOf(state.entities, job.workerEntityId);
    if (wRow < 0 || cols.hp[wRow] <= 0 || !isWorkerAtJob(state, wRow, job.q, job.r)) continue;
    demand += drainPerS;
    candidates.push({ entityId: job.workerEntityId, row: wRow, group, drainPerS, kind: cols.kind[wRow], jobId: job.jobId });
  }
  for (const order of colonyTerraformOrders(state, colonyIndex)) {
    for (const job of order.jobs) {
      if (job.totalEnergyE <= 0 || job.baseTimeS <= 0 || job.assignedUnitId === undefined) continue;
      const wRow = rowOf(state.entities, job.assignedUnitId);
      if (wRow < 0 || cols.hp[wRow] <= 0 || cols.kind[wRow] === ENTITY_KIND.hq) continue;
      if (cols.state[wRow] !== ENTITY_STATE.working && cols.state[wRow] !== ENTITY_STATE.offlineBrownout) continue;
      const workRate = cols.workRate[wRow] > 0 ? cols.workRate[wRow] : 1;
      const drainPerS = (job.totalEnergyE / job.baseTimeS) * workRate;
      demand += drainPerS;
      candidates.push({ entityId: job.assignedUnitId, row: wRow, group, drainPerS, kind: cols.kind[wRow], jobId: `${order.orderId}:${job.q},${job.r}` });
    }
  }
  return { demand: Number(demand.toFixed(4)), candidates };
}

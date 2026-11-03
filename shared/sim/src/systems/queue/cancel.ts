import { CANCEL_REFUND_RATE } from '../../data';
import { ENTITY_KIND, ENTITY_STATE } from '../../ecs/columns';
import { rowOf } from '../../ecs/store';
import type { CompiledDataLike } from '../../kernel/config';
import type { ColonyState, PlanetState } from '../../kernel/state';
import { cancelConstructionOrder } from '../construction';
import { cancelBuildingConstruction, type BuildingJobRecord } from '../economy/construction';
import { ensureColony } from '../economy/buildingRows';
import { refundCost } from '../economy/ledger';
import { cancelHubUnit, getHubUnitQueue } from '../factories-hub';
import { cancelHarvesterTask } from '../harvest';
import { cancelWorkJobs, hasWorkJob } from '../terraform-basic/dismantleAndWork';
import { cancelTerraformOrder, findTerraformOrder } from '../terraform-basic/queue';
import { UnitBook } from '../../units/book';
import type { QueueEntry } from './types';

/** Share of an in-progress entry's paid cost a cancel returns (`CANCEL_REFUND_RATE`, owner 2026-11-02). */
export const CANCEL_IN_PROGRESS_REFUND_RATIO = CANCEL_REFUND_RATE;

export { ensureColony };

export function refundEntrySpent(
  state: PlanetState,
  entry: QueueEntry,
  colony: ColonyState,
  tick: number,
  data?: CompiledDataLike,
): boolean {
  let refunded = false;
  if (entry.subEntityIds && entry.subEntityIds.length > 0) {
    for (const subId of entry.subEntityIds) {
      const eRow = rowOf(state.entities, subId);
      if (eRow >= 0 && state.entities.cols.state[eRow] === ENTITY_STATE.constructing) {
        const bRes = cancelBuildingConstruction(state, subId, entry.colonyIndex, tick, data);
        if (bRes.ok && bRes.refunded) refunded = true;
      }
    }
  } else if (entry.entityId !== undefined) {
    // Its building finished this step (the queue marks the entry `done` next step): nothing to cancel or refund.
    const eRow = rowOf(state.entities, entry.entityId);
    if (eRow >= 0 && state.entities.cols.state[eRow] !== ENTITY_STATE.constructing) return false;
    const bRes = cancelBuildingConstruction(state, entry.entityId, entry.colonyIndex, tick, data);
    if (bRes.ok && bRes.refunded) refunded = true;
  }
  if (!refunded) {
    const spent =
      entry.spentCost && Object.keys(entry.spentCost).length > 0
        ? entry.spentCost
        : entry.paid
          ? entry.cost
          : {};
    const hasSpent = Object.values(spent).some((v) => (v ?? 0) > 0);
    if (hasSpent) {
      refundCost(colony, spent, CANCEL_IN_PROGRESS_REFUND_RATIO, tick);
      refunded = true;
    }
  }
  return refunded;
}

export function cancelAllColonyTasks(
  state: PlanetState,
  colonyIndex: number,
  entries: QueueEntry[],
  tick: number,
  data: CompiledDataLike | undefined,
  saveFn: (state: PlanetState, entries: QueueEntry[], tick: number) => void,
): { ok: true; refunded: boolean } {
  const colony = ensureColony(state, colonyIndex, tick);
  let refunded = false;

  const remaining: QueueEntry[] = [];
  for (const entry of entries) {
    if (entry.colonyIndex !== colonyIndex) {
      remaining.push(entry);
      continue;
    }
    if (refundEntrySpent(state, entry, colony, tick, data)) refunded = true;
  }
  saveFn(state, remaining, tick);

  const jobs = (state.blobs.construction?.value as { jobs?: Record<number, BuildingJobRecord> } | undefined)?.jobs ?? {};
  for (const job of Object.values(jobs)) {
    if (job.owner === colonyIndex) {
      const bRes = cancelBuildingConstruction(state, job.entityId, colonyIndex, tick, data);
      if (bRes.ok && bRes.refunded) refunded = true;
    }
  }

  for (const hubEntry of getHubUnitQueue(state, colonyIndex)) {
    const uRes = cancelHubUnit(state, hubEntry.taskId, colonyIndex, tick, data);
    if (uRes.ok && uRes.refunded) refunded = true;
  }

  for (let r = 0; r < state.entities.count; r++) {
    if (state.entities.cols.owner[r] !== colonyIndex || state.entities.cols.hp[r] <= 0) continue;
    const k = state.entities.cols.kind[r];
    if (k === ENTITY_KIND.harvester || k === ENTITY_KIND.hq) {
      cancelHarvesterTask(state, state.entities.cols.id[r], tick, data);
    }
  }

  const wRes = cancelWorkJobs(state, colonyIndex, { all: true }, tick);
  if (Object.keys(wRes.refunded).length > 0) refunded = true;

  cancelConstructionOrder(state, colonyIndex, 'current', tick, data);
  cancelTerraformOrder(state, colonyIndex, 'active', tick, data);
  return { ok: true, refunded };
}

/**
 * Cancels the build a linked prep order belongs to: a W01 construction order (its order id), or a W02 building job
 * (`building:<entityId>`, refund rules of `cancelBuildingConstruction`; its queue entry ends with it).
 */
function cancelLinkedBuild(state: PlanetState, colonyIndex: number, linkedOrderId: string, tick: number, data?: CompiledDataLike): void {
  if (cancelConstructionOrder(state, colonyIndex, linkedOrderId, tick, data)) return;
  const entityId = linkedOrderId.startsWith('building:') ? Number(linkedOrderId.slice('building:'.length)) : NaN;
  if (Number.isInteger(entityId)) cancelBuildingConstruction(state, entityId, colonyIndex, tick, data);
}

/**
 * Ends the terraform order unit `entityId` is working on (current or shift-queued `terraform` commands), so the work
 * provider does not hand the same tile straight back. A Hub's linked prep is ended by cancelling its construction order.
 */
function cancelUnitTerraformOrders(state: PlanetState, entityId: number, colonyIndex: number, tick: number, data?: CompiledDataLike): void {
  const rec = new UnitBook(state).get(entityId);
  const cmds = [rec.current, ...rec.queue];
  for (const c of cmds) {
    if (!c || c.kind !== 'terraform') continue;
    const order = findTerraformOrder(state, colonyIndex, c.orderId);
    if (!order) continue;
    if (order.isLinkedPrep) {
      if (order.linkedOrderId !== undefined) cancelLinkedBuild(state, colonyIndex, order.linkedOrderId, tick, data);
    } else {
      cancelTerraformOrder(state, colonyIndex, order.orderId, tick, data);
    }
  }
}

export function tryCancelSpecialTaskId(
  state: PlanetState,
  taskId: string,
  colonyIndex: number | null | undefined,
  entries: QueueEntry[],
  tick: number,
  data: CompiledDataLike | undefined,
  scanAndSave: (colIdx: number) => void,
): { ok: true; refunded: boolean } | { ok: false; code: string } | null {
  if (taskId.startsWith('building:')) {
    const entityId = Number(taskId.slice('building:'.length));
    if (!Number.isInteger(entityId) || entityId <= 0) return { ok: false, code: 'invalid_args' };
    const qIdx = entries.findIndex((e) => e.entityId === entityId && e.state !== 'done' && e.state !== 'cancelled');
    const colIdx = qIdx >= 0 ? entries[qIdx].colonyIndex : (colonyIndex ?? 0);
    const bRes = cancelBuildingConstruction(state, entityId, colonyIndex, tick, data);
    if (!bRes.ok) return { ok: false, code: bRes.code };
    let refunded = bRes.refunded;
    if (qIdx >= 0) {
      const qEntry = entries[qIdx];
      if (!refunded && qEntry.spentCost && Object.values(qEntry.spentCost).some((v) => (v ?? 0) > 0)) {
        refundCost(ensureColony(state, colIdx, tick), qEntry.spentCost, CANCEL_IN_PROGRESS_REFUND_RATIO, tick);
        refunded = true;
      }
      entries.splice(qIdx, 1);
      scanAndSave(colIdx);
    }
    return { ok: true, refunded };
  }

  if (taskId.startsWith('harvester:') || taskId.startsWith('unit:')) {
    const entityId = Number(taskId.split(':')[1]);
    if (!Number.isInteger(entityId) || entityId <= 0) return { ok: false, code: 'invalid_args' };
    const r = rowOf(state.entities, entityId);
    if (r < 0) return { ok: false, code: 'unknown_entity' };
    if (colonyIndex !== undefined && colonyIndex !== null && state.entities.cols.owner[r] !== colonyIndex) {
      return { ok: false, code: 'not_own_colony' };
    }
    cancelUnitTerraformOrders(state, entityId, state.entities.cols.owner[r], tick, data);
    cancelHarvesterTask(state, entityId, tick, data);
    const wRes = cancelWorkJobs(state, colonyIndex, { workerEntityId: entityId }, tick);
    return { ok: true, refunded: Object.keys(wRes.refunded).length > 0 };
  }

  if (hasWorkJob(state, taskId)) {
    const wRes = cancelWorkJobs(state, colonyIndex, { jobId: taskId }, tick);
    if (wRes.cancelled > 0) {
      return { ok: true, refunded: Object.keys(wRes.refunded).length > 0 };
    }
  }

  const hubRes = cancelHubUnit(state, taskId, colonyIndex, tick, data);
  if (hubRes.ok || hubRes.code === 'not_own_colony') return hubRes;

  const numId = Number(taskId);
  if (Number.isInteger(numId) && numId > 0) {
    const jobs = (state.blobs.construction?.value as { jobs?: Record<number, BuildingJobRecord> } | undefined)?.jobs ?? {};
    if (jobs[numId]) {
      const bRes = cancelBuildingConstruction(state, numId, colonyIndex, tick, data);
      return bRes.ok ? { ok: true, refunded: bRes.refunded } : { ok: false, code: bRes.code };
    }
    const uRow = rowOf(state.entities, numId);
    if (uRow >= 0 && (state.entities.cols.kind[uRow] === ENTITY_KIND.harvester || state.entities.cols.kind[uRow] === ENTITY_KIND.hq)) {
      if (colonyIndex !== undefined && colonyIndex !== null && state.entities.cols.owner[uRow] !== colonyIndex) {
        return { ok: false, code: 'not_own_colony' };
      }
      cancelUnitTerraformOrders(state, numId, state.entities.cols.owner[uRow], tick, data);
      cancelHarvesterTask(state, numId, tick, data);
      const wRes = cancelWorkJobs(state, colonyIndex, { workerEntityId: numId }, tick);
      return { ok: true, refunded: Object.keys(wRes.refunded).length > 0 };
    }
  }

  return null;
}

export function applyReorderQueueTask(
  all: QueueEntry[],
  taskId: string,
  opts: { toIndex?: number; direction?: 'up' | 'down' | 'top' | 'bottom'; colonyIndex?: number | null },
): { ok: true; colonyIndex: number; lane: QueueEntry['lane'] } | { ok: false; code: string } {
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
  return { ok: true, colonyIndex: target.colonyIndex, lane: target.lane };
}

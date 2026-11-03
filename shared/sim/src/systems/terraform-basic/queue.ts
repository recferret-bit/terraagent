import type { RejectCode } from '@terra/contracts';
import type { CompiledDataLike } from '../../kernel/config';
import type { PlanetState, SimState } from '../../kernel/state';
import { placementWorldFromState } from '../construction/placementWorld';
import { findColonyHqRow } from '../find';
import { syncHqView } from '../hq/view';
import { resolveHqT1Row, rowNum } from '../rows';
import { executeDismantleAtTile } from './dismantleAndWork';
import { getTerraformOpSpec, isTerraformOpKind, type TerraformOpKind } from './ops';
import {
  colonyTerraformOrders,
  getColonyTerraformJobCount,
  getManualTerraformLaneCount,
  nextOrderId,
  readOrdersByColony,
  writeOrdersByColony,
  type TerraformJob,
  type TerraformOrder,
} from './orders';
import { enqueueWorkOrder } from './workOrder';
import {
  evaluateTerraform,
  evaluateTerraformTile,
  terraformJobKey,
  terraformWorldFromState,
  worldHasTerritory,
} from './rules';

/** Whether `colonyId` owns territory (an active own Hub, or at least one own tile). */
export function hasColonyClaimedTerritory(state: SimState, colonyId: number): boolean {
  return worldHasTerritory(placementWorldFromState(state), colonyId);
}

/** {@link evaluateTerraformTile} on authoritative state. */
export function canRunTerraformOpOnTile(
  state: SimState,
  colonyId: number,
  op: TerraformOpKind,
  q: number,
  r: number,
  opts?: { allowUnclaimed?: boolean; data?: CompiledDataLike },
): { ok: boolean; reason?: RejectCode } {
  return evaluateTerraformTile(terraformWorldFromState(state, colonyId, opts?.data), colonyId, op, q, r, opts);
}

export interface EnqueueTerraformOrderOpts {
  colonyId: number;
  op?: TerraformOpKind | 'auto';
  /** Each tile gets the op its terrain needs (also implied by `op: 'auto'`). */
  autoPrepare?: boolean;
  tiles?: ReadonlyArray<{ q: number; r: number }>;
  /** Pre-planned jobs (a Hub's linked prep): queued as given, re-checked when worked. */
  jobs?: ReadonlyArray<{ q: number; r: number; op: TerraformOpKind }>;
  /** The order id when the caller makes it (linked prep: `<constructionOrderId>/prep`); else the sim makes one. */
  orderId?: string;
  /** The client's id for the order (its command id). */
  taskId?: string;
  linkedOrderId?: string;
  linkedBuildingEntityId?: number;
  isLinkedPrep?: boolean;
  allowUnclaimed?: boolean;
  tick?: number;
  data?: CompiledDataLike;
}

export interface EnqueueTerraformOrderResult {
  ok: boolean;
  reason?: RejectCode;
  order?: TerraformOrder;
  skippedCount: number;
}

const newJob = (q: number, r: number, op: TerraformOpKind, data?: CompiledDataLike): TerraformJob => {
  const spec = getTerraformOpSpec(op, data);
  return { q, r, op, progress: 0, baseTimeS: spec.baseTimeS, totalEnergyE: spec.energyCostE, energyDrawnE: 0 };
};

/** Every `op:q,r` the colony already has queued (a tile is never queued twice for one op, GP-01). */
function pendingJobKeys(state: PlanetState, colonyId: number): Set<string> {
  const out = new Set<string>();
  for (const o of colonyTerraformOrders(state, colonyId)) for (const j of o.jobs) out.add(terraformJobKey(j.op, j.q, j.r));
  return out;
}

/** The manual-order lane limits (`hq.t1.terraformMaxOrders`, `terraformMaxJobs`, GP-02): a reject code or null. */
function laneFull(state: PlanetState, colonyId: number, newJobs: number, data?: CompiledDataLike): RejectCode | null {
  const hq = resolveHqT1Row(data);
  if (getManualTerraformLaneCount(state, colonyId) >= rowNum(hq, 'terraformMaxOrders')) return 'queue_full';
  return getColonyTerraformJobCount(state, colonyId) + newJobs > rowNum(hq, 'terraformMaxJobs') ? 'queue_full' : null;
}

function planJobs(state: SimState, opts: EnqueueTerraformOrderOpts): { jobs: TerraformJob[]; skippedCount: number; reject?: RejectCode } {
  if (Array.isArray(opts.jobs) && opts.jobs.length > 0) {
    if (opts.jobs.some((j) => !isTerraformOpKind(j.op))) return { jobs: [], skippedCount: 0, reject: 'invalid_args' };
    return { jobs: opts.jobs.map((j) => newJob(j.q, j.r, j.op, opts.data)), skippedCount: 0 };
  }
  const auto = Boolean(opts.autoPrepare) || opts.op === 'auto';
  if (!Array.isArray(opts.tiles) || opts.tiles.length === 0 || (!auto && !isTerraformOpKind(opts.op))) {
    return { jobs: [], skippedCount: 0, reject: 'invalid_args' };
  }
  const plan = evaluateTerraform(terraformWorldFromState(state, opts.colonyId, opts.data), {
    colonyId: opts.colonyId,
    op: isTerraformOpKind(opts.op) ? opts.op : 'grade',
    tiles: opts.tiles,
    auto,
    allowUnclaimed: opts.allowUnclaimed,
    pending: pendingJobKeys(state, opts.colonyId),
    data: opts.data,
  });
  const jobs = plan.jobs.map((j) => newJob(j.q, j.r, j.op, opts.data));
  return { jobs, skippedCount: plan.skipped.length, ...(jobs.length === 0 ? { reject: plan.firstReject ?? 'site_blocked' } : {}) };
}

/** Enqueues a single-tile, brush, or linked terraform order for `opts.colonyId`. */
export function enqueueTerraformOrder(state: SimState, opts: EnqueueTerraformOrderOpts): EnqueueTerraformOrderResult {
  const tick = opts.tick ?? state.meta.tick;
  const colonyId = opts.colonyId;
  if (opts.op === 'dismantle') {
    const tiles = opts.tiles ?? [];
    if (tiles.length === 0) return { ok: false, reason: 'invalid_args', skippedCount: 0 };
    let okCount = 0;
    let firstReject: RejectCode | undefined;
    for (const t of tiles) {
      const res = executeDismantleAtTile(state, colonyId, t.q, t.r, tick, opts.data);
      if (res.ok) okCount++;
      else if (!firstReject || res.reason === 'cannot_dismantle_hq') firstReject = res.reason;
    }
    const skippedCount = tiles.length - okCount;
    return okCount > 0 ? { ok: true, skippedCount } : { ok: false, reason: firstReject ?? 'site_blocked', skippedCount };
  }
  if (opts.op === 'work') {
    const tiles = opts.tiles ?? [];
    const reason = enqueueWorkOrder(state, colonyId, { tiles }, opts.taskId ?? `work#${colonyId}@${tick}`, tick, opts.data);
    return reason ? { ok: false, reason, skippedCount: tiles.length } : { ok: true, skippedCount: 0 };
  }
  const planned = planJobs(state, opts);
  if (planned.reject) return { ok: false, reason: planned.reject, skippedCount: planned.skippedCount };
  const isLinkedPrep = Boolean(opts.isLinkedPrep);
  if (!isLinkedPrep) {
    const full = laneFull(state, colonyId, planned.jobs.length, opts.data);
    if (full) return { ok: false, reason: full, skippedCount: planned.skippedCount };
  }
  const orderId = opts.orderId ?? nextOrderId(state, 'tf#', tick);
  const order: TerraformOrder = {
    orderId,
    taskId: opts.taskId ?? orderId,
    colonyId,
    op: isTerraformOpKind(opts.op) ? opts.op : planned.jobs[0].op,
    jobs: planned.jobs,
    skippedCount: planned.skippedCount,
    totalJobs: planned.jobs.length,
    completedJobs: 0,
    isLinkedPrep,
    ...(opts.linkedOrderId !== undefined ? { linkedOrderId: opts.linkedOrderId } : {}),
    ...(opts.linkedBuildingEntityId !== undefined ? { linkedBuildingEntityId: opts.linkedBuildingEntityId } : {}),
    ...(opts.allowUnclaimed ? { allowUnclaimed: true } : {}),
  };
  const byColony = readOrdersByColony(state);
  byColony[colonyId] = [...(byColony[colonyId] ?? []), order];
  writeOrdersByColony(state, byColony, tick);
  const hqRow = findColonyHqRow(state, colonyId);
  if (hqRow >= 0) syncHqView(state, hqRow, tick, opts.data);
  return { ok: true, order, skippedCount: planned.skippedCount };
}

/** The colony's terraform order named `id` (its order id, else the client's task id), or undefined. */
export function findTerraformOrder(state: PlanetState, colonyId: number, id: string): TerraformOrder | undefined {
  const list = colonyTerraformOrders(state, colonyId);
  return list.find((o) => o.orderId === id) ?? list.find((o) => o.taskId === id);
}

/**
 * Removes the colony's terraform order `orderId` (any kind, linked prep included: construction cancels its prep
 * through this). A unit working on it notices in its next step and goes idle (the units runner owns unit state,
 * GP-16). Returns whether an order was removed.
 */
export function removeTerraformOrder(state: SimState, colonyId: number, orderId: string, tick: number = state.meta.tick, data?: CompiledDataLike): boolean {
  const byColony = readOrdersByColony(state);
  const list = byColony[colonyId] ?? [];
  const at = list.findIndex((o) => o.orderId === orderId);
  if (at < 0) return false;
  list.splice(at, 1);
  writeOrdersByColony(state, byColony, tick);
  const hqRow = findColonyHqRow(state, colonyId);
  if (hqRow >= 0) syncHqView(state, hqRow, tick, data);
  return true;
}

/**
 * Cancels the colony's manual terraform order `id` (order id or task id; `'active'` = its first manual order). A Hub's
 * linked prep is never cancelled on its own (cancel the construction order). Returns whether an order was removed.
 */
export function cancelTerraformOrder(state: SimState, colonyId: number, id: string, tick: number = state.meta.tick, data?: CompiledDataLike): boolean {
  const order = id === 'active' ? colonyTerraformOrders(state, colonyId).find((o) => !o.isLinkedPrep) : findTerraformOrder(state, colonyId, id);
  if (!order || order.isLinkedPrep) return false;
  return removeTerraformOrder(state, colonyId, order.orderId, tick, data);
}

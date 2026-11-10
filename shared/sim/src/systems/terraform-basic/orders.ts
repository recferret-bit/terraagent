import type { ResourceKey } from '@terra/contracts';
import type { CompiledDataLike } from '../../kernel/config';
import { setBlob, type PlanetState } from '../../kernel/state';
import { discountTerraformCost, discountTerraformEnergy } from '../treasury/boost';
import { METEOR_CRATER_TERRAFORM_MULTIPLIER } from './groundWorkRule';
import { meteorCraterWorkTiles } from './meteorCraterFootprint';
import { getTerraformJobCost, getTerraformOpSpec, type TerraformOpKind } from './ops';

/**
 * The terraform queue (`blobs.terraformTasks`): one shape, `{ byColony: { [colony]: TerraformOrder[] } }`, written
 * only through {@link writeOrdersByColony} (`setBlob`, GP-08). Order ids are made by the sim (GP-09); `taskId` is the
 * id the client sent (its command id), kept so the client can name its own order when cancelling.
 */

export interface TerraformJob {
  q: number;
  r: number;
  op: TerraformOpKind;
  progress: number;
  /** Nominal duration in seconds at work rate 1.0 (`opsBasic.<op>.timeS`). */
  baseTimeS: number;
  totalEnergyE: number;
  energyDrawnE: number;
  totalCost?: Partial<Record<ResourceKey, number>>;
  spentCost?: Partial<Record<ResourceKey, number>>;
  status?: 'in_progress' | 'waiting';
  waitReason?: 'resources' | 'power';
  assignedUnitId?: number;
}

/**
 * A fresh job of `op` on `(q, r)`: time, energy and cost from the op row (`planetType` applies Irrigate's desert ×2).
 * Living-op resource and energy bills are discounted once here when `state` is passed (`terraform_boost`).
 * `work.ts` pays the stored `totalCost` and `totalEnergyE` and must not scale them again.
 */
export function newTerraformJob(
  q: number,
  r: number,
  op: TerraformOpKind,
  data?: CompiledDataLike,
  planetType?: string,
  state?: PlanetState,
  tick?: number,
): TerraformJob {
  const spec = getTerraformOpSpec(op, data);
  const at = tick ?? state?.meta.tick ?? 0;
  const rawCost = getTerraformJobCost(op, data, planetType);
  const totalCost = state ? discountTerraformCost(rawCost, state, at, op, data) : rawCost;
  const totalEnergyE = state ? discountTerraformEnergy(spec.energyCostE, state, at, op, data) : spec.energyCostE;
  const isCraterHole =
    op === 'fill' &&
    state !== undefined &&
    meteorCraterWorkTiles(state.grid.radius, q, r, state.grid.layers.terrain, state.blobs?.weather).length > 1;
  return {
    q,
    r,
    op,
    progress: 0,
    baseTimeS: isCraterHole ? spec.baseTimeS * METEOR_CRATER_TERRAFORM_MULTIPLIER : spec.baseTimeS,
    totalEnergyE,
    energyDrawnE: 0,
    ...(Object.keys(totalCost).length > 0 ? { totalCost, spentCost: {} } : {}),
  };
}

export interface TerraformOrder {
  /** Sim-made, unique on the planet (`tf<n>`, or `<constructionOrderId>/prep` for a Hub's linked prep). */
  orderId: string;
  /** The client's id for the order (its command id), or the order id. */
  taskId: string;
  colonyId: number;
  op: TerraformOpKind;
  jobs: TerraformJob[];
  skippedCount: number;
  totalJobs: number;
  completedJobs: number;
  status?: 'in_progress' | 'waiting';
  waitReason?: 'resources' | 'power';
  /** Set on a construction order's linked site prep: the construction order it belongs to. */
  linkedOrderId?: string;
  linkedBuildingEntityId?: number;
  isLinkedPrep: boolean;
  /** Linked Hub prep may work unclaimed tiles (`UO-TF-05`); kept so re-validation applies the same rule. */
  allowUnclaimed?: boolean;
}

export interface TerraformTasksBlobValue {
  byColony: Record<number, TerraformOrder[]>;
}

/** An order saved before these fields existed (SIM_VERSION 2 saves) gets their defaults; a complete order is returned as is. */
function withDefaults(o: TerraformOrder): TerraformOrder {
  if (typeof o.taskId === 'string' && typeof o.completedJobs === 'number' && typeof o.totalJobs === 'number' && typeof o.isLinkedPrep === 'boolean') return o;
  return { ...o, taskId: o.taskId ?? o.orderId, completedJobs: o.completedJobs ?? 0, totalJobs: o.totalJobs ?? o.jobs.length, isLinkedPrep: o.isLinkedPrep ?? false };
}

/** `colony`'s orders in a `terraformTasks` blob value (sim state or a client view), read-only, empty orders dropped. */
export function terraformOrdersOf(blobValue: unknown, colony: number): readonly TerraformOrder[] {
  const byColony = (blobValue as Partial<TerraformTasksBlobValue> | null | undefined)?.byColony;
  const list = byColony?.[colony];
  return Array.isArray(list) ? list.filter((o) => Array.isArray(o.jobs) && o.jobs.length > 0).map(withDefaults) : [];
}

/** `colony`'s queued terraform orders (read-only: copy before changing, see {@link readOrdersByColony}). */
export function colonyTerraformOrders(state: PlanetState, colony: number): readonly TerraformOrder[] {
  return terraformOrdersOf(state.blobs.terraformTasks?.value, colony);
}

const cloneJob = (j: TerraformJob): TerraformJob => ({
  ...j,
  ...(j.totalCost ? { totalCost: { ...j.totalCost } } : {}),
  ...(j.spentCost ? { spentCost: { ...j.spentCost } } : {}),
});

/** A mutable deep copy of every colony's orders (change it, then {@link writeOrdersByColony}). */
export function readOrdersByColony(state: PlanetState): Record<number, TerraformOrder[]> {
  const byColony = (state.blobs.terraformTasks?.value as Partial<TerraformTasksBlobValue> | undefined)?.byColony ?? {};
  const out: Record<number, TerraformOrder[]> = {};
  for (const [k, list] of Object.entries(byColony)) {
    if (Array.isArray(list)) out[Number(k)] = list.map((o) => ({ ...withDefaults(o), jobs: o.jobs.map(cloneJob) }));
  }
  return out;
}

/** Writes the queue (orders with no jobs left are dropped) and stamps the blob at `tick`. */
export function writeOrdersByColony(state: PlanetState, byColony: Record<number, TerraformOrder[]>, tick: number): void {
  const clean: Record<number, TerraformOrder[]> = {};
  const fillSpec = getTerraformOpSpec('fill');
  for (const [k, list] of Object.entries(byColony)) {
    const nonEmpty = list.filter((o) => o.jobs.length > 0);
    for (const o of nonEmpty) {
      for (const j of o.jobs) {
        if (
          j.op === 'fill' &&
          j.progress === 0 &&
          j.baseTimeS <= fillSpec.baseTimeS &&
          meteorCraterWorkTiles(state.grid.radius, j.q, j.r, state.grid.layers.terrain, state.blobs?.weather).length > 1
        ) {
          j.baseTimeS = fillSpec.baseTimeS * METEOR_CRATER_TERRAFORM_MULTIPLIER;
        }
      }
    }
    if (nonEmpty.length > 0) clean[Number(k)] = nonEmpty;
  }
  const value: TerraformTasksBlobValue = { byColony: clean };
  setBlob(state, 'terraformTasks', value, tick);
}

/** A mutable deep copy of `colony`'s orders only (change it, then {@link writeColonyOrders}; GP-22). */
export function readColonyOrders(state: PlanetState, colony: number): TerraformOrder[] {
  return colonyTerraformOrders(state, colony).map((o) => ({ ...o, jobs: o.jobs.map(cloneJob) }));
}

/** Replaces `colony`'s orders (other colonies' lists are kept as they are) and stamps the blob at `tick`. */
export function writeColonyOrders(state: PlanetState, colony: number, list: TerraformOrder[], tick: number): void {
  const byColony = (state.blobs.terraformTasks?.value as Partial<TerraformTasksBlobValue> | undefined)?.byColony ?? {};
  writeOrdersByColony(state, { ...byColony, [colony]: list }, tick);
}

/** Returns the queued terraform orders for `colonyId` (a copy). */
export function getColonyTerraformOrders(state: PlanetState, colonyId: number): TerraformOrder[] {
  return readOrdersByColony(state)[colonyId] ?? [];
}

/** The number of manual (non-linked-prep) terraform orders in `colonyId`'s Terraform lane (`UO-TF-03`, GP-02). */
export function getManualTerraformLaneCount(state: PlanetState, colonyId: number): number {
  return colonyTerraformOrders(state, colonyId).filter((o) => !o.isLinkedPrep).length;
}

/** The number of queued terraform jobs of `colonyId` (all orders, GP-02). */
export function getColonyTerraformJobCount(state: PlanetState, colonyId: number): number {
  return colonyTerraformOrders(state, colonyId).reduce((n, o) => n + o.jobs.length, 0);
}

/** A new sim-made order id, unique on the planet (`<prefix><n>`; the counter is the `orderSeq` blob, GP-09). */
export function nextOrderId(state: PlanetState, prefix: string, tick: number): string {
  const prev = state.blobs.orderSeq?.value;
  const n = (typeof prev === 'number' ? prev : 0) + 1;
  setBlob(state, 'orderSeq', n, tick);
  return `${prefix}${n}`;
}

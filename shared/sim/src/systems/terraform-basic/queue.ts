import type { RejectCode, ResourceKey } from '@terra/contracts';
import { dataRow } from '../../data';
import { ENTITY_KIND, ENTITY_STATE } from '../../ecs/columns';
import { setField } from '../../ecs/store';
import { hexIndex } from '../../grid/hex';
import { PREP, TERRAIN } from '../../grid/layers';
import { isValidTileIndex } from '../../grid/tileModel';
import type { CompiledDataLike } from '../../kernel/config';
import type { PlanetState, SimState } from '../../kernel/state';
import { defaultW01Data, syncHqView } from '../hq';

export type TerraformOpKind = 'grade' | 'clear' | 'break';

export interface TerraformOpSpec {
  op: TerraformOpKind;
  baseTimeS: number;
  energyCostE: number;
  yieldResource: ResourceKey | null;
  yieldAmount: number;
}

export interface TerraformJob {
  q: number;
  r: number;
  op: TerraformOpKind;
  progress: number;
  baseTimeS: number;
  totalEnergyE: number;
  energyDrawnE: number;
}

export interface TerraformOrder {
  orderId: string;
  taskId: string;
  colonyId: number;
  op: TerraformOpKind;
  jobs: TerraformJob[];
  skippedCount: number;
  linkedBuildingId?: number | string;
  allowUnclaimed?: boolean;
}

export interface TerraformTasksBlobValue {
  orders: TerraformOrder[];
  byColony: Record<number, TerraformOrder[]>;
  [colonyId: number]: TerraformOrder[];
}

const VALID_OPS: ReadonlySet<string> = new Set(['grade', 'clear', 'break']);

export function isTerraformOpKind(op: unknown): op is TerraformOpKind {
  return typeof op === 'string' && VALID_OPS.has(op);
}

/** Looks up the balance row for `grade | clear | break` from `opsBasic`. */
export function getTerraformOpSpec(op: TerraformOpKind, data?: CompiledDataLike): TerraformOpSpec {
  const src = data?.tables.opsBasic ? data : defaultW01Data();
  const row = dataRow(src, 'opsBasic', op);
  const baseTimeS = Number(row.baseTimeS ?? row.designSeconds ?? 3);
  const energyCostE = Number(row.energyCostE ?? row.energy ?? 20);
  const yieldResource = typeof row.yieldResource === 'string' ? (row.yieldResource as ResourceKey) : null;
  const yieldAmount = typeof row.yieldAmount === 'number' ? row.yieldAmount : 0;
  return { op, baseTimeS, energyCostE, yieldResource, yieldAmount };
}

/**
 * Returns `true` if `colonyId` has already claimed territory (either has an active Command Hub or owns at least one tile).
 */
export function hasColonyClaimedTerritory(state: SimState, colonyId: number): boolean {
  const e = state.entities;
  const cols = e.cols;
  for (let row = 0; row < e.count; row++) {
    if (cols.kind[row] !== ENTITY_KIND.hub) continue;
    if (cols.owner[row] !== colonyId) continue;
    if (cols.hpMax[row] > 0 && cols.hp[row] <= 0) continue;
    if (cols.state[row] === ENTITY_STATE.active) return true;
  }
  const owners = state.grid.layers.owner as Int8Array;
  for (let i = 0; i < state.grid.count; i++) {
    if (owners[i] === colonyId) return true;
  }
  return false;
}

/**
 * Validates whether `colonyId` can run `op` (`'grade' | 'clear' | 'break'`) on tile `(q, r)` (`UO-TF-05`, §4.5).
 */
export function canRunTerraformOpOnTile(
  state: SimState,
  colonyId: number,
  op: TerraformOpKind,
  q: number,
  r: number,
  opts?: { allowUnclaimed?: boolean },
): { ok: boolean; reason?: RejectCode } {
  if (!isTerraformOpKind(op) || !Number.isInteger(q) || !Number.isInteger(r)) {
    return { ok: false, reason: 'invalid_args' };
  }
  const tileIdx = hexIndex(state.grid.radius).indexOf(q, r);
  if (tileIdx < 0 || !isValidTileIndex(state.grid, tileIdx)) {
    return { ok: false, reason: 'invalid_args' };
  }

  const owner = state.grid.layers.owner[tileIdx];
  if (owner >= 0 && owner !== colonyId) {
    return { ok: false, reason: 'not_own_territory' };
  }
  if (owner === -1 && !opts?.allowUnclaimed && hasColonyClaimedTerritory(state, colonyId)) {
    return { ok: false, reason: 'not_own_territory' };
  }

  const terrain = state.grid.layers.terrain[tileIdx];
  const prep = state.grid.layers.prep[tileIdx];
  if (op === 'grade') {
    if (
      terrain !== TERRAIN.flat ||
      prep === PREP.prepared ||
      prep === PREP.living ||
      prep === PREP.ridge ||
      prep === PREP.moat
    ) {
      return { ok: false, reason: 'site_blocked' };
    }
    return { ok: true };
  }
  if (op === 'clear') {
    return terrain === TERRAIN.forest ? { ok: true } : { ok: false, reason: 'site_blocked' };
  }
  if (op === 'break') {
    return terrain === TERRAIN.rock ? { ok: true } : { ok: false, reason: 'site_blocked' };
  }
  return { ok: false, reason: 'invalid_args' };
}

export function readOrdersByColony(state: PlanetState): Record<number, TerraformOrder[]> {
  const blob = state.blobs.terraformTasks;
  if (!blob) return {};
  const val = (blob.value ?? blob) as Partial<TerraformTasksBlobValue>;
  const out: Record<number, TerraformOrder[]> = {};
  if (val.byColony && typeof val.byColony === 'object') {
    for (const [k, list] of Object.entries(val.byColony)) {
      const colIdx = Number(k);
      if (Number.isInteger(colIdx) && Array.isArray(list)) {
        out[colIdx] = list.map((o) => ({ ...o, jobs: o.jobs.map((j) => ({ ...j })) }));
      }
    }
    return out;
  }
  if (Array.isArray(val.orders)) {
    for (const order of val.orders) {
      const list = out[order.colonyId] ?? (out[order.colonyId] = []);
      list.push({ ...order, jobs: order.jobs.map((j) => ({ ...j })) });
    }
  }
  return out;
}

export function writeOrdersByColony(
  state: PlanetState,
  byColony: Record<number, TerraformOrder[]>,
  tick: number,
): void {
  const cleanByColony: Record<number, TerraformOrder[]> = {};
  const allOrders: TerraformOrder[] = [];
  for (const [k, list] of Object.entries(byColony)) {
    const colIdx = Number(k);
    const nonEmpty = list.filter((o) => o.jobs.length > 0);
    if (nonEmpty.length > 0) {
      cleanByColony[colIdx] = nonEmpty;
      allOrders.push(...nonEmpty);
    }
  }
  const value: TerraformTasksBlobValue = {
    orders: allOrders,
    byColony: cleanByColony,
    ...cleanByColony,
  };
  state.blobs.terraformTasks = {
    changedAt: tick,
    value,
    ...value,
  } as unknown as PlanetState['blobs'][string];
}

export function findColonyHqSlot(state: PlanetState, colonyId: number): number {
  const e = state.entities;
  const cols = e.cols;
  for (let row = 0; row < e.count; row++) {
    if (cols.kind[row] !== ENTITY_KIND.hq) continue;
    if (cols.owner[row] !== colonyId) continue;
    if (cols.hpMax[row] > 0 && cols.hp[row] <= 0) continue;
    return row;
  }
  return -1;
}

/** Returns the queued terraform orders for `colonyId`. */
export function getColonyTerraformOrders(state: SimState, colonyId: number): TerraformOrder[] {
  return readOrdersByColony(state)[colonyId] ?? [];
}

export interface EnqueueTerraformOrderOpts {
  colonyId: number;
  op?: TerraformOpKind;
  tiles?: ReadonlyArray<{ q: number; r: number; op?: TerraformOpKind }>;
  jobs?: ReadonlyArray<{ q: number; r: number; op: TerraformOpKind; baseTimeS?: number; totalEnergyE?: number }>;
  orderId?: string;
  taskId?: string;
  linkedBuildingId?: number | string;
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

/** Enqueues a single-tile, brush, or linked multi-step terraform order for `opts.colonyId`. */
export function enqueueTerraformOrder(
  state: SimState,
  opts: EnqueueTerraformOrderOpts,
): EnqueueTerraformOrderResult {
  const tick = opts.tick ?? state.meta.tick;
  const colonyId = opts.colonyId;
  const jobs: TerraformJob[] = [];
  let skippedCount = 0;
  let firstReject: RejectCode | undefined;

  if (Array.isArray(opts.jobs) && opts.jobs.length > 0) {
    for (const item of opts.jobs) {
      if (!isTerraformOpKind(item.op)) {
        return { ok: false, reason: 'invalid_args', skippedCount };
      }
      const spec = getTerraformOpSpec(item.op, opts.data);
      jobs.push({
        q: item.q,
        r: item.r,
        op: item.op,
        progress: 0,
        baseTimeS: item.baseTimeS ?? spec.baseTimeS,
        totalEnergyE: item.totalEnergyE ?? spec.energyCostE,
        energyDrawnE: 0,
      });
    }
  } else if (Array.isArray(opts.tiles) && opts.tiles.length > 0) {
    const defaultOp = opts.op;
    for (const tile of opts.tiles) {
      const tileOp = tile.op ?? defaultOp;
      if (!tileOp || !isTerraformOpKind(tileOp)) {
        return { ok: false, reason: 'invalid_args', skippedCount };
      }
      const check = canRunTerraformOpOnTile(state, colonyId, tileOp, tile.q, tile.r, {
        allowUnclaimed: opts.allowUnclaimed,
      });
      if (!check.ok) {
        skippedCount++;
        if (!firstReject) firstReject = check.reason ?? 'site_blocked';
        continue;
      }
      const spec = getTerraformOpSpec(tileOp, opts.data);
      jobs.push({
        q: tile.q,
        r: tile.r,
        op: tileOp,
        progress: 0,
        baseTimeS: spec.baseTimeS,
        totalEnergyE: spec.energyCostE,
        energyDrawnE: 0,
      });
    }
  } else {
    return { ok: false, reason: 'invalid_args', skippedCount: 0 };
  }

  if (jobs.length === 0) {
    return { ok: false, reason: firstReject ?? 'site_blocked', skippedCount };
  }

  const byColony = readOrdersByColony(state);
  const existing = byColony[colonyId] ?? [];
  const resolvedId = opts.orderId ?? opts.taskId ?? `tf_${colonyId}_${tick}_${existing.length + 1}`;
  const order: TerraformOrder = {
    orderId: resolvedId,
    taskId: resolvedId,
    colonyId,
    op: opts.op ?? jobs[0].op,
    jobs,
    skippedCount,
    ...(opts.linkedBuildingId !== undefined ? { linkedBuildingId: opts.linkedBuildingId } : {}),
    ...(opts.allowUnclaimed ? { allowUnclaimed: true } : {}),
  };
  byColony[colonyId] = [...existing, order];
  writeOrdersByColony(state, byColony, tick);

  const hqSlot = findColonyHqSlot(state, colonyId);
  if (hqSlot >= 0) {
    syncHqView(state, hqSlot, tick, opts.data);
  }
  return { ok: true, order, skippedCount };
}

/** Cancels a queued or active terraform order for `colonyId` and resets HQ state if idle. */
export function cancelTerraformOrder(
  state: SimState,
  colonyId: number,
  orderId?: string | number,
  tick: number = state.meta.tick,
  data?: CompiledDataLike,
): boolean {
  const byColony = readOrdersByColony(state);
  const list = byColony[colonyId];
  if (!list || list.length === 0) return false;

  let removeIdx: number;
  if (orderId === undefined || orderId === '' || orderId === 'current' || orderId === 'active') {
    removeIdx = 0;
  } else {
    const target = String(orderId);
    removeIdx = list.findIndex(
      (o) =>
        o.orderId === target ||
        o.taskId === target ||
        (o.linkedBuildingId !== undefined && String(o.linkedBuildingId) === target),
    );
  }
  if (removeIdx < 0) return false;

  list.splice(removeIdx, 1);
  byColony[colonyId] = list;
  writeOrdersByColony(state, byColony, tick);

  const hqSlot = findColonyHqSlot(state, colonyId);
  if (hqSlot >= 0) {
    if (removeIdx === 0 || list.length === 0) {
      if (state.entities.cols.state[hqSlot] === ENTITY_STATE.working) {
        setField(state.entities, hqSlot, 'state', ENTITY_STATE.idle, tick);
      }
      setField(state.entities, hqSlot, 'progress', 0, tick);
    }
    syncHqView(state, hqSlot, tick, data);
  }
  return true;
}

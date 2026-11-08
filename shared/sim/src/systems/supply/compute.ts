import type { CompiledDataLike } from '../../kernel/config';
import type { PlanetState } from '../../kernel/state';
import { isActiveCapacityProvider } from '../economy/ledger';
import { supplySources, unitSupplyOfName } from './sources';

/** One cap source line of the colony supply (e.g. `Supply Depot ×2 → +16`). */
export interface SupplyCapSource {
  building: string;
  label: string;
  count: number;
  each: number;
  total: number;
}

/**
 * The colony's unit supply (the `colony.supply` field, synced to clients): `used = units + reserved` against
 * `cap = min(max, Σ sources)`.
 */
export interface ColonySupply {
  /** Supply of alive owned units plus supply reserved by unit production already started. */
  used: number;
  /** Supply of alive owned units (a unit with `supply: 0`, the HQ, adds nothing). */
  units: number;
  /** Supply reserved by unit orders in production (started, not yet spawned). */
  reserved: number;
  cap: number;
  /** `max(0, cap - used)`. */
  available: number;
  /** The data ceiling the cap is clamped to (`hub.t1.supplyCapMax`). */
  max: number;
  sources: SupplyCapSource[];
  /** Present and `true` when `used > cap` (e.g. a supply provider went offline or was destroyed). */
  overCap?: boolean;
}

/**
 * A unit production order as the supply reads it: a `units`-lane queue entry (`task.kind === 'buildUnit'`) or a legacy
 * Hub production entry (`unit`). It reserves its unit's supply from the moment production starts (`in_progress`, or
 * paused mid-build on resources) until the unit spawns or the order is cancelled.
 */
export interface SupplyOrderLike {
  taskId?: string;
  colonyIndex: number;
  state: string;
  unit?: string;
  task?: { kind: string; unit?: string };
  elapsedTicks?: number;
  waitReason?: string;
}

/** Live order lists of a caller that mutates them before saving (read from the blobs when absent). */
export interface PendingOrders {
  queue?: readonly SupplyOrderLike[];
  hub?: readonly SupplyOrderLike[];
}

export interface SupplyReadOpts {
  pending?: PendingOrders;
  /** An order whose own reservation is left out (the order asking whether it may start). */
  excludeTaskId?: string;
}

/** The unit an order produces (`undefined` for a non-unit order). */
export function orderUnit(o: SupplyOrderLike): string | undefined {
  if (o.task) return o.task.kind === 'buildUnit' ? o.task.unit : undefined;
  return o.unit;
}

/** Whether `o` holds a supply reservation: its production started and is not done, cancelled or blocked on supply. */
export function reservesSupply(o: SupplyOrderLike): boolean {
  if (o.state === 'in_progress') return true;
  return o.state === 'waiting' && o.waitReason !== 'supply' && (o.elapsedTicks ?? 0) > 0;
}

function blobOrders(state: PlanetState, name: 'queue' | 'hubProduction'): readonly SupplyOrderLike[] {
  return (state.blobs[name]?.value as { entries?: SupplyOrderLike[] } | undefined)?.entries ?? [];
}

function reservedSupply(state: PlanetState, colonyIndex: number, data: CompiledDataLike | undefined, opts: SupplyReadOpts): number {
  const lists = [opts.pending?.queue ?? blobOrders(state, 'queue'), opts.pending?.hub ?? blobOrders(state, 'hubProduction')];
  let reserved = 0;
  for (const list of lists) {
    for (const o of list) {
      if (o.colonyIndex !== colonyIndex || (opts.excludeTaskId !== undefined && o.taskId === opts.excludeTaskId)) continue;
      const unit = orderUnit(o);
      if (unit !== undefined && reservesSupply(o)) reserved += unitSupplyOfName(unit, data) ?? 0;
    }
  }
  return reserved;
}

/** Computes colony `colonyIndex`'s supply from the entity store, the production orders and the data (pure read). */
export function computeColonySupply(
  state: PlanetState,
  colonyIndex: number,
  data?: CompiledDataLike,
  opts: SupplyReadOpts = {},
): ColonySupply {
  const src = supplySources(data);
  const e = state.entities, cols = e.cols;
  const providerCounts = new Map<number, number>();
  let units = 0;
  for (let r = 0; r < e.count; r++) {
    if (cols.owner[r] !== colonyIndex || cols.hp[r] <= 0) continue;
    const kind = cols.kind[r];
    units += src.unitSupplyByKind.get(kind) ?? 0;
    if (src.providers.has(kind) && isActiveCapacityProvider(state, r)) providerCounts.set(kind, (providerCounts.get(kind) ?? 0) + 1);
  }
  const sources: SupplyCapSource[] = [];
  let sum = 0;
  for (const [kind, count] of [...providerCounts].sort((a, b) => a[0] - b[0])) {
    const p = src.providers.get(kind)!;
    const total = count * p.provided;
    sum += total;
    sources.push({ building: p.building, label: p.label, count, each: p.provided, total });
  }
  const reserved = reservedSupply(state, colonyIndex, data, opts);
  const cap = Math.min(src.capMax, sum);
  const used = units + reserved;
  return {
    used,
    units,
    reserved,
    cap,
    available: Math.max(0, cap - used),
    max: src.capMax,
    sources,
    ...(used > cap ? { overCap: true } : {}),
  };
}

export type UnitSupplyCheck =
  | { ok: true; supply: ColonySupply; unitSupply: number }
  | { ok: false; code: 'supply_cap' | 'invalid_args'; detail: string };

/**
 * Whether colony `colonyIndex` has room for one more `unit` now (`used + supply(unit) <= cap`). The one supply rule of
 * every production path: the `enqueueTask` handler rejects with it, the queues start (or wait on `supply`) with it.
 */
export function checkUnitSupply(
  state: PlanetState,
  colonyIndex: number,
  unit: string,
  data?: CompiledDataLike,
  opts: SupplyReadOpts = {},
): UnitSupplyCheck {
  const unitSupply = unitSupplyOfName(unit, data);
  if (unitSupply === undefined) return { ok: false, code: 'invalid_args', detail: 'unknown unit' };
  const supply = computeColonySupply(state, colonyIndex, data, opts);
  if (unitSupply > 0 && supply.used + unitSupply > supply.cap) {
    const detail = supply.cap <= 0
      ? 'No unit supply yet: finish the Command Hub'
      : `Supply cap reached (${supply.used} / ${supply.cap}): build a Supply Depot`;
    return { ok: false, code: 'supply_cap', detail };
  }
  return { ok: true, supply, unitSupply };
}

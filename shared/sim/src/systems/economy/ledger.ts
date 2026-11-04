import {
  RESOURCE_FAMILIES,
  RESOURCE_FAMILY_OF,
  RESOURCE_KEYS,
  type ResourceFamily,
  type ResourceKey,
} from '@terra/contracts';
import { ENTITY_KIND, ENTITY_STATE } from '../../ecs/columns';
import type { LedgerReason } from '../../economy/reasons';
import { RESIDUAL_SCALE, fromMicro, splitMicro, toMicro, valueMicro } from '../../economy/residual';
import type { ColonyState, PlanetState } from '../../kernel/state';
import { moveMicro } from './flow';

export const BASE_HUB_STORAGE_CAP = 500;
export const DEPOT_STORAGE_CAP = 1000;

export interface ColonyProductionLedger {
  capped: Record<ResourceFamily, number>;
  produced: Record<ResourceKey, number>;
  incomePerS: Record<ResourceKey, number>;
  familyIncomePerS: Record<ResourceFamily, number>;
}

export interface ColonyLedgerFields {
  /** Whole units only (LED-16). */
  stock: Record<ResourceKey, number>;
  /** Sub-unit rest of each resource in integer micro-units (`0 <= residual < RESIDUAL_SCALE`), see `economy/residual`. */
  residual: Record<ResourceKey, number>;
  caps: Record<ResourceFamily, number>;
  production: ColonyProductionLedger;
}

export type ColonyWithLedger = ColonyState & ColonyLedgerFields;

export function createEmptyStock(): Record<ResourceKey, number> {
  const out = {} as Record<ResourceKey, number>;
  for (const k of RESOURCE_KEYS) out[k] = 0;
  return out;
}

export function createDefaultFamilyCaps(
  baseCap = BASE_HUB_STORAGE_CAP,
  depotCount = 0,
): Record<ResourceFamily, number> {
  const cap = baseCap + depotCount * DEPOT_STORAGE_CAP;
  return { metals: cap, minerals: cap, bio: cap };
}

export function createEmptyFamilyRecord(): Record<ResourceFamily, number> {
  return { metals: 0, minerals: 0, bio: 0 };
}

/**
 * Ensures `colony` has valid D-34 `stock` (10 ResourceKeys), `caps` (3 ResourceFamilies), and
 * `production` (`capped`, `produced`, `incomePerS`, `familyIncomePerS`) records, preserving any existing numbers.
 */
export function ensureColonyLedger(
  colony: ColonyState,
  opts?: { baseCap?: number; depotCount?: number },
): ColonyWithLedger {
  const rawStock = (colony.stock ?? {}) as Partial<Record<ResourceKey, number>>;
  const rawResidual = (colony.residual ?? {}) as Partial<Record<ResourceKey, number>>;
  const stock = createEmptyStock();
  const residual = createEmptyStock();
  for (const k of RESOURCE_KEYS) {
    const s = rawStock[k], r = rawResidual[k];
    const sOk = typeof s === 'number' && Number.isFinite(s), rOk = typeof r === 'number' && Number.isFinite(r);
    if (sOk && Number.isInteger(s) && s >= 0 && (!rOk || (Number.isInteger(r) && r >= 0 && r < RESIDUAL_SCALE))) {
      stock[k] = s;
      if (rOk) residual[k] = r;
    } else if (sOk || rOk) {
      // A fractional or out-of-range balance (a save from before whole-unit stock, a test): keep its value to the
      // micro-unit, whole part in stock, the rest in the residual.
      const v = (sOk ? toMicro(s) : 0) + (rOk ? Math.round(r) : 0);
      const sp = splitMicro(Math.max(0, v));
      stock[k] = sp.stock;
      residual[k] = sp.residual;
    }
  }
  colony.stock = stock;
  colony.residual = residual;

  const defaultCaps = createDefaultFamilyCaps(opts?.baseCap ?? BASE_HUB_STORAGE_CAP, opts?.depotCount ?? 0);
  const rawCaps = (colony.caps ?? {}) as Partial<Record<ResourceFamily, number>>;
  const caps = { ...defaultCaps };
  for (const f of RESOURCE_FAMILIES) {
    if (typeof rawCaps[f] === 'number' && Number.isFinite(rawCaps[f]!)) {
      caps[f] = rawCaps[f]!;
    }
  }
  colony.caps = caps;

  const rawProd = (colony.production ?? {}) as Partial<ColonyProductionLedger>;
  const capped = createEmptyFamilyRecord();
  const familyIncomePerS = createEmptyFamilyRecord();
  for (const f of RESOURCE_FAMILIES) {
    if (typeof rawProd.capped?.[f] === 'number') capped[f] = rawProd.capped[f];
    if (typeof rawProd.familyIncomePerS?.[f] === 'number') familyIncomePerS[f] = rawProd.familyIncomePerS[f];
  }
  const produced = createEmptyStock();
  const incomePerS = createEmptyStock();
  for (const k of RESOURCE_KEYS) {
    if (typeof rawProd.produced?.[k] === 'number') produced[k] = rawProd.produced[k];
    if (typeof rawProd.incomePerS?.[k] === 'number') incomePerS[k] = rawProd.incomePerS[k];
  }
  colony.production = { capped, produced, incomePerS, familyIncomePerS };

  return colony as ColonyWithLedger;
}

/** Recomputes the 3 family storage caps (`500` from Hub + `1000` per active Supply Depot). */
export function recomputeFamilyCaps(
  colony: ColonyState,
  hasHub = true,
  depotCount = 0,
  tick?: number,
): Record<ResourceFamily, number> {
  const c = ensureColonyLedger(colony);
  const cap = (hasHub ? BASE_HUB_STORAGE_CAP : 0) + depotCount * DEPOT_STORAGE_CAP;
  let changed = false;
  for (const f of RESOURCE_FAMILIES) {
    const cur = c.caps[f] ?? 0;
    const nextCap = hasHub && depotCount === 0 && cur < BASE_HUB_STORAGE_CAP + DEPOT_STORAGE_CAP ? Math.max(cur, cap) : cap;
    if (c.caps[f] !== nextCap) {
      c.caps[f] = nextCap;
      changed = true;
    }
  }
  if (changed && tick !== undefined) c.changedAt = tick;
  return c.caps;
}

/** Entity states in which a building gives no colony capacity (storage, unit supply): not built yet, or off the grid. */
const INACTIVE_PROVIDER_STATES: ReadonlySet<number> = new Set([
  ENTITY_STATE.constructing,
  ENTITY_STATE.offlineBrownout,
  ENTITY_STATE.offlineUnpowered,
  ENTITY_STATE.offlineOverload,
  ENTITY_STATE.offlineNoGrid,
]);

/** Whether entity row `r` is an alive, completed and powered building (one rule for storage and supply caps). */
export function isActiveCapacityProvider(state: PlanetState, r: number): boolean {
  const cols = state.entities.cols;
  return cols.hp[r] > 0 && !INACTIVE_PROVIDER_STATES.has(cols.state[r]);
}

/** Counts active (completed, alive, powered) Supply Depot T1 entities owned by `colonyIndex`. */
export function countActiveSupplyDepots(state: PlanetState, colonyIndex: number): number {
  const e = state.entities, cols = e.cols;
  let count = 0;
  for (let r = 0; r < e.count; r++) {
    if (cols.owner[r] !== colonyIndex || cols.kind[r] !== ENTITY_KIND.supplyDepot) continue;
    if (isActiveCapacityProvider(state, r)) count++;
  }
  return count;
}

/** Synchronizes `colony.caps` for `colonyIndex` from its active Supply Depots (`500` + `1000` per active depot). */
export function syncColonyDepotCaps(
  state: PlanetState,
  colonyIndex: number,
  tick: number = state.meta.tick,
): Record<ResourceFamily, number> {
  const colony = state.colonies[colonyIndex];
  if (!colony) return createDefaultFamilyCaps();
  return recomputeFamilyCaps(colony, true, countActiveSupplyDepots(state, colonyIndex), tick);
}

/** Total stored stock across all tiers of `family` (`metals`, `minerals`, or `bio`). */
export function familyStock(colony: ColonyState, family: ResourceFamily): number {
  const c = ensureColonyLedger(colony);
  let sum = 0;
  for (const k of RESOURCE_KEYS) {
    if (RESOURCE_FAMILY_OF[k] === family) sum += c.stock[k];
  }
  return sum;
}

/** Remaining storage capacity in `family` before hitting `caps[family]`. */
export function remainingFamilyCap(colony: ColonyState, family: ResourceFamily): number {
  const c = ensureColonyLedger(colony);
  const reserved = Number(
    (colony.cargo as { reservedByFamily?: Partial<Record<ResourceFamily, number>> } | undefined)
      ?.reservedByFamily?.[family] ?? 0,
  );
  return Math.max(0, c.caps[family] - familyStock(c, family) - Math.max(0, reserved));
}

export function isFamilyAtCap(colony: ColonyState, family: ResourceFamily): boolean {
  return remainingFamilyCap(colony, family) <= 1e-6;
}

/**
 * A payment may exceed the colony's value by this much (1 micro-unit, the old `1e-6` tolerance): `maxAffordableProgress`
 * works in floats, so the slice it allows can round one micro-unit past the value. The debit clamps at zero.
 */
const AFFORD_SLACK_MICRO = 1;

/** The exact value of `key` in micro-units: whole `stock` plus the sub-unit `residual`. */
function haveMicro(c: ColonyWithLedger, key: ResourceKey): number {
  return valueMicro(c.stock[key] ?? 0, c.residual[key] ?? 0);
}

/** The exact value of `key` as a number of units (stock plus residual; what a rate-based consumer may draw on). */
export function resourceValue(colony: ColonyState, key: ResourceKey): number {
  return fromMicro(haveMicro(ensureColonyLedger(colony), key));
}

export interface CreditOptions {
  /** `false` (refunds) leaves `production.produced` alone. */
  produced?: boolean;
  /** Ledger reason of the posting: `production.tick` (default), `construction.refund` when `produced: false`. */
  reason?: LedgerReason;
}

/**
 * Credits `amount` of `key` (fractions allowed) to the colony (LED-16): the amount is rounded to micro-units
 * (`toMicro`) and added to the exact value; the whole units that makes go to `colony.stock` through
 * `ColonyTreasury.add` (`clampToCap`: under the shared family cap less reserved import room, and posted to the journal
 * when run inside a step), the sub-unit rest stays in `colony.residual[key]`. Whole units that do not fit are lost and
 * counted in `colony.production.capped[family]`. Stamps `colony.changedAt = tick`. `produced: false` (refunds) leaves
 * `production.produced` alone: it counts what the colony made (Stockpile, W02-28); both counters are whole units.
 *
 * Returns `credited`, the amount of `amount` the colony accepted (it may sit in the residual, so it can be fractional;
 * deposits are drawn down by it), and `capped`, whole units that overflowed.
 */
export function creditResource(
  colony: ColonyState,
  key: ResourceKey,
  amount: number,
  tick: number = colony.changedAt,
  opts: CreditOptions = {},
): { credited: number; capped: number } {
  const c = ensureColonyLedger(colony);
  const micro = toMicro(amount);
  if (!(micro > 0)) return { credited: 0, capped: 0 };
  const reason = opts.reason ?? (opts.produced === false ? 'construction.refund' : 'production.tick');
  const moved = moveMicro(c, key, micro, tick, reason);
  if (moved.credited > 0 && opts.produced !== false) c.production.produced[key] += moved.credited;
  if (moved.capped > 0) c.production.capped[RESOURCE_FAMILY_OF[key]] += moved.capped;
  c.changedAt = tick;
  return { credited: fromMicro(Math.max(0, micro - moved.capped * RESIDUAL_SCALE)), capped: moved.capped };
}

/**
 * Draws up to `amount` (fractions allowed) of `key` out of the colony for a rate-based consumer (a thermal plant
 * burning fuel), as `production.consume` (or `reason`). Takes what the exact value covers: whole units leave
 * `colony.stock` through `ColonyTreasury.withdraw`, the rest comes out of the residual. Returns the amount taken.
 */
export function consumeResource(
  colony: ColonyState,
  key: ResourceKey,
  amount: number,
  tick: number = colony.changedAt,
  reason: LedgerReason = 'production.consume',
): number {
  const c = ensureColonyLedger(colony);
  const micro = Math.min(haveMicro(c, key), toMicro(amount));
  if (!(micro > 0)) return 0;
  moveMicro(c, key, -micro, tick, reason);
  c.changedAt = tick;
  return fromMicro(micro);
}

/** Empties `key` (stock and residual) as a `dev.grant` revoke, so the journal follows the dev console. */
export function zeroResource(colony: ColonyState, key: ResourceKey, tick: number, reason: LedgerReason = 'dev.grant'): void {
  consumeResource(colony, key, Number.POSITIVE_INFINITY, tick, reason);
}

export interface AffordabilityResult {
  ok: boolean;
  missing: Partial<Record<ResourceKey, number>>;
  exceedsCap: Partial<Record<ResourceFamily, number>>;
}

/** Checks whether `colony` can pay `cost` right now, and whether `cost` exceeds any family storage cap. */
export function checkCostAffordability(
  colony: ColonyState,
  cost: Partial<Record<ResourceKey, number>>,
): AffordabilityResult {
  const c = ensureColonyLedger(colony);
  const missing: Partial<Record<ResourceKey, number>> = {};
  const familyNeed = createEmptyFamilyRecord();
  let ok = true;

  for (const k of RESOURCE_KEYS) {
    const need = cost[k] ?? 0;
    if (need <= 0) continue;
    familyNeed[RESOURCE_FAMILY_OF[k]] += need;
    const short = toMicro(need) - haveMicro(c, k);
    if (short > AFFORD_SLACK_MICRO) {
      missing[k] = fromMicro(short);
      ok = false;
    }
  }

  const exceedsCap: Partial<Record<ResourceFamily, number>> = {};
  for (const f of RESOURCE_FAMILIES) {
    if (familyNeed[f] > c.caps[f] + 1e-6) {
      exceedsCap[f] = familyNeed[f] - c.caps[f];
      ok = false;
    }
  }

  return { ok, missing, exceedsCap };
}

/** Debits `cost` from the colony if affordable (as `construction.spend`); returns `true` when paid and stamps `colony.changedAt = tick`. */
export function debitCost(
  colony: ColonyState,
  cost: Partial<Record<ResourceKey, number>>,
  tick: number = colony.changedAt,
): boolean {
  const c = ensureColonyLedger(colony);
  const check = checkCostAffordability(c, cost);
  if (!check.ok) return false;
  let changed = false;
  for (const k of RESOURCE_KEYS) {
    const need = toMicro(cost[k] ?? 0);
    if (need > 0) {
      moveMicro(c, k, -need, tick, 'construction.spend');
      changed = true;
    }
  }
  if (changed) c.changedAt = tick;
  return true;
}

/**
 * Refunds `ratio` (e.g. `0.5` on cancel or demolish) of `cost` back to the colony as `construction.refund` (clamped by
 * cap, LED-17; not counted as produced). The share is exact to the micro-unit: refunding `0.5` of `75` credits 37
 * whole units now and keeps 0.5 in the residual.
 */
export function refundCost(
  colony: ColonyState,
  cost: Partial<Record<ResourceKey, number>>,
  ratio = 1,
  tick: number = colony.changedAt,
): void {
  if (ratio <= 0) return;
  for (const k of RESOURCE_KEYS) {
    const amt = (cost[k] ?? 0) * ratio;
    if (amt > 0) creditResource(colony, k, amt, tick, { produced: false });
  }
}

/**
 * Deducts the incremental resource slice for advancing a job's progress to `newProgress` (`0..1`) from the colony (as
 * `construction.spend`), updating `spentCost` in place. The slice is `totalCost[k] * newProgress - spentCost[k]`
 * rounded to micro-units, so the paid total after each step is `round(total * progress)` to the micro-unit and reaches
 * exactly `total` at progress 1; whole units leave `colony.stock`, the fraction comes out of the residual.
 * If the colony's value cannot cover the slice, returns `{ ok: false, missing }` without mutating anything.
 */
export function payProgressiveSlice(
  colony: ColonyState,
  totalCost: Partial<Record<ResourceKey, number>>,
  spentCost: Partial<Record<ResourceKey, number>>,
  newProgress: number,
  tick: number = colony.changedAt,
): { ok: true; spentCost: Partial<Record<ResourceKey, number>> } | { ok: false; missing: Partial<Record<ResourceKey, number>> } {
  const c = ensureColonyLedger(colony);
  const clampedProg = Math.max(0, Math.min(1, newProgress));
  const missing: Partial<Record<ResourceKey, number>> = {};
  const neededByKey: Partial<Record<ResourceKey, number>> = {};
  let canAfford = true;

  for (const k of RESOURCE_KEYS) {
    const total = totalCost[k] ?? 0;
    if (total <= 0) continue;
    const needed = toMicro(total * clampedProg) - toMicro(spentCost[k] ?? 0);
    if (needed <= 0) continue;
    neededByKey[k] = needed;
    const short = needed - haveMicro(c, k);
    if (short > AFFORD_SLACK_MICRO) {
      missing[k] = fromMicro(short);
      canAfford = false;
    }
  }

  if (!canAfford) {
    return { ok: false, missing };
  }

  let changed = false;
  for (const k of RESOURCE_KEYS) {
    const needed = neededByKey[k] ?? 0;
    if (needed > 0) {
      moveMicro(c, k, -needed, tick, 'construction.spend');
      spentCost[k] = fromMicro(toMicro(spentCost[k] ?? 0) + needed);
      changed = true;
    }
  }
  if (changed) c.changedAt = tick;
  return { ok: true, spentCost };
}

/** Returns the maximum cumulative progress (`0..targetProgress`) that `colony.stock` + `spentCost` can afford. */
export function maxAffordableProgress(
  colony: ColonyState,
  totalCost: Partial<Record<ResourceKey, number>>,
  spentCost: Partial<Record<ResourceKey, number>>,
  targetProgress: number,
): number {
  const c = ensureColonyLedger(colony);
  let maxProg = Math.max(0, Math.min(1, targetProgress));
  for (const k of RESOURCE_KEYS) {
    const total = totalCost[k] ?? 0;
    if (total <= 0) continue;
    const paid = spentCost[k] ?? 0;
    const have = fromMicro(haveMicro(c, k));
    const canReach = (paid + have) / total;
    if (canReach < maxProg) maxProg = canReach;
  }
  return Math.max(0, maxProg);
}

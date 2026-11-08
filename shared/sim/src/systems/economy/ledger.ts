import {
  RESOURCE_FAMILIES,
  RESOURCE_FAMILY_OF,
  RESOURCE_KEYS,
  type ResourceFamily,
  type ResourceKey,
} from '@terra/contracts';
import { ENTITY_KIND, ENTITY_STATE } from '../../ecs/columns';
import type { ColonyState, PlanetState } from '../../kernel/state';

export const BASE_HUB_STORAGE_CAP = 500;
export const DEPOT_STORAGE_CAP = 1000;

export interface ExtractorLivingBonusRecord {
  entityId: number;
  q?: number;
  r?: number;
  family?: ResourceFamily;
  adjacentToLiving: boolean;
  livingBonus: number;
  livingBonusText: string;
  ratePerS: number;
  unlockedTier?: 1 | 2 | 3;
  ringRadius?: number;
  ringTotalTiles?: number;
  ringTerraformedTiles?: number;
  ringLivingTiles?: number;
  ringTerraformedRatio?: number;
  ringLivingRatio?: number;
  ringTerraformedPct?: number;
  ringLivingPct?: number;
  shares?: { t1Share: number; t2Share: number; t3Share: number };
  incomePerSByKey?: Partial<Record<ResourceKey, number>>;
}

export interface ColonyProductionLedger {
  capped: Record<ResourceFamily, number>;
  produced: Record<ResourceKey, number>;
  incomePerS: Record<ResourceKey, number>;
  familyIncomePerS: Record<ResourceFamily, number>;
  extractors?: Record<number, ExtractorLivingBonusRecord>;
  tierGates?: unknown;
}

export interface ColonyLedgerFields {
  stock: Record<ResourceKey, number>;
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
  const stock = createEmptyStock();
  for (const k of RESOURCE_KEYS) {
    if (typeof rawStock[k] === 'number' && Number.isFinite(rawStock[k]!)) {
      stock[k] = rawStock[k]!;
    }
  }
  colony.stock = stock;

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
  const extractors = rawProd.extractors && typeof rawProd.extractors === 'object' ? { ...rawProd.extractors } : undefined;
  const tierGates = rawProd.tierGates && typeof rawProd.tierGates === 'object' ? rawProd.tierGates : undefined;
  colony.production = {
    capped,
    produced,
    incomePerS,
    familyIncomePerS,
    ...(extractors ? { extractors } : {}),
    ...(tierGates ? { tierGates } : {}),
  };

  return colony as ColonyWithLedger;
}

/** Ensures `state.colonies[colonyIndex]` exists and has a valid ledger at `tick`. */
export function ensureColonyAt(state: PlanetState, colonyIndex: number, tick: number): ColonyWithLedger {
  let col = state.colonies[colonyIndex];
  if (!col) {
    col = {
      index: colonyIndex,
      id: `col-${colonyIndex}`,
      name: `Colony ${colonyIndex + 1}`,
      color: 0xff6b00,
      status: 'active',
      changedAt: tick,
    };
    state.colonies[colonyIndex] = col;
  }
  return ensureColonyLedger(col);
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
  ENTITY_STATE.inert,
  ENTITY_STATE.offlineBrownout,
  ENTITY_STATE.offlineUnpowered,
  ENTITY_STATE.offlineOverload,
  ENTITY_STATE.offlineNoFuel,
  ENTITY_STATE.offlineNoGrid,
]);

/** Whether entity row `r` is an alive, completed and powered building (one rule for storage and supply caps). */
export function isActiveCapacityProvider(state: PlanetState, r: number): boolean {
  const cols = state.entities.cols;
  if (cols.hp[r] <= 0) return false;
  if (cols.kind[r] === ENTITY_KIND.droneControlArray) return cols.state[r] === ENTITY_STATE.active;
  return !INACTIVE_PROVIDER_STATES.has(cols.state[r]);
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
 * Credits `amount` of `key` to `colony.stock[key]`, clamping against the shared family cap (`caps[family]`).
 * Any overflow beyond the family cap is added to `colony.production.capped[family]`. Stamps `colony.changedAt = tick`.
 * `produced: false` (refunds) leaves `production.produced` alone: it counts what the colony made (Stockpile, W02-28).
 */
export function creditResource(
  colony: ColonyState,
  key: ResourceKey,
  amount: number,
  tick: number = colony.changedAt,
  opts: { produced?: boolean } = {},
): { credited: number; capped: number } {
  const c = ensureColonyLedger(colony);
  if (amount <= 0) return { credited: 0, capped: 0 };
  const family = RESOURCE_FAMILY_OF[key];
  const room = remainingFamilyCap(c, family);
  const credited = Math.min(amount, room);
  const capped = Math.max(0, amount - credited);

  if (credited > 0) {
    const next = c.stock[key] + credited;
    c.stock[key] = Math.abs(next - Math.round(next)) < 1e-9 ? Math.round(next) : next;
    if (opts.produced !== false) c.production.produced[key] += credited;
  }
  if (capped > 0) {
    c.production.capped[family] += capped;
  }
  c.changedAt = tick;
  return { credited, capped };
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
    const have = c.stock[k] ?? 0;
    if (have + 1e-6 < need) {
      missing[k] = need - have;
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

/** Debits `cost` from `colony.stock` if affordable; returns `true` when paid and stamps `colony.changedAt = tick`. */
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
    const need = cost[k] ?? 0;
    if (need > 0) {
      c.stock[k] = Math.max(0, c.stock[k] - need);
      changed = true;
    }
  }
  if (changed) c.changedAt = tick;
  return true;
}

/** Refunds `ratio` (e.g. `0.5` on cancel or demolish) of `cost` back into `colony.stock` (clamped by cap; not counted as produced). */
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
 * Deducts the incremental resource slice for advancing a job's progress to `newProgress` (`0..1`)
 * from `colony.stock`, updating `spentCost` in place.
 * If `colony.stock` cannot cover the incremental slice (`needed = totalCost[k] * newProgress - spentCost[k]`),
 * returns `{ ok: false, missing }` without mutating `colony.stock` or `spentCost`.
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
    const alreadyPaid = spentCost[k] ?? 0;
    const targetPaid = total * clampedProg;
    const needed = Math.max(0, targetPaid - alreadyPaid);
    if (needed <= 1e-6) continue;
    neededByKey[k] = needed;
    const have = c.stock[k] ?? 0;
    if (have + 1e-6 < needed) {
      missing[k] = needed - have;
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
      c.stock[k] = Math.max(0, Number((c.stock[k] - needed).toFixed(6)));
      spentCost[k] = Number(((spentCost[k] ?? 0) + needed).toFixed(6));
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
    const have = c.stock[k] ?? 0;
    const canReach = (paid + have) / total;
    if (canReach < maxProg) maxProg = canReach;
  }
  return Math.max(0, maxProg);
}

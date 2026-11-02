import {
  RESOURCE_FAMILIES,
  RESOURCE_FAMILY_OF,
  RESOURCE_KEYS,
  type ResourceFamily,
  type ResourceKey,
} from '@terra/contracts';
import type { ColonyState } from '../../kernel/state';

export const BASE_HUB_STORAGE_CAP = 500;
export const DEPOT_STORAGE_CAP = 1000;

export interface ColonyProductionLedger {
  capped: Record<ResourceFamily, number>;
  produced: Record<ResourceKey, number>;
  incomePerS: Record<ResourceKey, number>;
  familyIncomePerS: Record<ResourceFamily, number>;
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
    const nextCap = hasHub ? Math.max(c.caps[f] ?? 0, cap) : cap;
    if (c.caps[f] !== nextCap) {
      c.caps[f] = nextCap;
      changed = true;
    }
  }
  if (changed && tick !== undefined) c.changedAt = tick;
  return c.caps;
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
  return Math.max(0, c.caps[family] - familyStock(c, family));
}

export function isFamilyAtCap(colony: ColonyState, family: ResourceFamily): boolean {
  return remainingFamilyCap(colony, family) <= 1e-6;
}

/**
 * Credits `amount` of `key` to `colony.stock[key]`, clamping against the shared family cap (`caps[family]`).
 * Any overflow beyond the family cap is added to `colony.production.capped[family]`. Stamps `colony.changedAt = tick`.
 */
export function creditResource(
  colony: ColonyState,
  key: ResourceKey,
  amount: number,
  tick: number = colony.changedAt,
): { credited: number; capped: number } {
  const c = ensureColonyLedger(colony);
  if (amount <= 0) return { credited: 0, capped: 0 };
  const family = RESOURCE_FAMILY_OF[key];
  const room = remainingFamilyCap(c, family);
  const credited = Math.min(amount, room);
  const capped = Math.max(0, amount - credited);

  if (credited > 0) {
    c.stock[key] += credited;
    c.production.produced[key] += credited;
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

/** Refunds `ratio` (e.g. `0.75` on cancel, `0.5` on demolish) of `cost` back into `colony.stock` (clamped by cap). */
export function refundCost(
  colony: ColonyState,
  cost: Partial<Record<ResourceKey, number>>,
  ratio = 1,
  tick: number = colony.changedAt,
): void {
  if (ratio <= 0) return;
  for (const k of RESOURCE_KEYS) {
    const amt = (cost[k] ?? 0) * ratio;
    if (amt > 0) creditResource(colony, k, amt, tick);
  }
}

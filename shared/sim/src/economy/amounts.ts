import { RESOURCE_KEYS, type ResourceKey } from '@terra/contracts';
import { isMajor } from '@terra/ledger';

/**
 * The one rule for resource amounts, shared by the treasury (every add / withdraw) and the data compiler (every cost,
 * cargo and yield in a data row, every balance override and dev `tune`): a whole, non-negative number of major units
 * (a safe integer >= 0). Anything else is rejected where it enters, never rounded.
 */
export function isWholeAmount(v: unknown): v is number {
  return isMajor(v) && v >= 0;
}

export function isResourceKey(key: unknown): key is ResourceKey {
  return typeof key === 'string' && (RESOURCE_KEYS as readonly string[]).includes(key);
}

export interface AmountProblem {
  code: 'invalid_resource' | 'invalid_amount';
  /** The offending key (present for `invalid_amount`). */
  resource?: string;
  detail: string;
}

/** The first problem of an amounts map (an unknown resource key, or a value that is not a whole amount), or null. */
export function amountsProblem(amounts: Readonly<Record<string, unknown>>): AmountProblem | null {
  for (const [key, v] of Object.entries(amounts)) {
    if (!isResourceKey(key)) return { code: 'invalid_resource', detail: key };
    if (!isWholeAmount(v)) return { code: 'invalid_amount', resource: key, detail: String(v) };
  }
  return null;
}

/**
 * The order shortfalls are named in, everywhere a player sees one (the build waiting reason, the HUD toast,
 * `insufficient_funds`): metals, minerals, biomass, water, then the higher bio tiers.
 */
export const SHORTFALL_ORDER: readonly ResourceKey[] = [
  'metals.t1', 'metals.t2', 'metals.t3',
  'minerals.t1', 'minerals.t2', 'minerals.t3',
  'bio.biomass', 'bio.water', 'bio.t2', 'bio.t3',
];

const rank = (key: string): number => {
  const i = (SHORTFALL_ORDER as readonly string[]).indexOf(key);
  return i < 0 ? SHORTFALL_ORDER.length : i;
};

export interface Shortfall {
  resource: ResourceKey;
  have: number;
  need: number;
}

/**
 * The first resource `stock` lacks to cover `cost` (in {@link SHORTFALL_ORDER}; unknown keys last, by name), or null
 * when it covers everything. Missing stock keys count as 0. The single affordability check of the game.
 */
export function findShortfall(
  stock: Readonly<Partial<Record<string, number>>>,
  cost: Readonly<Partial<Record<string, number>>>,
): Shortfall | null {
  const keys = Object.keys(cost).sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : 1)); // keys are distinct
  for (const key of keys) {
    const need = cost[key] ?? 0;
    const have = stock[key] ?? 0;
    if (need > 0 && have < need) return { resource: key as ResourceKey, have, need };
  }
  return null;
}

import { RESOURCE_FAMILY_OF, RESOURCE_KEYS, type MarketTokenKey, type ResourceFamily, type ResourceKey } from '@terra/contracts';

export const FAMILY_LABEL: Readonly<Record<ResourceFamily, string>> = { metals: 'Metals', minerals: 'Minerals', bio: 'Bio' };
const FAMILY_ORDER: readonly ResourceFamily[] = ['metals', 'minerals', 'bio'];

const NAMES: Partial<Record<ResourceKey, string>> = { 'bio.water': 'Water (T1)', 'bio.biomass': 'Biomass (T1)' };

/** `metals.t2` -> `Metals T2`; the two T1 bio resources keep their names. */
export function resourceLabel(key: ResourceKey): string {
  return NAMES[key] ?? `${FAMILY_LABEL[RESOURCE_FAMILY_OF[key]]} ${key.split('.')[1]!.toUpperCase()}`;
}

const tierOf = (k: ResourceKey): number => (k.endsWith('.t2') ? 2 : k.endsWith('.t3') ? 3 : 1);

/** Base picker groups: Metals, Minerals, Bio, each ordered by tier. */
export function baseGroups(): Array<{ family: ResourceFamily; label: string; keys: ResourceKey[] }> {
  return FAMILY_ORDER.map((family) => ({
    family, label: FAMILY_LABEL[family],
    keys: RESOURCE_KEYS.filter((k) => RESOURCE_FAMILY_OF[k] === family).sort((a, b) => tierOf(a) - tierOf(b)),
  }));
}

/** Quote choices for a base: USDC (default), NEAR, then barter against every other resource. */
export function quoteChoices(base: ResourceKey): { cash: MarketTokenKey[]; barter: ResourceKey[] } {
  return { cash: ['USDC', 'NEAR'], barter: RESOURCE_KEYS.filter((k) => k !== base) };
}


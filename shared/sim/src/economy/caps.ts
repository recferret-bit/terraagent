import { RESOURCE_FAMILY_OF, type ResourceKey, type Stock } from '@terra/contracts';
import type { PlanetState } from '../kernel/state';

export interface ColonyCaps {
  metals: number;
  minerals: number;
  energy: number;
  bio: number;
  item: number;
}

/** Caps before a Hub is built (the landing pod's hold). */
export const INITIAL_CAPS: Readonly<ColonyCaps> = { metals: 600, minerals: 500, energy: 0, bio: 500, item: 0 };

/** The colony's storage cap per family (`col.caps`, falling back to {@link INITIAL_CAPS}). */
export function getColonyCaps(state: PlanetState, colonyIndex: number): ColonyCaps {
  const raw = state.colonies[colonyIndex]?.caps as Partial<ColonyCaps> | undefined;
  const pick = (k: keyof ColonyCaps): number => (typeof raw?.[k] === 'number' ? (raw[k] as number) : INITIAL_CAPS[k]);
  return { metals: pick('metals'), minerals: pick('minerals'), energy: pick('energy'), bio: pick('bio'), item: pick('item') };
}

/**
 * Splits a credit into what fits under the family caps and the overflow. Families are shared by their tiers, so
 * credits of one family fill the remaining room in key order. Whole units in, whole units out.
 */
export function clampToCaps(
  stock: Stock,
  caps: ColonyCaps,
  amounts: Partial<Record<ResourceKey, number>>,
): { credited: Partial<Record<ResourceKey, number>>; overflow: Partial<Record<ResourceKey, number>> } {
  const room: Record<string, number> = { metals: caps.metals, minerals: caps.minerals, bio: caps.bio };
  for (const [key, v] of Object.entries(stock)) room[RESOURCE_FAMILY_OF[key as ResourceKey]] -= v;
  const credited: Partial<Record<ResourceKey, number>> = {};
  const overflow: Partial<Record<ResourceKey, number>> = {};
  for (const key of Object.keys(amounts).sort() as ResourceKey[]) {
    const want = amounts[key] ?? 0;
    const family = RESOURCE_FAMILY_OF[key];
    const fit = Math.max(0, Math.min(want, room[family]));
    room[family] -= fit;
    if (fit > 0) credited[key] = fit;
    if (want - fit > 0) overflow[key] = want - fit;
  }
  return { credited, overflow };
}

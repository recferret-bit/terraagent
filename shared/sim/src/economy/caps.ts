import { RESOURCE_FAMILY_OF, type ResourceKey, type Stock } from '@terra/contracts';
import type { CompiledDataLike } from '../kernel/config';
import type { PlanetState } from '../kernel/state';
import { resolveStartingKitRow } from '../systems/rows';

export interface ColonyCaps {
  metals: number;
  minerals: number;
  energy: number;
  bio: number;
  item: number;
}

/**
 * Caps before a Hub is built: the landing pod's hold (`hq.startingKit.storageCaps`, GP-11). A family the row does not
 * name has cap 0.
 */
export function initialCaps(data?: CompiledDataLike): ColonyCaps {
  const raw = resolveStartingKitRow(data).storageCaps as Partial<Record<keyof ColonyCaps, unknown>> | undefined;
  const pick = (k: keyof ColonyCaps): number => (typeof raw?.[k] === 'number' ? (raw[k] as number) : 0);
  return { metals: pick('metals'), minerals: pick('minerals'), energy: pick('energy'), bio: pick('bio'), item: pick('item') };
}

/** The colony's storage cap per family (`col.caps`, each missing family at {@link initialCaps}). */
export function getColonyCaps(state: PlanetState, colonyIndex: number, data?: CompiledDataLike): ColonyCaps {
  return capsOf(state.colonies[colonyIndex]?.caps, data);
}

/** Caps from a colony record's `caps` (sim state or a client view), each missing family at {@link initialCaps}. */
export function capsOf(caps: unknown, data?: CompiledDataLike): ColonyCaps {
  const raw = caps as Partial<Record<keyof ColonyCaps, unknown>> | null | undefined;
  const base = initialCaps(data);
  const pick = (k: keyof ColonyCaps): number => (typeof raw?.[k] === 'number' ? (raw[k] as number) : base[k]);
  return { metals: pick('metals'), minerals: pick('minerals'), energy: pick('energy'), bio: pick('bio'), item: pick('item') };
}

/**
 * Splits a credit into what fits under the family caps and the overflow (`add({ clampToCap: true })`: the overflow is
 * not credited to the colony; the treasury posts it to `sys:overflow`, LED-11, and reports it in the result). Families are shared by their tiers, so
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

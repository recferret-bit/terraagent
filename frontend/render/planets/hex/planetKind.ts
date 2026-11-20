import { hashGroundSeed } from '@terra/sim/grid/hex';
import { PLANET_SPECS, type PlanetKind, type PlanetSpec } from '../PlanetSpec';

/** The sim's planet types (D-33) as plain strings: the render layer does not import the engine. */
export type SimPlanetType = 'desert' | 'ocean' | 'temperate';

const KIND_OF: Record<SimPlanetType, PlanetKind> = { desert: 'dune', ocean: 'oceanForest', temperate: 'forestRock' };

/** Sim planet type → the render look (D-33: desert→dune, ocean→oceanForest, temperate→forestRock). */
export const kindForPlanetType = (type: SimPlanetType): PlanetKind => KIND_OF[type];

/** Orbit pick → the sim planet type of its dev planet family (dune→desert, oceanForest→ocean, forestRock→temperate). */
export const planetTypeForKind = (kind: PlanetKind): SimPlanetType =>
  (Object.keys(KIND_OF) as SimPlanetType[]).find((t) => KIND_OF[t] === kind) ?? 'desert';

/**
 * The planet look for a sim planet. Without an explicit `seed`, returns the canonical `PLANET_SPECS` reference;
 * with `seed` (string or number), derives a deterministic 32-bit `look.seed` so every player joining that planet
 * generates identical ground detail, rock outcrops, forest stands, and ground flora.
 */
export function specForPlanetType(type: SimPlanetType, seed?: string | number | null): PlanetSpec {
  const base = PLANET_SPECS[kindForPlanetType(type)];
  if (seed === undefined || seed === null || seed === '') return base;
  return { ...base, seed: hashGroundSeed(seed, base.seed) };
}

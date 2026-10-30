import { PLANET_SPECS, type PlanetKind, type PlanetSpec } from '../PlanetSpec';

/** The sim's planet types (D-33) as plain strings: the render layer does not import the engine. */
export type SimPlanetType = 'desert' | 'ocean' | 'temperate';

const KIND_OF: Record<SimPlanetType, PlanetKind> = { desert: 'dune', ocean: 'oceanForest', temperate: 'forestRock' };

/** Sim planet type → the render look (D-33: desert→dune, ocean→oceanForest, temperate→forestRock). */
export const kindForPlanetType = (type: SimPlanetType): PlanetKind => KIND_OF[type];

/** The planet look for a sim planet; the seed only matters for noise terrains, so the hex terrain keeps the spec's own. */
export const specForPlanetType = (type: SimPlanetType): PlanetSpec => PLANET_SPECS[kindForPlanetType(type)];

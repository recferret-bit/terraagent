import { createState } from '../kernel/state';
import { PREP, TERRAIN } from '../grid/layers';
import { registerGenerator } from './generators';

/** The empty dev planet (W00): every tile flat and wild, no deposits, no colonies. The real generator replaces it. */
export const DEV_PLANET_RADIUS = 56;
/** The guest dev planets `pl_dev*` (server and the no-backend local fallback): a desert since D-38, owner 2026-11-01. */
export const DEV_PLANET_TYPE = 'desert' as const;
export const DEV_PLANET_SEED = 'golden-1';
/** Seats (colonies) per dev planet (D-12); at most `MAX_COLONIES_PER_PLANET` (8), the sim's colony limit. */
export const DEV_PLANET_CAPACITY = 5;

/** Dev planet types a guest can pick in orbit (dune → desert, oceanForest → ocean, forestRock → temperate). */
export const DEV_PLANET_TYPES = ['desert', 'ocean', 'temperate'] as const;
export type DevPlanetType = (typeof DEV_PLANET_TYPES)[number];

export const isDevPlanetType = (t: unknown): t is DevPlanetType => typeof t === 'string' && (DEV_PLANET_TYPES as readonly string[]).includes(t);

/**
 * One dev planet family per type (owner 2026-11-01): desert keeps `pl_dev`, `pl_dev_2`, …; the others are
 * `pl_dev_ocean`, `pl_dev_ocean_2`, … and `pl_dev_temperate`, `pl_dev_temperate_2`, …. `index` starts at 1.
 */
export function devPlanetIdFor(type: DevPlanetType, index: number): string {
  const base = type === DEV_PLANET_TYPE ? 'pl_dev' : `pl_dev_${type}`;
  return index <= 1 ? base : `${base}_${index}`;
}

/** The type a dev planet id stands for, or `null` when `id` is not a dev planet id (`devPlanetIdFor`'s inverse). */
export function devPlanetTypeOf(id: string): DevPlanetType | null {
  if (/^pl_dev(_\d+)?$/.test(id)) return DEV_PLANET_TYPE;
  const m = /^pl_dev_(ocean|temperate)(_\d+)?$/.exec(id);
  return m ? (m[1] as DevPlanetType) : null;
}

registerGenerator('flat', ({ seed, planetId, planetType, radius }) => {
  const s = createState({ planetId, planetType, seed, radius });
  s.grid.layers.terrain.fill(TERRAIN.flat);
  s.grid.layers.prep.fill(PREP.wild);
  return s;
});

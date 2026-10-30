import { createState } from '../kernel/state';
import { PREP, TERRAIN } from '../grid/layers';
import { registerGenerator } from './generators';

/** The empty dev planet (W00): every tile flat and wild, no deposits, no colonies. The real generator replaces it. */
export const DEV_PLANET_RADIUS = 56;

registerGenerator('flat', ({ seed, planetId, planetType, radius }) => {
  const s = createState({ planetId, planetType, seed, radius });
  s.grid.layers.terrain.fill(TERRAIN.flat);
  s.grid.layers.prep.fill(PREP.wild);
  return s;
});

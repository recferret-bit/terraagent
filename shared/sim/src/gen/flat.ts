import { createState } from '../kernel/state';
import { PREP, TERRAIN } from '../grid/layers';
import { registerGenerator } from './generators';

/** The empty dev planet (W00): every tile flat and wild, no deposits, no colonies. The real generator replaces it. */
export const DEV_PLANET_RADIUS = 56;
/** The guest dev planets `pl_dev*` (server and the no-backend local fallback): a desert since D-38, owner 2026-11-01. */
export const DEV_PLANET_TYPE = 'desert' as const;
export const DEV_PLANET_SEED = 'golden-1';

registerGenerator('flat', ({ seed, planetId, planetType, radius }) => {
  const s = createState({ planetId, planetType, seed, radius });
  s.grid.layers.terrain.fill(TERRAIN.flat);
  s.grid.layers.prep.fill(PREP.wild);
  return s;
});

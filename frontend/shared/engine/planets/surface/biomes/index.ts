import type { PlanetKind } from '../../PlanetSpec';
import type { SurfaceContext } from '../SurfaceContext';
import { buildDune } from './dune';
import { buildOceanForest } from './oceanForest';
import { buildForestRock } from './forestRock';

/** Per-world scatter strategy: fills the shared SurfaceContext with rocks, flora, water and ambient particles. */
export const BIOME_BUILDERS: Record<PlanetKind, (ctx: SurfaceContext) => void> = {
  dune: buildDune,
  oceanForest: buildOceanForest,
  forestRock: buildForestRock,
};

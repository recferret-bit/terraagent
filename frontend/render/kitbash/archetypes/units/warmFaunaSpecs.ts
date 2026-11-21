import { DUNE_MAMMALS } from './warmFaunaDuneSpecs';
import { FOREST_OCEAN_MAMMALS } from './warmFaunaForestOceanSpecs';
import type { WarmFaunaEntry } from './warmFaunaTypes';

export { warmPalette, type WarmFaunaEntry } from './warmFaunaTypes';

export const WARM_FAUNA_ENTRIES: readonly WarmFaunaEntry[] = [
  ...FOREST_OCEAN_MAMMALS,
  ...DUNE_MAMMALS,
];

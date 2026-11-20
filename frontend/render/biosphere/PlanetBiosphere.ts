import * as THREE from 'three';
import { AnimalsOrchestrator } from '../orchestrators/AnimalsOrchestrator';
import { buildBiomeOrchestratorConfig } from '../orchestrators/BiomeConfig';
import { buildBiosphereView } from '../orchestrators/biomeViews';
import { BirdsOrchestrator } from '../orchestrators/BirdsOrchestrator';
import type { PlanetSpec } from '../planets/PlanetSpec';
import type { WaterFauna } from '../visuals/water/fauna';
import type { BiosphereHabitatIndex, PlanetBiosphere } from './biosphereTypes';

export interface CreatePlanetBiosphereOptions {
  look: PlanetSpec;
  habitat: BiosphereHabitatIndex;
  /** Optional swimming water fauna handle so fish/rays/jellies react to the same unified conqueror & battle threats. */
  waterFauna?: WaterFauna | null;
}

/**
 * Creates a pooled `PlanetBiosphere` backed directly by `BirdsOrchestrator` (2 groups/type, biome-only,
 * size-dependent wing animation, zero collision checks) and `AnimalsOrchestrator` (biome-only circadian mammals).
 */
export function createPlanetBiosphere(opts: CreatePlanetBiosphereOptions): PlanetBiosphere {
  const { look, habitat } = opts;
  const group = new THREE.Group();
  group.name = 'planetBiosphere';
  const sharedTimeU: THREE.IUniform<number> = { value: 0 };
  const approxRadius = Math.max(8, Math.round(habitat.halfSize / 2));
  const config = buildBiomeOrchestratorConfig(look, approxRadius);

  const birds = new BirdsOrchestrator(config, habitat, group, sharedTimeU);
  const animals = new AnimalsOrchestrator(config, habitat, group, sharedTimeU);
  const view = buildBiosphereView(group, sharedTimeU, birds, animals, habitat, opts.waterFauna ?? null);

  return {
    ...view,
    dispose() {
      view.dispose();
      birds.dispose();
      animals.dispose();
      group.removeFromParent();
    },
  };
}

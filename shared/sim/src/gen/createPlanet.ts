import type { PlanetState } from '../kernel/state';
import { DEV_PLANET_RADIUS } from './flat';
import { getGenerator, type PlanetParams } from './generators';
import './flat';

/**
 * Creates a planet with the generator named by `type` (SIM-GEN). Pure: the same params give the same planet.
 * Defaults: radius 56 (≈ 9 600 tiles), type `temperate`, id `pl_dev`.
 */
export function createPlanet(p: PlanetParams): PlanetState {
  const gen = getGenerator(p.type);
  if (!gen) throw new Error(`unknown planet generator "${p.type}"`);
  return gen({
    seed: p.seed,
    planetId: p.planetId ?? 'pl_dev',
    planetType: p.planetType ?? 'temperate',
    radius: p.radius ?? DEV_PLANET_RADIUS,
  });
}

import type { PlanetState } from '../kernel/state';
import { DEV_PLANET_RADIUS } from './flat';
import { GEN_VERSION, getGenerator, type PlanetParams } from './generators';
import './flat';
import './world';

/**
 * Creates a planet with the generator named by `type` (SIM-GEN). Pure: the same params give the same planet.
 * Defaults: radius 56 (≈ 9 600 tiles), type `temperate`, id `pl_dev`.
 */
export function createPlanet(p: PlanetParams): PlanetState {
  const type = p.type ?? 'temperate';
  const gen = getGenerator(type);
  if (!gen) throw new Error(`unknown planet generator "${type}"`);
  const state = gen({
    seed: p.seed,
    planetId: p.planetId ?? p.id ?? 'pl_dev',
    planetType: p.planetType ?? 'temperate',
    radius: p.radius ?? DEV_PLANET_RADIUS,
    capacity: p.capacity,
    ...(p.worldSalt ? { worldSalt: p.worldSalt } : {}),
  });
  state.meta.genVersion = GEN_VERSION;
  return state;
}

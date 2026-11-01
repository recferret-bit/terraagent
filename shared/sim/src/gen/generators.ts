import type { PlanetState, PlanetType } from '../kernel/state';

/** Parameters every planet generator receives (SIMULATION §10). */
export interface PlanetParams {
  /** Generator id: `flat` (the W00 dev planet); the real generators register their own ids. */
  type?: string;
  seed: string;
  planetId?: string;
  /** Convenience alias for `planetId`. */
  id?: string;
  planetType?: PlanetType;
  radius?: number;
  capacity?: number;
  /** Host secret for the hidden subsurface (`meta.worldSalt`, never sent to clients). */
  worldSalt?: string;
}

export type PlanetGenerator = (p: Required<Omit<PlanetParams, 'type' | 'id' | 'capacity' | 'worldSalt'>> & { capacity?: number; worldSalt?: string }) => PlanetState;

/**
 * Bumped when generation output changes; `createPlanet` stamps it into `meta.genVersion` so hosts can tell planets
 * built by an older generator apart (D-38: dev planets are wiped, local saves start fresh).
 * **Bump rule:** any change that alters generated output (a `data/worldgen.ts` number, a stage, noise, spawn slots,
 * landing zones) bumps this in the same commit; `test/gen/world.spec.ts` pins a fingerprint so a forgotten bump fails.
 * 3: hidden-ground salt, falloff-ring reclassification, wind-direction table.
 */
export const GEN_VERSION = 3;

const generators = new Map<string, PlanetGenerator>();

/** Registers a generator under an id (a later wave adds its file, it does not edit `createPlanet`). */
export function registerGenerator(type: string, gen: PlanetGenerator): void {
  if (generators.has(type)) throw new Error(`planet generator ${type} already registered`);
  generators.set(type, gen);
}

export const hasGenerator = (type: string) => generators.has(type);
export const getGenerator = (type: string) => generators.get(type);

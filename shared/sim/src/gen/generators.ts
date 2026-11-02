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
 * 4: the hidden subsurface is generated after the landing zones (WE-09); a desert falloff ring keeps the metals 2×2
 *    Flat footprint (WE-18); generation numbers moved to `data/worldgen.ts` (WE-19 / WE-20, same values).
 * 5: desert returns to pre-W1 continuous wind-carved dune sea + spaced rock landforms; buildable Flat ground is only
 *    around the pod drop landing zones (wild desert sand is `slope`).
 * 6-7: desert rockiness restricted to mountains/mesas rising above local dune relief; inner landing rim graded by slopeGradientM.
 */
export const GEN_VERSION = 7;

const generators = new Map<string, PlanetGenerator>();

/** Registers a generator under an id (a later wave adds its file, it does not edit `createPlanet`). */
export function registerGenerator(type: string, gen: PlanetGenerator): void {
  if (generators.has(type)) throw new Error(`planet generator ${type} already registered`);
  generators.set(type, gen);
}

export const hasGenerator = (type: string) => generators.has(type);
export const getGenerator = (type: string) => generators.get(type);

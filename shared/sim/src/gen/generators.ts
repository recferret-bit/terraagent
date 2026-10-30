import type { PlanetState, PlanetType } from '../kernel/state';

/** Parameters every planet generator receives (SIMULATION §10). */
export interface PlanetParams {
  /** Generator id: `flat` (the W00 dev planet); the real generators register their own ids. */
  type: string;
  seed: string;
  planetId?: string;
  planetType?: PlanetType;
  radius?: number;
}

export type PlanetGenerator = (p: Required<Omit<PlanetParams, 'type'>>) => PlanetState;

const generators = new Map<string, PlanetGenerator>();

/** Registers a generator under an id (a later wave adds its file, it does not edit `createPlanet`). */
export function registerGenerator(type: string, gen: PlanetGenerator): void {
  if (generators.has(type)) throw new Error(`planet generator ${type} already registered`);
  generators.set(type, gen);
}

export const hasGenerator = (type: string) => generators.has(type);
export const getGenerator = (type: string) => generators.get(type);

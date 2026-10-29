/**
 * Late-bound access to modules delivered by other workstreams. Uses import.meta.glob so the
 * app still boots (with a clear error only when a feature is used) if a module has not landed yet.
 */
import type { PlanetSpec } from '../planets/PlanetSpec';
import type { CreatePlanetSurface } from '../planets/surface/types';
import type { CreateOrbitalStage } from '../orbit/types';
import type { CreateDescentSequence } from '../descent/types';

const surfaceMod = import.meta.glob('../planets/surface/index.ts', { eager: true }) as Record<string, any>;
const orbitMod = import.meta.glob('../orbit/OrbitalStage.ts', { eager: true }) as Record<string, any>;
const descentMod = import.meta.glob('../descent/createDescent.ts', { eager: true }) as Record<string, any>;
const lookMod = import.meta.glob('../planets/applyPlanetLook.ts', { eager: true }) as Record<string, any>;

function pick<T>(mods: Record<string, any>, name: string): T | undefined {
  const m = Object.values(mods)[0];
  return m ? (m[name] as T | undefined) : undefined;
}

export const createPlanetSurface = pick<CreatePlanetSurface>(surfaceMod, 'createPlanetSurface');
export const createOrbitalStage = pick<CreateOrbitalStage>(orbitMod, 'createOrbitalStage');
export const createDescentSequence = pick<CreateDescentSequence>(descentMod, 'createDescentSequence');
/** Signature owned by the descent/look workstream; invoked loosely. */
export const applyPlanetLook = pick<(...args: any[]) => any>(lookMod, 'applyPlanetLook');

export type { PlanetSpec };

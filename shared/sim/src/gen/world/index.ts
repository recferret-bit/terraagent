import { createState, type PlanetState } from '../../kernel/state';
import { registerGenerator, type PlanetGenerator } from '../generators';
import { DEFAULT_SPAWN_CAPACITY } from '../spawnSlots';
import { createContext, type WorldStage } from './context';
import { classifyDesert } from './stages/classifyDesert';
import { landing } from './stages/landing';
import { reliefDesert } from './stages/reliefDesert';
import { subsurface } from './stages/subsurface';
import { deposits, temperateTerrain } from './stages/temperate';

export { worldProfile, type WorldGenContext, type WorldStage } from './context';

import { GEN_VERSION } from '../generators';

export { GEN_VERSION };

/** Stage registry: a profile row (`data/worldgen.ts`) lists stage ids; a new stage registers here, not in a generator. */
const STAGES = new Map<string, WorldStage>();
export function registerWorldStage(stage: WorldStage): void {
  if (STAGES.has(stage.id)) throw new Error(`world stage ${stage.id} already registered`);
  STAGES.set(stage.id, stage);
}
for (const st of [temperateTerrain, deposits, reliefDesert, classifyDesert, subsurface, landing]) registerWorldStage(st);

/**
 * World generation orchestrator (D-38): builds an empty planet, then runs the planet type's profile stages in order —
 * relief → classes → visible deposits → spawn slots + levelled landing zones → hidden subsurface. Every stage is a
 * small part in `stages/`; per-sector seeds keep sectors independent. Pure: the same params give the same planet.
 */
export function generateWorld(p: Parameters<PlanetGenerator>[0], onStage?: (id: string) => void): PlanetState {
  const state = createState({ planetId: p.planetId, planetType: p.planetType, seed: p.seed, radius: p.radius });
  if (p.worldSalt) state.meta.worldSalt = p.worldSalt;
  const ctx = createContext(state, p.capacity ?? DEFAULT_SPAWN_CAPACITY);
  for (const id of ctx.profile.stages) {
    const stage = STAGES.get(id);
    if (!stage) throw new Error(`world profile ${ctx.profile.id}: unknown stage ${id}`);
    stage.run(ctx);
    onStage?.(id);
  }
  state.meta.genVersion = GEN_VERSION;
  return state;
}

// `temperate` stays the generator id every host and scenario uses; the profile is chosen by `planetType`. Hosts that
// pass the planet type as the generator id (`type: planet.type`) get that type's profile.
registerGenerator('temperate', (p) => generateWorld(p));
registerGenerator('desert', (p) => generateWorld({ ...p, planetType: 'desert' }));
registerGenerator('ocean', (p) => generateWorld({ ...p, planetType: 'ocean' }));

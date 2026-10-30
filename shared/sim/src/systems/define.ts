import type { CommandHandlerDef } from '../kernel/commands';
import type { SimSystem } from '../kernel/system';
import type { WaveId } from '../kernel/types';

/**
 * A sim module: the unit of discovery. One folder `systems/<name>/index.ts` whose default export is a `SimModule`.
 * `scripts/gen/sim-systems.gen.mjs` lists those folders into `index.generated.ts` (folders starting with `_` are skipped).
 */
export interface SimModule {
  readonly id: string;
  readonly wave: WaveId;
  readonly systems: readonly SimSystem[];
  readonly handlers: readonly CommandHandlerDef[];
}

export interface SimModuleDef {
  id: string;
  wave: WaveId;
  systems?: SimSystem[];
  handlers?: CommandHandlerDef[];
}

export const defineSimModule = (def: SimModuleDef): SimModule => ({ id: def.id, wave: def.wave, systems: def.systems ?? [], handlers: def.handlers ?? [] });

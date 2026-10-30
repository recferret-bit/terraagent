import type { CommandHandlerDef } from '../kernel/commands';
import { createPipeline, type Pipeline } from '../kernel/step';
import type { CompiledDataLike, EngineConfig } from '../kernel/config';
import { compileData } from '../data';
import type { SimSystem } from '../kernel/system';
import type { SimModule } from './define';
import { SIM_MODULES } from './index.generated';

export const allModules = (): readonly SimModule[] => SIM_MODULES;
export const allSystems = (modules: readonly SimModule[] = SIM_MODULES): SimSystem[] => modules.flatMap((m) => m.systems);
export const allHandlers = (modules: readonly SimModule[] = SIM_MODULES): CommandHandlerDef[] => modules.flatMap((m) => m.handlers);

export interface EngineConfigInput {
  flags: Iterable<string>;
  /** Defaults to `compileData(flags)` over every discovered table. */
  data?: CompiledDataLike;
  /** Defaults to every discovered module; tests may pass a subset or extras. */
  modules?: readonly SimModule[];
}

/** Default engine config from the registry: hosts pass flags + data and never assemble system lists by hand. */
export function createEngineConfig(input: EngineConfigInput): EngineConfig {
  const modules = input.modules ?? SIM_MODULES;
  const flags = new Set(input.flags);
  return { flags, data: input.data ?? compileData(flags), systems: allSystems(modules), handlers: allHandlers(modules) };
}

export const createRegistryPipeline = (input: EngineConfigInput): Pipeline => createPipeline(createEngineConfig(input));

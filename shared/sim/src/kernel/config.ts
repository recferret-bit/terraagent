import type { CommandHandlerDef } from './commands';
import type { SimSystem } from './system';

/** Compiled data tables (filled in by `compileData`); the kernel only needs the hash and the table bag. */
export interface CompiledDataLike {
  readonly hash: string;
  readonly tables: Readonly<Record<string, unknown>>;
}

export const EMPTY_DATA: CompiledDataLike = { hash: 'empty', tables: {} };

/**
 * Engine configuration: which waves are on, the compiled data and the registered systems / command handlers.
 * Identical on every host of a planet (server thread, client replica, local host), so the same commands produce
 * the same state.
 */
export interface EngineConfig {
  readonly flags: ReadonlySet<string>;
  readonly data: CompiledDataLike;
  readonly systems: readonly SimSystem[];
  readonly handlers: readonly CommandHandlerDef[];
}

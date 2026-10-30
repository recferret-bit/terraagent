export interface BackendModuleDef {
  readonly id: string;
  readonly wave: string;
  readonly module?: new (...args: unknown[]) => object;
  readonly providers?: readonly unknown[];
  readonly exports?: readonly unknown[];
  readonly [key: string]: unknown;
}

/**
 * Declares a backend wave module definition.
 */
export function defineBackendModule<T extends BackendModuleDef>(def: T): T {
  return def;
}

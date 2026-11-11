import { DATA_TABLES } from '../../data/index.generated';
import type { TableDef } from '../../data/_define';
import { registerDataParams } from './register-data';
import { registerGuildParams } from './register-guild';
import { registerMarketParams } from './register-market';
import { registerRegionParams } from './register-regions';
import { ParamRegistry } from './registry';
import type { ParamRegistrar } from './types';

/** Registrars composed into the default registry. Add a file's registrar here; nothing else changes. */
export const PARAM_REGISTRARS: readonly ParamRegistrar[] = [registerMarketParams, registerRegionParams, registerGuildParams];

/** A fresh registry from the registrars plus the derived data-table entries (`tables` defaults to the bundled data). */
export function createParamRegistry(extra: readonly ParamRegistrar[] = [], tables: readonly TableDef[] = DATA_TABLES): ParamRegistry {
  const r = new ParamRegistry();
  for (const reg of [...PARAM_REGISTRARS, ...extra]) reg(r);
  registerDataParams(r, tables);
  return r;
}

let cached: ParamRegistry | undefined;
/** The shared registry of the bundled data tables (built once; pure and deterministic). */
export function defaultParamRegistry(): ParamRegistry {
  return (cached ??= createParamRegistry());
}

import type { BalanceOverrides } from './_overrides';
import type { TableDef } from './_define';
import { compileTables, type CompiledData } from './_compile';
import { DATA_TABLES } from './index.generated';

export { defineTable, type TableDef, type Row, type RowValue, type Unit } from './_define';
export {
  compileTables,
  dataRow,
  ECONOMY_RATE_SCALE,
  type CompiledData,
  type CompiledRow,
  type CompiledTable,
  type CompileInput,
} from './_compile';
export {
  parseTunePath, parseTuneValue, setOverride, mergeOverrides, exportOverrides, parseOverrides, isEmptyOverrides,
  type BalanceOverrides, type TunePath,
} from './_overrides';
export { dataHash, canonical } from './_hash';
export {
  DISMANTLE_REFUND_RATE,
  REPAIR_COST_RATE,
  TERRAFORM_TIME_TABLE,
  type TerraformTimeKey,
  type TerraformTimeSpec,
} from './ops-basic';
export { findSpecFromRow, FIND_FAMILIES, TERRAFORM_RESOURCE_SPAWN, type FindFamily, type TerraformFindSpec } from './terraform-finds';
export {
  RESOURCE_INCOME_TABLE,
  type ResourceIncomeKey,
} from './resources';
export {
  consumeDepositRichness,
  DEPOSIT_BP_PER_UNIT,
  DEPOSIT_MAX_RICHNESS_BP,
  DEPOSIT_MAX_UNITS,
  depositRemainingUnits,
  depositStageFromRichness,
  type DepositStage,
} from './terrain';

/** Every discovered table (`shared/sim/src/data/*.ts`, listed by `npm run gen`). */
export const allTables = (): readonly TableDef[] => DATA_TABLES;

/** Compiles every discovered table for an enabled wave set. */
export const compileData = (
  flags: { has(wave: string): boolean } | ReadonlySet<string>,
  optsOrOverrides?: { economyRateScale?: number; overrides?: BalanceOverrides } | BalanceOverrides,
): CompiledData => {
  if (!optsOrOverrides) return compileTables({ flags, tables: DATA_TABLES });
  if ('economyRateScale' in optsOrOverrides || 'overrides' in optsOrOverrides) {
    const o = optsOrOverrides as { economyRateScale?: number; overrides?: BalanceOverrides };
    return compileTables({ flags, tables: DATA_TABLES, economyRateScale: o.economyRateScale, overrides: o.overrides });
  }
  return compileTables({ flags, tables: DATA_TABLES, overrides: optsOrOverrides as BalanceOverrides });
};

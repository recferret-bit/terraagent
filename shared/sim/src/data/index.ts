import type { BalanceOverrides } from './_overrides';
import type { TableDef } from './_define';
import { compileTables, type CompiledData } from './_compile';
import { DATA_TABLES } from './index.generated';

export { defineTable, type TableDef, type Row, type RowValue, type Unit } from './_define';
export { compileTables, dataRow, type CompiledData, type CompiledRow, type CompiledTable, type CompileInput } from './_compile';
export {
  parseTunePath, parseTuneValue, setOverride, mergeOverrides, exportOverrides, parseOverrides, isEmptyOverrides,
  type BalanceOverrides, type TunePath,
} from './_overrides';
export { dataHash, canonical } from './_hash';

/** Every discovered table (`shared/sim/src/data/*.ts`, listed by `npm run gen`). */
export const allTables = (): readonly TableDef[] => DATA_TABLES;

/** Compiles every discovered table for an enabled wave set. */
export const compileData = (flags: { has(wave: string): boolean } | ReadonlySet<string>, overrides?: BalanceOverrides): CompiledData =>
  compileTables({ flags, tables: DATA_TABLES, ...(overrides ? { overrides } : {}) });

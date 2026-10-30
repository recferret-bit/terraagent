import { TICK_MS } from '../kernel/constants';
import type { CompiledDataLike } from '../kernel/config';
import type { Row, RowValue, TableDef, Unit } from './_define';
import { dataHash } from './_hash';

export type CompiledRow = Readonly<Record<string, RowValue>> & { readonly id: string; readonly wave: string };
export type CompiledTable = Readonly<Record<string, CompiledRow>>;

/** Compiled tables: rows by id, units converted to ticks, rows of disabled waves removed. */
export interface CompiledData extends CompiledDataLike {
  readonly hash: string;
  readonly tables: Readonly<Record<string, CompiledTable>>;
}

const CONVERT: Record<Unit, (v: number) => number> = {
  seconds: (s) => Math.round((s * 1000) / TICK_MS),
  perSecond: (r) => (r * TICK_MS) / 1000,
};

function convertRow(table: TableDef, row: Row): CompiledRow {
  const out: Record<string, RowValue> = { ...row };
  for (const [field, unit] of Object.entries(table.units ?? {}) as [string, Unit][]) {
    const v = out[field];
    if (v === undefined) continue;
    if (typeof v !== 'number') throw new Error(`data ${table.name}.${row.id}.${field}: unit ${unit} needs a number, got ${typeof v}`);
    out[field] = CONVERT[unit](v);
  }
  return out as CompiledRow;
}

export interface CompileInput {
  flags: { has(wave: string): boolean } | ReadonlySet<string>;
  tables: readonly TableDef[];
}

/**
 * `compileData` (SIM-D-03): converts design units to ticks and keeps only the rows of enabled waves. Pure; the same
 * tables + flags always give the same `hash`.
 */
export function compileTables({ flags, tables }: CompileInput): CompiledData {
  const out: Record<string, CompiledTable> = {};
  for (const t of tables) {
    if (out[t.name]) throw new Error(`duplicate data table ${t.name}`);
    const rows: Record<string, CompiledRow> = {};
    for (const r of t.rows) {
      if (rows[r.id]) throw new Error(`data ${t.name}: duplicate row ${r.id}`);
      if (flags.has(r.wave)) rows[r.id] = convertRow(t, r);
    }
    out[t.name] = rows;
  }
  return { hash: dataHash(out), tables: out };
}

/** Typed row lookup for systems: `row(ctx.data, 'devProbe', 'probe')`. Throws when the row is missing. */
export function dataRow(data: CompiledDataLike, table: string, id: string): CompiledRow {
  const r = (data.tables[table] as CompiledTable | undefined)?.[id];
  if (!r) throw new Error(`data row ${table}.${id} is missing (disabled wave or typo)`);
  return r;
}

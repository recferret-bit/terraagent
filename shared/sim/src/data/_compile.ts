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

/**
 * Global economy pacing multiplier (`colony-economy-and-buildings-spec.md` §1 rule 2, `SIMULATION.md` §7.6).
 * Scales resource production, harvest, upkeep, water, and ammo flow rates at compile time while leaving
 * solar/power output (`grossOutputPerS`, `netOutputPerS`, `powerDrainPerS`) and build `cost` untouched.
 */
export const ECONOMY_RATE_SCALE = 0.25;

const RESOURCE_FLOW_FIELDS = new Set(['outputPerS', 'harvestRatePerS', 'upkeepPerS', 'waterPerS', 'ammoPerS']);

function convertRow(table: TableDef, row: Row, scale: number): CompiledRow {
  const out: Record<string, RowValue> = { ...row };
  const units = table.units ?? {};
  for (const [field, unit] of Object.entries(units) as [string, Unit][]) {
    const v = out[field];
    if (v === undefined) continue;
    if (typeof v !== 'number') throw new Error(`data ${table.name}.${row.id}.${field}: unit ${unit} needs a number, got ${typeof v}`);
    if (unit === 'seconds') out[field] = Math.round((v * 1000) / TICK_MS);
    else if (unit === 'perSecond') out[field] = (v * TICK_MS) / 1000;
    else if (unit === 'resourceFlow') out[field] = v * scale;
  }
  for (const field of RESOURCE_FLOW_FIELDS) {
    if (field in units) continue;
    const v = out[field];
    if (typeof v === 'number') out[field] = v * scale;
  }
  return out as CompiledRow;
}

export interface CompileInput {
  flags: { has(wave: string): boolean } | ReadonlySet<string>;
  tables: readonly TableDef[];
  economyRateScale?: number;
}

/**
 * `compileData` (SIM-D-03): converts design units to ticks, scales resource flow rates by `economyRateScale`
 * (default `ECONOMY_RATE_SCALE = 0.25`), and keeps only the rows of enabled waves. Pure; the same tables + flags
 * always give the same `hash`.
 */
export function compileTables({ flags, tables, economyRateScale = ECONOMY_RATE_SCALE }: CompileInput): CompiledData {
  const out: Record<string, CompiledTable> = {};
  for (const t of tables) {
    if (out[t.name]) throw new Error(`duplicate data table ${t.name}`);
    const rows: Record<string, CompiledRow> = {};
    for (const r of t.rows) {
      if (rows[r.id]) throw new Error(`data ${t.name}: duplicate row ${r.id}`);
      if (flags.has(r.wave)) rows[r.id] = convertRow(t, r, economyRateScale);
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

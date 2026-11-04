import { compileData, dataRow, type CompiledRow } from '../data';
import type { CompiledDataLike } from '../kernel/config';
import { TICK_MS } from '../kernel/constants';

/**
 * The one way gameplay systems read balance rows (XC-01, XC-02, GP-25). A row comes from the step's compiled data, or
 * from the W01 defaults when a caller has none (tests, the client ghost); a missing row or field throws instead of
 * running on a literal copy of the number. Fields listed in a table's `units` are compiled (ticks, per tick): convert
 * them back with {@link ticksToSeconds} / {@link perTickToPerSecond} only where seconds are shown.
 */

let cachedW01Data: CompiledDataLike | null = null;
let cachedW05Data: CompiledDataLike | null = null;

/** The compiled W00 + W01 tables (cached): the data a caller without a step ctx reads. */
export function defaultW01Data(): CompiledDataLike {
  if (!cachedW01Data) cachedW01Data = compileData(new Set(['W00', 'W01']));
  return cachedW01Data;
}

/** The compiled W00..W05 tables (cached): fallback for W05 rows when a caller has no step ctx. */
export function defaultW05Data(): CompiledDataLike {
  if (!cachedW05Data) cachedW05Data = compileData(new Set(['W00', 'W01', 'W02', 'W03', 'W04', 'W05']));
  return cachedW05Data;
}

/** Row `table.id` of `data` when it has that table, else of {@link defaultW01Data}. Throws when the row is missing. */
export function w01Row(data: CompiledDataLike | undefined, table: string, id: string): CompiledRow {
  const src = data?.tables[table] ? data : defaultW01Data();
  return dataRow(src, table, id);
}

/** Row `table.id` of `data` when it has that row, else of {@link defaultW05Data}. Throws when the row is missing. */
export function w05Row(data: CompiledDataLike | undefined, table: string, id: string): CompiledRow {
  const tbl = data?.tables[table] as Record<string, CompiledRow> | undefined;
  const src = tbl && id in tbl ? data! : defaultW05Data();
  return dataRow(src, table, id);
}

/** A numeric field of `row`; throws when it is missing or not a finite number. */
export function rowNum(row: CompiledRow, field: string): number {
  const v = row[field];
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`data row ${row.id}.${field} is not a number`);
  return v;
}

/** Compiled ticks back to seconds (UI bills, order fields that carry seconds). */
export const ticksToSeconds = (ticks: number): number => (ticks * TICK_MS) / 1000;

/** A compiled per-tick rate back to per second. */
export const perTickToPerSecond = (perTick: number): number => (perTick * 1000) / TICK_MS;

/** HQ Commander Drone T1 (`hq.t1`). */
export const resolveHqT1Row = (data?: CompiledDataLike): CompiledRow => w01Row(data, 'hq', 't1');

/** Landing kit (`hq.startingKit`). */
export const resolveStartingKitRow = (data?: CompiledDataLike): CompiledRow => w01Row(data, 'hq', 'startingKit');

/** Command Hub T1 (`hub.t1`). */
export const resolveHubT1Row = (data?: CompiledDataLike): CompiledRow => w01Row(data, 'hub', 't1');

/**
 * Data tables (D-35, SIM-G-DATA): every balance number is a row in `shared/sim/src/data/<table>.ts`, never a
 * constant in system code. A table file default-exports `defineTable({...})`; the generator lists every table file.
 *
 * Rows are written in **design units** (seconds, per-second rates). `units` names the fields `compileData` converts:
 *   - `seconds`   → ticks (`round(s × 1000 / TICK_MS)`), e.g. a 30 s build → 150 ticks
 *   - `perSecond` → per tick (`v × TICK_MS / 1000`)
 * Every row carries `wave`; rows of disabled waves are dropped at compile time ("no flag, no feature").
 */
export type Unit = 'seconds' | 'perSecond';

export type RowValue = number | string | boolean | null | readonly RowValue[] | { readonly [k: string]: RowValue };

export interface Row {
  readonly id: string;
  readonly wave: string;
  readonly [field: string]: RowValue;
}

export interface TableDef<R extends Row = Row> {
  /** Table name used in `compiled.tables[name]` and in `tune <table>.<row>.<field>`. */
  readonly name: string;
  readonly summary: string;
  readonly units?: Readonly<Partial<Record<Exclude<keyof R, 'id' | 'wave'>, Unit>>>;
  readonly rows: readonly R[];
}

export const defineTable = <R extends Row>(t: TableDef<R>): TableDef<R> => t;

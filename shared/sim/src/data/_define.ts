/**
 * Data tables (D-35, SIM-G-DATA): every balance number is a row in `shared/sim/src/data/<table>.ts`, never a
 * constant in system code. A table file default-exports `defineTable({...})`; the generator lists every table file.
 *
 * Rows are written in **design units** (seconds, per-second rates). `units` names the fields `compileData` converts:
 *   - `seconds`   → ticks (`round(s × 1000 / TICK_MS)`), e.g. a 30 s build → 150 ticks
 *   - `perSecond` → per tick (`v × TICK_MS / 1000`)
 * Every row carries `wave`; rows of disabled waves are dropped at compile time ("no flag, no feature").
 * `amounts` names the fields that hold resource amounts; they must be whole, non-negative units (no fractions).
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
  /**
   * Fields holding resource amounts (a cost, a cargo, a yield, a storage cap): a number, or a map of resource key →
   * number. Every value must be a whole, non-negative number of units (`isWholeAmount`); `compileData` and every
   * balance override / `tune` reject anything else (`_amounts.ts`).
   */
  readonly amounts?: readonly Exclude<keyof R & string, 'id' | 'wave'>[];
  readonly rows: readonly R[];
}

export const defineTable = <R extends Row>(t: TableDef<R>): TableDef<R> => t;

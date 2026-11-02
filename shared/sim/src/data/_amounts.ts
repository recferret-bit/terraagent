import { amountsProblem, isWholeAmount } from '../economy/amounts';
import type { Row, RowValue, TableDef } from './_define';

/**
 * Resource amounts in data (D-34, D-35): the fields a table lists in `amounts` hold a whole, non-negative number of
 * units, or a map of resource key → such a number. Checked by `compileTables` on every row (base data and overrides)
 * and by `applyOverrides` on each overridden field, so a fractional cargo / cost / yield never reaches the sim:
 * a bad file fails to compile and a bad `tune` is rejected with this message.
 */
export function checkAmountField(table: TableDef, rowId: string, field: string, value: RowValue | undefined, label: string): void {
  if (!(table.amounts as readonly string[] | undefined)?.includes(field) || value === undefined || value === null) return;
  const at = `${label} ${table.name}.${rowId}.${field}`;
  const rule = 'resource amounts are whole, non-negative units';
  if (typeof value === 'number') {
    if (!isWholeAmount(value)) throw new Error(`${at}: ${rule}, got ${value}`);
    return;
  }
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error(`${at}: ${rule} (a number or a resource map), got ${JSON.stringify(value)}`);
  const bad = amountsProblem(value as Readonly<Record<string, unknown>>);
  if (bad?.code === 'invalid_resource') throw new Error(`${at}: unknown resource "${bad.detail}"`);
  if (bad) throw new Error(`${at}['${bad.resource}']: ${rule}, got ${bad.detail}`);
}

/** {@link checkAmountField} over every `amounts` field of `row`. */
export function checkRowAmounts(table: TableDef, row: Row, label: string): void {
  for (const field of (table.amounts ?? []) as readonly string[]) checkAmountField(table, row.id, field, row[field], label);
}

import type { Row, RowValue, TableDef } from '../../data/_define';
import type { ParamEntry, ParamMutability, ParamUnit } from './types';
import type { ParamRegistry } from './registry';

/** Spec of one field of a table row; the default always comes from the data table (D-35), never from here. */
export type FieldSpec = Omit<ParamEntry, 'path' | 'default' | 'requiredWave' | 'mutability' | 'description'> & {
  readonly description: string;
  readonly mutability?: ParamMutability;
};

/** Rows of `table` matching `match` (an id prefix ending in `*`, or an exact id). */
export function rowsMatching(table: TableDef, match: string): readonly Row[] {
  return table.rows.filter((r) => (match.endsWith('*') ? r.id.startsWith(match.slice(0, -1)) : r.id === match));
}

/** Registers `table.row.field` for every row of `match` from `spec`; throws when the row or field is missing (drift guard). */
export function registerField(r: ParamRegistry, table: TableDef, match: string, field: string, spec: FieldSpec): void {
  const matched = rowsMatching(table, match);
  if (matched.length === 0) throw new Error(`param registry: ${table.name} has no row ${match}`);
  // A wildcard covers the rows that carry the field; an exact row must carry it.
  const rows = match.endsWith('*') ? matched.filter((row) => row[field] !== undefined) : matched;
  if (rows.length === 0) throw new Error(`param registry: ${table.name}.${match}.${field} is missing in the data table`);
  const fixed = table.fixed && (table.fixed.fields === '*' || (table.fixed.fields as readonly string[]).includes(field));
  for (const row of rows) {
    const def = row[field];
    if (def === undefined) throw new Error(`param registry: ${table.name}.${row.id}.${field} is missing in the data table`);
    r.register({
      ...spec,
      path: `${table.name}.${row.id}.${field}`,
      default: def as ParamEntry['default'],
      requiredWave: row.wave,
      mutability: fixed ? 'fixed' : spec.mutability ?? 'runtime',
      ...(fixed ? { why: table.fixed?.why } : spec.why ? { why: spec.why } : {}),
    });
  }
}

/** Field names of `table` rows (excluding id/wave) that hold a value, for coverage checks. */
export function dataFields(table: TableDef): readonly string[] {
  return [...new Set(table.rows.flatMap((r) => Object.keys(r).filter((k) => k !== 'id' && k !== 'wave')))].sort();
}

export const unitOfTableField = (table: TableDef, field: string): ParamUnit => {
  const u = (table.units as Readonly<Record<string, string>> | undefined)?.[field];
  return u === 'seconds' ? 'seconds' : u === 'perSecond' ? 'per_second' : u === 'resourceFlow' ? 'resource_flow' : 'count';
};

export type { RowValue };

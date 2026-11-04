import type { TableDef } from '../../data/_define';
import { dataFields, registerField, unitOfTableField, type FieldSpec } from './fields';
import type { ParamRegistry } from './registry';
import { RESOURCE_KEYS } from '@terra/contracts';

/**
 * Derived entries for existing economy data-table numeric fields (path `table.row.field`, the `tune` syntax). Each is
 * listed explicitly (what is tunable is a decision, not a side effect); the default always comes from the table row.
 * Bounds are conservative design limits: `[0, 10x default]`-style, wide enough to explore, narrow enough to stay safe.
 */
const DERIVED: readonly { readonly table: string; readonly row: string; readonly field: string; readonly kind: 'int' | 'bp' | 'map'; readonly max: number; readonly what: string }[] = [
  { table: 'tradeHub', row: '*', field: 'throughputPerMin', kind: 'int', max: 100000, what: 'Trade Hub throughput per minute' },
  { table: 'tradeHub', row: '*', field: 'dailyMintCapPerResource', kind: 'int', max: 1000000, what: 'daily cargo mint cap per resource' },
  { table: 'hub', row: '*', field: 'storageCapPerFamily', kind: 'int', max: 100000, what: 'Hub storage cap per resource family' },
  { table: 'hub', row: '*', field: 'cancelRefundBp', kind: 'bp', max: 10000, what: 'refund share when a Hub build is cancelled' },
  { table: 'opsBasic', row: '*', field: 'yields', kind: 'map', max: 1000, what: 'terraform yield per resource' },
  { table: 'workCrew', row: '*', field: 'maxCrew', kind: 'int', max: 64, what: 'maximum helpers on a work site' },
];

export function registerDataParams(r: ParamRegistry, tables: readonly TableDef[]): void {
  for (const d of DERIVED) {
    const table = tables.find((t) => t.name === d.table);
    if (!table) throw new Error(`param registry: unknown data table ${d.table}`);
    if (!dataFields(table).includes(d.field)) throw new Error(`param registry: ${d.table}.${d.field} is not a data field`);
    const base = { description: `${d.table}.${d.field}: ${d.what}.` };
    const spec: FieldSpec = d.kind === 'map'
      ? { ...base, unit: 'whole_units', type: 'intMap', mapKeys: RESOURCE_KEYS, bounds: { min: 0, max: d.max } }
      : { ...base, unit: d.kind === 'bp' ? 'bp' : unitOfTableField(table, d.field), type: 'int', bounds: { min: 0, max: d.max } };
    registerField(r, table, d.row, d.field, spec);
  }
}

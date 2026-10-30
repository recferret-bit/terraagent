import type { Row, RowValue, TableDef } from './_define';

/**
 * Balance overrides (D-35): `{ [table]: { [rowId]: { [field]: value } } }` in **design units** (seconds, per-second
 * rates). They are merged over the data rows at `compileData`, before unit conversion, so `buildS: 60` means 300 ticks.
 */
export type BalanceOverrides = { readonly [table: string]: { readonly [rowId: string]: { readonly [field: string]: RowValue } } };

export interface TunePath { readonly table: string; readonly row: string; readonly field: string }

const PATH_PART = /^[A-Za-z0-9_-]+$/;

/** `dev.probe.nudgeTiles` → `{ table: 'dev', row: 'probe', field: 'nudgeTiles' }`. Throws on anything that is not exactly three names. */
export function parseTunePath(path: string): TunePath {
  const parts = path.split('.');
  if (parts.length !== 3 || !parts.every((p) => PATH_PART.test(p))) {
    throw new Error(`tune path "${path}" must look like <table>.<row>.<field>, e.g. dev.probe.nudgeTiles`);
  }
  return { table: parts[0] as string, row: parts[1] as string, field: parts[2] as string };
}

/** Console text → value: JSON when it parses (numbers, booleans, null, arrays, objects, quoted strings), else the raw string. */
export function parseTuneValue(raw: string): RowValue {
  try { return JSON.parse(raw) as RowValue; } catch { return raw; }
}

/** A copy of `o` with `path` set to `value` (a string is parsed with `parseTuneValue`). Inputs are never mutated. */
export function setOverride(o: BalanceOverrides, path: string, value: RowValue | undefined): BalanceOverrides {
  const { table, row, field } = parseTunePath(path);
  if (value === undefined) throw new Error(`tune ${path}: a value is required`);
  const v = typeof value === 'string' ? parseTuneValue(value) : value;
  const t = o[table] ?? {};
  return { ...o, [table]: { ...t, [row]: { ...(t[row] ?? {}), [field]: v } } };
}

/** `a` with `b` laid over it, field by field (`b` wins). */
export function mergeOverrides(a: BalanceOverrides, b: BalanceOverrides): BalanceOverrides {
  const out: Record<string, Record<string, Record<string, RowValue>>> = {};
  for (const src of [a, b]) {
    for (const [t, rows] of Object.entries(src)) {
      const ot = (out[t] ??= {});
      for (const [r, fields] of Object.entries(rows)) ot[r] = { ...(ot[r] ?? {}), ...fields };
    }
  }
  return JSON.parse(JSON.stringify(out)) as BalanceOverrides;
}

export const isEmptyOverrides = (o: BalanceOverrides): boolean => Object.keys(o).length === 0;

/** Pretty JSON, keys sorted: the content of a `balance.overrides.json` file. */
export function exportOverrides(o: BalanceOverrides): string {
  const sort = (v: unknown): unknown => {
    if (v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map(sort);
    return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sort((v as Record<string, unknown>)[k])]));
  };
  return JSON.stringify(sort(o), null, 2);
}

/** Validates the shape of untrusted overrides (a file, a WS message). Throws a clear error; does not check them against tables. */
export function parseOverrides(input: unknown, label = 'overrides'): BalanceOverrides {
  const obj = (v: unknown, what: string): Record<string, unknown> => {
    if (v === null || typeof v !== 'object' || Array.isArray(v)) throw new Error(`${label}: ${what} must be an object`);
    return v as Record<string, unknown>;
  };
  for (const [t, rows] of Object.entries(obj(input, 'the root'))) {
    for (const [r, fields] of Object.entries(obj(rows, `table "${t}"`))) {
      for (const f of Object.keys(obj(fields, `row "${t}.${r}"`))) parseTunePath(`${t}.${r}.${f}`);
    }
  }
  return input as BalanceOverrides;
}

const kindOf = (v: unknown): string => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);

/** Returns the rows of `tables` with the overrides laid over them. Unknown table/row/field or a value of another type throws. */
export function applyOverrides(tables: readonly TableDef[], overrides: BalanceOverrides): readonly TableDef[] {
  const byName = new Map(tables.map((t) => [t.name, t]));
  for (const [tn, rows] of Object.entries(overrides)) {
    const t = byName.get(tn);
    if (!t) throw new Error(`balance override: unknown table "${tn}" (known: ${[...byName.keys()].join(', ')})`);
    for (const [rn, fields] of Object.entries(rows)) {
      const row = t.rows.find((r) => r.id === rn);
      if (!row) throw new Error(`balance override: unknown row "${tn}.${rn}" (known: ${t.rows.map((r) => r.id).join(', ')})`);
      for (const [fn, v] of Object.entries(fields)) {
        if (fn === 'id' || fn === 'wave' || !(fn in row)) {
          throw new Error(`balance override: unknown field "${tn}.${rn}.${fn}" (known: ${Object.keys(row).filter((k) => k !== 'id' && k !== 'wave').join(', ')})`);
        }
        const was = row[fn];
        if (was !== null && kindOf(was) !== kindOf(v)) {
          throw new Error(`balance override: ${tn}.${rn}.${fn} is a ${kindOf(was)}, got ${kindOf(v)} ${JSON.stringify(v)}`);
        }
      }
    }
  }
  return tables.map((t) => {
    const rows = overrides[t.name];
    if (!rows) return t;
    return { ...t, rows: t.rows.map((r): Row => (rows[r.id] ? { ...r, ...rows[r.id] } : r)) };
  });
}

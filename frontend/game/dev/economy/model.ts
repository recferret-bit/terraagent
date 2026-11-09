import type { ParamValue, ProfilePatchOp } from '@terra/contracts';

/** One entry of `GET /v1/economy/schema` (`describeSchema`): JSON-Schema fields plus the registry's `x-*` metadata. */
export interface SchemaProp {
  readonly description: string;
  readonly default: ParamValue;
  readonly type: 'integer' | 'string' | 'boolean' | 'array' | 'object';
  readonly minimum?: number;
  readonly maximum?: number;
  readonly enum?: readonly string[];
  readonly maxItems?: number;
  readonly 'x-unit': string;
  readonly 'x-mutability': 'runtime' | 'new_world_only' | 'fixed';
  readonly 'x-requiredWave': string;
  readonly 'x-enabled': boolean;
  readonly 'x-minimum'?: string;
  readonly 'x-maximum'?: string;
  readonly 'x-why'?: string;
  readonly 'x-dependencies'?: readonly { path: string; relation: 'lte' | 'gte' }[];
}
export interface EconomySchema { readonly schemaVersion: number; readonly properties: Readonly<Record<string, SchemaProp>> }

export type FieldKind = 'int' | 'atomic' | 'bool' | 'enum' | 'intList' | 'intMap';
export type GroupId = 'market' | 'resources' | 'budgets';
export const GROUPS: readonly { readonly id: GroupId; readonly title: string }[] = [
  { id: 'market', title: 'Market fees and quotes' },
  { id: 'resources', title: 'Resource policies (all ten)' },
  { id: 'budgets', title: 'Budgets and limits' },
];

export interface ParamField { readonly path: string; readonly group: GroupId; readonly kind: FieldKind; readonly prop: SchemaProp }

const kindOf = (p: SchemaProp): FieldKind => {
  if (p.type === 'boolean') return 'bool';
  if (p.type === 'integer') return 'int';
  if (p.type === 'array') return 'intList';
  if (p.type === 'object') return 'intMap';
  return p.enum ? 'enum' : 'atomic';
};

/** `market.policy.*` / `market.quote.*` → market; `market.resource.*` → resources; everything else is a budget/limit table. */
export function groupOf(path: string): GroupId {
  if (path.startsWith('market.resource.')) return 'resources';
  return path.startsWith('market.') ? 'market' : 'budgets';
}

/** Every registered path as a field, sorted by path. */
export function fieldsOf(schema: EconomySchema): ParamField[] {
  return Object.keys(schema.properties).sort().map((path) => {
    const prop = schema.properties[path] as SchemaProp;
    return { path, group: groupOf(path), kind: kindOf(prop), prop };
  });
}

export const effective = (f: ParamField, params: Readonly<Record<string, ParamValue>>): ParamValue => params[f.path] ?? f.prop.default;

export const formatValue = (v: ParamValue): string => (typeof v === 'object' ? JSON.stringify(v) : String(v));

export type Parsed = { readonly ok: true; readonly value: ParamValue } | { readonly ok: false; readonly error: string };
const INT = /^-?\d+$/;
const ATOMIC = /^(0|[1-9]\d{0,77})$/;

/** Text from an input → typed value, with a client-side check mirroring the registry (the server stays the authority). */
export function parseFieldInput(f: ParamField, text: string): Parsed {
  const t = text.trim();
  switch (f.kind) {
    case 'int': return INT.test(t) && Number.isSafeInteger(Number(t)) ? { ok: true, value: Number(t) } : { ok: false, error: 'expected an integer' };
    case 'atomic': return ATOMIC.test(t) ? { ok: true, value: t } : { ok: false, error: 'expected a non-negative integer (atomic units, no decimals)' };
    case 'bool': return t === 'true' || t === 'false' ? { ok: true, value: t === 'true' } : { ok: false, error: 'expected true or false' };
    case 'enum': return f.prop.enum?.includes(t) ? { ok: true, value: t } : { ok: false, error: `expected one of ${f.prop.enum?.join(', ')}` };
    case 'intList': {
      const parts = t === '' ? [] : t.split(',').map((s) => s.trim());
      return parts.every((s) => INT.test(s)) ? { ok: true, value: parts.map(Number) } : { ok: false, error: 'expected integers separated by commas' };
    }
    case 'intMap':
      try {
        const v: unknown = JSON.parse(t);
        return v && typeof v === 'object' && !Array.isArray(v) && Object.values(v).every((n) => Number.isSafeInteger(n)) ? { ok: true, value: v as Record<string, number> } : { ok: false, error: 'expected a JSON object of integers' };
      } catch { return { ok: false, error: 'expected a JSON object of integers' }; }
  }
}

export interface BuiltOps { readonly ops: ProfilePatchOp[]; readonly errors: Record<string, string> }
const same = (a: ParamValue, b: ParamValue): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * The patch ops for the edited inputs (`edits`: path → text): unchanged values produce nothing, a value equal to the
 * default drops an existing override (`unset`), anything else is a `set`. Unparseable input is reported per field.
 */
export function buildOps(fields: readonly ParamField[], params: Readonly<Record<string, ParamValue>>, edits: Readonly<Record<string, string>>): BuiltOps {
  const ops: ProfilePatchOp[] = [];
  const errors: Record<string, string> = {};
  for (const f of fields) {
    const text = edits[f.path];
    if (text === undefined) continue;
    const p = parseFieldInput(f, text);
    if (!p.ok) { errors[f.path] = p.error; continue; }
    const cur = effective(f, params);
    if (same(p.value, cur)) continue;
    if (same(p.value, f.prop.default)) ops.push({ op: 'unset', path: f.path });
    else ops.push({ op: 'set', path: f.path, value: p.value });
  }
  return { ops, errors };
}

/** Structured server errors → messages per parameter path (`ops.N…` paths map back to the op's path; no path → `_`). */
export function mapErrors(errors: readonly { code: string; path?: string; message: string }[], ops: readonly ProfilePatchOp[] = []): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const e of errors) {
    const m = /^ops\.(\d+)/.exec(e.path ?? '');
    const key = m ? ops[Number(m[1])]?.path ?? '_' : e.path ?? '_';
    (out[key] ??= []).push(`${e.code}: ${e.message}`);
  }
  return out;
}

export interface DiffRow { readonly path: string; readonly unit: string; readonly from: string; readonly to: string }

/** Effective values that differ between two parameter sets (defaults filled in), sorted by path. */
export function diffParams(fields: readonly ParamField[], a: Readonly<Record<string, ParamValue>>, b: Readonly<Record<string, ParamValue>>): DiffRow[] {
  return fields
    .filter((f) => !same(effective(f, a), effective(f, b)))
    .map((f) => ({ path: f.path, unit: f.prop['x-unit'], from: formatValue(effective(f, a)), to: formatValue(effective(f, b)) }));
}

export type BadgeTone = 'ok' | 'ai' | 'alert' | 'away';
/** The mutability badge: runtime (live-tunable), new-world-only, fixed; and a disabled-wave marker. */
export function badgesOf(f: ParamField): { label: string; tone: BadgeTone }[] {
  const m = f.prop['x-mutability'];
  const out: { label: string; tone: BadgeTone }[] = [{ label: m === 'runtime' ? 'RUNTIME' : m === 'new_world_only' ? 'NEW WORLD ONLY' : 'FIXED', tone: m === 'runtime' ? 'ok' : m === 'fixed' ? 'alert' : 'away' }];
  out.push({ label: f.prop['x-requiredWave'], tone: f.prop['x-enabled'] ? 'ai' : 'alert' });
  return out;
}

export const boundsText = (f: ParamField): string => {
  const p = f.prop;
  if (p['x-minimum'] !== undefined) return `${p['x-minimum']}…${p['x-maximum']}`;
  return p.minimum !== undefined ? `${p.minimum}…${p.maximum}` : '';
};

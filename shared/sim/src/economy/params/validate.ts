import { economyError, ProfilePatch, zodIssuesToEconomyErrors, type EconomyError, type ProfileContent } from '@terra/contracts';
import { isResourceKey } from '../amounts';
import { defaultParamRegistry } from './default';
import type { ParamRegistry } from './registry';
import type { ParamEntry, ParamValue, WaveFlags } from './types';

const ATOMIC = /^(0|[1-9]\d{0,77})$/;
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v);
const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Self-consistency of an entry (bounds ordered, default valid). Returns a problem text or null. */
export function checkEntryShape(e: ParamEntry): string | null {
  if ((e.type === 'int' || e.type === 'atomic' || e.type === 'intMap' || e.type === 'intList') && !e.bounds) return 'bounds are required';
  if (e.type === 'enum' && !e.enumValues?.length) return 'enumValues are required';
  if (e.type === 'intMap' && !e.mapKeys?.length) return 'mapKeys are required';
  if (e.mutability !== 'runtime' && !e.why) return 'a non-runtime field needs `why`';
  if (e.bounds && big(e.bounds.min) > big(e.bounds.max)) return 'bounds.min > bounds.max';
  const errs = checkType(e, e.default);
  return errs ? `default is invalid: ${errs}` : null;
}

const big = (n: number | string): bigint => BigInt(n);

/** Type and bounds check of one value against its entry. Returns a problem text or null. */
function checkType(e: ParamEntry, v: unknown): string | null {
  const inRange = (n: number | string): boolean => !e.bounds || (big(n) >= big(e.bounds.min) && big(n) <= big(e.bounds.max));
  const range = e.bounds ? `[${e.bounds.min}, ${e.bounds.max}]` : '';
  switch (e.type) {
    case 'int':
      if (!isInt(v)) return 'wrong_type: expected a safe integer';
      return inRange(v) ? null : `out_of_bounds: ${v} not in ${range}`;
    case 'atomic':
      if (typeof v !== 'string' || !ATOMIC.test(v)) return 'wrong_type: expected a non-negative integer decimal string';
      return inRange(v) ? null : `out_of_bounds: ${v} not in ${range}`;
    case 'bool':
      return typeof v === 'boolean' ? null : 'wrong_type: expected a boolean';
    case 'enum':
      if (typeof v !== 'string') return 'wrong_type: expected a string';
      return e.enumValues?.includes(v) ? null : `out_of_bounds: "${v}" is not one of ${e.enumValues?.join(', ')}`;
    case 'intList': {
      if (!Array.isArray(v) || !v.every(isInt)) return 'wrong_type: expected a list of safe integers';
      if (e.maxItems !== undefined && v.length > e.maxItems) return `out_of_bounds: at most ${e.maxItems} items`;
      return v.every(inRange) ? null : `out_of_bounds: every item must be in ${range}`;
    }
    case 'intMap': {
      if (!isRecord(v)) return 'wrong_type: expected an object of integers';
      for (const [k, n] of Object.entries(v)) {
        if (!isResourceKey(k) && !e.mapKeys?.includes(k)) return `unknown_resource: "${k}"`;
        if (!isInt(n)) return `wrong_type: ${k} must be a safe integer`;
        if (!inRange(n)) return `out_of_bounds: ${k}=${n} not in ${range}`;
      }
      return null;
    }
  }
}

/** Value-only validation of one registered path (no wave/mutability policy; see {@link validatePatch}). */
export function validateValue(path: string, value: unknown, registry: ParamRegistry = defaultParamRegistry()): EconomyError[] {
  const e = registry.get(path);
  if (!e) return [economyError('unknown_path', `unknown parameter path "${path}"`, path)];
  const problem = checkType(e, value);
  if (!problem) return [];
  const [code, ...rest] = problem.split(': ');
  const message = rest.join(': ');
  return [economyError(code as 'wrong_type' | 'out_of_bounds' | 'unknown_resource', message, path, { type: e.type, unit: e.unit, ...(e.bounds ? { bounds: e.bounds } : {}) })];
}

export interface ValidatePatchOptions {
  readonly registry?: ParamRegistry;
  /** The version the content is at; a patch with another `expectedVersion` fails with `version_conflict`. */
  readonly currentVersion?: number;
  /** `existing_world`: a `new_world_only` field is rejected (live/runtime candidate). Default `new_world` (any candidate). */
  readonly target?: 'new_world' | 'existing_world';
}

type ParamsOf = Pick<ProfileContent, 'parameters'> | { readonly parameters?: Readonly<Record<string, ParamValue>> };

/** The parameters after applying `ops` (no validation). `unset` removes the override (the default applies again). */
export function applyPatchOps(content: ParamsOf, patch: ProfilePatch): Record<string, ParamValue> {
  const out: Record<string, ParamValue> = { ...(content.parameters ?? {}) };
  for (const op of patch.ops) {
    if (op.op === 'unset') delete out[op.path];
    else if (op.value !== undefined) out[op.path] = op.value;
  }
  return out;
}

/**
 * Validates a patch against the registry and the enabled waves (ECONOMY §6): unknown path, wrong type, out of bounds,
 * fixed/`new_world_only` (per target), disabled wave, version guard, cross-field dependencies on effective values.
 * Pure: it does not mutate `content`. An empty array means the patch is valid.
 */
export function validatePatch(content: ParamsOf, patch: unknown, flags?: WaveFlags, opts: ValidatePatchOptions = {}): EconomyError[] {
  const parsed = ProfilePatch.safeParse(patch);
  if (!parsed.success) return zodIssuesToEconomyErrors(parsed.error, 'invalid_patch');
  const registry = opts.registry ?? defaultParamRegistry();
  const p = parsed.data;
  const errors: EconomyError[] = [];
  if (opts.currentVersion !== undefined && p.expectedVersion !== opts.currentVersion) {
    errors.push(economyError('version_conflict', `patch expects version ${p.expectedVersion}, profile is at ${opts.currentVersion}`, undefined, { expected: p.expectedVersion, current: opts.currentVersion }));
  }
  p.ops.forEach((op, i) => errors.push(...validateOp(registry, op, `ops.${i}`, flags, opts.target)));
  if (errors.length === 0) errors.push(...checkDependencies(registry, applyPatchOps(content, p), p.ops.map((o) => o.path)));
  return errors;
}

function validateOp(registry: ParamRegistry, op: ProfilePatch['ops'][number], at: string, flags: WaveFlags | undefined, target: ValidatePatchOptions['target']): EconomyError[] {
  const e = registry.get(op.path);
  if (!e) return [economyError('unknown_path', `unknown parameter path "${op.path}"`, op.path, { op: at })];
  if (e.mutability === 'fixed') return [economyError('not_tunable', e.why ?? 'this field is fixed', op.path, { mutability: e.mutability })];
  if (e.mutability === 'new_world_only' && target === 'existing_world') {
    return [economyError('not_tunable', `${e.why ?? 'new worlds only'} (new_world_only)`, op.path, { mutability: e.mutability })];
  }
  if (flags && !flags.has(e.requiredWave)) {
    return [economyError('wave_disabled', `${op.path} needs wave ${e.requiredWave}, which is disabled`, op.path, { requiredWave: e.requiredWave })];
  }
  if (op.op === 'unset') return [];
  if (op.value === undefined) return [economyError('wrong_type', 'a set op needs a value', op.path, { op: at })];
  return validateValue(op.path, op.value, registry);
}

function checkDependencies(registry: ParamRegistry, effective: Record<string, ParamValue>, touched: readonly string[]): EconomyError[] {
  const errors: EconomyError[] = [];
  const value = (path: string): ParamValue | undefined => effective[path] ?? registry.get(path)?.default;
  const related = new Set(touched);
  for (const e of registry.list()) {
    for (const d of e.dependencies ?? []) {
      if (!related.has(e.path) && !related.has(d.path)) continue;
      const a = value(e.path);
      const b = value(d.path);
      if (typeof a !== 'number' || typeof b !== 'number') continue;
      if (d.relation === 'lte' ? a > b : a < b) {
        errors.push(economyError('dependency_violation', `${e.path} (${a}) must be ${d.relation === 'lte' ? '<=' : '>='} ${d.path} (${b})`, e.path, { other: d.path, relation: d.relation }));
      }
    }
  }
  return errors;
}

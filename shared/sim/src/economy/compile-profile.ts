import { economyError, type EconomyError, type ParamValue } from '@terra/contracts';
import { canonical, compileData, type BalanceOverrides } from '../data';
import type { RowValue } from '../data';
import { tryCompileMarketConfig, type MarketConfig } from './market-config';
import { defaultParamRegistry, validatePatch, type ParamRegistry } from './params';
import { sha256Hex } from './sha256';

/**
 * Profile compilation (D-35, D-44, W13-38): a profile version's `parameters` become the balance-override shape
 * `compileData` already accepts, so the sim, the server, the browser (`?host=local`) and experiment hosts compile the
 * SAME data from the same content and get the same `dataHash`. Pure: no DB, no clock, no I/O. A tick never reads the
 * database; hosts receive this plain, frozen, structured-cloneable object.
 */
export interface CompiledProfile {
  /** Design-unit overrides, only the parameters that differ from the bootstrap data tables (baseline → `{}`). */
  readonly overrides: BalanceOverrides;
  /** `sha256:<hex>` of the canonical overrides; equal overrides, equal hash. */
  readonly overridesHash: string;
  /** Hash of the compiled data tables (`compileData(flags, overrides).hash`), the `welcome.dataHash` every host agrees on. */
  readonly dataHash: string;
  /** Wave ids the compile ran with. */
  readonly flags: readonly string[];
  /** The pinned market configuration; absent while wave W13 is off. */
  readonly marketConfig?: MarketConfig;
}

export type CompileProfileResult = { readonly ok: true; readonly compiled: CompiledProfile } | { readonly ok: false; readonly errors: EconomyError[] };

export class ProfileCompileError extends Error {
  constructor(readonly errors: readonly EconomyError[]) {
    super(`invalid economy profile: ${errors.map((e) => `${e.code}${e.path ? ` ${e.path}` : ''}`).join(', ')}`);
    this.name = 'ProfileCompileError';
  }
}

/** `table.row.field` → `{table,row,field}`; the row id may contain dots (`market.quote.USDC.tickAtomic`). */
export function splitParamPath(path: string): { readonly table: string; readonly row: string; readonly field: string } {
  const first = path.indexOf('.');
  const last = path.lastIndexOf('.');
  if (first <= 0 || last <= first) throw new Error(`parameter path "${path}" must look like <table>.<row>.<field>`);
  return { table: path.slice(0, first), row: path.slice(first + 1, last), field: path.slice(last + 1) };
}

const same = (a: unknown, b: unknown): boolean => canonical(a) === canonical(b);

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object') for (const v of Object.values(o)) deepFreeze(v);
  return Object.freeze(o);
}

/** The non-default parameters as balance overrides (sorted, so the object is deterministic). */
export function parametersToOverrides(parameters: Readonly<Record<string, ParamValue>>, registry: ParamRegistry = defaultParamRegistry()): BalanceOverrides {
  const out: Record<string, Record<string, Record<string, RowValue>>> = {};
  for (const path of Object.keys(parameters).sort()) {
    const value = parameters[path] as ParamValue;
    if (same(value, registry.get(path)?.default)) continue;
    const { table, row, field } = splitParamPath(path);
    ((out[table] ??= {})[row] ??= {})[field] = JSON.parse(JSON.stringify(value)) as RowValue;
  }
  return out;
}

export interface CompileProfileOptions { readonly registry?: ParamRegistry }

/**
 * Validates `content.parameters` (registry: path, type, bounds, fixed, disabled wave, dependencies) and compiles them.
 * Never throws; returns structured `EconomyError`s. Same content + flags always gives the same result on every host.
 */
export function tryCompileProfile(content: { readonly parameters?: Readonly<Record<string, ParamValue>> }, flags: readonly string[], opts: CompileProfileOptions = {}): CompileProfileResult {
  const registry = opts.registry ?? defaultParamRegistry();
  const has = new Set(flags);
  const parameters = content.parameters ?? {};
  const ops = Object.keys(parameters).sort().filter((p) => !same(parameters[p], registry.get(p)?.default)).map((path) => ({ op: 'set' as const, path, value: parameters[path] }));
  const errors = validatePatch({ parameters: {} }, { schemaVersion: 1, requestId: 'compile-profile', expectedVersion: 1, ops }, { has: (w) => has.has(w) }, { registry });
  if (errors.length > 0) return { ok: false, errors };
  const overrides = deepFreeze(parametersToOverrides(parameters, registry));
  let dataHash: string;
  try {
    dataHash = compileData(has, overrides).hash;
  } catch (e) {
    return { ok: false, errors: [economyError('schema_mismatch', e instanceof Error ? e.message : String(e))] };
  }
  let marketConfig: MarketConfig | undefined;
  if (has.has('W13')) {
    const m = tryCompileMarketConfig(content, { registry, flags: { has: (w) => has.has(w) } });
    if (!m.ok) return { ok: false, errors: m.errors };
    marketConfig = m.config;
  }
  const compiled: CompiledProfile = {
    overrides,
    overridesHash: `sha256:${sha256Hex(canonical(overrides))}`,
    dataHash,
    flags: Object.freeze([...flags]),
    ...(marketConfig ? { marketConfig } : {}),
  };
  return { ok: true, compiled: Object.freeze(compiled) };
}

/** Like {@link tryCompileProfile} but throws {@link ProfileCompileError}. */
export function compileProfile(content: { readonly parameters?: Readonly<Record<string, ParamValue>> }, flags: readonly string[], opts: CompileProfileOptions = {}): CompiledProfile {
  const r = tryCompileProfile(content, flags, opts);
  if (!r.ok) throw new ProfileCompileError(r.errors);
  return r.compiled;
}

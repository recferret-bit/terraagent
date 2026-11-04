import {
  MARKET_TOKENS, RESOURCE_KEYS, economyError, type EconomyError, type MarketTokenKey, type ParamValue, type QuoteToken, type ResourceKey,
} from '@terra/contracts';
import { canonical } from '../data/_hash';
import type { CompiledDataLike } from '../kernel/config';
import { defaultParamRegistry, validatePatch, type ParamRegistry, type WaveFlags } from './params';
import { sha256Hex } from './sha256';

/** Tradable pair of the planet book with the numbers an order is checked against (market atomic units as decimal strings). */
export interface PairConfig {
  readonly pair: string;
  readonly base: ResourceKey;
  readonly quote: QuoteToken;
  readonly lotUnits: number;
  readonly tickAtomic: string;
  readonly minNotionalAtomic: string;
  /** Decimals of the market atomic unit of the base and quote tokens (resources 0, USDC 6, NEAR 24). */
  readonly tokenDecimals: { readonly base: number; readonly quote: number };
}

/** The one immutable market configuration every host compiles from a pinned profile (W13-03, D-44). */
export interface MarketConfig {
  readonly policyVersion: string;
  /** `sha256:<hex>` of the canonical JSON of everything below it; equal hash means equal config on every host. */
  readonly policyHash: string;
  readonly platformFeeBp: number;
  readonly stallFeeMinBp: number;
  readonly stallFeeMaxBp: number;
  readonly stallFeeDefaultBp: number;
  readonly treasuryShareBp: number;
  readonly ttlOptionsS: readonly number[];
  readonly openOrderLimit: number;
  readonly baseLotUnits: number;
  readonly bookDepthLevels: number;
  readonly bookPushHz: number;
  readonly pairs: readonly PairConfig[];
}

export class MarketConfigError extends Error {
  constructor(readonly errors: readonly EconomyError[]) {
    super(`invalid market configuration: ${errors.map((e) => `${e.code}${e.path ? ` ${e.path}` : ''}`).join(', ')}`);
    this.name = 'MarketConfigError';
  }
}

export type MarketConfigResult = { ok: true; config: MarketConfig } | { ok: false; errors: EconomyError[] };

export interface CompileMarketConfigOptions {
  readonly registry?: ParamRegistry;
  /** Enabled waves; a market path of a disabled wave is rejected `wave_disabled`. Omitted: not checked. */
  readonly flags?: WaveFlags;
}

const PREFIX = 'market.';
const quoteRow = (q: QuoteToken): string => (q === 'USDC' || q === 'NEAR' ? `quote.${q}` : 'quote.resource');
const same = (a: unknown, b: unknown): boolean => canonical(a) === canonical(b);

/** Effective `market.*` values: registry defaults overlaid with `overrides`; unknown `market.*` override paths are kept for validation. */
function effective(registry: ParamRegistry, overrides: Readonly<Record<string, ParamValue>>): Record<string, ParamValue> {
  const out: Record<string, ParamValue> = {};
  for (const e of registry.list()) if (e.path.startsWith(PREFIX)) out[e.path] = e.default;
  for (const [p, v] of Object.entries(overrides)) if (p.startsWith(PREFIX)) out[p] = v;
  return out;
}

function validate(registry: ParamRegistry, values: Readonly<Record<string, ParamValue>>, flags?: WaveFlags): EconomyError[] {
  const ops = Object.entries(values)
    .filter(([p, v]) => !same(v, registry.get(p)?.default))
    .map(([path, value]) => ({ op: 'set' as const, path, value }));
  return validatePatch({ parameters: {} }, { schemaVersion: 1, requestId: 'market-config', expectedVersion: 1, ops }, flags, { registry });
}

function build(values: Readonly<Record<string, ParamValue>>): MarketConfig {
  const n = (f: string): number => values[`market.policy.${f}`] as number;
  const pairs: PairConfig[] = [];
  for (const base of RESOURCE_KEYS) {
    if (values[`market.resource.${base}.tradable`] !== true) continue;
    const quotes: QuoteToken[] = [...RESOURCE_KEYS.filter((k) => k !== base && values[`market.resource.${k}.tradable`] === true), 'USDC', 'NEAR'];
    for (const quote of quotes) {
      const q = quoteRow(quote);
      pairs.push({
        pair: `${base}/${quote}`, base, quote,
        lotUnits: values[`market.resource.${base}.lotUnits`] as number,
        tickAtomic: values[`market.${q}.tickAtomic`] as string,
        minNotionalAtomic: values[`market.${q}.minNotionalAtomic`] as string,
        tokenDecimals: { base: MARKET_TOKENS[base as MarketTokenKey].decimals, quote: MARKET_TOKENS[quote].decimals },
      });
    }
  }
  const body = {
    policyVersion: values['market.policy.policyVersion'] as string,
    platformFeeBp: n('platformFeeBp'), stallFeeMinBp: n('stallFeeMinBp'), stallFeeMaxBp: n('stallFeeMaxBp'),
    stallFeeDefaultBp: n('stallFeeDefaultBp'), treasuryShareBp: n('treasuryShareBp'),
    ttlOptionsS: [...(values['market.policy.ttlOptionsS'] as number[])],
    openOrderLimit: n('openOrderLimit'), baseLotUnits: n('baseLotUnits'), bookDepthLevels: n('bookDepthLevels'), bookPushHz: n('bookPushHz'),
    pairs,
  };
  const policyHash = `sha256:${sha256Hex(canonical(body))}`;
  return deepFreeze({ ...body, policyHash });
}

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object') for (const v of Object.values(o)) deepFreeze(v);
  return Object.freeze(o);
}

function resolve(values: Record<string, ParamValue>, opts: CompileMarketConfigOptions): MarketConfigResult {
  const registry = opts.registry ?? defaultParamRegistry();
  const errors = validate(registry, values, opts.flags);
  return errors.length > 0 ? { ok: false, errors } : { ok: true, config: build(values) };
}

/** Compiles a pinned profile's `parameters` (`market.*` overrides over the bootstrap defaults) without throwing. */
export function tryCompileMarketConfig(content: { readonly parameters?: Readonly<Record<string, ParamValue>> }, opts: CompileMarketConfigOptions = {}): MarketConfigResult {
  return resolve(effective(opts.registry ?? defaultParamRegistry(), content.parameters ?? {}), opts);
}

/** Like {@link tryCompileMarketConfig} but throws a {@link MarketConfigError} carrying the structured `EconomyError`s. */
export function compileMarketConfig(content: { readonly parameters?: Readonly<Record<string, ParamValue>> }, opts: CompileMarketConfigOptions = {}): MarketConfig {
  const r = tryCompileMarketConfig(content, opts);
  if (!r.ok) throw new MarketConfigError(r.errors);
  return r.config;
}

/** The `market` table of already compiled data (`compileData` applies profile overrides) as `market.<row>.<field>` values. */
export function marketValuesFromData(data: CompiledDataLike): Record<string, ParamValue> {
  const table = (data.tables.market ?? {}) as Record<string, Record<string, ParamValue>>;
  const out: Record<string, ParamValue> = {};
  for (const [row, fields] of Object.entries(table)) {
    for (const [field, v] of Object.entries(fields)) if (field !== 'id' && field !== 'wave') out[`${PREFIX}${row}.${field}`] = v;
  }
  return out;
}

const cache = new WeakMap<CompiledDataLike, MarketConfig>();
/**
 * The market config of a host's compiled data, validated and cached per data object. Throws {@link MarketConfigError}
 * (also when the W13 `market` rows are not compiled in, i.e. the wave is off).
 */
export function marketConfigFromData(data: CompiledDataLike, opts: CompileMarketConfigOptions = {}): MarketConfig {
  const hit = cache.get(data);
  if (hit) return hit;
  const values = marketValuesFromData(data);
  const missing = Object.keys(values).length === 0 ? [economyError('wave_disabled', 'the market table is not compiled (wave W13 off)', 'market')] : [];
  if (missing.length > 0) throw new MarketConfigError(missing);
  const config = compileMarketConfig({ parameters: values }, opts);
  cache.set(data, config);
  return config;
}

/** Config of one pair, or `undefined` when the pair is not tradable. */
export const pairConfigOf = (config: MarketConfig, base: ResourceKey, quote: QuoteToken): PairConfig | undefined =>
  config.pairs.find((p) => p.base === base && p.quote === quote);

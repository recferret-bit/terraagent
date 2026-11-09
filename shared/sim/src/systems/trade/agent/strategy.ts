import { RESOURCE_KEYS, type ResourceKey } from '@terra/contracts';
import type { Ratio } from '../../../economy/flows/ratio';
import { quoteColony } from './decide';
import type { AgentParams } from './params';
import type { AgentColonyInput, AgentQuotes } from './types';

export const AGENT_SPECIALISATIONS = ['balanced', 'miner', 'refiner', 'hydro', 'logistics', 'autarky'] as const;
export type AgentSpecialisation = (typeof AGENT_SPECIALISATIONS)[number];

export const AGENT_RISK_POSTURES = ['conservative', 'moderate', 'aggressive'] as const;
export type AgentRiskPosture = (typeof AGENT_RISK_POSTURES)[number];

export const AGENT_GOALS = ['surplus_export', 'shortfall_cover', 'reserve_build', 'self_sufficiency'] as const;
export type AgentGoal = (typeof AGENT_GOALS)[number];

export interface AgentResourceTarget {
  readonly reserve: bigint;
  readonly target: bigint;
  readonly keep: bigint;
  readonly planned?: bigint;
  readonly expectedOwn?: bigint;
  readonly ownUnitCost?: Ratio | null;
  readonly localUnitCost?: Ratio | null;
  readonly transportPerUnit?: Ratio | null;
}

/**
 * Strategy input chosen by an LLM or scripted policy (ECONOMY §15, W13-61).
 * Selects specialisation, reserve targets, risk posture, and high-level goals;
 * never contains a free price — the deterministic quote library computes all bids/asks.
 */
export interface AgentStrategyInput {
  readonly specialisation: AgentSpecialisation;
  readonly risk: AgentRiskPosture;
  readonly goals: readonly AgentGoal[];
  readonly reserveTargets: Partial<Record<ResourceKey, AgentResourceTarget>>;
  readonly maxOrderTtlS?: number;
}

export type StrategyValidationErrorCode =
  | 'free_price_forbidden'
  | 'invalid_strategy'
  | 'unknown_field'
  | 'invalid_specialisation'
  | 'invalid_risk'
  | 'invalid_goals'
  | 'invalid_resource'
  | 'invalid_target'
  | 'invalid_ttl';

export type StrategyValidationResult =
  | { readonly ok: true; readonly value: AgentStrategyInput }
  | { readonly ok: false; readonly code: StrategyValidationErrorCode; readonly field?: string; readonly message: string };

const FORBIDDEN_PRICE_KEYS = new Set([
  'price', 'bidprice', 'askprice', 'unitprice', 'limitprice', 'priceamount',
  'quoteprice', 'clearingprice', 'targetprice', 'minprice', 'maxprice',
  'notional', 'bid', 'ask', 'orders',
]);

const TOP_KEYS = new Set(['specialisation', 'risk', 'goals', 'reserveTargets', 'maxOrderTtlS']);
const TARGET_KEYS = new Set(['reserve', 'target', 'keep', 'planned', 'expectedOwn', 'ownUnitCost', 'localUnitCost', 'transportPerUnit']);
const RESOURCE_SET = new Set<string>(RESOURCE_KEYS);

function isForbiddenPriceKey(key: string): boolean {
  const lower = key.toLowerCase();
  return FORBIDDEN_PRICE_KEYS.has(lower) || lower.includes('price');
}

/** Recursively scans a raw strategy payload for any forbidden price/order field. */
export function findForbiddenPriceField(raw: unknown, prefix = ''): string | null {
  if (typeof raw !== 'object' || raw === null) return null;
  if (Array.isArray(raw)) {
    for (let i = 0; i < raw.length; i++) {
      const hit = findForbiddenPriceField(raw[i], `${prefix}[${i}]`);
      if (hit) return hit;
    }
    return null;
  }
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (isForbiddenPriceKey(k)) return path;
    const nested = findForbiddenPriceField(v, path);
    if (nested) return nested;
  }
  return null;
}

function parseNonNegBigInt(v: unknown): bigint | null {
  if (typeof v === 'bigint') return v >= 0n ? v : null;
  if (typeof v === 'number') return Number.isSafeInteger(v) && v >= 0 ? BigInt(v) : null;
  if (typeof v === 'string' && /^(0|[1-9]\d*)$/.test(v)) return BigInt(v);
  return null;
}

function parseRatio(v: unknown): Ratio | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v === 'string') {
    const m = /^(0|[1-9]\d*)(?:\/([1-9]\d*))?$/.exec(v);
    if (!m) return undefined;
    return { num: BigInt(m[1]!), den: BigInt(m[2] ?? '1') };
  }
  if (typeof v === 'object' && !Array.isArray(v)) {
    const obj = v as Record<string, unknown>;
    if (Object.keys(obj).some((k) => k !== 'num' && k !== 'den')) return undefined;
    const num = parseNonNegBigInt(obj.num);
    const den = parseNonNegBigInt(obj.den ?? 1n);
    if (num === null || den === null || den <= 0n) return undefined;
    return { num, den };
  }
  return undefined;
}

function parseResourceTarget(res: string, raw: unknown): Extract<StrategyValidationResult, { readonly ok: false }> | { readonly ok: true; readonly target: AgentResourceTarget } {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, code: 'invalid_target', field: `reserveTargets.${res}`, message: `Target for ${res} must be an object.` };
  }
  const obj = raw as Record<string, unknown>;
  for (const k of Object.keys(obj)) {
    if (!TARGET_KEYS.has(k)) {
      return { ok: false, code: 'unknown_field', field: `reserveTargets.${res}.${k}`, message: `Unknown target field "${k}".` };
    }
  }
  const reserve = parseNonNegBigInt(obj.reserve ?? 0n);
  const target = parseNonNegBigInt(obj.target ?? obj.reserve ?? 0n);
  const keep = parseNonNegBigInt(obj.keep ?? obj.reserve ?? 0n);
  const planned = obj.planned === undefined ? undefined : parseNonNegBigInt(obj.planned);
  const expectedOwn = obj.expectedOwn === undefined ? undefined : parseNonNegBigInt(obj.expectedOwn);
  if (reserve === null || target === null || keep === null || planned === null || expectedOwn === null || target < reserve) {
    return { ok: false, code: 'invalid_target', field: `reserveTargets.${res}`, message: `Target quantities for ${res} must be non-negative whole units with target >= reserve.` };
  }
  const ownUnitCost = parseRatio(obj.ownUnitCost);
  const localUnitCost = parseRatio(obj.localUnitCost);
  const transportPerUnit = parseRatio(obj.transportPerUnit);
  if ((obj.ownUnitCost !== undefined && ownUnitCost === undefined) || (obj.localUnitCost !== undefined && localUnitCost === undefined) || (obj.transportPerUnit !== undefined && transportPerUnit === undefined)) {
    return { ok: false, code: 'invalid_target', field: `reserveTargets.${res}`, message: `Cost ratios for ${res} must be non-negative rationals with a positive denominator.` };
  }
  return {
    ok: true,
    target: {
      reserve, target, keep,
      ...(planned === undefined ? {} : { planned }),
      ...(expectedOwn === undefined ? {} : { expectedOwn }),
      ...(ownUnitCost === undefined ? {} : { ownUnitCost }),
      ...(localUnitCost === undefined ? {} : { localUnitCost }),
      ...(transportPerUnit === undefined ? {} : { transportPerUnit }),
    },
  };
}

/** Validates an untrusted LLM/bot strategy object and rejects any free price (`free_price_forbidden`). */
export function validateAgentStrategy(raw: unknown): StrategyValidationResult {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, code: 'invalid_strategy', message: 'Strategy must be a JSON object.' };
  }
  const forbidden = findForbiddenPriceField(raw);
  if (forbidden) {
    return { ok: false, code: 'free_price_forbidden', field: forbidden, message: `Free price field "${forbidden}" is forbidden; the quote library computes all prices.` };
  }
  const obj = raw as Record<string, unknown>;
  for (const k of Object.keys(obj)) {
    if (!TOP_KEYS.has(k)) return { ok: false, code: 'unknown_field', field: k, message: `Unknown strategy field "${k}".` };
  }
  if (typeof obj.specialisation !== 'string' || !(AGENT_SPECIALISATIONS as readonly string[]).includes(obj.specialisation)) {
    return { ok: false, code: 'invalid_specialisation', field: 'specialisation', message: 'Invalid specialisation.' };
  }
  if (typeof obj.risk !== 'string' || !(AGENT_RISK_POSTURES as readonly string[]).includes(obj.risk)) {
    return { ok: false, code: 'invalid_risk', field: 'risk', message: 'Invalid risk posture.' };
  }
  if (!Array.isArray(obj.goals) || obj.goals.length === 0 || obj.goals.some((g) => typeof g !== 'string' || !(AGENT_GOALS as readonly string[]).includes(g))) {
    return { ok: false, code: 'invalid_goals', field: 'goals', message: 'goals must be a non-empty list of valid agent goals.' };
  }
  if (typeof obj.reserveTargets !== 'object' || obj.reserveTargets === null || Array.isArray(obj.reserveTargets)) {
    return { ok: false, code: 'invalid_target', field: 'reserveTargets', message: 'reserveTargets must be a map of resource targets.' };
  }
  const reserveTargets: Partial<Record<ResourceKey, AgentResourceTarget>> = {};
  for (const [res, tRaw] of Object.entries(obj.reserveTargets as Record<string, unknown>)) {
    if (!RESOURCE_SET.has(res)) return { ok: false, code: 'invalid_resource', field: `reserveTargets.${res}`, message: `Unknown resource "${res}".` };
    const parsed = parseResourceTarget(res, tRaw);
    if (!parsed.ok) return parsed;
    reserveTargets[res as ResourceKey] = parsed.target;
  }
  let maxOrderTtlS: number | undefined;
  if (obj.maxOrderTtlS !== undefined) {
    if (typeof obj.maxOrderTtlS !== 'number' || !Number.isInteger(obj.maxOrderTtlS) || obj.maxOrderTtlS < 60 || obj.maxOrderTtlS > 86_400) {
      return { ok: false, code: 'invalid_ttl', field: 'maxOrderTtlS', message: 'maxOrderTtlS must be an integer in 60..86400.' };
    }
    maxOrderTtlS = obj.maxOrderTtlS;
  }
  return {
    ok: true,
    value: {
      specialisation: obj.specialisation as AgentSpecialisation,
      risk: obj.risk as AgentRiskPosture,
      goals: [...new Set(obj.goals as AgentGoal[])],
      reserveTargets,
      ...(maxOrderTtlS === undefined ? {} : { maxOrderTtlS }),
    },
  };
}

/** Projects a validated strategy onto a colony's state input for the deterministic quote library. */
export function applyStrategyToColonyInput(strategy: AgentStrategyInput, base: AgentColonyInput): AgentColonyInput {
  const t = strategy.reserveTargets[base.resource];
  const scale = strategy.risk === 'conservative' ? { num: 5n, den: 4n } : strategy.risk === 'aggressive' ? { num: 3n, den: 4n } : { num: 1n, den: 1n };
  const reserve = ((t?.reserve ?? base.need.reserve) * scale.num) / scale.den;
  const keepUnits = ((t?.keep ?? base.keepUnits) * scale.num) / scale.den;
  const target = t ? (t.target > reserve ? t.target : reserve) : (base.target > reserve ? base.target : reserve);
  return {
    ...base,
    need: {
      planned: t?.planned ?? base.need.planned,
      reserve,
      available: base.need.available,
      expectedOwn: t?.expectedOwn ?? base.need.expectedOwn,
    },
    target,
    keepUnits,
    ownUnitCost: t?.ownUnitCost !== undefined ? t.ownUnitCost : base.ownUnitCost,
    transportPerUnit: t?.transportPerUnit !== undefined ? t.transportPerUnit : base.transportPerUnit,
    walkAway: {
      ...base.walkAway,
      localUnitCost: t?.localUnitCost !== undefined ? t.localUnitCost : base.walkAway.localUnitCost,
    },
  };
}

/** Computes deterministic quotes from a validated strategy + colony state, gating bid/ask sides by the strategy's goals. */
export function quoteColonyWithStrategy(strategy: AgentStrategyInput, base: AgentColonyInput, params: AgentParams): AgentQuotes {
  const adjustedParams: AgentParams = strategy.risk === 'conservative'
    ? { ...params, reserveMarginBp: params.reserveMarginBp + 200, minSavingBp: params.minSavingBp + 100 }
    : strategy.risk === 'aggressive'
      ? { ...params, reserveMarginBp: Math.max(0, params.reserveMarginBp - 100), minSavingBp: Math.max(0, params.minSavingBp - 100) }
      : params;
  const quotes = quoteColony(applyStrategyToColonyInput(strategy, base), adjustedParams);
  const allowBid = strategy.goals.includes('shortfall_cover') || strategy.goals.includes('reserve_build');
  const allowAsk = strategy.goals.includes('surplus_export') && strategy.specialisation !== 'autarky';
  return {
    basis: quotes.basis,
    mid: quotes.mid,
    bid: allowBid ? quotes.bid : null,
    ask: allowAsk ? quotes.ask : null,
    bidReasons: allowBid ? quotes.bidReasons : [...quotes.bidReasons],
    askReasons: allowAsk ? quotes.askReasons : [...quotes.askReasons],
  };
}

export const SCRIPTED_STRATEGIES: Readonly<Record<string, unknown>> = {
  scripted: {
    specialisation: 'balanced',
    risk: 'moderate',
    goals: ['surplus_export', 'shortfall_cover'],
    reserveTargets: {
      'bio.water': {
        reserve: '100', target: '250', keep: '100', planned: '150', expectedOwn: '50',
        ownUnitCost: '10000/1', localUnitCost: '40000/1', transportPerUnit: '0/1',
      },
      'metals.t1': {
        reserve: '50', target: '150', keep: '50', planned: '80', expectedOwn: '20',
        ownUnitCost: '20000/1', localUnitCost: '60000/1', transportPerUnit: '0/1',
      },
    },
    maxOrderTtlS: 3600,
  },
  exporter: {
    specialisation: 'hydro',
    risk: 'conservative',
    goals: ['surplus_export'],
    reserveTargets: {
      'bio.water': {
        reserve: '50', target: '100', keep: '50',
        ownUnitCost: '10000/1', transportPerUnit: '0/1',
      },
    },
    maxOrderTtlS: 3600,
  },
};

export function resolveStrategyArg(spec: string): AgentStrategyInput {
  const raw = SCRIPTED_STRATEGIES[spec] ?? (spec.trim().startsWith('{') ? JSON.parse(spec) : null);
  if (!raw) throw new Error(`Unknown strategy "${spec}". Pass --strategy scripted|exporter or a JSON strategy object.`);
  const validated = validateAgentStrategy(raw);
  if (!validated.ok) throw new Error(`Invalid strategy (${validated.code}): ${validated.message}`);
  return validated.value;
}

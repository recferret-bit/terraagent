import type { OrderSide, QuoteToken, ResourceKey } from '@terra/contracts';
import type { CompiledDataLike } from '../../kernel/config';
import type { ColonyState } from '../../kernel/state';

/** Compiled `market.policy` (+ `market.quote.*`) numbers the sim checks; balance values live only in `data/market.ts` (D-35). */
export interface MarketPolicy {
  platformFeeBp: number;
  stallFeeMinBp: number;
  stallFeeMaxBp: number;
  stallFeeDefaultBp: number;
  ttlOptionsS: readonly number[];
  openOrderLimit: number;
  baseLotUnits: number;
}

export type MarketResourceAmounts = Partial<Record<ResourceKey, number>>;

/** One order the market module reserved for this colony (the sim mirror; the server DB is authoritative). */
export interface ColonyOpenOrder {
  side: OrderSide;
  resource: ResourceKey;
  amount: number;
  orderId?: string;
  reserved: MarketResourceAmounts;
}

export interface ColonyLastTrade {
  tradeId: string;
  role: 'buyer' | 'seller' | 'stall';
  base: ResourceKey;
  amount: number;
  quote: QuoteToken;
  atTick: number;
}

/** `colony.market`: HUD mirror of the colony's market state. Never holds USDC/NEAR and never moves sim stock. */
export interface ColonyMarketState {
  orderSeq: number;
  hubFeeBp: number;
  reservedInOrbit: MarketResourceAmounts;
  openOrders: Record<string, ColonyOpenOrder>;
  /** Accepted `market.placeOrder` requests not yet reserved by the module (bounded; moved into `openOrders` on `market.reserve`). */
  requested: Record<string, Pick<ColonyOpenOrder, 'side' | 'resource' | 'amount'>>;
  /** Bounded FIFO of `${tradeId}:${role}` already applied by `market.settled` (idempotent replay). */
  settledTrades: string[];
  lastTrade?: ColonyLastTrade;
}

/** Hard bounds of the mirror (a misbehaving module cannot grow colony state without limit). */
export const MAX_TRACKED_SETTLED_TRADES = 64;
export const MAX_MIRRORED_OPEN_ORDERS_FACTOR = 4;

const FALLBACK_POLICY: MarketPolicy = {
  platformFeeBp: 100, stallFeeMinBp: 0, stallFeeMaxBp: 100, stallFeeDefaultBp: 100,
  ttlOptionsS: [900, 3600, 21600, 86400], openOrderLimit: 20, baseLotUnits: 1,
};

type Table = Record<string, Record<string, unknown> | undefined>;

/** Reads `market.policy` from compiled data (fallbacks mirror the bootstrap row only for hosts compiled without W13). */
export function readMarketPolicy(data: CompiledDataLike): MarketPolicy {
  const row = (data.tables.market as Table | undefined)?.policy;
  const num = (k: keyof MarketPolicy): number => {
    const v = row?.[k];
    return typeof v === 'number' && Number.isFinite(v) ? v : (FALLBACK_POLICY[k] as number);
  };
  const ttl = row?.ttlOptionsS;
  return {
    platformFeeBp: num('platformFeeBp'),
    stallFeeMinBp: num('stallFeeMinBp'),
    stallFeeMaxBp: num('stallFeeMaxBp'),
    stallFeeDefaultBp: num('stallFeeDefaultBp'),
    ttlOptionsS: Array.isArray(ttl) ? (ttl as number[]) : FALLBACK_POLICY.ttlOptionsS,
    openOrderLimit: num('openOrderLimit'),
    baseLotUnits: Math.max(1, num('baseLotUnits')),
  };
}

/** Minimum notional (market atomic units) of a quote token (`quote.USDC`, `quote.NEAR`, `quote.resource`). */
export function readMinNotionalAtomic(data: CompiledDataLike, quote: QuoteToken): bigint {
  const id = quote === 'USDC' || quote === 'NEAR' ? `quote.${quote}` : 'quote.resource';
  const v = (data.tables.market as Table | undefined)?.[id]?.minNotionalAtomic;
  return typeof v === 'string' && /^\d+$/.test(v) ? BigInt(v) : 1n;
}

/** Ensures `colony.market` is a well-formed `ColonyMarketState` (same pattern as `ensureColonyCargoState`). */
export function ensureColonyMarketState(colony: ColonyState, data?: CompiledDataLike): ColonyMarketState {
  const raw = ((colony.market && typeof colony.market === 'object' && !Array.isArray(colony.market)) ? colony.market : {}) as Record<string, unknown>;
  if (typeof raw.orderSeq !== 'number' || !Number.isFinite(raw.orderSeq) || raw.orderSeq < 0) raw.orderSeq = 0;
  else raw.orderSeq = Math.floor(raw.orderSeq);
  if (typeof raw.hubFeeBp !== 'number' || !Number.isFinite(raw.hubFeeBp)) {
    raw.hubFeeBp = (data ? readMarketPolicy(data) : FALLBACK_POLICY).stallFeeDefaultBp;
  }
  for (const k of ['reservedInOrbit', 'openOrders', 'requested'] as const) {
    if (!raw[k] || typeof raw[k] !== 'object' || Array.isArray(raw[k])) raw[k] = {};
  }
  if (!Array.isArray(raw.settledTrades)) raw.settledTrades = [];
  colony.market = raw;
  return raw as unknown as ColonyMarketState;
}

/** Adds `sign × deltas` to `target`, clamping every key at 0 and dropping zero keys. */
export function addAmounts(target: MarketResourceAmounts, deltas: MarketResourceAmounts, sign: 1 | -1): void {
  for (const [k, v] of Object.entries(deltas) as [ResourceKey, number][]) {
    if (!Number.isFinite(v)) continue;
    const next = Math.max(0, (target[k] ?? 0) + sign * v);
    if (next === 0) delete target[k];
    else target[k] = next;
  }
}

export const sumAmounts = (a: MarketResourceAmounts): number => Object.values(a).reduce((s: number, v) => s + (v ?? 0), 0);

/** Keeps the mirror's `openOrders` map bounded: evicts the oldest entries (insertion order). */
export function boundOpenOrders(m: ColonyMarketState, policy: MarketPolicy): void {
  const max = policy.openOrderLimit * MAX_MIRRORED_OPEN_ORDERS_FACTOR;
  for (const map of [m.openOrders, m.requested] as Record<string, unknown>[]) {
    const keys = Object.keys(map);
    for (let i = 0; i < keys.length - max; i++) delete map[keys[i]];
  }
}

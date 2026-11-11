import type { Fill } from '@terra/sim/systems/trade/market-matcher';
import type { MarketOrderRecord } from '../../book/market-order.record.js';
import type { FundingBucket } from '../funding/exposure.js';
import { quoteSeqOf } from '../offers/quote-row.js';
import { departOf, quoteRef, type GuildOrderIntent } from './plan.js';

/** One guild-side fill. `side` is the NPC's. `amount` is whole base units added to or removed from the cache. */
export interface GuildFillNotice {
  readonly npcId: string;
  readonly planetId: string;
  readonly base: string;
  readonly quote: string;
  readonly side: 'buy' | 'sell';
  readonly amount: number;
  readonly orderId: string;
  readonly reserve: bigint;
  readonly orderAmount: bigint;
  readonly departAt: number;
  readonly quoteSeq: number;
}

export interface OrderMeta {
  readonly reserve: bigint;
  readonly departAt: number;
  readonly quoteSeq: number;
  readonly orderAmount: bigint;
  readonly bucket: FundingBucket;
}

export interface RequoteReport {
  readonly requoted: boolean;
  readonly reason?: string;
  readonly orderId?: string;
  readonly quoteSeq?: number;
  readonly bid?: bigint;
  readonly previousOrderId?: string;
}

const ATOMIC = /^(0|[1-9]\d*)$/;

/** True when stored loss is already at the policy ceiling. Only a new bid is refused. */
export function lossBlocksBid(lossAtomic: string | undefined, ceiling: string | undefined): boolean {
  if (!lossAtomic || !ceiling || !ATOMIC.test(lossAtomic) || !ATOMIC.test(ceiling)) return false;
  const cap = BigInt(ceiling);
  return cap > 0n && BigInt(lossAtomic) >= cap;
}

/** Funding units a fill turns from reserved into spent. The whole hold moves when the fill covers the order. */
export function consumedHold(reserve: bigint, orderAmount: bigint, qty: bigint): bigint {
  if (reserve <= 0n || qty <= 0n || orderAmount <= 0n) return 0n;
  if (qty >= orderAmount) return reserve;
  return (reserve * qty) / orderAmount;
}

/** The same intent on a new quote sequence, so the order id changes and the previous offer id expires. */
export function withQuoteSeq(intent: GuildOrderIntent, quoteSeq: number): GuildOrderIntent {
  return {
    ...intent,
    quoteSeq,
    ref: quoteRef(intent.npcId, intent.planetId, intent.base, intent.side, intent.departAt, quoteSeq),
  };
}

export function reserveFrom(value: unknown): bigint {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 0n;
  const raw = (value as { reserve?: unknown }).reserve;
  return typeof raw === 'string' && ATOMIC.test(raw) ? BigInt(raw) : 0n;
}

export function bucketFrom(value: unknown): FundingBucket {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'inventory';
  return (value as { bucket?: unknown }).bucket === 'cash' ? 'cash' : 'inventory';
}

/** Reserve, depart time and sequence stored on a guild order row. */
export function termsMeta(signedTerms: unknown, ref: string, amount: bigint): OrderMeta {
  const parsed = departOf(ref);
  const seq = quoteSeqOf(signedTerms as Parameters<typeof quoteSeqOf>[0]);
  return {
    reserve: reserveFrom(signedTerms),
    departAt: parsed?.departAt ?? 0,
    quoteSeq: seq || parsed?.quoteSeq || 0,
    orderAmount: amount,
    bucket: bucketFrom(signedTerms),
  };
}

/** The NPC leg of one matcher fill. A player-only fill is null. The caller fills reserve from the row. */
export function noticeFromFill(
  fill: Fill,
  orders: readonly (MarketOrderRecord | null)[],
): GuildFillNotice | null {
  const npc = [fill.makerOrderId, fill.takerOrderId]
    .map((id) => orders.find((row) => row?.orderId === id) ?? null)
    .find((row) => row && (row.actorKind === 'npc' || row.actorKind === 'guild'));
  if (!npc || (npc.side !== 'buy' && npc.side !== 'sell')) return null;
  if (fill.qty <= 0n || fill.qty > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  const parsed = departOf(npc.ref);
  return {
    npcId: npc.colonyId,
    planetId: npc.planetId,
    base: npc.base,
    quote: npc.quote,
    side: npc.side,
    amount: Number(fill.qty),
    orderId: npc.orderId,
    reserve: 0n,
    orderAmount: npc.amount,
    departAt: parsed?.departAt ?? 0,
    quoteSeq: parsed?.quoteSeq ?? 0,
  };
}

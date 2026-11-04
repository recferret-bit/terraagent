import { planParties as planSharedParties, type SettleParty } from '@terra/sim/systems/trade/market-parties';
import type { TradeBatch } from '@terra/sim/systems/trade/market-batch';
import type { MarketOrderRecord } from '../book/market-order.record.js';

export type { ResourceAmounts, SettleParty } from '@terra/sim/systems/trade/market-parties';

/** What one fill did to one order, so a final failure can undo exactly that (later fills of the same order stay). */
export interface OrderRollback {
  readonly orderId: string;
  readonly qty: string;
  readonly notional: string;
  /** Reservation the fill consumed or freed (principal / fees); restored when the order is executable again. */
  readonly restorePrincipal: string;
  readonly restoreFees: string;
  /** Per fee bucket key: what the fill added to `base` and `fee`. */
  readonly buckets: Record<string, { base: string; fee: string }>;
}

/** Stored in the outbox payload so the FINAL step needs nothing but the row (also after a restart). */
export interface TradePlan {
  readonly tradeId: string;
  readonly planetId: string;
  readonly base: string;
  readonly quote: string;
  readonly qty: number;
  readonly notional: string;
  readonly platformFee: string;
  readonly stallFee: string;
  readonly stallFeeBp: number;
  readonly makerSide: 'buy' | 'sell';
  readonly pair: string;
  readonly organic: boolean;
  /** Who rested the maker order (`player`, `npc`, `fixture`); absent on plans written before W13-29. */
  readonly makerKind?: string;
  /** Treasury share carved out of `platformFee` (0 while W22 is off), decimal string; absent = 0. */
  readonly treasuryFee?: string;
  readonly parties: SettleParty[];
  readonly rollback: OrderRollback[];
}

/** Pure: the three parties of a fill (buyer, seller, maker stall); the rule is the shared `planParties` the experiment harness uses. */
export const planParties = (batch: TradeBatch, buyer: MarketOrderRecord, seller: MarketOrderRecord, maker: MarketOrderRecord): SettleParty[] =>
  planSharedParties(batch, buyer, seller, maker);

const sub = (a: string, b: string): string => (BigInt(a) - BigInt(b)).toString();

/** Pure: the delta between an order before the fill (`pre`) and after it (`u`). */
export function rollbackOf(pre: MarketOrderRecord, u: TradeBatch['buyer']): OrderRollback {
  const buckets: OrderRollback['buckets'] = {};
  for (const [k, post] of Object.entries(u.feeBuckets)) {
    const before = pre.feeBuckets[k] ?? { base: '0', fee: '0' };
    if (post.base !== before.base || post.fee !== before.fee) buckets[k] = { base: sub(post.base, before.base), fee: sub(post.fee, before.fee) };
  }
  return {
    orderId: pre.orderId, qty: (u.filled - pre.filled).toString(), notional: (u.cumNotional - pre.cumNotional).toString(),
    restorePrincipal: (pre.reservedPrincipal - u.reservedPrincipal).toString(), restoreFees: (pre.reservedFees - u.reservedFees).toString(), buckets,
  };
}

import { isResourceToken, type MarketTokenKey } from '@terra/contracts';
import type { TradeBatch } from '@terra/sim/systems/trade/market-batch';
import type { MarketOrderRecord } from '../book/market-order.record.js';

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

export type ResourceAmounts = Record<string, number>;

/** What one colony's sim mirror receives for a FINAL trade (`market.settled`): whole-unit in-orbit deltas and consumed reservations. */
export interface SettleParty {
  readonly role: 'buyer' | 'seller' | 'stall';
  readonly colonyId: string;
  readonly colonyIndex: number | null;
  readonly ref: string | null;
  readonly deltas: ResourceAmounts;
  readonly released: ResourceAmounts;
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

const isRes = (t: string): boolean => isResourceToken(t as MarketTokenKey);
const add = (m: ResourceAmounts, token: string, n: bigint): void => {
  if (n !== 0n && isRes(token)) m[token] = (m[token] ?? 0) + Number(n);
};

/** Pure: the three parties of a fill (buyer, seller, maker stall). Cash tokens never touch the sim mirror. */
export function planParties(batch: TradeBatch, buyer: MarketOrderRecord, seller: MarketOrderRecord, maker: MarketOrderRecord): SettleParty[] {
  const b: ResourceAmounts = {}, bRel: ResourceAmounts = {};
  add(b, batch.base, batch.qty);
  add(b, batch.quote, -(batch.notional + batch.platformFee + batch.stallFee));
  add(bRel, batch.quote, batch.notional + batch.platformFee + batch.stallFee + batch.buyer.releasePrincipal + batch.buyer.releaseFees);
  const s: ResourceAmounts = {}, sRel: ResourceAmounts = {};
  add(s, batch.base, -batch.qty);
  add(s, batch.quote, batch.notional);
  add(sRel, batch.base, batch.qty + batch.seller.releasePrincipal);
  const parties: SettleParty[] = [
    { role: 'buyer', colonyId: buyer.colonyId, colonyIndex: buyer.colonyIndex, ref: buyer.ref, deltas: b, released: bRel },
    { role: 'seller', colonyId: seller.colonyId, colonyIndex: seller.colonyIndex, ref: seller.ref, deltas: s, released: sRel },
  ];
  if (batch.stallFee > 0n) {
    const st: ResourceAmounts = {};
    add(st, batch.quote, batch.stallFee);
    parties.push({ role: 'stall', colonyId: maker.stallColonyId, colonyIndex: maker.stallColonyId === maker.colonyId ? maker.colonyIndex : null, ref: null, deltas: st, released: {} });
  }
  return parties;
}

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

import { describe, expect, it } from 'vitest';
import { OrderBook } from '../../src/systems/trade/market-book';
import { matchIncoming, type MatchableOrder } from '../../src/systems/trade/market-matcher';

let n = 0n;
const mk = (side: 'buy' | 'sell', amount: bigint, price: bigint, over: Partial<MatchableOrder> = {}): MatchableOrder => {
  n += 1n;
  return {
    orderId: `o${n}`, seq: n, side, colonyId: `c${n}`, amount, filled: 0n, priceAmount: price,
    fillPolicy: 'partial', policyVersion: 'v1', platformFeeBp: 100, stallFeeBp: 50, maxStallFeeBp: side === 'buy' ? 100 : null, ...over,
  };
};
const bookOf = (...os: MatchableOrder[]): OrderBook<MatchableOrder> => {
  const b = new OrderBook<MatchableOrder>('metals.t1/USDC');
  os.forEach((o) => b.add(o));
  return b;
};

describe('matchIncoming', () => {
  it('ask 200 @0.40 vs bid 100 @0.45 -> one fill of 100 @0.40, 100 left on the ask', () => {
    const ask = mk('sell', 200n, 80n);
    const bid = mk('buy', 100n, 45n);
    const r = matchIncoming(bookOf(ask), bid);
    expect(r.fills).toHaveLength(1);
    expect(r.fills[0]).toMatchObject({ makerOrderId: ask.orderId, takerOrderId: bid.orderId, makerSide: 'sell', qty: 100n, price: { num: 80n, den: 200n } });
    expect(r.restingRemainder).toBe(0n);
    expect(remaining(ask, r.fills[0]!.qty)).toBe(100n);
  });
  const remaining = (o: MatchableOrder, q: bigint): bigint => o.amount - o.filled - q;

  it('never matches the same colony, but a later other-colony order still does', () => {
    const own = mk('sell', 100n, 40n, { colonyId: 'me' });
    const other = mk('sell', 100n, 42n);
    const r = matchIncoming(bookOf(own, other), mk('buy', 100n, 50n, { colonyId: 'me' }));
    expect(r.fills.map((f) => f.makerOrderId)).toEqual([other.orderId]);
  });

  it('sweeps levels in price-time order and stops at the limit', () => {
    const a1 = mk('sell', 10n, 5n); // 0.5
    const a2 = mk('sell', 10n, 4n); // 0.4
    const a3 = mk('sell', 10n, 4n); // 0.4 later
    const a4 = mk('sell', 10n, 9n); // 0.9 beyond limit
    const r = matchIncoming(bookOf(a1, a2, a3, a4), mk('buy', 35n, 20n)); // limit 0.571
    expect(r.fills.map((f) => [f.makerOrderId, f.qty])).toEqual([[a2.orderId, 10n], [a3.orderId, 10n], [a1.orderId, 10n]]);
    expect(r.restingRemainder).toBe(5n);
  });

  it('skips incompatible policy versions and fee terms', () => {
    const v2 = mk('sell', 10n, 4n, { policyVersion: 'v2' });
    const fee = mk('sell', 10n, 4n, { platformFeeBp: 50 });
    const ok = mk('sell', 10n, 5n);
    const r = matchIncoming(bookOf(v2, fee, ok), mk('buy', 10n, 10n));
    expect(r.fills.map((f) => f.makerOrderId)).toEqual([ok.orderId]);
  });

  it('skips a maker stall above the buyer maximum; buyer-maker case', () => {
    const dear = mk('sell', 10n, 4n, { stallFeeBp: 200 });
    const fair = mk('sell', 10n, 5n, { stallFeeBp: 100 });
    expect(matchIncoming(bookOf(dear, fair), mk('buy', 10n, 10n, { maxStallFeeBp: 100 })).fills.map((f) => f.makerOrderId)).toEqual([fair.orderId]);
    const bid = mk('buy', 100n, 45n, { stallFeeBp: 20 });
    const sell = mk('sell', 50n, 20n, { stallFeeBp: 9999 }); // seller stall irrelevant
    const r = matchIncoming(bookOf(bid), sell);
    expect(r.fills[0]).toMatchObject({ makerSide: 'buy', makerOrderId: bid.orderId, buyerOrderId: bid.orderId, sellerOrderId: sell.orderId, qty: 50n, price: { num: 45n, den: 100n } });
  });

  it('all-or-nothing incoming fills only completely, else rests unfilled', () => {
    const a = mk('sell', 60n, 24n);
    const none = matchIncoming(bookOf(a), mk('buy', 100n, 45n, { fillPolicy: 'all_or_nothing' }));
    expect(none).toEqual({ fills: [], restingRemainder: 100n });
    const b = mk('sell', 40n, 16n);
    const full = matchIncoming(bookOf(a, b), mk('buy', 100n, 45n, { fillPolicy: 'all_or_nothing' }));
    expect(full.fills.map((f) => f.qty)).toEqual([60n, 40n]);
    expect(full.restingRemainder).toBe(0n);
  });

  it('a resting all-or-nothing maker is taken in full or skipped', () => {
    const aon = mk('sell', 100n, 40n, { fillPolicy: 'all_or_nothing' });
    const next = mk('sell', 100n, 45n);
    expect(matchIncoming(bookOf(aon, next), mk('buy', 50n, 50n)).fills.map((f) => f.makerOrderId)).toEqual([next.orderId]);
    const r = matchIncoming(bookOf(aon), mk('buy', 150n, 90n));
    expect(r.fills.map((f) => f.qty)).toEqual([100n]);
    expect(r.restingRemainder).toBe(50n);
  });

  it('accounts for already filled amounts and does not mutate the book', () => {
    const a = mk('sell', 100n, 40n, { filled: 70n });
    const b = bookOf(a);
    expect(matchIncoming(b, mk('buy', 100n, 100n)).fills[0]!.qty).toBe(30n);
    expect(b.get(a.orderId)).toBe(a);
  });
});

import { describe, expect, it } from 'vitest';
import { OrderBook, type RestingOrder } from '../../src/systems/trade/market-book';

let n = 0n;
const order = (side: 'buy' | 'sell', amount: bigint, priceAmount: bigint, over: Partial<RestingOrder> = {}): RestingOrder => {
  n += 1n;
  return { orderId: `o${n}`, seq: n, side, colonyId: 'c', amount, filled: 0n, priceAmount, ...over };
};
const ids = (os: RestingOrder[]): string[] => os.map((o) => o.orderId);

describe('OrderBook', () => {
  it('sorts bids high-first and asks low-first with seq ties', () => {
    const b = new OrderBook('water/USDC');
    const b1 = order('buy', 100n, 40n);
    const b2 = order('buy', 100n, 45n);
    const b3 = order('buy', 300n, 30n); // 0.10
    const b4 = order('buy', 30n, 1n); // 1/30
    const a1 = order('sell', 100n, 50n);
    const a2 = order('sell', 100n, 48n);
    const a3 = order('sell', 200n, 96n); // ties a2 (0.48), later seq
    for (const o of [b4, b1, b3, b2, a1, a3, a2]) b.add(o);
    expect(ids(b.orders('buy'))).toEqual([b2.orderId, b1.orderId, b3.orderId, b4.orderId]);
    expect(ids(b.orders('sell'))).toEqual([a2.orderId, a3.orderId, a1.orderId]);
    expect(b.bestBid()?.orderId).toBe(b2.orderId);
    expect(b.bestAsk()?.orderId).toBe(a2.orderId);
  });

  it('equal rationals 10/300 and 1/30 tie and order by seq', () => {
    const b = new OrderBook('water/USDC');
    const late = order('buy', 30n, 1n, { seq: 9n });
    const early = order('buy', 300n, 10n, { seq: 4n });
    b.add(late);
    b.add(early);
    expect(ids(b.orders('buy'))).toEqual([early.orderId, late.orderId]);
    expect(b.depth('buy', 5)).toEqual([{ num: '1', den: 30, amount: 330, orders: 2 }]);
  });

  it('walks the opposite side in priority order', () => {
    const b = new OrderBook('water/USDC');
    const a1 = order('sell', 10n, 20n);
    const a2 = order('sell', 10n, 10n);
    b.add(a1);
    b.add(a2);
    expect(ids([...b.opposite('buy')])).toEqual([a2.orderId, a1.orderId]);
    expect(ids([...b.opposite('sell')])).toEqual([]);
  });

  it('update keeps position, full fill removes, remove works', () => {
    const b = new OrderBook('water/USDC');
    const x = order('sell', 10n, 10n);
    const y = order('sell', 10n, 10n);
    b.add(x);
    b.add(y);
    b.update(x.orderId, 4n);
    expect(b.bestAsk()?.orderId).toBe(x.orderId);
    expect(b.bestAsk()?.filled).toBe(4n);
    b.update(x.orderId, 10n);
    expect(b.has(x.orderId)).toBe(false);
    expect(b.bestAsk()?.orderId).toBe(y.orderId);
    expect(b.remove(y.orderId)?.orderId).toBe(y.orderId);
    expect(b.size).toBe(0);
    expect(() => b.update('nope', 1n)).not.toThrow();
  });

  it('depth aggregates equal prices, uses remaining, limits levels', () => {
    const b = new OrderBook('water/USDC');
    b.add(order('sell', 100n, 40n));
    b.add(order('sell', 50n, 20n, { filled: 10n }));
    b.add(order('sell', 100n, 45n));
    b.add(order('sell', 100n, 50n));
    expect(b.depth('sell', 2)).toEqual([
      { num: '2', den: 5, amount: 140, orders: 2 },
      { num: '9', den: 20, amount: 100, orders: 1 },
    ]);
    expect(b.depth('sell', 10)).toHaveLength(3);
    expect(b.depth('buy', 3)).toEqual([]);
  });
});

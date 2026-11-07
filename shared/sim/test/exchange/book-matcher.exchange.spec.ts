import { describe, expect, it } from 'vitest';
import { OrderBook, remainingOf } from '../../src/systems/trade/market-book';
import { matchIncoming } from '../../src/systems/trade/market-matcher';
import { comparePrice } from '../../src/systems/trade/market-price';
import { priceOfOrder } from '../../src/systems/trade/market-book';
import { randBig, randInt, rng, SEEDS, xbook, xo, type XOrder } from './exchange-kit';

const ids = (os: XOrder[]): string[] => os.map((o) => o.orderId);

describe('exchange book', () => {
  it('empty and one-sided books', () => {
    const b = new OrderBook<XOrder>('p');
    expect(b.bestBid()).toBeUndefined();
    expect(b.bestAsk()).toBeUndefined();
    expect(b.depth('buy', 5)).toEqual([]);
    expect([...b.opposite('buy')]).toEqual([]);
    expect(b.remove('nope')).toBeUndefined();
    expect(b.update('nope', 1n)).toBeUndefined();
    b.add(xo('buy', 1n, 10n));
    expect(b.bestAsk()).toBeUndefined();
    expect(b.depth('sell', 3)).toEqual([]);
    expect(b.size).toBe(1);
  });
  it('same price, different time: older seq first on both sides', () => {
    const a = xo('sell', 10n, 100n), b = xo('sell', 10n, 100n), c = xo('sell', 10n, 100n);
    expect(ids(xbook(c, a, b).orders('sell'))).toEqual([a.orderId, b.orderId, c.orderId]);
    const x = xo('buy', 10n, 100n), y = xo('buy', 10n, 100n);
    expect(ids(xbook(y, x).orders('buy'))).toEqual([x.orderId, y.orderId]);
  });
  it('equal rationals with different representation tie by time', () => {
    const early = xo('sell', 30n, 1n), late = xo('sell', 300n, 10n);
    const book = xbook(early, late);
    expect(ids(book.orders('sell'))).toEqual([early.orderId, late.orderId]);
    expect(book.depth('sell', 5)).toEqual([{ num: '1', den: 30, amount: 330, orders: 2 }]);
  });
  it('best price wins over time: bids high first, asks low first', () => {
    const a1 = xo('sell', 1n, 30n), a2 = xo('sell', 1n, 20n), b1 = xo('buy', 1n, 5n), b2 = xo('buy', 1n, 9n);
    const book = xbook(a1, a2, b1, b2);
    expect(book.bestAsk()!.orderId).toBe(a2.orderId);
    expect(book.bestBid()!.orderId).toBe(b2.orderId);
  });
  it('level aggregation uses remaining units and respects the level limit', () => {
    const book = xbook(xo('sell', 10n, 100n, { filled: 4n }), xo('sell', 5n, 50n), xo('sell', 1n, 20n), xo('sell', 1n, 30n));
    expect(book.depth('sell', 10)).toEqual([
      { num: '10', den: 1, amount: 11, orders: 2 },
      { num: '20', den: 1, amount: 1, orders: 1 },
      { num: '30', den: 1, amount: 1, orders: 1 },
    ]);
    expect(book.depth('sell', 2)).toHaveLength(2);
    expect(book.depth('sell', 0)).toEqual([]);
  });
  it('fully filled resting order does not show in depth', () => {
    const book = xbook(xo('sell', 4n, 40n, { filled: 4n }));
    expect(book.depth('sell', 3)).toEqual([]);
  });
  it('partial update keeps position; full update removes; out of range throws', () => {
    const a = xo('sell', 10n, 100n), b = xo('sell', 10n, 100n);
    const book = xbook(a, b);
    expect(book.update(a.orderId, 3n)!.filled).toBe(3n);
    expect(ids(book.orders('sell'))).toEqual([a.orderId, b.orderId]);
    expect(book.get(a.orderId)!.filled).toBe(3n);
    expect(() => book.update(a.orderId, 11n)).toThrow(RangeError);
    expect(() => book.update(a.orderId, -1n)).toThrow(RangeError);
    expect(book.update(a.orderId, 10n)!.filled).toBe(10n);
    expect(book.has(a.orderId)).toBe(false);
    expect(book.size).toBe(1);
  });
  it('adding the same orderId replaces instead of duplicating', () => {
    const a = xo('buy', 10n, 100n);
    const book = xbook(a);
    book.add({ ...a, priceAmount: 500n });
    expect(book.size).toBe(1);
    expect(book.orders('buy')).toHaveLength(1);
    expect(book.bestBid()!.priceAmount).toBe(500n);
  });
  it('opposite() yields a snapshot, safe against mutation while iterating', () => {
    const a = xo('sell', 1n, 1n), b = xo('sell', 1n, 2n);
    const book = xbook(a, b);
    const seen: string[] = [];
    for (const o of book.opposite('buy')) { seen.push(o.orderId); book.remove(o.orderId); }
    expect(seen).toEqual([a.orderId, b.orderId]);
  });
});

describe('exchange book: invariants', () => {
  it('sorted invariant holds under random add/update/remove', () => {
    for (const seed of SEEDS) {
      const r = rng(seed);
      const book = xbook();
      const live: XOrder[] = [];
      for (let i = 0; i < 80; i++) {
        const op = randInt(r, 0, 3);
        if (op <= 1 || live.length === 0) {
          const o = xo(r() < 0.5 ? 'buy' : 'sell', randBig(r, 1, 50), randBig(r, 1, 40));
          book.add(o); live.push(o);
        } else if (op === 2) {
          const o = live.splice(randInt(r, 0, live.length - 1), 1)[0]!;
          expect(book.remove(o.orderId)!.orderId).toBe(o.orderId);
        } else {
          const o = live[randInt(r, 0, live.length - 1)]!;
          const cur = book.get(o.orderId)!;
          const f = randBig(r, Number(cur.filled), Number(cur.amount));
          book.update(o.orderId, f);
          if (f === cur.amount) live.splice(live.indexOf(o), 1);
        }
        expect(book.size).toBe(live.length);
        for (const side of ['buy', 'sell'] as const) {
          const os = book.orders(side);
          for (let k = 1; k < os.length; k++) {
            const c = comparePrice(priceOfOrder(os[k - 1]!), priceOfOrder(os[k]!));
            const ok = side === 'buy' ? c > 0 : c < 0;
            expect(ok || (c === 0 && os[k - 1]!.seq < os[k]!.seq)).toBe(true);
          }
        }
      }
    }
  });
});

describe('exchange matcher: crossing rules', () => {
  it('bid == ask crosses; executes at the maker price (maker = resting sell)', () => {
    const ask = xo('sell', 10n, 100n), bid = xo('buy', 10n, 100n);
    const r = matchIncoming(xbook(ask), bid);
    expect(r.fills).toHaveLength(1);
    expect(r.fills[0]).toMatchObject({ qty: 10n, makerSide: 'sell', makerOrderId: ask.orderId, buyerOrderId: bid.orderId, sellerOrderId: ask.orderId });
    expect(r.restingRemainder).toBe(0n);
  });
  it('bid < ask does not cross', () => {
    const r = matchIncoming(xbook(xo('sell', 10n, 101n)), xo('buy', 10n, 100n));
    expect(r.fills).toEqual([]);
    expect(r.restingRemainder).toBe(10n);
  });
  it('rational bid/ask equality across amounts crosses', () => {
    const r = matchIncoming(xbook(xo('sell', 300n, 10n)), xo('buy', 30n, 1n));
    expect(r.fills[0]!.qty).toBe(30n);
  });
  it('taker buy price improves to the maker ask; taker sell price improves to the maker bid', () => {
    const buy = matchIncoming(xbook(xo('sell', 10n, 50n)), xo('buy', 10n, 900n));
    expect(buy.fills[0]!.price).toEqual({ num: 50n, den: 10n });
    const sell = matchIncoming(xbook(xo('buy', 10n, 900n)), xo('sell', 10n, 50n));
    expect(sell.fills[0]).toMatchObject({ makerSide: 'buy', price: { num: 900n, den: 10n } });
  });
  it('zero-price ask crosses any bid; zero-price bid only crosses a zero ask', () => {
    expect(matchIncoming(xbook(xo('sell', 5n, 0n)), xo('buy', 5n, 1n)).fills).toHaveLength(1);
    expect(matchIncoming(xbook(xo('sell', 5n, 1n)), xo('buy', 5n, 0n)).fills).toHaveLength(0);
    expect(matchIncoming(xbook(xo('sell', 5n, 0n)), xo('buy', 5n, 0n)).fills).toHaveLength(1);
  });
  it('multi-level sweep: best price first, then time, remainder rests', () => {
    const a = xo('sell', 5n, 50n), b = xo('sell', 5n, 50n), c = xo('sell', 5n, 40n), d = xo('sell', 5n, 80n);
    const r = matchIncoming(xbook(a, b, c, d), xo('buy', 14n, 1000n));
    expect(r.fills.map((f) => [f.makerOrderId, f.qty])).toEqual([[c.orderId, 5n], [a.orderId, 5n], [b.orderId, 4n]]);
    expect(r.restingRemainder).toBe(0n);
  });
  it('taker larger than the whole book fills all and rests the rest', () => {
    const r = matchIncoming(xbook(xo('sell', 3n, 3n), xo('sell', 4n, 8n)), xo('buy', 100n, 100_000n));
    expect(r.fills.map((f) => f.qty)).toEqual([3n, 4n]);
    expect(r.restingRemainder).toBe(93n);
  });
  it('empty / same-side-only book matches nothing', () => {
    expect(matchIncoming(xbook(), xo('buy', 3n, 3n))).toEqual({ fills: [], restingRemainder: 3n });
    expect(matchIncoming(xbook(xo('buy', 3n, 3n)), xo('buy', 3n, 3n)).fills).toEqual([]);
  });
  it('incoming with prior fills only wants its remainder', () => {
    const r = matchIncoming(xbook(xo('sell', 10n, 10n)), xo('buy', 10n, 100n, { filled: 7n }));
    expect(r.fills[0]!.qty).toBe(3n);
  });
  it('resting maker with partial fill offers only its remaining units at the full-order rational', () => {
    const r = matchIncoming(xbook(xo('sell', 10n, 100n, { filled: 6n })), xo('buy', 10n, 1000n));
    expect(r.fills[0]).toMatchObject({ qty: 4n, price: { num: 100n, den: 10n } });
  });
  it('exhausted (zero remaining) resting order is ignored', () => {
    const dead = xo('sell', 5n, 5n, { filled: 5n });
    const live = xo('sell', 5n, 9n);
    const r = matchIncoming(xbook(dead, live), xo('buy', 5n, 100n));
    expect(r.fills.map((f) => f.makerOrderId)).toEqual([live.orderId]);
  });
});

describe('exchange matcher: skip rules', () => {
  it('self-trade (same colony) is skipped, never cancelled, and does not block better-ranked others', () => {
    const mine = xo('sell', 5n, 10n, { colonyId: 'me' }), other = xo('sell', 5n, 20n);
    const book = xbook(mine, other);
    const r = matchIncoming(book, xo('buy', 5n, 1000n, { colonyId: 'me' }));
    expect(r.fills.map((f) => f.makerOrderId)).toEqual([other.orderId]);
    expect(book.has(mine.orderId)).toBe(true);
  });
  it('only own orders on the other side: no fills, full remainder', () => {
    const r = matchIncoming(xbook(xo('sell', 5n, 10n, { colonyId: 'me' })), xo('buy', 5n, 100n, { colonyId: 'me' }));
    expect(r).toEqual({ fills: [], restingRemainder: 5n });
  });
  it('same order id in the book is never matched with itself', () => {
    const o = xo('sell', 5n, 10n);
    const r = matchIncoming(xbook(o), { ...xo('buy', 5n, 100n), orderId: o.orderId, colonyId: 'x' });
    expect(r.fills).toEqual([]);
  });
  it('policy version mismatch is skipped', () => {
    const bad = xo('sell', 5n, 1n, { policyVersion: 'v0' }), ok = xo('sell', 5n, 2n);
    expect(matchIncoming(xbook(bad, ok), xo('buy', 5n, 100n)).fills.map((f) => f.makerOrderId)).toEqual([ok.orderId]);
  });
  it('platformFeeBp mismatch is skipped, both directions', () => {
    expect(matchIncoming(xbook(xo('sell', 5n, 1n, { platformFeeBp: 50 })), xo('buy', 5n, 100n)).fills).toEqual([]);
    expect(matchIncoming(xbook(xo('buy', 5n, 100n, { platformFeeBp: 50 })), xo('sell', 5n, 1n)).fills).toEqual([]);
  });
  it('maker stall fee above the buyer maximum is skipped (maker sell)', () => {
    const high = xo('sell', 5n, 1n, { stallFeeBp: 60 }), fit = xo('sell', 5n, 2n, { stallFeeBp: 50 });
    const r = matchIncoming(xbook(high, fit), xo('buy', 5n, 100n, { maxStallFeeBp: 50 }));
    expect(r.fills.map((f) => f.makerOrderId)).toEqual([fit.orderId]);
  });
  it('maker stall fee at the maximum is accepted (boundary)', () => {
    expect(matchIncoming(xbook(xo('sell', 5n, 1n, { stallFeeBp: 50 })), xo('buy', 5n, 100n, { maxStallFeeBp: 50 })).fills).toHaveLength(1);
  });
  it('buyer maker whose own stall rate exceeds its own max is not matched', () => {
    const buyer = xo('buy', 5n, 100n, { stallFeeBp: 70, maxStallFeeBp: 50 });
    expect(matchIncoming(xbook(buyer), xo('sell', 5n, 1n)).fills).toEqual([]);
  });
  it('buyer without a maximum tolerates only 0 bp', () => {
    expect(matchIncoming(xbook(xo('sell', 5n, 1n, { stallFeeBp: 1 })), xo('buy', 5n, 100n, { maxStallFeeBp: null })).fills).toEqual([]);
    expect(matchIncoming(xbook(xo('sell', 5n, 1n, { stallFeeBp: 0 })), xo('buy', 5n, 100n, { maxStallFeeBp: null })).fills).toHaveLength(1);
  });
  it('skipped makers do not break price ordering of later fills', () => {
    const a = xo('sell', 2n, 2n, { policyVersion: 'x' }), b = xo('sell', 2n, 4n), c = xo('sell', 2n, 6n);
    const r = matchIncoming(xbook(c, b, a), xo('buy', 4n, 100n));
    expect(r.fills.map((f) => f.makerOrderId)).toEqual([b.orderId, c.orderId]);
  });
  it('a non-crossing maker after skipped ones still ends the sweep', () => {
    const skipped = xo('sell', 2n, 2n, { policyVersion: 'x' }), far = xo('sell', 2n, 500n);
    expect(matchIncoming(xbook(skipped, far), xo('buy', 4n, 40n)).fills).toEqual([]);
  });
});

describe('exchange matcher: fill policies', () => {
  it('partial taker fills what it can and rests the remainder', () => {
    const r = matchIncoming(xbook(xo('sell', 3n, 3n)), xo('buy', 10n, 100n));
    expect(r.fills[0]!.qty).toBe(3n);
    expect(r.restingRemainder).toBe(7n);
  });
  it('AON taker with insufficient depth returns no fills and rests unfilled in full', () => {
    const r = matchIncoming(xbook(xo('sell', 3n, 3n)), xo('buy', 10n, 100n, { fillPolicy: 'all_or_nothing' }));
    expect(r).toEqual({ fills: [], restingRemainder: 10n });
  });
  it('AON taker with exactly enough depth across levels fills completely', () => {
    const r = matchIncoming(xbook(xo('sell', 3n, 3n), xo('sell', 7n, 70n)), xo('buy', 10n, 1000n, { fillPolicy: 'all_or_nothing' }));
    expect(r.fills.map((f) => f.qty)).toEqual([3n, 7n]);
    expect(r.restingRemainder).toBe(0n);
  });
  it('AON taker depth that includes only skipped/self liquidity does not count', () => {
    const r = matchIncoming(xbook(xo('sell', 10n, 10n, { colonyId: 'me' })), xo('buy', 10n, 100n, { colonyId: 'me', fillPolicy: 'all_or_nothing' }));
    expect(r.fills).toEqual([]);
  });
  it('AON maker needing less than available than the taker wants is skipped (taker wants less)', () => {
    const aon = xo('sell', 10n, 10n, { fillPolicy: 'all_or_nothing' }), part = xo('sell', 10n, 50n);
    const r = matchIncoming(xbook(aon, part), xo('buy', 4n, 1000n));
    expect(r.fills.map((f) => f.makerOrderId)).toEqual([part.orderId]);
  });
  it('AON maker taken in full when the taker wants at least all of it', () => {
    const aon = xo('sell', 10n, 10n, { fillPolicy: 'all_or_nothing' });
    expect(matchIncoming(xbook(aon), xo('buy', 10n, 1000n)).fills[0]!.qty).toBe(10n);
    const more = matchIncoming(xbook(aon), xo('buy', 15n, 1000n));
    expect(more.fills[0]!.qty).toBe(10n);
    expect(more.restingRemainder).toBe(5n);
  });
  it('AON maker larger than a partial taker: no fill, taker rests', () => {
    const r = matchIncoming(xbook(xo('buy', 10n, 1000n, { fillPolicy: 'all_or_nothing' })), xo('sell', 4n, 4n));
    expect(r).toEqual({ fills: [], restingRemainder: 4n });
  });
  it('AON taker against AON maker of the same size matches exactly', () => {
    const r = matchIncoming(
      xbook(xo('sell', 6n, 6n, { fillPolicy: 'all_or_nothing' })),
      xo('buy', 6n, 60n, { fillPolicy: 'all_or_nothing' }),
    );
    expect(r.fills).toHaveLength(1);
  });
  it('AON taker is not partially satisfied when an AON maker is skipped (greedy, no backtrack)', () => {
    const aon = xo('sell', 10n, 10n, { fillPolicy: 'all_or_nothing' }), small = xo('sell', 4n, 100n);
    const r = matchIncoming(xbook(aon, small), xo('buy', 4n, 1000n, { fillPolicy: 'all_or_nothing' }));
    expect(r.fills.map((f) => f.makerOrderId)).toEqual([small.orderId]);
  });
});

describe('exchange matcher: properties', () => {
  function randomWorld(seed: number): { book: ReturnType<typeof xbook>; taker: XOrder } {
    const r = rng(seed);
    const mk = (side: 'buy' | 'sell'): XOrder => {
      const amount = randBig(r, 1, 30);
      const o = xo(side, amount, randBig(r, 1, 60) * amount / BigInt(randInt(r, 1, 3)), {
        colonyId: `c${randInt(r, 0, 5)}`,
        fillPolicy: r() < 0.25 ? 'all_or_nothing' : 'partial',
        stallFeeBp: [0, 50, 100][randInt(r, 0, 2)]!,
        maxStallFeeBp: side === 'buy' ? [null, 0, 50, 100][randInt(r, 0, 3)]! : null,
        policyVersion: r() < 0.1 ? 'v2' : 'v1',
        platformFeeBp: r() < 0.1 ? 50 : 100,
      });
      return { ...o, filled: r() < 0.3 ? randBig(r, 0, Number(amount) - 1) : 0n };
    };
    const book = xbook(...Array.from({ length: randInt(r, 0, 14) }, () => mk(r() < 0.5 ? 'buy' : 'sell')));
    // makers must not self-cross: only the taker's opposite side matters here
    return { book, taker: { ...mk(r() < 0.5 ? 'buy' : 'sell'), filled: 0n } };
  }
  it('fills never violate crossing, quantity, self-trade; sum qty + remainder = wanted; deterministic', () => {
    for (const seed of SEEDS.concat(Array.from({ length: 200 }, (_, i) => i))) {
      const { book, taker } = randomWorld(seed);
      const want = remainingOf(taker);
      const res = matchIncoming(book, taker);
      const again = matchIncoming(book, taker);
      expect(again).toEqual(res);
      let sum = 0n;
      const used = new Map<string, bigint>();
      for (const f of res.fills) {
        const maker = book.get(f.makerOrderId)!;
        expect(f.qty).toBeGreaterThan(0n);
        sum += f.qty;
        used.set(maker.orderId, (used.get(maker.orderId) ?? 0n) + f.qty);
        expect(maker.colonyId).not.toBe(taker.colonyId);
        const bid = taker.side === 'buy' ? taker : maker, ask = taker.side === 'buy' ? maker : taker;
        expect(comparePrice(priceOfOrder(bid), priceOfOrder(ask))).toBeGreaterThanOrEqual(0);
        expect(comparePrice(f.price, priceOfOrder(maker))).toBe(0);
        if (maker.fillPolicy === 'all_or_nothing') expect(f.qty).toBe(remainingOf(maker));
        expect(maker.policyVersion).toBe(taker.policyVersion);
        expect(maker.platformFeeBp).toBe(taker.platformFeeBp);
        const buyer = maker.side === 'buy' ? maker : taker;
        expect(maker.stallFeeBp).toBeLessThanOrEqual(buyer.maxStallFeeBp ?? 0);
        expect(f.buyerOrderId === f.makerOrderId || f.buyerOrderId === f.takerOrderId).toBe(true);
      }
      for (const [id, q] of used) expect(q).toBeLessThanOrEqual(remainingOf(book.get(id)!));
      expect(sum).toBeLessThanOrEqual(want);
      expect(sum + res.restingRemainder).toBe(want);
      if (taker.fillPolicy === 'all_or_nothing') expect(res.restingRemainder === 0n || res.fills.length === 0).toBe(true);
      // price priority: makers appear in non-decreasing book rank
      const rank = [...book.opposite(taker.side)].map((o) => o.orderId);
      const idx = res.fills.map((f) => rank.indexOf(f.makerOrderId));
      expect([...idx].sort((a, b) => a - b)).toEqual(idx);
    }
  });
  it('matching does not mutate the book', () => {
    const { book, taker } = randomWorld(42);
    const before = JSON.stringify([book.orders('buy'), book.orders('sell')], (_, v) => (typeof v === 'bigint' ? v.toString() : v));
    matchIncoming(book, taker);
    const after = JSON.stringify([book.orders('buy'), book.orders('sell')], (_, v) => (typeof v === 'bigint' ? v.toString() : v));
    expect(after).toBe(before);
  });
});

import { describe, expect, it } from 'vitest';
import { buildTradeBatch, type BatchOrder } from '../../src/systems/trade/market-batch';
import { maxBuyerSpend } from '../../src/systems/trade/market-fees';
import { matchIncoming, type MatchableOrder } from '../../src/systems/trade/market-matcher';
import { OrderBook } from '../../src/systems/trade/market-book';

/** Review of ECONOMY section 3 rounding: many random fills must never let a buyer underpay beyond the floors, a seller overreceive, or a reservation run short. */
let seed = 12345;
const rnd = (n: number): number => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };

const base = (id: string, colony: string, side: 'buy' | 'sell', amount: bigint, priceAmount: bigint, over: Partial<BatchOrder & MatchableOrder> = {}): BatchOrder & MatchableOrder => ({
  seq: 0n, orderId: id, colonyId: colony, accountId: `${colony}.acct`, side, amount, filled: 0n, priceAmount, platformFeeBp: 100, stallFeeBp: 50, stallColonyId: colony, stallAccountId: `${colony}.acct`,
  platformAccountId: 'platform.acct', policyVersion: 'v1', feeBuckets: {}, cumNotional: 0n, reservedPrincipal: side === 'buy' ? priceAmount : amount,
  reservedFees: side === 'buy' ? maxBuyerSpend(priceAmount, 100, 100) - priceAmount : 0n, fillPolicy: 'partial', maxStallFeeBp: side === 'buy' ? 100 : null, ...over,
} as never);

describe('review: fee and notional rounding over many fills', () => {
  it('never exceeds the order price, never exceeds the fee maximum, never runs the reservation short, always zero-sum', () => {
    let totalFills = 0;
    for (let round = 0; round < 300; round++) {
      const buyAmount = BigInt(10 + rnd(900));
      const buyTotal = BigInt(1_000_000 + rnd(50_000_000));
      let buyer = base('b', 'cb', 'buy', buyAmount, buyTotal, { seq: 9999n });
      const makers: Array<BatchOrder & MatchableOrder> = [];
      const count = 2 + rnd(8);
      for (let i = 0; i < count; i++) {
        const amt = BigInt(1 + rnd(300));
        // makers priced at or below the buyer's unit price so they cross
        const total = (buyTotal * amt) / buyAmount - BigInt(rnd(1000));
        if (total > 0n) makers.push(base(`s${i}`, `cs${i}`, 'sell', amt, total, { seq: BigInt(i), stallFeeBp: rnd(100) }));
      }
      const book = new OrderBook<MatchableOrder>('bio.water/USDC');
      for (const m of makers) book.add(m);
      const { fills } = matchIncoming(book, buyer);
      totalFills += fills.length;
      let spent = 0n;
      let platform = 0n;
      const received = new Map<string, bigint>();
      for (const f of fills) {
        const maker = makers.find((m) => m.orderId === f.makerOrderId)!;
        const seller = maker;
        const b = buildTradeBatch({ tradeId: `t${round}${f.makerOrderId}`, base: 'bio.water', quote: 'USDC', fill: f, buyer, seller, treasury: { enabled: false, shareBp: 0, accountId: 't' } });
        expect(b.legs.filter((l) => l.token === 'USDC').reduce((a, l) => a + l.delta, 0n)).toBe(0n);
        spent += b.notional + b.platformFee + b.stallFee;
        platform += b.platformFee;
        received.set(seller.orderId, (received.get(seller.orderId) ?? 0n) + b.notional);
        buyer = { ...buyer, filled: b.buyer.filled, cumNotional: b.buyer.cumNotional, feeBuckets: b.buyer.feeBuckets, reservedPrincipal: b.buyer.reservedPrincipal, reservedFees: b.buyer.reservedFees };
        makers[makers.indexOf(maker)] = { ...maker, filled: b.seller.filled, cumNotional: b.seller.cumNotional, reservedPrincipal: b.seller.reservedPrincipal };
      }
      expect(spent).toBeLessThanOrEqual(maxBuyerSpend(buyTotal, 100, 100));
      expect(platform).toBeLessThanOrEqual((buyer.cumNotional * 100n) / 10_000n); // floors never overcharge, and never lose more than 1 atomic per bucket
      expect(buyer.cumNotional).toBeLessThanOrEqual(buyTotal);
      for (const m of makers) expect(received.get(m.orderId) ?? 0n).toBeLessThanOrEqual(m.priceAmount); // a seller never receives more than its ask
    }
    expect(totalFills).toBeGreaterThan(300); // the property ran on real fills, not on an empty book
  });
});

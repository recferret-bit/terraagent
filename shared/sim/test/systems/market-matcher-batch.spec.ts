import { describe, expect, it } from 'vitest';
import { buildTradeBatch, type BatchOrder, type TradeBatch, type TreasuryTerms } from '../../src/systems/trade/market-batch';
import { chargeBucketed, feeBucketKey, makerNotional, maxBuyerSpend } from '../../src/systems/trade/market-fees';
import type { Fill } from '../../src/systems/trade/market-matcher';

const off: TreasuryTerms = { enabled: false, shareBp: 2000, accountId: 'treasury' };
const order = (o: Partial<BatchOrder> & Pick<BatchOrder, 'orderId' | 'side' | 'amount' | 'priceAmount'>): BatchOrder => ({
  colonyId: o.orderId, accountId: `acc-${o.orderId}`, filled: 0n, platformFeeBp: 100, stallFeeBp: 100, stallColonyId: o.orderId,
  stallAccountId: `acc-${o.orderId}`, platformAccountId: 'platform', policyVersion: 'v1', feeBuckets: {}, cumNotional: 0n,
  reservedPrincipal: o.side === 'sell' ? o.amount : o.priceAmount, reservedFees: 10n ** 30n, ...o,
});
const fillOf = (maker: BatchOrder, taker: BatchOrder, qty: bigint): Fill => {
  const buyer = maker.side === 'buy' ? maker : taker;
  const seller = maker.side === 'buy' ? taker : maker;
  return { makerOrderId: maker.orderId, takerOrderId: taker.orderId, makerSide: maker.side, buyerOrderId: buyer.orderId, sellerOrderId: seller.orderId,
    buyerColonyId: buyer.colonyId, sellerColonyId: seller.colonyId, qty, price: { num: maker.priceAmount, den: maker.amount } };
};
const build = (maker: BatchOrder, taker: BatchOrder, qty: bigint, treasury = off): TradeBatch => {
  const buyer = maker.side === 'buy' ? maker : taker;
  const seller = maker.side === 'buy' ? taker : maker;
  return buildTradeBatch({ tradeId: 't1', base: 'bio.water', quote: 'USDC', fill: fillOf(maker, taker, qty), buyer, seller, treasury });
};
const delta = (b: TradeBatch, acc: string, token: string): bigint => b.legs.find((l) => l.accountId === acc && l.token === token)?.delta ?? 0n;
const sums = (b: TradeBatch): Map<string, bigint> => {
  const m = new Map<string, bigint>();
  for (const l of b.legs) m.set(l.token, (m.get(l.token) ?? 0n) + l.delta);
  return m;
};

describe('acceptance: 300 water for 10 USDC at 1% + 1%', () => {
  it('buyer -10.20/+300, seller +10/-300, platform +0.10, stall +0.10, zero-sum', () => {
    const sell = order({ orderId: 'S', side: 'sell', amount: 300n, priceAmount: 10_000_000n, stallAccountId: 'stall' });
    const buy = order({ orderId: 'B', side: 'buy', amount: 300n, priceAmount: 10_000_000n });
    const b = build(sell, buy, 300n);
    expect(delta(b, 'stall', 'USDC')).toBe(100_000n);
    expect(delta(b, 'acc-B', 'USDC')).toBe(-10_200_000n);
    expect(delta(b, 'acc-B', 'bio.water')).toBe(300n);
    expect(delta(b, 'acc-S', 'USDC')).toBe(10_000_000n);
    expect(delta(b, 'acc-S', 'bio.water')).toBe(-300n);
    expect(delta(b, 'platform', 'USDC')).toBe(100_000n);
    for (const s of sums(b).values()) expect(s).toBe(0n);
    expect(b.batchHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(build(sell, buy, 300n).batchHash).toBe(b.batchHash);
  });
  it('stall fee goes to the maker stall; identical accounts aggregate but attribution stays', () => {
    const sell = order({ orderId: 'S', side: 'sell', amount: 300n, priceAmount: 10_000_000n, stallAccountId: 'stall-1', accountId: 'seller' });
    const buy = order({ orderId: 'B', side: 'buy', amount: 300n, priceAmount: 10_000_000n });
    const b = build(sell, buy, 300n);
    expect(delta(b, 'stall-1', 'USDC')).toBe(100_000n);
    const same = build({ ...sell, stallAccountId: 'seller' }, buy, 300n);
    expect(delta(same, 'seller', 'USDC')).toBe(10_100_000n);
    expect(same.attribution.filter((l) => l.accountId === 'seller' && l.token === 'USDC').map((l) => l.kind).sort()).toEqual(['principal', 'stall_fee']);
  });
});

describe('roles and treasury', () => {
  it('resting buy + incoming sell: the buyer still pays both fees, maker stall earns', () => {
    const buy = order({ orderId: 'B', side: 'buy', amount: 100n, priceAmount: 45_000_000n, stallFeeBp: 50 });
    const sell = order({ orderId: 'S', side: 'sell', amount: 50n, priceAmount: 1n, stallFeeBp: 9999 });
    const b = build(buy, sell, 50n);
    expect(b.notional).toBe(22_500_000n);
    // the buyer is the maker, so its own stall earns the stall fee back; the attribution still shows the charge
    expect(delta(b, 'acc-B', 'USDC')).toBe(-(22_500_000n + 225_000n));
    expect(delta(b, 'platform', 'USDC')).toBe(225_000n);
    expect(b.attribution.find((l) => l.kind === 'stall_fee' && l.accountId === 'acc-B' && l.delta < 0n)?.delta).toBe(-112_500n);
    expect(b.stallFeeBp).toBe(50);
  });
  it('treasury is carved out of the platform fee only, and only when W22 is on', () => {
    const sell = order({ orderId: 'S', side: 'sell', amount: 300n, priceAmount: 10_000_000n });
    const buy = order({ orderId: 'B', side: 'buy', amount: 300n, priceAmount: 10_000_000n });
    const on = build(sell, buy, 300n, { enabled: true, shareBp: 2000, accountId: 'treasury' });
    expect(on.platformFee).toBe(100_000n);
    expect(on.treasuryAllocation).toBe(20_000n);
    expect(on.platformRetained).toBe(80_000n);
    expect(delta(on, 'treasury', 'USDC')).toBe(20_000n);
    expect(delta(on, 'platform', 'USDC')).toBe(80_000n);
    expect(delta(on, 'acc-B', 'USDC')).toBe(-10_200_000n);
    for (const s of sums(on).values()) expect(s).toBe(0n);
    expect(build(sell, buy, 300n).treasuryAllocation).toBe(0n);
  });
  it('reports reservation use and the release on completion', () => {
    const sell = order({ orderId: 'S', side: 'sell', amount: 100n, priceAmount: 4_000_000n });
    const buy = order({ orderId: 'B', side: 'buy', amount: 100n, priceAmount: 4_500_000n, reservedFees: 90_000n });
    const b = build(sell, buy, 100n);
    expect(b.buyer.reservedPrincipal).toBe(0n);
    expect(b.buyer.releasePrincipal).toBe(500_000n); // price improvement
    expect(b.buyer.releaseFees).toBe(90_000n - 80_000n);
    expect(b.seller.releasePrincipal).toBe(0n);
    const half = build(sell, buy, 40n);
    expect(half.buyer.reservedPrincipal).toBe(4_500_000n - 1_600_000n);
    expect(half.buyer.releasePrincipal).toBe(0n);
  });
});

describe('cumulative rounding', () => {
  it('a 1% fee on 7 units of a barter quote is 0, and seven such fills never exceed the unsplit fee', () => {
    const key = feeBucketKey('metals.t1', 100, 'platform', 'v1');
    expect(chargeBucketed({}, key, 7n, 100).fee).toBe(0n);
    let buckets = {};
    let total = 0n;
    for (let i = 0; i < 7; i++) {
      const r = chargeBucketed(buckets, key, 7n, 100);
      buckets = r.buckets;
      total += r.fee;
    }
    expect(total).toBe((49n * 100n) / 10_000n);
  });

  const rng = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  it('property: any split of a maker order sums to the unsplit notional and fees, zero-sum, within the reservation', () => {
    const rand = rng(42);
    for (let iter = 0; iter < 300; iter++) {
      const amount = BigInt(1 + Math.floor(rand() * 500));
      const price = BigInt(1 + Math.floor(rand() * 10 ** 9));
      const stallBp = Math.floor(rand() * 101);
      const sell = order({ orderId: 'S', side: 'sell', amount, priceAmount: price, stallFeeBp: stallBp, reservedFees: 0n });
      let buy = order({ orderId: 'B', side: 'buy', amount, priceAmount: price * 2n, maxStallFeeBp: 100 } as never);
      const maxSpend = maxBuyerSpend(buy.priceAmount, 100, 100);
      buy = { ...buy, reservedPrincipal: buy.priceAmount, reservedFees: maxSpend - buy.priceAmount };
      let makerState = sell;
      let notional = 0n, plat = 0n, stall = 0n, spent = 0n, filled = 0n;
      while (filled < amount) {
        const q = 1n + BigInt(Math.floor(rand() * Number(amount - filled)));
        const b = build(makerState, buy, q);
        for (const s of sums(b).values()) expect(s).toBe(0n);
        notional += b.notional; plat += b.platformFee; stall += b.stallFee;
        spent += b.notional + b.platformFee + b.stallFee;
        makerState = { ...makerState, filled: b.seller.filled, cumNotional: b.seller.cumNotional };
        buy = { ...buy, filled: b.buyer.filled, cumNotional: b.buyer.cumNotional, feeBuckets: b.buyer.feeBuckets, reservedPrincipal: b.buyer.reservedPrincipal, reservedFees: b.buyer.reservedFees };
        filled += q;
        expect(spent).toBeLessThanOrEqual(maxSpend);
      }
      expect(notional).toBe(makerNotional(price, amount, 0n, amount));
      expect(notional).toBe(price);
      expect(plat).toBe((price * 100n) / 10_000n);
      expect(stall).toBe((price * BigInt(stallBp)) / 10_000n);
    }
  });
});

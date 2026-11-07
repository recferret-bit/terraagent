import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import { bookLevelOf, comparePrice, crosses, gcd, limitPrice, reducePrice } from '../../src/systems/trade/market-price';
import {
  chargeBucketed, feeBucketKey, makerNotional, maxBuyerFees, maxBuyerSpend, treasuryAllocation, type FeeBuckets,
} from '../../src/systems/trade/market-fees';
import { priceDecimal } from '../../src/systems/trade/market-board';
import { readMinNotionalAtomic } from '../../src/systems/trade/market-state';
import { compileData } from '../../src';
import { randBig, randInt, rng, SEEDS } from './exchange-kit';

const BIG = 2n ** 64n;

describe('exchange prices: rationals', () => {
  it('10/300 equals 1/30 and sorts consistently', () => {
    const a = limitPrice(10n, 300n), b = limitPrice(1n, 30n);
    expect(comparePrice(a, b)).toBe(0);
    expect(comparePrice(b, a)).toBe(0);
    expect(crosses(a, b) && crosses(b, a)).toBe(true);
  });
  it('compare is antisymmetric and transitive on random rationals', () => {
    for (const seed of SEEDS) {
      const r = rng(seed);
      const p = () => limitPrice(randBig(r, 0, 5000), randBig(r, 1, 300));
      const [a, b, c] = [p(), p(), p()];
      expect(comparePrice(a, b)).toBe(-comparePrice(b, a));
      if (comparePrice(a, b) <= 0 && comparePrice(b, c) <= 0) expect(comparePrice(a, c)).toBeLessThanOrEqual(0);
    }
  });
  it('reduce keeps value, gives lowest terms, is idempotent', () => {
    for (const seed of SEEDS) {
      const r = rng(seed);
      const p = limitPrice(randBig(r, 0, 100000), randBig(r, 1, 5000));
      const q = reducePrice(p);
      expect(comparePrice(p, q)).toBe(0);
      expect(reducePrice(q)).toEqual(q);
      if (p.num > 0n) expect(gcd(q.num, q.den)).toBe(1n);
    }
  });
  it('0/den reduces to 0/1', () => {
    expect(reducePrice(limitPrice(0n, 7n))).toEqual({ num: 0n, den: 1n });
  });
  it('zero price is legal and is below every positive price', () => {
    const z = limitPrice(0n, 5n);
    expect(comparePrice(z, limitPrice(1n, 1_000_000n))).toBe(-1);
    expect(crosses(z, limitPrice(0n, 9n))).toBe(true);
  });
  it('zero/negative amount and negative price throw RangeError', () => {
    expect(() => limitPrice(1n, 0n)).toThrow(RangeError);
    expect(() => limitPrice(1n, -3n)).toThrow(RangeError);
    expect(() => limitPrice(-1n, 3n)).toThrow(RangeError);
  });
  it('huge bigints beyond 2^64 compare exactly (no float rounding)', () => {
    const a = limitPrice(BIG * 3n + 1n, BIG), b = limitPrice(BIG * 3n, BIG);
    expect(comparePrice(a, b)).toBe(1);
    expect(comparePrice(limitPrice(BIG * BIG + 1n, BIG * BIG), limitPrice(1n, 1n))).toBe(1);
    expect(comparePrice(limitPrice(BIG * 10n, BIG * 300n), limitPrice(1n, 30n))).toBe(0);
    expect(reducePrice(limitPrice(BIG * 10n, BIG * 300n))).toEqual({ num: 1n, den: 30n });
  });
  it('gcd handles zero and negatives', () => {
    expect(gcd(0n, 5n)).toBe(5n);
    expect(gcd(-12n, 18n)).toBe(6n);
    expect(gcd(0n, 0n)).toBe(0n);
  });
  it('bookLevelOf reduces the price', () => {
    expect(bookLevelOf(limitPrice(10n, 300n), 5n, 2)).toEqual({ num: '1', den: 30, amount: 5, orders: 2 });
  });
});

describe('exchange prices: decimal formatting', () => {
  it('truncates (never rounds) and trims zeros', () => {
    expect(priceDecimal({ num: 2n, den: 3n })).toBe('0.666666');
    expect(priceDecimal({ num: 1n, den: 30n })).toBe('0.033333');
    expect(priceDecimal({ num: 5n, den: 2n })).toBe('2.5');
    expect(priceDecimal({ num: 7n, den: 1n })).toBe('7');
    expect(priceDecimal({ num: 0n, den: 1n })).toBe('0');
    expect(priceDecimal({ num: 1n, den: 10_000_000n })).toBe('0');
    expect(priceDecimal({ num: 1n, den: 3n }, 0)).toBe('0');
    expect(priceDecimal({ num: 7n, den: 2n }, 0)).toBe('3');
  });
  it('handles values beyond 2^64', () => {
    expect(priceDecimal({ num: BIG * 100n, den: 1n })).toBe((BIG * 100n).toString());
  });
});

describe('exchange fees: cumulative rounding', () => {
  it('maker notional over any split equals the unsplit notional', () => {
    for (const seed of SEEDS) {
      const r = rng(seed);
      const amount = randBig(r, 1, 400), price = randBig(r, 0, 10_000_000);
      let filled = 0n, sum = 0n;
      while (filled < amount) {
        const qty = randBig(r, 1, Number(amount - filled));
        const n = makerNotional(price, amount, filled, qty);
        expect(n).toBeGreaterThanOrEqual(0n);
        sum += n; filled += qty;
      }
      expect(sum).toBe(price);
    }
  });
  it('partial maker fill cumulative notional is floor(filled*price/amount)', () => {
    expect(makerNotional(10n, 3n, 0n, 1n)).toBe(3n);
    expect(makerNotional(10n, 3n, 1n, 1n)).toBe(3n);
    expect(makerNotional(10n, 3n, 2n, 1n)).toBe(4n);
  });
  it('huge maker price keeps exactness', () => {
    expect(makerNotional(BIG * 7n, 7n, 0n, 7n)).toBe(BIG * 7n);
    expect(makerNotional(BIG * 7n + 3n, 7n, 3n, 4n)).toBe(BIG * 7n + 3n - (3n * (BIG * 7n + 3n)) / 7n);
  });
  it('fee buckets: cumulative floors equal the unsplit fee for random splits and rates', () => {
    for (const seed of SEEDS) {
      const r = rng(seed);
      const rate = [0, 1, 37, 99, 100][randInt(r, 0, 4)]!;
      let b: FeeBuckets = {};
      let total = 0n, fees = 0n;
      for (let i = 0; i < 12; i++) {
        const n = randBig(r, 0, 9999);
        const c = chargeBucketed(b, 'k', n, rate);
        b = c.buckets; total += n; fees += c.fee;
        expect(c.fee).toBeGreaterThanOrEqual(0n);
      }
      expect(fees).toBe((total * BigInt(rate)) / 10_000n);
      expect(b.k!.fee).toBe(fees.toString());
      expect(b.k!.base).toBe(total.toString());
    }
  });
  it('dust fills round their fee to 0 yet the sum catches up', () => {
    let b: FeeBuckets = {};
    const fees: bigint[] = [];
    for (let i = 0; i < 200; i++) { const c = chargeBucketed(b, 'k', 1n, 100); b = c.buckets; fees.push(c.fee); }
    expect(fees[0]).toBe(0n);
    expect(fees.reduce((a, c) => a + c, 0n)).toBe(2n);
  });
  it('separate buckets (different policy) do not share state', () => {
    const k1 = feeBucketKey('USDC', 100, 'p', 'v1'), k2 = feeBucketKey('USDC', 100, 'p', 'v2');
    expect(k1).not.toBe(k2);
    const c1 = chargeBucketed({}, k1, 99n, 100);
    const c2 = chargeBucketed(c1.buckets, k2, 1n, 100);
    expect(c2.fee).toBe(0n);
    expect(c2.buckets[k1]).toEqual(c1.buckets[k1]);
  });
  it('rate 0 charges nothing, rate 10000 charges the notional, input buckets are not mutated', () => {
    const input: FeeBuckets = { k: { base: '5', fee: '1' } };
    const snap = JSON.stringify(input);
    expect(chargeBucketed(input, 'k', 12345n, 0).fee).toBe(0n);
    expect(chargeBucketed(input, 'k', 12345n, 10_000).fee).toBe(12345n);
    expect(JSON.stringify(input)).toBe(snap);
  });
  it('maxBuyerFees upper-bounds the actual platform+stall fees for random fill sequences', () => {
    for (const seed of SEEDS) {
      const r = rng(seed);
      const amount = randBig(r, 1, 300), price = randBig(r, 1, 5_000_000);
      const pBp = [0, 50, 100][randInt(r, 0, 2)]!, sBp = [0, 1, 70, 100][randInt(r, 0, 3)]!;
      let filled = 0n, b: FeeBuckets = {}, fees = 0n, principal = 0n;
      while (filled < amount) {
        const qty = randBig(r, 1, Number(amount - filled));
        const n = makerNotional(price, amount, filled, qty);
        const p = chargeBucketed(b, 'p', n, pBp), s = chargeBucketed(p.buckets, 's', n, sBp);
        b = s.buckets; fees += p.fee + s.fee; principal += n; filled += qty;
      }
      expect(fees).toBeLessThanOrEqual(maxBuyerFees(price, pBp, sBp));
      expect(principal + fees).toBeLessThanOrEqual(maxBuyerSpend(price, pBp, sBp));
    }
  });
  it('maxBuyerFees/maxBuyerSpend exact values at 0 and 100 bp', () => {
    expect(maxBuyerFees(1_000_000n, 0, 0)).toBe(0n);
    expect(maxBuyerFees(1_000_000n, 100, 100)).toBe(20_000n);
    expect(maxBuyerSpend(1_000_000n, 100, 0)).toBe(1_010_000n);
    expect(maxBuyerFees(99n, 100, 100)).toBe(0n);
  });
  it('treasury allocation on/off, never exceeds the platform fee', () => {
    expect(treasuryAllocation(1000n, 2000, false)).toBe(0n);
    expect(treasuryAllocation(1000n, 2000, true)).toBe(200n);
    expect(treasuryAllocation(0n, 2000, true)).toBe(0n);
    expect(treasuryAllocation(7n, 2000, true)).toBe(1n);
    expect(treasuryAllocation(7n, 10_000, true)).toBe(7n);
    expect(treasuryAllocation(7n, 0, true)).toBe(0n);
  });
});

describe('exchange minimum notional per quote token', () => {
  const data = compileData(parseWaves('..13'));
  it('reads each quote minimum and defaults to 1 for an unknown quote', () => {
    expect(readMinNotionalAtomic(data, 'USDC')).toBe(100_000n);
    expect(readMinNotionalAtomic(data, 'NEAR')).toBe(10_000_000_000_000_000_000_000n);
    expect(readMinNotionalAtomic(data, 'metals.t1' as never)).toBe(1n);
  });
});

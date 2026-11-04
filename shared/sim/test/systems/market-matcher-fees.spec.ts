import { describe, expect, it } from 'vitest';
import { chargeBucketed, feeBucketKey, maxBuyerFees } from '../../src/systems/trade/market-fees';

describe('market-matcher fees: rounding without dust', () => {
  const key = feeBucketKey('metals.t1', 100, 'platform', 'v1');
  it('a 1 % fee on 7 units is 0 (fee 0, no dust)', () => {
    expect(chargeBucketed({}, key, 7n, 100).fee).toBe(0n);
  });
  it('1 % on 7 units, 100 fills in a row: total equals the unsplit fee and the bucket tracks it', () => {
    let buckets = {};
    let total = 0n;
    for (let i = 0; i < 100; i++) {
      const r = chargeBucketed(buckets, key, 7n, 100);
      buckets = r.buckets;
      total += r.fee;
    }
    expect(total).toBe(7n); // 700 * 1 %
    expect(buckets).toEqual({ [key]: { base: '700', fee: '7' } });
  });
  it('the fee maximum bounds the cumulative fees', () => {
    expect(maxBuyerFees(10_000_000n, 100, 100)).toBe(200_000n);
    expect(maxBuyerFees(7n, 100, 100)).toBe(0n);
  });
});

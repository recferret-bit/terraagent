import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { BP_SCALE, isMajor, owedAt, ratioToBp, shareBp } from '../src';

const RUNS = { numRuns: 2000 };

/** floor(a × bp / 10000) computed exactly with BigInt. */
function shareOracle(amount: number, bp: number): number {
  const num = BigInt(amount) * BigInt(bp);
  const q = num / 10_000n;
  return Number(num < 0n && q * 10_000n !== num ? q - 1n : q);
}

describe('amount properties', () => {
  it('shareBp is an integer between 0 and amount for non-negative amounts', () => {
    fc.assert(
      fc.property(fc.maxSafeNat(), fc.double({ noNaN: false }), (amount, bp) => {
        const share = shareBp(amount, bp);
        expect(isMajor(share)).toBe(true);
        expect(share).toBeGreaterThanOrEqual(0);
        expect(share).toBeLessThanOrEqual(amount);
      }),
      RUNS,
    );
  });

  it('shareBp matches exact floor(amount × bp / 10000) for every safe amount', () => {
    fc.assert(
      fc.property(fc.maxSafeInteger(), fc.integer({ min: 0, max: BP_SCALE }), (amount, bp) => {
        expect(shareBp(amount, bp)).toBe(shareOracle(amount, bp));
      }),
      RUNS,
    );
  });

  it('shareBp is monotone in bp', () => {
    fc.assert(
      fc.property(fc.maxSafeNat(), fc.integer({ min: 0, max: BP_SCALE }), fc.integer({ min: 0, max: BP_SCALE }), (amount, x, y) => {
        const [lo, hi] = x <= y ? [x, y] : [y, x];
        expect(shareBp(amount, lo)).toBeLessThanOrEqual(shareBp(amount, hi));
      }),
      RUNS,
    );
  });

  it('ratioToBp round-trips whole basis points', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: BP_SCALE }), (bp) => {
        expect(ratioToBp(bp / BP_SCALE)).toBe(bp);
      }),
      RUNS,
    );
  });

  it('owedAt increments over any monotone progress sequence are non-negative and sum exactly to total', () => {
    const progress = fc.array(fc.double({ min: -0.5, max: 1.5, noNaN: true }), { maxLength: 40 });
    fc.assert(
      fc.property(fc.oneof(fc.nat({ max: 10_000 }), fc.maxSafeNat()), progress, (total, steps) => {
        const seq = [...steps.sort((a, b) => a - b), 1];
        let paid = 0;
        let prev = 0;
        for (const p of seq) {
          const owed = owedAt(total, p);
          const step = owed - owedAt(total, prev);
          expect(isMajor(owed)).toBe(true);
          expect(step).toBeGreaterThanOrEqual(0);
          expect(owed).toBeLessThanOrEqual(total);
          paid += step;
          prev = p;
        }
        expect(paid).toBe(total);
      }),
      RUNS,
    );
  });
});

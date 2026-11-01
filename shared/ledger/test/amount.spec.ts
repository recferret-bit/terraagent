import { describe, expect, it } from 'vitest';
import { BP_SCALE, isMajor, isPositiveMajor, owedAt, ratioToBp, shareBp } from '../src';

const M = Number.MAX_SAFE_INTEGER;

describe('isMajor / isPositiveMajor', () => {
  it('accepts safe integers including zero and negatives', () => {
    for (const n of [0, -0, 1, -1, 42, M, -M]) expect(isMajor(n)).toBe(true);
  });

  it('rejects fractions, non-finite, unsafe and non-numbers', () => {
    for (const n of [0.5, -1.5, NaN, Infinity, -Infinity, M + 1, -M - 1, '1', null, undefined, 1n, {}]) {
      expect(isMajor(n)).toBe(false);
    }
  });

  it('isPositiveMajor needs a safe integer above zero', () => {
    expect(isPositiveMajor(1)).toBe(true);
    expect(isPositiveMajor(M)).toBe(true);
    for (const n of [0, -0, -1, 0.5, 1.5, NaN, Infinity, '3', M + 1]) expect(isPositiveMajor(n)).toBe(false);
  });
});

describe('shareBp', () => {
  it('BP_SCALE is 10000', () => expect(BP_SCALE).toBe(10_000));

  it('floors amount × bp / 10000', () => {
    expect(shareBp(100, 7500)).toBe(75);
    expect(shareBp(3, 5000)).toBe(1);
    expect(shareBp(1, 9999)).toBe(0);
    expect(shareBp(7, 10_000)).toBe(7);
    expect(shareBp(7, 0)).toBe(0);
    expect(shareBp(0, 5000)).toBe(0);
  });

  it('clamps bp to 0..10000 and truncates fractional bp', () => {
    expect(shareBp(10, 20_000)).toBe(10);
    expect(shareBp(10, Infinity)).toBe(10);
    expect(shareBp(10, -5)).toBe(0);
    expect(shareBp(10, -Infinity)).toBe(0);
    expect(shareBp(10_000, 1.9)).toBe(1);
  });

  it('treats NaN bp as 0', () => expect(shareBp(10, NaN)).toBe(0));

  it('floors negative amounts toward -infinity', () => {
    expect(shareBp(-1, 5000)).toBe(-1);
    expect(shareBp(-3, 5000)).toBe(-2);
    expect(shareBp(-20_000, 5000)).toBe(-10_000);
  });

  it('is exact at the safe-integer edge', () => {
    expect(shareBp(M, 10_000)).toBe(M);
    expect(shareBp(M, 9999)).toBe(Number((BigInt(M) * 9999n) / 10_000n));
    expect(shareBp(M, 1)).toBe(Number(BigInt(M) / 10_000n));
    expect(shareBp(-M, 10_000)).toBe(-M);
  });
});

describe('ratioToBp', () => {
  it('rounds a ratio to the nearest basis point', () => {
    expect(ratioToBp(0.75)).toBe(7500);
    expect(ratioToBp(1)).toBe(10_000);
    expect(ratioToBp(0)).toBe(0);
    expect(ratioToBp(0.12345)).toBe(1235);
    expect(ratioToBp(0.00004)).toBe(0);
    expect(ratioToBp(1.5)).toBe(15_000);
  });
});

describe('owedAt', () => {
  it('pays nothing at or below zero progress (and for NaN)', () => {
    expect(owedAt(10, 0)).toBe(0);
    expect(owedAt(10, -0.5)).toBe(0);
    expect(owedAt(10, NaN)).toBe(0);
  });

  it('pays exactly total once progress reaches 1', () => {
    expect(owedAt(10, 1)).toBe(10);
    expect(owedAt(10, 1.7)).toBe(10);
    expect(owedAt(10, Infinity)).toBe(10);
    expect(owedAt(M, 1)).toBe(M);
  });

  it('floors partial progress', () => {
    expect(owedAt(10, 0.25)).toBe(2);
    expect(owedAt(10, 0.99)).toBe(9);
    expect(owedAt(3, 0.5)).toBe(1);
    expect(owedAt(1, 0.999_999)).toBe(0);
  });

  it('never exceeds total below progress 1', () => {
    const justBelowOne = 1 - Number.EPSILON / 2;
    expect(justBelowOne).toBeLessThan(1);
    expect(owedAt(M, justBelowOne)).toBe(M - 1);
    expect(owedAt(5, justBelowOne)).toBe(4);
  });
});

import { describe, expect, it } from 'vitest';
import { formatAtomic, formatUnitPrice, mockLabel, parseDisplayAmount } from '../src/market/format';

describe('market format', () => {
  it('formats exact atomic amounts', () => {
    expect(formatAtomic('USDC', 10_200_000n)).toBe('10.20');
    expect(formatAtomic('USDC', 100_000n)).toBe('0.10');
    expect(formatAtomic('USDC', 1n)).toBe('0.000001');
    expect(formatAtomic('USDC', 9_800_000n)).toBe('9.80');
    expect(formatAtomic('USDC', -10_000_000n)).toBe('-10.00');
    expect(formatAtomic('bio.water', 300n)).toBe('300');
    expect(formatAtomic('NEAR', 1_500_000_000_000_000_000_000_000n)).toBe('1.50');
    expect(formatAtomic('NEAR', 1n)).toBe('0.000000000000000000000001');
  });
  it('formats adaptive unit prices', () => {
    expect(formatUnitPrice(10_000_000n, 300, 'USDC')).toBe('0.0333');
    expect(formatUnitPrice(80n, 200, 'bio.water')).toBe('0.400');
    expect(formatUnitPrice(12_500_000n, 1, 'USDC')).toBe('12.50');
    expect(formatUnitPrice(1_234_567n, 1, 'USDC')).toBe('1.23');
    expect(formatUnitPrice(0n, 1, 'USDC')).toBe('0.00');
  });
  it('parses exactly and rejects extra decimals', () => {
    expect(parseDisplayAmount('USDC', '10.20')).toBe(10_200_000n);
    expect(parseDisplayAmount('USDC', '10')).toBe(10_000_000n);
    expect(parseDisplayAmount('USDC', '0.000001')).toBe(1n);
    expect(parseDisplayAmount('USDC', '1.2000000')).toBe(1_200_000n);
    expect(() => parseDisplayAmount('USDC', '0.0000001')).toThrow();
    expect(() => parseDisplayAmount('bio.water', '1.5')).toThrow();
    expect(() => parseDisplayAmount('USDC', '-1')).toThrow();
    expect(() => parseDisplayAmount('USDC', '1e3')).toThrow();
    expect(() => parseDisplayAmount('USDC', '')).toThrow();
  });
  it('property: parse(format(x)) == x for every token over many atomic values', () => {
    let seed = 7;
    const rnd = (): number => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    for (const token of ['USDC', 'NEAR', 'bio.water', 'metals.t1'] as const) {
      const xs = [0n, 1n, 9n, 10n, 99_999n, 10n ** 6n, 10n ** 24n, 10n ** 30n + 1n];
      for (let i = 0; i < 300; i++) xs.push(BigInt(Math.floor(rnd() * 1e15)) * BigInt(Math.floor(rnd() * 1e12) + 1));
      for (const x of xs) expect(parseDisplayAmount(token, formatAtomic(token, x))).toBe(x);
    }
  });
  it('labels mock tokens', () => {
    expect(mockLabel('USDC')).toBe('mock USDC');
  });
});

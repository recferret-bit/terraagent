import { describe, expect, it } from 'vitest';
import { bookLevelOf, comparePrice, crosses, limitPrice, reducePrice } from '../../src/systems/trade/market-price';

describe('market-price', () => {
  it('equal rationals tie (10/300 = 1/30)', () => {
    expect(comparePrice(limitPrice(10n, 300n), limitPrice(1n, 30n))).toBe(0);
  });
  it('orders 0.40 below 0.45 exactly', () => {
    expect(comparePrice(limitPrice(40n, 100n), limitPrice(45n, 100n))).toBe(-1);
    expect(comparePrice(limitPrice(9n, 20n), limitPrice(2n, 5n))).toBe(1);
  });
  it('crosses when bid >= ask', () => {
    expect(crosses(limitPrice(45n, 100n), limitPrice(40n, 100n))).toBe(true);
    expect(crosses(limitPrice(1n, 30n), limitPrice(10n, 300n))).toBe(true);
    expect(crosses(limitPrice(39n, 100n), limitPrice(40n, 100n))).toBe(false);
  });
  it('is exact beyond float precision', () => {
    const big = 10n ** 40n;
    expect(comparePrice(limitPrice(big + 1n, 3n), limitPrice(big, 3n))).toBe(1);
  });
  it('reduces by gcd and builds a book level', () => {
    expect(reducePrice(limitPrice(10n, 300n))).toEqual({ num: 1n, den: 30n });
    expect(bookLevelOf(limitPrice(10n, 300n), 7n, 2)).toEqual({ num: '1', den: 30, amount: 7, orders: 2 });
    expect(reducePrice(limitPrice(0n, 5n))).toEqual({ num: 0n, den: 1n });
  });
  it('rejects a zero amount', () => {
    expect(() => limitPrice(1n, 0n)).toThrow();
  });
});

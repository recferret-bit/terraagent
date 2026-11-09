import type { BookLevel } from '@terra/contracts';

/**
 * Exact limit prices (W13-01 / LED-20). An order's unit price is the rational `priceAmount / amount`
 * (quote atomic per whole base unit). Everything here is bigint arithmetic; there are no floats.
 */
export interface LimitPrice {
  /** Total quote atomic for the full order amount. */
  readonly num: bigint;
  /** The order's full base amount (whole units), > 0. */
  readonly den: bigint;
}

export function limitPrice(priceAmount: bigint, amount: bigint): LimitPrice {
  if (amount <= 0n) throw new RangeError('limit price needs a positive base amount');
  if (priceAmount < 0n) throw new RangeError('limit price must not be negative');
  return { num: priceAmount, den: amount };
}

/** Negative when `a` is cheaper than `b`, 0 when the rationals are equal (10/300 equals 1/30), positive otherwise. */
export function comparePrice(a: LimitPrice, b: LimitPrice): number {
  const d = a.num * b.den - b.num * a.den;
  return d < 0n ? -1 : d > 0n ? 1 : 0;
}

/** A bid and an ask cross when the bid pays at least the ask. */
export function crosses(bid: LimitPrice, ask: LimitPrice): boolean {
  return comparePrice(bid, ask) >= 0;
}

export function gcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) [x, y] = [y, x % y];
  return x;
}

/** Reduced form (lowest terms) of a price; `0/den` reduces to `0/1`. */
export function reducePrice(p: LimitPrice): LimitPrice {
  const g = gcd(p.num, p.den);
  return g <= 1n ? p : { num: p.num / g, den: p.den / g };
}

/** One `market.book` level for a price, resting `amount` base units spread over `orders` orders. */
export function bookLevelOf(price: LimitPrice, amount: bigint, orders: number): BookLevel {
  const r = reducePrice(price);
  return { num: r.num.toString(), den: Number(r.den), amount: Number(amount), orders };
}

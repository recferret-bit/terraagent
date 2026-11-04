/**
 * Exact rationals for economy metrics (ECONOMY §2): bigint numerator over a positive bigint denominator, always in
 * lowest terms, so a metric is never a float and two hosts agree to the last digit. Only {@link ratioToDecimal} turns
 * one into text (for `MetricRow.value`), with one documented rounding rule.
 */
export interface Ratio {
  readonly num: bigint;
  readonly den: bigint;
}

const abs = (a: bigint): bigint => (a < 0n ? -a : a);

function gcd(a: bigint, b: bigint): bigint {
  let x = abs(a), y = abs(b);
  while (y > 0n) [x, y] = [y, x % y];
  return x;
}

/** `num/den` in lowest terms. Throws on a zero denominator: callers decide the null reason first. */
export function ratio(num: bigint, den: bigint = 1n): Ratio {
  if (den === 0n) throw new Error('ratio: zero denominator');
  const g = gcd(num, den) || 1n;
  const s = den < 0n ? -1n : 1n;
  return { num: (s * num) / g, den: (s * den) / g };
}

export const ZERO: Ratio = { num: 0n, den: 1n };
export const addRatio = (a: Ratio, b: Ratio): Ratio => ratio(a.num * b.den + b.num * a.den, a.den * b.den);
export const subRatio = (a: Ratio, b: Ratio): Ratio => ratio(a.num * b.den - b.num * a.den, a.den * b.den);
export const mulRatio = (a: Ratio, b: Ratio): Ratio => ratio(a.num * b.num, a.den * b.den);
/** Throws when `b` is zero. */
export const divRatio = (a: Ratio, b: Ratio): Ratio => ratio(a.num * b.den, a.den * b.num);
export const ratioEquals = (a: Ratio, b: Ratio): boolean => a.num === b.num && a.den === b.den;
export const sumRatios = (rs: readonly Ratio[]): Ratio => rs.reduce(addRatio, ZERO);

/**
 * Decimal text with at most `digits` fraction digits (trailing zeros trimmed), rounding half away from zero:
 * `7/2` is `"3.5"`, `1/3` at 6 digits is `"0.333333"`, `-5/2` at 0 digits is `"-3"`.
 */
export function ratioToDecimal(r: Ratio, digits = 6): string {
  let scale = 1n;
  for (let i = 0; i < digits; i++) scale *= 10n;
  const scaled = abs(r.num) * scale;
  let q = scaled / r.den;
  if ((scaled % r.den) * 2n >= r.den) q += 1n;
  const whole = q / scale;
  const frac = (q % scale).toString().padStart(digits, '0').replace(/0+$/, '');
  const sign = r.num < 0n && q > 0n ? '-' : '';
  return `${sign}${whole}${frac ? `.${frac}` : ''}`;
}

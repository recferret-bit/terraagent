/**
 * The one deterministic exponentiation of the quote function (ECONOMY section 4), shared by the runtime quote agent and the
 * experiments. Pure bigint, no floats, no `Math`. Specification:
 *
 *   powRatioWad(num, den, p, q) = x^(p/q) in WAD fixed point (WAD = 10^18), x = num / den > 0, integers 0 <= p, 1 <= q.
 *   1. xw = floor(num * WAD / den)                           (x in WAD, rounded down)
 *   2. y  = floor((xw * WAD^(q-1))^(1/q))                    (exact integer q-th root: y ~ WAD * x^(1/q), rounded down)
 *   3. z  = floor(y^p / WAD^(p-1)), and WAD for p = 0         (integer power in WAD, rounded down)
 * Every step rounds down, so the result is within (p + 1) units of 10^-18 of the real value and is identical on every host.
 * Callers round the final price once (bids down, asks up), never inside this function.
 */
export const WAD = 10n ** 18n;

/** `floor(n^(1/q))` for `n >= 0`, `q >= 1`, by Newton iteration from an upper bound (exact, terminates). */
export function integerRoot(n: bigint, q: number): bigint {
  if (n < 0n) throw new RangeError('integerRoot: negative radicand');
  if (!Number.isInteger(q) || q < 1) throw new RangeError('integerRoot: degree must be a positive integer');
  if (n < 2n || q === 1) return n;
  const deg = BigInt(q);
  let x = 1n << BigInt(Math.floor(n.toString(2).length / q) + 1); // 2^(ceil(bits/q)) >= root
  for (;;) {
    const next = ((deg - 1n) * x + n / x ** (deg - 1n)) / deg;
    if (next >= x) return x;
    x = next;
  }
}

/** `(num / den)^(p / q)` in WAD, rounded down. `null` for a non-positive numerator or denominator or a bad exponent. */
export function powRatioWad(num: bigint, den: bigint, p: number, q: number): bigint | null {
  if (num <= 0n || den <= 0n || !Number.isInteger(p) || p < 0 || !Number.isInteger(q) || q < 1) return null;
  if (p === 0) return WAD;
  const xw = (num * WAD) / den;
  const y = integerRoot(xw * WAD ** BigInt(q - 1), q);
  return y ** BigInt(p) / WAD ** BigInt(p - 1);
}

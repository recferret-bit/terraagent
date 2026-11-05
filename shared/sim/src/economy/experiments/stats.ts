import { addRatio, divRatio, mulRatio, ratio, ratioToDecimal, subRatio, sumRatios, ZERO, type Ratio } from '../flows/ratio';

/**
 * Paired-seed statistics, exact and deterministic (no floats, no randomness). Method: for one metric series, the paired
 * differences `d_i = candidate_i - baseline_i` over n seeds are exact rationals; the mean and the sample variance are
 * exact; the 95 % confidence interval is a Student t interval `mean ± t(0.975, n-1) * sqrt(var / n)` where the only
 * irrational step (the square root) is taken in fixed point at 1e-9 and rounded DOWN, so the interval is never narrower
 * than the exact one by more than 1e-9. n = 1 has no interval (`null`): that is `insufficient_data`, not a zero width.
 */

/** t(0.975, df) for df 1..30 in thousandths; beyond 30 the normal 1.96 is used. */
const T975_THOUSANDTHS = [
  12706, 4303, 3182, 2776, 2571, 2447, 2365, 2306, 2262, 2228, 2201, 2179, 2160, 2145, 2131, 2120, 2110, 2101, 2093, 2086,
  2080, 2074, 2069, 2064, 2060, 2056, 2052, 2048, 2045, 2042,
];
export const tCritical = (df: number): Ratio => ratio(BigInt(df >= 1 && df <= 30 ? T975_THOUSANDTHS[df - 1]! : 1960), 1000n);

function isqrt(n: bigint): bigint {
  if (n < 2n) return n;
  let x = n;
  let y = (x + 1n) / 2n;
  while (y < x) { x = y; y = (x + n / x) / 2n; }
  return x;
}

const SCALE = 1_000_000_000n;
/** `floor(sqrt(r))` at 1e-9 resolution, as a ratio. */
function sqrtDown(r: Ratio): Ratio {
  return ratio(isqrt((r.num * SCALE * SCALE) / r.den), SCALE);
}

export interface PairedStats {
  readonly n: number;
  readonly mean: Ratio;
  /** 95 % interval of the mean difference; null with fewer than two pairs. */
  readonly ci: { readonly lo: Ratio; readonly hi: Ratio } | null;
}

export function pairedStats(diffs: readonly Ratio[]): PairedStats | null {
  const n = diffs.length;
  if (n === 0) return null;
  const mean = divRatio(sumRatios(diffs), ratio(BigInt(n)));
  if (n === 1) return { n, mean, ci: null };
  const ss = sumRatios(diffs.map((d) => mulRatio(subRatio(d, mean), subRatio(d, mean))));
  const se2 = divRatio(ss, ratio(BigInt((n - 1) * n)));
  const t = tCritical(n - 1);
  const half = sqrtDown(mulRatio(mulRatio(t, t), se2));
  return { n, mean, ci: { lo: subRatio(mean, half), hi: addRatio(mean, half) } };
}

export const sign = (r: Ratio): -1 | 0 | 1 => (r.num < 0n ? -1 : r.num > 0n ? 1 : 0);
export const decimal = (r: Ratio): string => ratioToDecimal(r, 6);
export { ZERO };

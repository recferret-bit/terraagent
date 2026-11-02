/**
 * Amounts are whole **major units** (1 metal, 1 water): safe integers, never fractions. Any share of an amount
 * (refund ratio, progress slice) is computed with these helpers so it rounds down to a whole unit deterministically.
 */

/** Basis points in a whole: `10000 bp = 100 %`. */
export const BP_SCALE = 10_000;

/** True when `n` is a safe integer (zero and negatives included). */
export function isMajor(n: unknown): n is number {
  return typeof n === 'number' && Number.isSafeInteger(n);
}

/** True when `n` is a safe integer greater than zero. */
export function isPositiveMajor(n: unknown): n is number {
  return isMajor(n) && n > 0;
}

/**
 * `floor(amount × bp / 10000)` in whole units; `bp` is clamped to `0..10000` (NaN counts as 0). Exact for every safe
 * integer `amount`: the product is split as `q × 10000 + r` so it never leaves the safe-integer range.
 */
export function shareBp(amount: number, bp: number): number {
  const clamped = Number.isNaN(bp) ? 0 : Math.max(0, Math.min(BP_SCALE, Math.trunc(bp)));
  const mod = amount % BP_SCALE;
  const rest = mod < 0 ? mod + BP_SCALE : mod;
  const whole = (amount - rest) / BP_SCALE;
  return whole * clamped + Math.floor((rest * clamped) / BP_SCALE);
}

/** Converts a ratio (`0.75`) to basis points (`7500`), rounded to the nearest bp. */
export function ratioToBp(ratio: number): number {
  return Math.round(ratio * BP_SCALE);
}

/**
 * The whole units of `total` owed at cumulative `progress` (0..1): `floor(total × progress)`, and exactly `total` once
 * progress reaches 1. Paying `owedAt(p₂) − owedAt(p₁)` per step therefore never pays a fraction and settles exactly.
 */
export function owedAt(total: number, progress: number): number {
  if (!(progress > 0)) return 0;
  if (progress >= 1) return total;
  return Math.min(total, Math.floor(total * progress));
}

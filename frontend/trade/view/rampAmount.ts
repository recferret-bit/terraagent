import { parseDecimalToAtomic } from '@terra/contracts';

export type RampAmountResult =
  | { readonly ok: true; readonly atomic: string }
  | { readonly ok: false; readonly error: string };

/** Largest atomic amount the server accepts (`\d{1,39}`); keeps a typo from becoming a quintillion-scale quote. */
const MAX_ATOMIC_DIGITS = 39;

/**
 * Converts the human amount typed in the ramp (`10.00`) to the ATOMIC integer string the quote API expects, scaled by
 * the origin token's `decimals` (`USDC` 6: `10.00` -> `10000000`; `NEAR` 24: `1` -> `10^24`). Never throws.
 */
export function rampAmountToAtomic(text: string, decimals: number): RampAmountResult {
  const t = text.trim();
  if (!t) return { ok: false, error: 'Enter an amount.' };
  let atomic: bigint;
  try {
    atomic = parseDecimalToAtomic(t, decimals);
  } catch (e) {
    const msg = e instanceof RangeError ? e.message : '';
    if (/at most \d+ decimals/.test(msg)) return { ok: false, error: `This token has at most ${decimals} decimals.` };
    return { ok: false, error: 'Enter a plain positive number, for example 10.00 (no signs or exponents).' };
  }
  if (atomic <= 0n) return { ok: false, error: 'Amount must be greater than zero.' };
  const s = atomic.toString();
  if (s.length > MAX_ATOMIC_DIGITS) return { ok: false, error: 'Amount is too large.' };
  return { ok: true, atomic: s };
}

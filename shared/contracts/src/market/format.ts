import { marketToken, type MarketTokenKey } from './tokens';

/**
 * Display formatting and parsing of market amounts (W13-17). **Display only**: ledger and settlement code never reads
 * these strings back; they work on bigint atomic units. `formatAtomic` and `parseDisplayAmount` are exact inverses,
 * so no display rounding can change a ledger amount. Only the explicitly lossy `formatUnitPrice` rounds (never parsed).
 */
const pow10 = (n: number): bigint => 10n ** BigInt(n);
const MIN_FRACTION = 2;

/**
 * Exact amount: every digit of the token's smallest unit, trailing zeros trimmed down to at least 2 decimals for
 * USDC/NEAR (`10.20`, `0.000001`, `1.5` NEAR = `1.50`); resources are whole units (`300`).
 */
export function formatAtomic(token: MarketTokenKey, atomic: bigint | string): string {
  const value = BigInt(atomic);
  if (value < 0n) return `-${formatAtomic(token, -value)}`;
  const decimals = marketToken(token).decimals;
  if (decimals === 0) return value.toString();
  const whole = value / pow10(decimals);
  let frac = (value % pow10(decimals)).toString().padStart(decimals, '0').replace(/0+$/, '');
  frac = frac.padEnd(MIN_FRACTION, '0');
  return `${whole}.${frac}`;
}

/** Parses what `formatAtomic` prints (and plain `10`, `10.2`). Rejects more decimals than the token has, signs, exponents and empty input. */
export function parseDisplayAmount(token: MarketTokenKey, text: string): bigint {
  const m = /^(0|[1-9]\d*)(?:\.(\d+))?$/.exec(text.trim());
  if (!m) throw new RangeError(`not a plain non-negative amount: "${text}"`);
  const decimals = marketToken(token).decimals;
  const frac = m[2] ?? '';
  if (frac.length > decimals) {
    // trailing zeros beyond the token's precision are harmless only when they are all zeros
    if (!/^0+$/.test(frac.slice(decimals))) throw new RangeError(`${token} has at most ${decimals} decimals: "${text}"`);
  }
  return BigInt(m[1]!) * pow10(decimals) + BigInt(frac.slice(0, decimals).padEnd(decimals, '0') || '0');
}

/**
 * Unit price `num / den` (quote atomic per whole base unit) in whole quote units with adaptive significant digits:
 * three significant digits below 1 (`0.0333`), at least two decimals otherwise (`12.50`, `1.23`). Rounds half up.
 * Lossy by design: use for labels only.
 */
export function formatUnitPrice(num: bigint | string, den: bigint | number, quote: MarketTokenKey): string {
  const n = BigInt(num);
  const d = BigInt(den) * pow10(marketToken(quote).decimals);
  if (d <= 0n) throw new RangeError('price denominator must be positive');
  if (n === 0n) return '0.00';
  const whole = n / d;
  let frac: number;
  if (whole > 0n) frac = Math.max(MIN_FRACTION, 3 - whole.toString().length);
  else {
    let zeros = 0;
    while (n * pow10(zeros) < d) zeros += 1; // value * 10^zeros >= 1, so `zeros - 1` leading zeros after the point
    frac = zeros - 1 + 3;
  }
  const scaled = (2n * n * pow10(frac) + d) / (2n * d);
  const digits = scaled.toString().padStart(frac + 1, '0');
  return `${digits.slice(0, digits.length - frac)}.${digits.slice(digits.length - frac)}`;
}

/** Every market token is a mock in F2 and says so wherever it is shown (NEAR-65). */
export const mockLabel = (token: MarketTokenKey): string => `mock ${token}`;

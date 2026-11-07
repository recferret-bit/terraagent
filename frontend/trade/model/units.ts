import { formatAtomic, formatUnitPrice, mockLabel, parseDisplayAmount, type BookLevel, type MarketTokenKey } from '@terra/contracts';

/** Money here is bigint atomic units only; unit prices are exact rationals `num / den` (quote atomic per whole base unit). */
export interface Ratio { readonly num: string; readonly den: number }

export const fmtAmount = (token: MarketTokenKey, atomic: string | bigint): string => `${formatAtomic(token, atomic)} ${mockLabel(token)}`;
export const fmtUnit = (r: Ratio | null, quote: MarketTokenKey): string => (r ? formatUnitPrice(r.num, r.den, quote) : '-');

/** `a/b <=> c/d` by cross-multiplication: -1, 0, 1. */
export function cmpRatio(a: Ratio, b: Ratio): number {
  const l = BigInt(a.num) * BigInt(b.den);
  const r = BigInt(b.num) * BigInt(a.den);
  return l < r ? -1 : l > r ? 1 : 0;
}

/** Total quote for `amount` base units at a level price: ceil for a buyer that must cross an ask, floor for a seller crossing a bid. */
export function totalAtLevel(level: Ratio, amount: number, round: 'up' | 'down'): bigint {
  const n = BigInt(level.num) * BigInt(amount);
  const d = BigInt(level.den);
  return round === 'down' ? n / d : (n + d - 1n) / d;
}

/** Parses a display amount, or null when it is not a plain positive amount. */
export function tryParse(token: MarketTokenKey, text: string): bigint | null {
  try {
    const v = parseDisplayAmount(token, text);
    return v > 0n ? v : null;
  } catch { return null; }
}

/** Whole base units from a text field; null unless `1..1e9`. */
export function parseUnits(text: string): number | null {
  const t = text.trim();
  if (!/^[1-9]\d{0,9}$/.test(t)) return null;
  const n = Number(t);
  return n <= 1_000_000_000 ? n : null;
}

export const levelRatio = (l: BookLevel): Ratio => ({ num: l.num, den: l.den });

export function ttlLabel(seconds: number): string {
  if (seconds % 86_400 === 0) return `${seconds / 86_400} d`;
  if (seconds % 3600 === 0) return `${seconds / 3600} h`;
  if (seconds % 60 === 0) return `${seconds / 60} min`;
  return `${seconds} s`;
}

/** "1h 02m" / "45s" / "expired" left until `expiresAtMs`. */
export function timeLeft(expiresAtMs: number, nowMs: number): string {
  const s = Math.floor((expiresAtMs - nowMs) / 1000);
  if (s <= 0) return 'expired';
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${String(m % 60).padStart(2, '0')}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

/** Basis points as a percentage label: 100 -> "1.00 %". */
export const bpLabel = (bp: number): string => `${(bp / 100).toFixed(2)} %`;
export const changeLabel = (bp: number | null): string => (bp === null ? '-' : `${bp >= 0 ? '+' : ''}${(bp / 100).toFixed(2)} %`);

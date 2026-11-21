import { STAKING_RULES, type IncomeProjection } from '@terra/contracts';

export const YEAR_MS = 365 * 86_400_000;
export const DAY_MS = 86_400_000;
export const MAX_PREVIEW_NEAR = 1_000_000;
/**
 * Effective APY is capped at 1000 % (`100_000` bp): a dust stake with one large market fill would otherwise print an
 * absurd figure. The UI shows the cap as `1000 %+`.
 */
export const MAX_EFFECTIVE_APY_BP = 100_000;

/** `?amount=` → whole NEAR: non-numeric / empty / non-finite → the default, otherwise clamped to `0..10^6`. */
export function parsePreviewAmount(raw: unknown): number {
  const def = STAKING_RULES.defaultPreviewNear;
  if (typeof raw !== 'string' && typeof raw !== 'number') return def;
  const text = String(raw).trim();
  if (!/^[+-]?\d+(\.\d+)?$/.test(text)) return def;
  const n = Number(text);
  if (!Number.isFinite(n)) return def;
  return Math.min(Math.max(n, 0), MAX_PREVIEW_NEAR);
}

const safe = (n: number): number => (Number.isFinite(n) && n > 0 ? n : 0);

/** Net staking income of `amountNear` at `netApyBp` (simple interest per period; compounding lives in the series). */
export function projectIncome(amountNear: number, netApyBp: number, nearUsd: number): IncomeProjection {
  const amount = safe(amountNear);
  const yearlyNear = (amount * safe(netApyBp)) / 10_000;
  const price = safe(nearUsd);
  const dailyNear = yearlyNear / 365;
  const monthlyNear = yearlyNear / 12;
  return {
    amountNear: amount,
    dailyNear,
    monthlyNear,
    yearlyNear,
    dailyUsd: dailyNear * price,
    monthlyUsd: monthlyNear * price,
    yearlyUsd: yearlyNear * price,
  };
}

export interface EffectiveApyInput {
  readonly netApyBp: number;
  /** Staked value now (active + LST), USD. */
  readonly stakedUsd: number;
  readonly windowMs: number;
  /** NON-SELF fee savings + stall royalties + Lead Patron revenue earned inside the window, USD. */
  readonly extrasUsd: number;
}

/**
 * `base net APY + annualized(non-self extras) / staked USD`, in bp. Zero when nothing is staked; never negative
 * (negative extras count as 0); non-finite inputs count as 0; capped at `MAX_EFFECTIVE_APY_BP`.
 */
export function effectiveApyBp(i: EffectiveApyInput): number {
  if (!(Number.isFinite(i.stakedUsd) && i.stakedUsd > 0)) return 0;
  const windowMs = Number.isFinite(i.windowMs) && i.windowMs > 0 ? i.windowMs : YEAR_MS;
  const extraAnnual = safe(i.extrasUsd) * (YEAR_MS / windowMs);
  const bp = safe(i.netApyBp) + (extraAnnual / i.stakedUsd) * 10_000;
  return Math.min(MAX_EFFECTIVE_APY_BP, Math.max(0, Math.round(bp)));
}

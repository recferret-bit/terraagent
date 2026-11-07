import type { Ratio } from '../../../economy/flows/ratio';
import { maxBuyerSpend } from '../market-fees';
import type { AgentReason } from './types';

/** `ceil(units * unit)` for a non-negative rational (transport and cost totals never round in the agent's favour). */
export const ceilTimes = (units: bigint, unit: Ratio): bigint => (units * unit.num + unit.den - 1n) / unit.den;
/** `floor(units * unit)`. */
export const floorTimes = (units: bigint, unit: Ratio): bigint => (units * unit.num) / unit.den;

/**
 * Largest principal whose reservation `maxBuyerSpend(principal, platformBp, stallBp)` fits `limit` (0 when none does). The
 * reservation is a floor-based, monotone function, so the closed form is checked and nudged by the rounding step.
 */
export function principalForSpend(limit: bigint, platformFeeBp: number, maxStallFeeBp: number): bigint {
  if (limit <= 0n) return 0n;
  const feeBp = BigInt(platformFeeBp + maxStallFeeBp);
  let p = (limit * 10_000n) / (10_000n + feeBp);
  while (p > 0n && maxBuyerSpend(p, platformFeeBp, maxStallFeeBp) > limit) p--;
  while (maxBuyerSpend(p + 1n, platformFeeBp, maxStallFeeBp) <= limit) p++;
  return p;
}

export interface BidLimits {
  readonly platformFeeBp: number;
  readonly maxStallFeeBp: number;
  /** Quote the colony may lock: free quote capped by the remaining budget. */
  readonly cashLimit: bigint;
  /** Largest bid principal (budget per order). */
  readonly maxOrderQuote: bigint;
  readonly transportPerUnit: Ratio;
}

export interface BidFit {
  readonly amount: bigint;
  readonly principal: bigint;
  /** Quote the order locks (principal + maximum fees) plus the transport bill. */
  readonly maxSpend: bigint;
}

/**
 * Largest lot-multiple `amount <= maxAmount` whose bid fits every hard limit, where `principalAt(units)` is the price the
 * agent wants for that many units (already capped by the walk-away price). The fit is monotone in the amount, so a binary
 * search over lots finds it; the price per unit is never lowered to make room (a lower price would not be the quote).
 */
export function fitBid(maxAmount: bigint, lot: bigint, principalAt: (units: bigint) => bigint, l: BidLimits): BidFit | null {
  const fits = (lots: bigint): BidFit | null => {
    const amount = lots * lot;
    const principal = principalAt(amount);
    const maxSpend = maxBuyerSpend(principal, l.platformFeeBp, l.maxStallFeeBp) + ceilTimes(amount, l.transportPerUnit);
    return principal > 0n && principal <= l.maxOrderQuote && maxSpend <= l.cashLimit ? { amount, principal, maxSpend } : null;
  };
  let lo = 0n, hi = maxAmount / lot;
  let best: BidFit | null = null;
  while (lo < hi) {
    const mid = (lo + hi + 1n) / 2n;
    const f = fits(mid);
    if (f) { best = f; lo = mid; } else hi = mid - 1n;
  }
  return best;
}

/** Why `fitBid` found nothing, most specific first. */
export function noFitReason(cashLimit: bigint, walkCapForOneLot: bigint): AgentReason {
  if (cashLimit <= 0n) return 'no_cash';
  if (walkCapForOneLot <= 0n) return 'below_walkaway';
  return 'size_zero';
}

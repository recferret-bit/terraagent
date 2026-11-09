import { ratio, type Ratio } from '../../../economy/flows/ratio';
import { WAD, powRatioWad } from './fixed-point';
import type { AgentParams } from './params';
import type { AgentReason, ReferenceInput } from './types';
import { validRatio } from './value';

/**
 * The ECONOMY section 4 quote function, exact and deterministic:
 *   scarcity = clamp((target + eps) / (inventory + eps), low, high)      (clamp by cross-multiplication, exact)
 *   mid      = reference * scarcity^k                                    (`powRatioWad`, k = num / den, rounded down)
 *   bid      = mid * (1 - bidHalfSpread),  ask = mid * (1 + askHalfSpread)
 * Orders carry TOTAL prices, so rounding happens once per order total: a bid total rounds DOWN, an ask total UP.
 */
export interface MidPrice {
  /** Quote atomic per whole base unit. */
  readonly mid: Ratio;
  /** `scarcity^k` in WAD (10^18 = 1.0): above 1 the resource is scarce here, below 1 abundant. */
  readonly factorWad: bigint;
}

/** Reasons a reference price cannot be quoted from (empty when it can). Stale or thin never yields a price. */
export function referenceReasons(ref: ReferenceInput, p: AgentParams): AgentReason[] {
  if (ref.price === null) return ['no_reference'];
  if (!validRatio(ref.price) || ref.price.num <= 0n) return ['no_reference'];
  const out: AgentReason[] = [];
  if (ref.ageS === null || !(ref.ageS >= 0) || ref.ageS > p.referenceMaxAgeS) out.push('stale_reference');
  if (ref.basis === 'organic' && (ref.eligibleVolume === null || ref.eligibleVolume < p.minReferenceVolume)) out.push('thin_reference');
  return out;
}

/** `clamp((target + eps) / (inventory + eps))` as an exact fraction; `null` when `inventory + eps` is not positive. */
export function scarcityRatio(target: bigint, inventory: bigint, p: AgentParams): Ratio | null {
  const eps = BigInt(p.epsilonUnits);
  const num = target + eps;
  const den = inventory + eps;
  if (den <= 0n || num <= 0n) return null;
  const low = ratio(BigInt(p.clampLowBp), 10_000n);
  const high = ratio(BigInt(p.clampHighBp), 10_000n);
  if (num * low.den < low.num * den) return low;
  if (num * high.den > high.num * den) return high;
  return ratio(num, den);
}

/** The mid price, or the reasons it does not exist. A zero denominator is `zero_denominator`, never a price. */
export function midPrice(reference: Ratio, target: bigint, inventory: bigint, p: AgentParams): MidPrice | { readonly reasons: readonly AgentReason[] } {
  if (!validRatio(reference) || reference.num <= 0n) return { reasons: ['no_reference'] };
  const s = scarcityRatio(target, inventory, p);
  if (!s) return { reasons: ['zero_denominator'] };
  const f = powRatioWad(s.num, s.den, p.scarcityExponentNum, p.scarcityExponentDen);
  if (f === null) return { reasons: ['zero_denominator'] };
  return { mid: ratio(reference.num * f, reference.den * WAD), factorWad: f };
}

/** Bid total for `amount` units: `floor(amount * mid * (1 - halfSpread))`. */
export const bidTotal = (mid: Ratio, amount: bigint, p: AgentParams): bigint =>
  (amount * mid.num * BigInt(10_000 - p.bidHalfSpreadBp)) / (mid.den * 10_000n);

/** Ask total for `amount` units: `ceil(amount * mid * (1 + halfSpread))`. */
export function askTotal(mid: Ratio, amount: bigint, p: AgentParams): bigint {
  const n = amount * mid.num * BigInt(10_000 + p.askHalfSpreadBp);
  const d = mid.den * 10_000n;
  return (n + d - 1n) / d;
}

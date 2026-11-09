import { mulRatio, ratio, type Ratio } from '../../../economy/flows/ratio';
import type { AgentParams } from './params';
import type { AgentReason, WalkAwayInputs } from './types';

/** A usable rational: positive denominator. (`ratio()` guarantees it; hand-built inputs are checked here.) */
export const validRatio = (r: Ratio | null | undefined): r is Ratio => !!r && r.den > 0n;

const lessThan = (a: Ratio, b: Ratio): boolean => a.num * b.den < b.num * a.den;
const scaleBp = (r: Ratio, bp: bigint): Ratio => ratio(r.num * bp, r.den * 10_000n);

export type Valued = { readonly value: Ratio; readonly reasons?: undefined } | { readonly value: null; readonly reasons: readonly AgentReason[] };

/**
 * Walk-away unit price of a purchase (quote atomic per unit): the cheapest alternative to buying, i.e. the lower of the
 * local unit cost and the production minutes valued at `minuteValue`; with neither, the need value; then reduced by
 * `minSavingBp` so a purchase must save something. Unknown inputs are never replaced by a default:
 * nothing known gives `null` / `no_walkaway_value`, a malformed rational `zero_denominator`.
 */
export function walkAwayUnitPrice(w: WalkAwayInputs, p: AgentParams): Valued {
  const all = [w.localUnitCost, w.localMinutesPerUnit, w.minuteValue, w.needValue];
  if (all.some((r) => r !== null && !validRatio(r))) return { value: null, reasons: ['zero_denominator'] };
  const alts: Ratio[] = [];
  if (validRatio(w.localUnitCost)) alts.push(w.localUnitCost);
  if (validRatio(w.localMinutesPerUnit) && validRatio(w.minuteValue)) alts.push(mulRatio(w.localMinutesPerUnit, w.minuteValue));
  let best: Ratio | null = alts.reduce<Ratio | null>((m, a) => (m === null || lessThan(a, m) ? a : m), null);
  if (best === null && validRatio(w.needValue)) best = w.needValue;
  if (best === null) return { value: null, reasons: ['no_walkaway_value'] };
  return { value: scaleBp(best, BigInt(10_000 - Math.min(10_000, p.minSavingBp))) };
}

/**
 * Lowest unit price an ask may carry: own unit cost plus the reserve value (`reserveMarginBp` over cost), plus transport.
 * An unmeasured cost or transport is `null` with the reason, never zero.
 */
export function minAskUnitPrice(ownUnitCost: Ratio | null, transport: Ratio | null, p: AgentParams): Valued {
  if (ownUnitCost === null) return { value: null, reasons: ['no_unit_cost'] };
  if (transport === null) return { value: null, reasons: ['transport_unknown'] };
  if (!validRatio(ownUnitCost) || !validRatio(transport)) return { value: null, reasons: ['zero_denominator'] };
  const cost = scaleBp(ownUnitCost, BigInt(10_000 + p.reserveMarginBp));
  return { value: ratio(cost.num * transport.den + transport.num * cost.den, cost.den * transport.den) };
}

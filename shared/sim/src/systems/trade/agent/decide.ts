import { ratio, type Ratio } from '../../../economy/flows/ratio';
import { ceilTimes, fitBid, floorTimes, noFitReason, principalForSpend } from './limits';
import { maxBuyerSpend } from '../market-fees';
import { desiredBuyQty, sellableQty, wholeLots } from './need';
import type { AgentParams } from './params';
import { askTotal, bidTotal, midPrice, referenceReasons, type MidPrice } from './quote';
import type { AgentColonyInput, AgentQuotes, AgentReason, SideQuote } from './types';
import { minAskUnitPrice, validRatio, walkAwayUnitPrice } from './value';

type Side = { readonly quote: SideQuote | null; readonly reasons: readonly AgentReason[] };
const paused = (...reasons: AgentReason[]): Side => ({ quote: null, reasons });

const nonNeg = (v: bigint): bigint => (v > 0n ? v : 0n);
const lotOf = (i: AgentColonyInput): bigint => BigInt(Math.max(1, Math.floor(i.lotUnits)));

/** The bid: need and cash bound the size, the walk-away price (net of transport and fees) bounds the price. */
export function quoteBid(i: AgentColonyInput, p: AgentParams, mid: MidPrice | null, midReasons: readonly AgentReason[]): Side {
  if (!mid) return { quote: null, reasons: midReasons };
  if (i.transportPerUnit === null) return paused('transport_unknown');
  if (!validRatio(i.transportPerUnit)) return paused('zero_denominator');
  const want = desiredBuyQty(i.need);
  if (want === 0n) return paused('no_need');
  const wa = walkAwayUnitPrice(i.walkAway, p);
  if (wa.value === null) return { quote: null, reasons: wa.reasons };
  const cash = i.budgetLeft === null || i.freeQuote < i.budgetLeft ? i.freeQuote : i.budgetLeft;
  const lot = lotOf(i);
  const cap = wholeLots(want < BigInt(p.maxOrderUnits) ? want : BigInt(p.maxOrderUnits), Number(lot));
  const transport = i.transportPerUnit;
  const walkCap = (units: bigint): bigint => principalForSpend(floorTimes(units, wa.value) - ceilTimes(units, transport), i.platformFeeBp, i.maxStallFeeBp);
  const principalAt = (units: bigint): bigint => {
    const wanted = bidTotal(mid.mid, units, p);
    const limit = walkCap(units);
    return wanted < limit ? wanted : limit;
  };
  const fit = fitBid(cap, lot, principalAt, { platformFeeBp: i.platformFeeBp, maxStallFeeBp: i.maxStallFeeBp, cashLimit: nonNeg(cash), maxOrderQuote: p.maxOrderQuoteAtomic, transportPerUnit: transport });
  if (!fit) {
    const principal = principalAt(lot);
    return paused(cap === 0n ? 'size_zero' : noFitReason(cash, { principal, spend: maxBuyerSpend(principal, i.platformFeeBp, i.maxStallFeeBp) + ceilTimes(lot, transport) }));
  }
  if (fit.principal < i.minNotionalAtomic) return paused('below_min_notional');
  return { quote: { side: 'buy', token: i.quote, amount: fit.amount, priceAmount: fit.principal, maxSpend: fit.maxSpend }, reasons: [] };
}

/** The ask: surplus bounds the size; the price is the mid-based ask, never below own cost plus reserve margin and transport. */
export function quoteAsk(i: AgentColonyInput, p: AgentParams, mid: MidPrice | null): Side {
  const floor = minAskUnitPrice(i.ownUnitCost, i.transportPerUnit, p);
  if (floor.value === null) return { quote: null, reasons: floor.reasons };
  const spare = sellableQty(i.freeUnits, i.keepUnits);
  if (spare === 0n) return paused('no_surplus');
  const cap = wholeLots(spare < BigInt(p.maxOrderUnits) ? spare : BigInt(p.maxOrderUnits), Number(lotOf(i)));
  if (cap === 0n) return paused('size_zero');
  const costTotal = ceilTimes(cap, floor.value);
  const wanted = mid ? askTotal(mid.mid, cap, p) : costTotal;
  const price = wanted > costTotal ? wanted : costTotal;
  if (price < i.minNotionalAtomic) return paused('below_min_notional');
  return { quote: { side: 'sell', token: i.quote, amount: cap, priceAmount: price, maxSpend: 0n }, reasons: [] };
}

/**
 * Both sides of one colony and resource (ECONOMY section 4). Bids need a usable reference (no/stale/thin pauses them);
 * asks fall back to the cost floor when there is no reference, so a market can start from sellers. Every paused side
 * carries its reason codes; no side is ever priced from a default.
 */
export function quoteColony(i: AgentColonyInput, p: AgentParams): AgentQuotes {
  const refReasons = referenceReasons(i.reference, p);
  const ref: Ratio | null = i.reference.price;
  const m = ref ? midPrice(ref, i.target, i.inventory, p) : { reasons: ['no_reference'] as AgentReason[] };
  const mid = 'mid' in m ? m : null;
  const reasons = [...refReasons, ...('reasons' in m ? m.reasons : [])];
  const bid = quoteBid(i, p, refReasons.length === 0 ? mid : null, reasons);
  const ask = quoteAsk(i, p, refReasons.length === 0 ? mid : null);
  return { basis: ref ? i.reference.basis : null, mid: mid ? ratio(mid.mid.num, mid.mid.den) : null, bid: bid.quote, ask: ask.quote, bidReasons: bid.reasons, askReasons: ask.reasons };
}

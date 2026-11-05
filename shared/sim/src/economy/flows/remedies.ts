import type { QuoteToken, ResourceKey } from '@terra/contracts';
import { ratio, mulRatio, type Ratio } from './ratio';

/**
 * The four remedies of a shortage, side by side (ECONOMY §2.1 "buy / haul / build-depot / reserve"): buy at the best ask
 * including fees, produce locally, build a Supply Depot, or put units in reserve. Pure; the caller supplies the numbers
 * (best ask from the market snapshot, production minutes from `recipeMinutesPerUnit`, depot row, logistics utilization).
 */
export interface RemedyInput {
  readonly resource: ResourceKey;
  /** Whole units missing. */
  readonly qty: number;
  /** Best ask: quote atomic `num` per `den` whole base units, with both buyer fees (bp). Null when nobody sells. */
  readonly ask: { readonly num: bigint; readonly den: bigint; readonly quote: QuoteToken; readonly platformFeeBp: number; readonly stallFeeBp: number } | null;
  /** Production minutes per unit here (extractor / recipe); null when the region cannot produce it. */
  readonly localMinutesPerUnit: Ratio | null;
  /** The cheapest depot that adds supply capacity; null when not applicable. */
  readonly depot: { readonly cost: Readonly<Partial<Record<ResourceKey, number>>>; readonly buildMinutes: number; readonly throughputAdd: number } | null;
  /** Logistics load L, capacity K (window units) when the shortage is a logistics bill. */
  readonly logistics?: { readonly L: Ratio; readonly K: number };
  /** Load a reserve order would take off the bill (units put in reserve); 0 when none can. */
  readonly reserveLoadRelief?: number;
}

export type RemedyKind = 'buy' | 'produce' | 'depot' | 'reserve';
export interface Remedy {
  readonly kind: RemedyKind;
  readonly available: boolean;
  /** Why it is unavailable or what it does not solve. */
  readonly note?: string;
  /** Minutes until the need is met (0 = at once after the trade settles). */
  readonly minutes: Ratio | null;
  /** Buy: notional + fees in the quote token, atomic (ceil). */
  readonly quoteCost?: { readonly token: QuoteToken; readonly notional: bigint; readonly fees: bigint; readonly total: bigint };
  /** Depot: resources spent. */
  readonly resourceCost?: Readonly<Partial<Record<ResourceKey, number>>>;
  /** Depot / reserve: utilization L/K after the remedy (exact). */
  readonly utilizationAfter?: Ratio | null;
}

const ceilDiv = (a: bigint, b: bigint): bigint => (a + b - 1n) / b;

export function compareRemedies(i: RemedyInput): Remedy[] {
  const qty = BigInt(Math.max(0, Math.floor(i.qty)));
  const out: Remedy[] = [];
  if (i.ask && i.ask.den > 0n) {
    const notional = ceilDiv(qty * i.ask.num, i.ask.den);
    const fees = ceilDiv(notional * BigInt(i.ask.platformFeeBp + i.ask.stallFeeBp), 10_000n);
    out.push({ kind: 'buy', available: true, minutes: ratio(0n), quoteCost: { token: i.ask.quote, notional, fees, total: notional + fees } });
  } else out.push({ kind: 'buy', available: false, note: 'no_ask', minutes: null });
  out.push(i.localMinutesPerUnit
    ? { kind: 'produce', available: true, minutes: mulRatio(i.localMinutesPerUnit, ratio(qty)) }
    : { kind: 'produce', available: false, note: 'not_producible_here', minutes: null });
  const L = i.logistics?.L;
  const K = i.logistics?.K ?? 0;
  const util = (cap: number, load: Ratio): Ratio | null => (cap > 0 ? ratio(load.num, load.den * BigInt(cap)) : null);
  if (i.depot) {
    out.push({ kind: 'depot', available: true, minutes: ratio(BigInt(Math.round(i.depot.buildMinutes))), resourceCost: { ...i.depot.cost }, ...(L ? { utilizationAfter: util(K + i.depot.throughputAdd, L) } : {}) });
  } else out.push({ kind: 'depot', available: false, note: 'no_depot_row', minutes: null });
  const relief = Math.max(0, i.reserveLoadRelief ?? 0);
  if (L && relief > 0) {
    const after = ratio(L.num - BigInt(relief) * L.den, L.den);
    out.push({ kind: 'reserve', available: true, minutes: ratio(0n), utilizationAfter: after.num < 0n ? ratio(0n) : util(K, after) });
  } else out.push({ kind: 'reserve', available: false, note: 'nothing_to_reserve', minutes: null });
  return out;
}

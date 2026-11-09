import type { QuoteToken, ResourceKey } from '@terra/contracts';
import { walkAsks, type DepthLevel, type DepthState } from './depth';
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
  /**
   * Best ask: quote atomic `num` per `den` whole base units, with both buyer fees (bp). Null when nobody sells. Without
   * `levels` the whole quantity is priced at this one ask (unlimited depth); with `levels` (the visible ask book) the buy
   * walks them (`walkAsks`) and reports what is actually for sale.
   */
  readonly ask: {
    readonly num: bigint; readonly den: bigint; readonly quote: QuoteToken; readonly platformFeeBp: number; readonly stallFeeBp: number;
    readonly levels?: readonly DepthLevel[];
  } | null;
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
  /** Buy: notional + fees in the quote token, atomic, for the `depth.fillable` units (not for units nobody offers). */
  readonly quoteCost?: { readonly token: QuoteToken; readonly notional: bigint; readonly fees: bigint; readonly total: bigint };
  /** Buy: how much of the missing quantity the visible asks cover (`partial` / `insufficient_depth` say it is not all). */
  readonly depth?: { readonly requested: bigint; readonly fillable: bigint; readonly missing: bigint; readonly state: DepthState };
  /** Depot: resources spent. */
  readonly resourceCost?: Readonly<Partial<Record<ResourceKey, number>>>;
  /** Depot / reserve: utilization L/K after the remedy (exact). */
  readonly utilizationAfter?: Ratio | null;
}

/** The buy remedy: the whole quantity at the one ask, or the visible levels walked in price order. */
function buyRemedy(i: RemedyInput, qty: bigint): Remedy {
  const ask = i.ask;
  if (!ask || ask.den <= 0n || ask.num <= 0n) return { kind: 'buy', available: false, note: 'no_ask', minutes: null };
  const levels = ask.levels ?? [{ num: ask.num, den: ask.den, amount: qty }];
  const q = walkAsks(levels, qty, { platformFeeBp: ask.platformFeeBp, stallFeeBp: ask.stallFeeBp, quote: ask.quote });
  const depth = { requested: q.requested, fillable: q.fillable, missing: q.missing, state: q.state };
  if (q.fillable === 0n && qty > 0n) return { kind: 'buy', available: false, note: 'insufficient_depth', minutes: null, depth };
  return {
    kind: 'buy', available: true, minutes: ratio(0n), depth, ...(q.state === 'partial' ? { note: 'partial_depth' } : {}),
    quoteCost: { token: ask.quote, notional: q.notional, fees: q.fees, total: q.total },
  };
}

export function compareRemedies(i: RemedyInput): Remedy[] {
  const qty = BigInt(Number.isFinite(i.qty) ? Math.max(0, Math.floor(i.qty)) : 0);
  const out: Remedy[] = [];
  out.push(buyRemedy(i, qty));
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

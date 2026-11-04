import { OrderBook, remainingOf, priceOfOrder, type RestingOrder } from './market-book';
import { crosses, type LimitPrice } from './market-price';

/** What the matcher needs of an order beyond `RestingOrder`: the terms pinned at placement (ECONOMY §3). */
export interface MatchableOrder extends RestingOrder {
  readonly fillPolicy: string;
  readonly policyVersion: string;
  readonly platformFeeBp: number;
  /** The stall rate this order's stall charges when this order is the maker. */
  readonly stallFeeBp: number;
  /** Buyer's explicit maximum maker-stall rate; null for sells. */
  readonly maxStallFeeBp: number | null;
}

/** One match. The price is always the maker's rational (`priceAmount / amount` of the maker order). */
export interface Fill {
  readonly makerOrderId: string;
  readonly takerOrderId: string;
  readonly makerSide: 'buy' | 'sell';
  readonly buyerOrderId: string;
  readonly sellerOrderId: string;
  readonly buyerColonyId: string;
  readonly sellerColonyId: string;
  /** Whole base units. */
  readonly qty: bigint;
  /** Maker's limit price: quote atomic `num` per `den` whole base units. */
  readonly price: LimitPrice;
}

export interface MatchResult {
  readonly fills: Fill[];
  /** Base units of the incoming order still unfilled after these fills (the caller rests it when it is bookable). */
  readonly restingRemainder: bigint;
}

/** Same platform fee and the same policy version (the version fixes rounding and fee-bucket rules). */
export const policyCompatKey = (o: Pick<MatchableOrder, 'policyVersion'>): string => o.policyVersion;
export function policiesCompatible(a: MatchableOrder, b: MatchableOrder): boolean {
  return a.platformFeeBp === b.platformFeeBp && policyCompatKey(a) === policyCompatKey(b);
}

/** The maker's stall rate must fit the buyer's explicit maximum (a missing maximum tolerates 0 bp only). */
function stallFits(maker: MatchableOrder, taker: MatchableOrder): boolean {
  const buyer = maker.side === 'buy' ? maker : taker;
  return maker.stallFeeBp <= (buyer.maxStallFeeBp ?? 0);
}

function makeFill(maker: MatchableOrder, taker: MatchableOrder, qty: bigint): Fill {
  const buyer = maker.side === 'buy' ? maker : taker;
  const seller = maker.side === 'buy' ? taker : maker;
  return {
    makerOrderId: maker.orderId,
    takerOrderId: taker.orderId,
    makerSide: maker.side,
    buyerOrderId: buyer.orderId,
    sellerOrderId: seller.orderId,
    buyerColonyId: buyer.colonyId,
    sellerColonyId: seller.colonyId,
    qty,
    price: priceOfOrder(maker),
  };
}

/**
 * Crosses `incoming` against the opposite side of `book` in price-time priority. Pure: the book is not changed (the
 * caller persists the fills and updates it). Rules:
 *  - execution price is the maker's; a fill needs bid >= ask;
 *  - resting orders of the incoming order's colony are skipped, never cancelled (self-trade prevention);
 *  - incompatible policies and a maker stall rate above the buyer's maximum are skipped;
 *  - a `partial` incoming order fills as much as it can; an `all_or_nothing` incoming order fills only if it can
 *    complete now, otherwise it returns no fills and rests unfilled (it is never rejected here);
 *  - a resting `all_or_nothing` maker is taken in full or not at all (skipped when the taker needs less).
 * Greedy and deterministic; an AON maker that does not fit is skipped, not backtracked.
 */
export function matchIncoming(book: OrderBook<MatchableOrder>, incoming: MatchableOrder): MatchResult {
  const want = remainingOf(incoming);
  const fills: Fill[] = [];
  let left = want;
  for (const maker of book.opposite(incoming.side)) {
    if (left <= 0n) break;
    const bid = incoming.side === 'buy' ? incoming : maker;
    const ask = incoming.side === 'buy' ? maker : incoming;
    if (!crosses(priceOfOrder(bid), priceOfOrder(ask))) break; // sorted: nothing further crosses
    if (maker.orderId === incoming.orderId || maker.colonyId === incoming.colonyId) continue;
    if (!policiesCompatible(maker, incoming) || !stallFits(maker, incoming)) continue;
    const avail = remainingOf(maker);
    if (avail <= 0n) continue;
    const qty = avail < left ? avail : left;
    if (maker.fillPolicy === 'all_or_nothing' && qty < avail) continue;
    fills.push(makeFill(maker, incoming, qty));
    left -= qty;
  }
  if (incoming.fillPolicy === 'all_or_nothing' && left > 0n) return { fills: [], restingRemainder: want };
  return { fills, restingRemainder: left };
}

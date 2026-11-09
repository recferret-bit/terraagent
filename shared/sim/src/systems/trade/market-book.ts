import type { BookLevel } from '@terra/contracts';
import { bookLevelOf, comparePrice, limitPrice, type LimitPrice } from './market-price';

export type BookSide = 'buy' | 'sell';

/** The fields the book needs of a resting order; callers may carry more (`OrderBook<T>` keeps the object as given). */
export interface RestingOrder {
  readonly orderId: string;
  /** Time priority inside a price level: the DB row id (ascending = older). */
  readonly seq: bigint;
  readonly side: BookSide;
  readonly colonyId: string;
  /** Whole base units ordered. */
  readonly amount: bigint;
  /** Whole base units filled so far. */
  readonly filled: bigint;
  /** Total quote atomic for `amount`. */
  readonly priceAmount: bigint;
}

export const remainingOf = (o: Pick<RestingOrder, 'amount' | 'filled'>): bigint => o.amount - o.filled;
export const priceOfOrder = (o: Pick<RestingOrder, 'amount' | 'priceAmount'>): LimitPrice => limitPrice(o.priceAmount, o.amount);

/** Price-time priority: bids best (highest) first, asks best (lowest) first, ties by `seq` ascending. */
function compareForSide(side: BookSide, a: RestingOrder, b: RestingOrder): number {
  const c = comparePrice(priceOfOrder(a), priceOfOrder(b));
  if (c !== 0) return side === 'buy' ? -c : c;
  return a.seq < b.seq ? -1 : a.seq > b.seq ? 1 : 0;
}

/** In-memory order book of one pair on one planet. Pure and deterministic; persistence is the caller's job. */
export class OrderBook<T extends RestingOrder = RestingOrder> {
  private readonly bids: T[] = [];
  private readonly asks: T[] = [];
  private readonly byId = new Map<string, T>();

  constructor(readonly pair: string) {}

  get size(): number {
    return this.byId.size;
  }

  has(orderId: string): boolean {
    return this.byId.has(orderId);
  }

  get(orderId: string): T | undefined {
    return this.byId.get(orderId);
  }

  private sideList(side: BookSide): T[] {
    return side === 'buy' ? this.bids : this.asks;
  }

  /** Inserts at its priority position. Replaces an existing order of the same id. */
  add(order: T): void {
    if (this.byId.has(order.orderId)) this.remove(order.orderId);
    const list = this.sideList(order.side);
    let lo = 0;
    let hi = list.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (compareForSide(order.side, list[mid]!, order) <= 0) lo = mid + 1;
      else hi = mid;
    }
    list.splice(lo, 0, order);
    this.byId.set(order.orderId, order);
  }

  remove(orderId: string): T | undefined {
    const order = this.byId.get(orderId);
    if (!order) return undefined;
    const list = this.sideList(order.side);
    const i = list.indexOf(order);
    if (i >= 0) list.splice(i, 1);
    this.byId.delete(orderId);
    return order;
  }

  /** Sets the filled amount (price, side and priority never change). A fully filled order leaves the book. */
  update(orderId: string, filled: bigint): T | undefined {
    const order = this.byId.get(orderId);
    if (!order) return undefined;
    if (filled < 0n || filled > order.amount) throw new RangeError(`filled ${filled} outside 0..${order.amount} for ${orderId}`);
    if (filled === order.amount) {
      this.remove(orderId);
      return { ...order, filled };
    }
    const next = { ...order, filled };
    const list = this.sideList(order.side);
    list[list.indexOf(order)] = next;
    this.byId.set(orderId, next);
    return next;
  }

  bestBid(): T | undefined {
    return this.bids[0];
  }

  bestAsk(): T | undefined {
    return this.asks[0];
  }

  /** The orders a taker of `takerSide` can match against, in priority order (a taker buy walks the asks). */
  *opposite(takerSide: BookSide): IterableIterator<T> {
    yield* [...(takerSide === 'buy' ? this.asks : this.bids)];
  }

  /** All orders of one side in priority order (a copy). */
  orders(side: BookSide): T[] {
    return [...this.sideList(side)];
  }

  /** Top `levels` aggregated levels of a side (equal rational prices merge), for the `market.book` push. */
  depth(side: BookSide, levels: number): BookLevel[] {
    const out: BookLevel[] = [];
    let cur: { price: LimitPrice; amount: bigint; orders: number } | undefined;
    const flush = (): void => {
      if (cur) out.push(bookLevelOf(cur.price, cur.amount, cur.orders));
    };
    for (const o of this.sideList(side)) {
      const rem = remainingOf(o);
      if (rem <= 0n) continue;
      const price = priceOfOrder(o);
      if (cur && comparePrice(cur.price, price) === 0) {
        cur.amount += rem;
        cur.orders += 1;
        continue;
      }
      flush();
      if (out.length >= levels) return out;
      cur = { price, amount: rem, orders: 1 };
    }
    if (out.length < levels) flush();
    return out;
  }
}

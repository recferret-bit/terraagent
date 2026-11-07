import type { ActorKind, BookLevel, OrderSide, TradeOrderView } from '@terra/contracts';
import { cmpRatio, levelRatio, type Ratio } from './units';

/** One line of the market-wide table. `kind: 'level'` is an aggregate of every resting order at that price (all actors); `own` is one of the caller's orders. */
export type MarketLine =
  | { readonly kind: 'level'; readonly side: OrderSide; readonly price: Ratio; readonly amount: number; readonly orders: number; readonly ownAtLevel: number }
  | { readonly kind: 'own'; readonly side: OrderSide; readonly price: Ratio; readonly order: TradeOrderView; readonly remaining: number; readonly actor: ActorKind };

const RESTING = new Set(['OPEN', 'PARTIAL']);

/** Unit price of an own order as an exact rational: total quote / amount. */
export const orderPrice = (o: TradeOrderView): Ratio => ({ num: o.price.amount, den: o.amount });
export const orderRemaining = (o: TradeOrderView): number => Math.max(0, o.amount - o.filled);

/**
 * Merges aggregated book levels with the caller's own resting orders of the pair. The endpoint exposes no per-order rows of other
 * actors (no actor kind, stall fee, TTL or AON flag), so those are shown only for own orders; levels carry amount and order count.
 * Asks come first (best at the bottom, nearest the spread), then bids best-first; own lines sit right after their level.
 */
export function buildMarketLines(asks: readonly BookLevel[], bids: readonly BookLevel[], own: readonly TradeOrderView[], pair: string): MarketLine[] {
  const mine = own.filter((o) => o.pair === pair && RESTING.has(o.state));
  const lines: MarketLine[] = [];
  const emit = (side: OrderSide, levels: readonly BookLevel[], dir: 1 | -1): void => {
    const sideOwn = mine.filter((o) => o.side === side);
    const used = new Set<string>();
    const sorted = [...levels].sort((a, b) => cmpRatio(levelRatio(a), levelRatio(b)) * dir);
    const placeOwn = (price: Ratio): MarketLine[] => sideOwn.filter((o) => !used.has(o.orderId) && cmpRatio(orderPrice(o), price) === 0).map((order) => {
      used.add(order.orderId);
      return { kind: 'own', side, price, order, remaining: orderRemaining(order), actor: 'player' } as MarketLine;
    });
    for (const level of sorted) {
      const price = levelRatio(level);
      const ownLines = placeOwn(price);
      lines.push({ kind: 'level', side, price, amount: level.amount, orders: level.orders, ownAtLevel: ownLines.length }, ...ownLines);
    }
    // an own order whose level is beyond the fetched depth still shows up
    for (const o of sideOwn) if (!used.has(o.orderId)) lines.push({ kind: 'own', side, price: orderPrice(o), order: o, remaining: orderRemaining(o), actor: 'player' });
  };
  emit('sell', asks, -1);
  emit('buy', bids, -1);
  return lines;
}

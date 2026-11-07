import type { ActorKind, OrderSide, TradeFillView, TradeOrderView, TradeView } from '@terra/contracts';
import type { PrismaClient } from '@terra/db';
import { toRecord } from '../book/market-order.record.js';
import { myOrderView, tradeView } from '../api/market-snapshot.service.js';

export type OrderRow = NonNullable<Awaited<ReturnType<PrismaClient['marketOrder']['findUnique']>>>;
export type TradeRow = NonNullable<Awaited<ReturnType<PrismaClient['intentTrade']['findUnique']>>>;

/** A persisted order as the trade API shows it (the game client's `MyOrderView` plus planet, actor and last error). */
export const tradeOrderView = (r: OrderRow): TradeOrderView => ({
  ...myOrderView(toRecord(r)), planetId: r.planetId, actorKind: r.actorKind as ActorKind, lastError: r.lastError,
});

/** One trade from the point of view of `colonyId` (side, own order id, who was on the other side). */
export function tradeFillView(t: TradeRow, colonyId: string): TradeFillView {
  const buyer = t.buyerColonyId === colonyId;
  const makerIsBuyer = t.makerSide === 'buy';
  const buyerOrder = makerIsBuyer ? t.makerOrderId : t.takerOrderId;
  const sellerOrder = makerIsBuyer ? t.takerOrderId : t.makerOrderId;
  const base: TradeView = { ...tradeView(t), state: t.state as TradeView['state'], actorKind: (buyer ? t.buyerActorKind : t.sellerActorKind) as ActorKind };
  const side: OrderSide = buyer ? 'buy' : 'sell';
  return { ...base, side, orderId: buyer ? buyerOrder : sellerOrder, counterpartyKind: (buyer ? t.sellerActorKind : t.buyerActorKind) as ActorKind };
}

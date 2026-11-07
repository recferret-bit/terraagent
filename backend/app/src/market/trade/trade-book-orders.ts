import { createHash } from 'node:crypto';
import type { ActorKind, FillPolicy, TradeBookOrderView } from '@terra/contracts';
import { limitPrice, reducePrice } from '@terra/sim/systems/trade/market-price';
import type { MarketOrderRecord } from '../book/market-order.record.js';

/** Stable per-planet pseudonym of a colony: lets a reader group orders of one maker without learning the colony id. */
export const colonyRef = (planetId: string, colonyId: string): string => createHash('sha256').update(`book-order-colony:${planetId}:${colonyId}`).digest('hex').slice(0, 12);

/** One resting order as the public list shows it: no account, player, reservation or fee-bucket data. */
export function bookOrderView(o: MarketOrderRecord, myColonyId: string | null | undefined): TradeBookOrderView {
  const p = reducePrice(limitPrice(o.priceAmount, o.amount));
  return {
    orderId: o.orderId, side: o.side, price: { num: p.num.toString(), den: Number(p.den) }, amount: Number(o.amount), remaining: Number(o.amount - o.filled),
    actorKind: o.actorKind as ActorKind, stallFeeBp: o.stallFeeBp, expiresAtMs: o.expiresAt.getTime(), fillPolicy: o.fillPolicy as FillPolicy, colonyRef: colonyRef(o.planetId, o.colonyId),
    ...(myColonyId === undefined ? {} : { mine: myColonyId !== null && o.colonyId === myColonyId }),
  };
}

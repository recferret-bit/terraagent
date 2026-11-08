import { createHmac, randomBytes } from 'node:crypto';
import { Logger } from '@nestjs/common';
import type { ActorKind, FillPolicy, TradeBookOrderView } from '@terra/contracts';
import { limitPrice, reducePrice } from '@terra/sim/systems/trade/market-price';
import type { MarketOrderRecord } from '../book/market-order.record.js';

/** Stable per-planet pseudonym of a colony: lets a reader group orders of one maker without learning the colony id. */
let fallbackSecret: string | null = null;
/** `TA_COLONY_REF_SECRET`; unset: a random per-process secret (refs then change on restart; production logs it once). */
function refSecret(): string {
  const set = process.env.TA_COLONY_REF_SECRET;
  if (set) return set;
  if (!fallbackSecret) {
    fallbackSecret = randomBytes(32).toString('hex');
    if (process.env.NODE_ENV === 'production') new Logger('colonyRef').warn('TA_COLONY_REF_SECRET is not set: colonyRef pseudonyms use a random per-process secret and change on restart');
  }
  return fallbackSecret;
}

/** HMAC (keyed by a server secret) so a reader cannot reverse the pseudonym by hashing guessable colony ids. */
export const colonyRef = (planetId: string, colonyId: string, secret: string = refSecret()): string =>
  createHmac('sha256', secret).update(`book-order-colony:${planetId}:${colonyId}`).digest('hex').slice(0, 12);

/** One resting order as the public list shows it: no account, player, reservation or fee-bucket data. */
export function bookOrderView(o: MarketOrderRecord, myColonyId: string | null | undefined): TradeBookOrderView {
  const p = reducePrice(limitPrice(o.priceAmount, o.amount));
  return {
    orderId: o.orderId, side: o.side, price: { num: p.num.toString(), den: Number(p.den) }, amount: Number(o.amount), remaining: Number(o.amount - o.filled),
    actorKind: o.actorKind as ActorKind, stallFeeBp: o.stallFeeBp, expiresAtMs: o.expiresAt.getTime(), fillPolicy: o.fillPolicy as FillPolicy, colonyRef: colonyRef(o.planetId, o.colonyId),
    ...(myColonyId === undefined ? {} : { mine: myColonyId !== null && o.colonyId === myColonyId }),
  };
}

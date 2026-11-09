import { addAmounts, sumAmounts, type ColonyMarketState, type MarketPolicy, type MarketResourceAmounts } from './market-state';

/**
 * The ONE place that decides when an order's open-order slot (`market.openOrders[ref]`, counted against `openOrderLimit`) ends.
 *
 * An order holds a slot from `market.reserve` until it ends for ANY reason: fully filled, cancelled, expired, rejected or
 * settlement failed. Whether it reserved a resource is irrelevant (a USDC-paid buy reserves none in the sim).
 * Reservation accounting (`reservedInOrbit`) is separate and untouched by this module.
 */

/** Ends the order (`market.release`, any reason): the slot is freed; deleting twice is a no-op. */
export function endOrder(market: ColonyMarketState, ref: string): void {
  delete market.openOrders[ref];
  delete market.requested[ref];
}

/**
 * Applies one final fill (`market.settled`, buyer/seller role) to the order's mirror: consumes `released` reservation, counts the
 * filled base units and ends the order once it is complete (filled >= amount, or its reservation hit 0 by this fill).
 */
export function applyFill(market: ColonyMarketState, ref: string, filledUnits: number, released?: MarketResourceAmounts): void {
  const order = market.openOrders[ref];
  if (!order) return;
  const before = sumAmounts(order.reserved);
  if (released) addAmounts(order.reserved, released, -1);
  order.filled = (order.filled ?? 0) + filledUnits;
  const reservationConsumed = before > 0 && sumAmounts(order.reserved) === 0;
  const complete = order.amount > 0 && order.filled >= order.amount;
  if (reservationConsumed || complete) endOrder(market, ref);
}

/**
 * Bounded self-heal for colonies persisted before this lifecycle existed: their leaked slots are refs with no reservation and no
 * `filled` counter (new reserves always write `filled`). Called when the limit is reached; drops the oldest such refs until a slot
 * is free. A legacy USDC-paid order that is genuinely still open loses only its HUD mirror (the DB stays authoritative).
 */
export function healLeakedSlots(market: ColonyMarketState, policy: MarketPolicy): void {
  const keys = Object.keys(market.openOrders);
  for (const k of keys) {
    if (Object.keys(market.openOrders).length < policy.openOrderLimit) return;
    const o = market.openOrders[k];
    if (o.filled === undefined && sumAmounts(o.reserved) === 0) delete market.openOrders[k];
  }
}

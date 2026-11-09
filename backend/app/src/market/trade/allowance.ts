import type { TradeAllowance, TradeErrorCode } from '@terra/contracts';

/** A reference price as the board reports it: quote atomic `num` per `den` whole base units. */
export interface ReferencePrice { readonly num: bigint; readonly den: bigint }

export interface AllowanceOrder {
  readonly pair: string;
  readonly amount: bigint;
  /** Total quote atomic of the full amount (`price.amount`). */
  readonly notional: bigint;
}

export interface AllowanceUsage {
  /** Orders already resting or pending (requests in flight count before their order exists). */
  readonly outstandingOrders: number;
  /** Quote atomic committed today: open/pending orders in full, ended orders what they filled. */
  readonly committedToday: bigint;
  readonly reference: ReferencePrice | null;
}

export interface AllowanceRejection { readonly code: TradeErrorCode; readonly message: string; readonly details: Record<string, unknown> }

/**
 * The agent safety rails as one pure function. First failing rail wins, in this order (each has a stable code):
 * `kill_switch`, `pair_not_allowed`, `max_order_notional`, `max_open_orders`, `daily_budget_exceeded`, `price_out_of_band`.
 * The price band only applies while an organic reference exists; without one (empty market) the order passes this rail.
 */
export function checkAllowance(a: TradeAllowance, order: AllowanceOrder, use: AllowanceUsage): AllowanceRejection | null {
  if (a.killSwitch) return reject('kill_switch', 'The kill switch of this key is on.', {});
  if (!a.allowedPairs.includes(order.pair)) return reject('pair_not_allowed', `Pair ${order.pair} is not allowed for this key.`, { pair: order.pair, allowedPairs: a.allowedPairs });
  const maxNotional = BigInt(a.maxOrderNotional);
  if (order.notional > maxNotional) return reject('max_order_notional', `Order notional ${order.notional} exceeds ${maxNotional}.`, { notional: order.notional.toString(), max: maxNotional.toString() });
  if (use.outstandingOrders >= a.maxOpenOrders) return reject('max_open_orders', `At most ${a.maxOpenOrders} open or pending orders.`, { outstanding: use.outstandingOrders, max: a.maxOpenOrders });
  const budget = BigInt(a.dailyBudget);
  if (use.committedToday + order.notional > budget) {
    return reject('daily_budget_exceeded', `Daily budget ${budget} would be exceeded.`, { committedToday: use.committedToday.toString(), notional: order.notional.toString(), budget: budget.toString() });
  }
  if (a.priceBandBp !== null && use.reference && outOfBand(order, use.reference, a.priceBandBp)) {
    return reject('price_out_of_band', `Unit price is more than ${a.priceBandBp} bp from the reference.`, { bandBp: a.priceBandBp, reference: { num: use.reference.num.toString(), den: use.reference.den.toString() } });
  }
  return null;
}

/** |price/amount - num/den| / (num/den) > band/10000, exactly, by cross-multiplication. */
export function outOfBand(o: AllowanceOrder, ref: ReferencePrice, bandBp: number): boolean {
  if (ref.num <= 0n || ref.den <= 0n || o.amount <= 0n) return false;
  const diff = o.notional * ref.den - ref.num * o.amount;
  return (diff < 0n ? -diff : diff) * 10_000n > BigInt(bandBp) * ref.num * o.amount;
}

const reject = (code: TradeErrorCode, message: string, details: Record<string, unknown>): AllowanceRejection => ({ code, message, details });

/** Start of the current UTC day: the allowance's daily window. */
export const dayStart = (nowMs: number): Date => new Date(Math.floor(nowMs / 86_400_000) * 86_400_000);

import { buildTradeBatch, type BatchOrder, type TradeBatch, type TreasuryTerms } from '@terra/sim/systems/trade/market-batch';
import type { Fill } from '@terra/sim/systems/trade/market-matcher';
import type { MarketOrderRecord } from '../book/market-order.record.js';

const toBatchOrder = (o: MarketOrderRecord): BatchOrder => ({
  orderId: o.orderId,
  colonyId: o.colonyId,
  accountId: o.accountId,
  side: o.side,
  amount: o.amount,
  filled: o.filled,
  priceAmount: o.priceAmount,
  platformFeeBp: o.platformFeeBp,
  stallFeeBp: o.stallFeeBp,
  stallColonyId: o.stallColonyId,
  stallAccountId: o.stallAccountId,
  platformAccountId: o.platformAccountId,
  policyVersion: o.policyVersion,
  feeBuckets: o.feeBuckets,
  cumNotional: o.cumNotional,
  reservedPrincipal: o.reservedPrincipal,
  reservedFees: o.reservedFees,
});

/**
 * Adapts one matcher `Fill` and the locked, re-read order rows to the shared exact batch. Pure: no database access.
 * `orders` must hold both the buyer and seller row as read under `lockForUpdate`; W13-13 persists `batch.buyer` /
 * `batch.seller` (filled, cumNotional, feeBuckets, reservations) and the trade row in one transaction.
 */
export function buildFillBatch(args: {
  readonly tradeId: string;
  readonly fill: Fill;
  readonly orders: ReadonlyMap<string, MarketOrderRecord>;
  readonly treasury: TreasuryTerms;
}): TradeBatch {
  const buyer = args.orders.get(args.fill.buyerOrderId);
  const seller = args.orders.get(args.fill.sellerOrderId);
  if (!buyer || !seller) throw new Error(`orders of fill ${args.tradeId} were not locked`);
  return buildTradeBatch({
    tradeId: args.tradeId,
    base: buyer.base,
    quote: buyer.quote,
    fill: args.fill,
    buyer: toBatchOrder(buyer),
    seller: toBatchOrder(seller),
    treasury: args.treasury,
  });
}

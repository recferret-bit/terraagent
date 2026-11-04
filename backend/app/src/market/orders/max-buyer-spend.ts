const ceilBp = (amount: bigint, bp: number): bigint => (amount * BigInt(bp) + 9_999n) / 10_000n;

/**
 * The most a buyer can be charged for an order whose total quote is `priceAmount`: the principal plus the platform fee
 * and the maximum stall fee, each rounded up (ECONOMY §3). This is what a buy order reserves in full.
 * TODO(W13-12): switch to `maxBuyerSpend` of `@terra/sim/systems/trade/market-fees` once it is merged.
 */
export function maxBuyerSpend(priceAmount: bigint, platformFeeBp: number, maxStallFeeBp: number): bigint {
  return priceAmount + ceilBp(priceAmount, platformFeeBp) + ceilBp(priceAmount, maxStallFeeBp);
}

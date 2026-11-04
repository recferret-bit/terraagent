/**
 * Exact fee and rounding rules of a market fill (ECONOMY §3, LED-20). All bigint; no floats.
 *  - Notional of a fill is cumulative per MAKER order, so any split of a maker's order sums to the unsplit notional.
 *  - Fees are paid by the buyer in the quote token and rounded cumulatively per buyer order and bucket
 *    `(quote, rateBp, beneficiary, policyVersion)`, so splitting a fill inside a bucket never changes the total.
 */
export const BP_DENOMINATOR = 10_000n;

/** `floor(a * b / c)` for non-negative a, b and positive c. */
export const floorMulDiv = (a: bigint, b: bigint, c: bigint): bigint => (a * b) / c;

/** Quote notional of `qty` base units against a maker at rational `priceAmount / amount`, given what the maker already filled. */
export function makerNotional(priceAmount: bigint, amount: bigint, makerFilled: bigint, qty: bigint): bigint {
  return floorMulDiv(makerFilled + qty, priceAmount, amount) - floorMulDiv(makerFilled, priceAmount, amount);
}

/** Cumulative state of one fee bucket on a buyer order (decimal strings, as stored in `feeBuckets` JSON). */
export interface FeeBucket {
  /** Cumulative notional that fee was charged on. */
  readonly base: string;
  /** Cumulative fee charged so far. */
  readonly fee: string;
}
export type FeeBuckets = Readonly<Record<string, FeeBucket>>;

export const feeBucketKey = (quote: string, rateBp: number, beneficiary: string, policyVersion: string): string =>
  `${quote}|${rateBp}|${beneficiary}|${policyVersion}`;

/** The fee of this fill's notional in a bucket and the bucket after it. */
export function chargeBucketed(buckets: FeeBuckets, key: string, notional: bigint, rateBp: number): { fee: bigint; buckets: FeeBuckets } {
  const prev = buckets[key] ?? { base: '0', fee: '0' };
  const cumBase = BigInt(prev.base);
  const rate = BigInt(rateBp);
  const fee = floorMulDiv(cumBase + notional, rate, BP_DENOMINATOR) - floorMulDiv(cumBase, rate, BP_DENOMINATOR);
  const next: FeeBucket = { base: (cumBase + notional).toString(), fee: (BigInt(prev.fee) + fee).toString() };
  return { fee, buckets: { ...buckets, [key]: next } };
}

/** Treasury allocation carved out of the platform fee (W22). Zero when W22 is off; never taken from the stall fee. */
export function treasuryAllocation(platformFee: bigint, shareBp: number, enabled: boolean): bigint {
  return enabled ? floorMulDiv(platformFee, BigInt(shareBp), BP_DENOMINATOR) : 0n;
}

/**
 * Upper bound of everything a buyer can ever be charged on an order of total quote `priceAmount`: the cumulative
 * floors of every bucket sum to at most `floor(total notional * rate / 10000)`, and total notional never exceeds
 * `priceAmount` (a taker pays the maker's price, never above its own limit). This is the quote reservation of a buy.
 */
export function maxBuyerFees(priceAmount: bigint, platformFeeBp: number, maxStallFeeBp: number): bigint {
  return floorMulDiv(priceAmount, BigInt(platformFeeBp), BP_DENOMINATOR) + floorMulDiv(priceAmount, BigInt(maxStallFeeBp), BP_DENOMINATOR);
}

/** Quote reserved for a buy order: principal plus the maximum fees. */
export const maxBuyerSpend = (priceAmount: bigint, platformFeeBp: number, maxStallFeeBp: number): bigint =>
  priceAmount + maxBuyerFees(priceAmount, platformFeeBp, maxStallFeeBp);

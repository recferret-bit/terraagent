import { canonical } from '../../data/_hash';
import { sha256Hex } from '../../economy/sha256';
import type { Fill } from './market-matcher';
import { chargeBucketed, feeBucketKey, makerNotional, type FeeBuckets } from './market-fees';

/** An order as the batch builder sees it: pinned terms plus the exact cumulative state read under the row lock. */
export interface BatchOrder {
  readonly orderId: string;
  readonly colonyId: string;
  readonly accountId: string;
  readonly side: 'buy' | 'sell';
  readonly amount: bigint;
  readonly filled: bigint;
  readonly priceAmount: bigint;
  readonly platformFeeBp: number;
  readonly stallFeeBp: number;
  readonly stallColonyId: string;
  readonly stallAccountId: string;
  readonly platformAccountId: string;
  readonly policyVersion: string;
  readonly feeBuckets: FeeBuckets;
  readonly cumNotional: bigint;
  readonly reservedPrincipal: bigint;
  readonly reservedFees: bigint;
}

export interface TreasuryTerms {
  /** True only while wave W22 is on. */
  readonly enabled: boolean;
  readonly shareBp: number;
  readonly accountId: string;
}

export type LegKind = 'principal' | 'platform_fee' | 'stall_fee' | 'treasury';
export interface Leg {
  readonly accountId: string;
  readonly token: string;
  /** Signed market atomic units. */
  readonly delta: bigint;
}
export interface AttributionLeg extends Leg {
  readonly kind: LegKind;
}

/** New cumulative values of one order after the fill (what W13-13 persists under the same lock). */
export interface OrderUpdate {
  readonly orderId: string;
  readonly filled: bigint;
  readonly cumNotional: bigint;
  readonly feeBuckets: FeeBuckets;
  readonly reservedPrincipal: bigint;
  readonly reservedFees: bigint;
  /** Reservation freed because this fill completed the order (price improvement, fee-maximum slack); 0 otherwise. */
  readonly releasePrincipal: bigint;
  readonly releaseFees: bigint;
}

export interface TradeBatch {
  readonly tradeId: string;
  readonly base: string;
  readonly quote: string;
  readonly qty: bigint;
  readonly notional: bigint;
  /** Gross platform fee the buyer pays (retained + treasury). */
  readonly platformFee: bigint;
  readonly treasuryAllocation: bigint;
  readonly platformRetained: bigint;
  readonly stallFee: bigint;
  readonly stallFeeBp: number;
  readonly platformFeeBp: number;
  /** Per (account, token) sums, identical accounts merged, zero entries dropped, sorted. Zero-sum per token. */
  readonly legs: Leg[];
  /** The same movements before merging, with fee attribution. Zero-sum per token. */
  readonly attribution: AttributionLeg[];
  readonly batchHash: string;
  readonly buyer: OrderUpdate;
  readonly seller: OrderUpdate;
}

export interface BuildBatchInput {
  readonly tradeId: string;
  readonly base: string;
  readonly quote: string;
  readonly fill: Fill;
  /** The order orders by `fill.buyerOrderId` / `fill.sellerOrderId`, as locked and re-read. */
  readonly buyer: BatchOrder;
  readonly seller: BatchOrder;
  readonly treasury: TreasuryTerms;
}

/** Merges legs of the same account and token and drops zero entries; sorted by token then account. */
export function aggregateLegs(legs: readonly Leg[]): Leg[] {
  const sums = new Map<string, Leg>();
  for (const l of legs) {
    const k = `${l.token}\u0000${l.accountId}`;
    const prev = sums.get(k);
    sums.set(k, { accountId: l.accountId, token: l.token, delta: (prev?.delta ?? 0n) + l.delta });
  }
  return [...sums.values()].filter((l) => l.delta !== 0n).sort((a, b) => (a.token === b.token ? (a.accountId < b.accountId ? -1 : 1) : a.token < b.token ? -1 : 1));
}

/** Throws unless every token's legs sum to zero. */
export function assertZeroSum(legs: readonly Leg[]): void {
  const sums = new Map<string, bigint>();
  for (const l of legs) sums.set(l.token, (sums.get(l.token) ?? 0n) + l.delta);
  for (const [token, s] of sums) if (s !== 0n) throw new Error(`batch is not zero-sum for ${token}: ${s}`);
}

export const legsToJson = (legs: readonly AttributionLeg[] | readonly Leg[]): Record<string, string>[] =>
  legs.map((l) => ({ ...l, delta: l.delta.toString() }));

const hashOf = (tradeId: string, legs: Leg[], attribution: AttributionLeg[]): string =>
  `sha256:${sha256Hex(canonical({ tradeId, legs: legsToJson(legs), attribution: legsToJson(attribution) }))}`;

/**
 * The stall fee bucket has its own role-suffixed key: with the platform account equal to the maker's stall account and equal
 * rates the plain `(quote, bp, account, policyVersion)` keys collide and the second charge floors over a base that already
 * holds this fill. Orders persisted before the suffix keep their stall bucket under the plain key: it is adopted as the
 * stall bucket unless that key is the platform's own (a collided bucket is the platform's; the stall starts afresh).
 */
export function stallBucket(buckets: FeeBuckets, legacyKey: string, platformKey: string): { key: string; buckets: FeeBuckets } {
  const key = `${legacyKey}|stall`;
  if (buckets[key] || !buckets[legacyKey] || legacyKey === platformKey) return { key, buckets };
  return { key, buckets: { ...buckets, [key]: buckets[legacyKey]! } };
}

/** Buyer-order bucket of the treasury carve. The share is in the key so a later rate does not reuse the old base. */
export const treasuryBucketKey = (platformKey: string, shareBp: number): string => `${platformKey}|treasury|${shareBp}`;

/** Share bp stored on a buyer order, or null when this order has never carved a treasury leg. */
export function treasuryShareInBuckets(buckets: FeeBuckets): number | null {
  const mark = '|treasury|';
  for (const key of Object.keys(buckets)) {
    const at = key.lastIndexOf(mark);
    if (at < 0) continue;
    const n = Number(key.slice(at + mark.length));
    if (Number.isInteger(n) && n >= 0 && n <= 10_000) return n;
  }
  return null;
}

/**
 * Treasury part of this fill's platform fee. Cumulative per buyer bucket (`chargeBucketed`), so two small platform
 * fees can still yield the unit that each fee would floor away on its own. A fresh bucket matches `treasuryAllocation`.
 */
function carveTreasury(buckets: FeeBuckets, platformKey: string, platformFee: bigint, treasury: TreasuryTerms): { part: bigint; buckets: FeeBuckets } {
  if (!treasury.enabled || platformFee <= 0n || treasury.shareBp <= 0) return { part: 0n, buckets };
  const charged = chargeBucketed(buckets, treasuryBucketKey(platformKey, treasury.shareBp), platformFee, treasury.shareBp);
  return { part: charged.fee, buckets: charged.buckets };
}

export interface FillCharge {
  readonly quote: string;
  readonly notional: bigint;
  readonly platformFeeBp: number;
  readonly platformAccountId: string;
  readonly policyVersion: string;
  readonly stallFeeBp: number;
  readonly stallAccountId: string;
  readonly treasury: TreasuryTerms;
}

/** Platform fee, stall fee and treasury carve for one fill, with the buyer's buckets after it. */
export function chargeFillBuckets(buckets: FeeBuckets, c: FillCharge): { buckets: FeeBuckets; platformFee: bigint; stallFee: bigint; treasuryPart: bigint } {
  const platformKey = feeBucketKey(c.quote, c.platformFeeBp, c.platformAccountId, c.policyVersion);
  const stall = stallBucket(buckets, feeBucketKey(c.quote, c.stallFeeBp, c.stallAccountId, c.policyVersion), platformKey);
  const p = chargeBucketed(stall.buckets, platformKey, c.notional, c.platformFeeBp);
  const s = chargeBucketed(p.buckets, stall.key, c.notional, c.stallFeeBp);
  const carved = carveTreasury(s.buckets, platformKey, p.fee, c.treasury);
  return { buckets: carved.buckets, platformFee: p.fee, stallFee: s.fee, treasuryPart: carved.part };
}

/**
 * Builds the exact zero-sum settlement batch of one fill and the resulting order states. Pure. The buyer pays the
 * notional plus the platform fee and the maker's stall fee (whoever is the maker) and receives all base; the seller
 * receives the notional and delivers the base; the treasury share is carved out of the platform fee.
 */
export function buildTradeBatch(input: BuildBatchInput): TradeBatch {
  const { fill, buyer, seller, base, quote, treasury } = input;
  const maker = fill.makerSide === 'buy' ? buyer : seller;
  const qty = fill.qty;
  if (qty <= 0n) throw new RangeError('fill quantity must be positive');
  if (fill.buyerOrderId !== buyer.orderId || fill.sellerOrderId !== seller.orderId) throw new Error('fill does not match the given orders');
  for (const o of [buyer, seller]) if (o.filled + qty > o.amount) throw new RangeError(`fill exceeds ${o.orderId}`);
  const notional = makerNotional(maker.priceAmount, maker.amount, maker.filled, qty);
  const charged = chargeFillBuckets(buyer.feeBuckets, {
    quote, notional, platformFeeBp: buyer.platformFeeBp, platformAccountId: buyer.platformAccountId, policyVersion: buyer.policyVersion,
    stallFeeBp: maker.stallFeeBp, stallAccountId: maker.stallAccountId, treasury,
  });
  const platformFee = charged.platformFee;
  const stallFee = charged.stallFee;
  const treasuryPart = charged.treasuryPart;
  const retained = platformFee - treasuryPart;

  const attribution: AttributionLeg[] = [
    { accountId: buyer.accountId, token: quote, delta: -notional, kind: 'principal' },
    { accountId: seller.accountId, token: quote, delta: notional, kind: 'principal' },
    { accountId: buyer.accountId, token: base, delta: qty, kind: 'principal' },
    { accountId: seller.accountId, token: base, delta: -qty, kind: 'principal' },
    { accountId: buyer.accountId, token: quote, delta: -platformFee, kind: 'platform_fee' },
    { accountId: buyer.platformAccountId, token: quote, delta: retained, kind: 'platform_fee' },
    { accountId: buyer.accountId, token: quote, delta: -stallFee, kind: 'stall_fee' },
    { accountId: maker.stallAccountId, token: quote, delta: stallFee, kind: 'stall_fee' },
  ];
  if (treasuryPart > 0n) attribution.push({ accountId: treasury.accountId, token: quote, delta: treasuryPart, kind: 'treasury' });
  const kept = attribution.filter((l) => l.delta !== 0n);
  assertZeroSum(kept);
  const legs = aggregateLegs(kept);

  const buyerFees = platformFee + stallFee;
  const update = (o: BatchOrder, isBuyer: boolean): OrderUpdate => {
    const principalUsed = isBuyer ? notional : qty;
    const feesUsed = isBuyer ? buyerFees : 0n;
    if (principalUsed > o.reservedPrincipal || feesUsed > o.reservedFees) throw new RangeError(`reservation of ${o.orderId} is too small for this fill`);
    const filled = o.filled + qty;
    const done = filled === o.amount;
    const principalLeft = o.reservedPrincipal - principalUsed;
    const feesLeft = o.reservedFees - feesUsed;
    return {
      orderId: o.orderId,
      filled,
      cumNotional: o.cumNotional + notional,
      feeBuckets: isBuyer ? charged.buckets : o.feeBuckets,
      reservedPrincipal: done ? 0n : principalLeft,
      reservedFees: done ? 0n : feesLeft,
      releasePrincipal: done ? principalLeft : 0n,
      releaseFees: done ? feesLeft : 0n,
    };
  };
  return {
    tradeId: input.tradeId, base, quote, qty, notional, platformFee, treasuryAllocation: treasuryPart, platformRetained: retained,
    stallFee, stallFeeBp: maker.stallFeeBp, platformFeeBp: buyer.platformFeeBp, legs, attribution: kept,
    batchHash: hashOf(input.tradeId, legs, kept), buyer: update(buyer, true), seller: update(seller, false),
  };
}

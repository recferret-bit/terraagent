import { canonical } from '../../data/_hash';
import { sha256Hex } from '../../economy/sha256';
import type { Fill } from './market-matcher';
import { chargeBucketed, feeBucketKey, makerNotional, treasuryAllocation, type FeeBuckets } from './market-fees';

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

  const platformKey = feeBucketKey(quote, buyer.platformFeeBp, buyer.platformAccountId, buyer.policyVersion);
  const stallKey = feeBucketKey(quote, maker.stallFeeBp, maker.stallAccountId, buyer.policyVersion);
  const p = chargeBucketed(buyer.feeBuckets, platformKey, notional, buyer.platformFeeBp);
  const s = chargeBucketed(p.buckets, stallKey, notional, maker.stallFeeBp);
  const platformFee = p.fee;
  const stallFee = s.fee;
  const treasuryPart = treasuryAllocation(platformFee, treasury.shareBp, treasury.enabled);
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
      feeBuckets: isBuyer ? s.buckets : o.feeBuckets,
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

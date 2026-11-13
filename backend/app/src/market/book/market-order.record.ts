import type { PrismaClient } from '@terra/db';
import type { RestingOrder } from '@terra/sim/systems/trade/market-book';
import { decimalToBigint } from './decimal.js';

type MarketOrder = NonNullable<Awaited<ReturnType<PrismaClient['marketOrder']['findUnique']>>>;

export type FeeBuckets = Record<string, { base: string; fee: string }>;

/** A persisted order with exact bigint amounts. `seq` (the row id) is the time priority; it satisfies `RestingOrder`. */
export interface MarketOrderRecord extends RestingOrder {
  readonly ref: string;
  readonly planetId: string;
  readonly pair: string;
  readonly base: string;
  readonly quote: string;
  readonly colonyIndex: number | null;
  readonly playerId: string | null;
  readonly accountId: string;
  readonly stallColonyId: string;
  readonly stallAccountId: string;
  readonly stallHubEntityId: number | null;
  readonly platformAccountId: string;
  readonly fillPolicy: string;
  readonly policyVersion: string;
  readonly policyHash: string;
  readonly platformFeeBp: number;
  /** Discounted buyer platform fee pinned at placement (e.g. `50` bp for `>= 10 NEAR` stakers) while `platformFeeBp` stays at the epoch policy rate for book matching. */
  readonly effectivePlatformFeeBp?: number;
  readonly stallFeeBp: number;
  readonly maxStallFeeBp: number | null;
  readonly reservedPrincipal: bigint;
  readonly reservedFees: bigint;
  readonly cumNotional: bigint;
  readonly feeBuckets: FeeBuckets;
  readonly actorKind: string;
  readonly state: string;
  readonly ttlS: number;
  readonly expiresAt: Date;
  readonly createdAt: Date;
}

export const OPEN_STATES: readonly string[] = ['OPEN', 'PARTIAL'];
export const isBookable = (state: string): boolean => OPEN_STATES.includes(state);

export function toRecord(r: MarketOrder): MarketOrderRecord {
  const rawStakerFee = (r.signedTerms as { stakerPlatformFeeBp?: unknown } | null)?.stakerPlatformFeeBp;
  const effectivePlatformFeeBp =
    typeof rawStakerFee === 'number' && Number.isInteger(rawStakerFee) && rawStakerFee >= 0
      ? rawStakerFee
      : undefined;
  return {
    orderId: r.orderId,
    seq: r.id,
    side: r.side as 'buy' | 'sell',
    colonyId: r.colonyId,
    amount: decimalToBigint(r.amount),
    filled: decimalToBigint(r.filled),
    priceAmount: decimalToBigint(r.priceAmount),
    ref: r.ref,
    planetId: r.planetId,
    pair: r.pair,
    base: r.base,
    quote: r.quote,
    colonyIndex: r.colonyIndex,
    playerId: r.playerId,
    accountId: r.accountId,
    stallColonyId: r.stallColonyId,
    stallAccountId: r.stallAccountId,
    stallHubEntityId: r.stallHubEntityId,
    platformAccountId: r.platformAccountId,
    fillPolicy: r.fillPolicy,
    policyVersion: r.policyVersion,
    policyHash: r.policyHash,
    platformFeeBp: r.platformFeeBp,
    ...(effectivePlatformFeeBp !== undefined ? { effectivePlatformFeeBp } : {}),
    stallFeeBp: r.stallFeeBp,
    maxStallFeeBp: r.maxStallFeeBp,
    reservedPrincipal: decimalToBigint(r.reservedPrincipal),
    reservedFees: decimalToBigint(r.reservedFees),
    cumNotional: decimalToBigint(r.cumNotional),
    feeBuckets: (r.feeBuckets ?? {}) as FeeBuckets,
    actorKind: r.actorKind,
    state: r.state,
    ttlS: r.ttlS,
    expiresAt: r.expiresAt,
    createdAt: r.createdAt,
  };
}

import { createHash } from 'node:crypto';
import { pairId, type QuoteToken, type ResourceKey } from '@terra/contracts';
import type { CreateMarketOrderInput } from '../../book/market-order.repository.js';
import { PLATFORM_ACCOUNT_ID } from '../market-policy.provider.js';

/** Deterministic order id of a sim ref on one planet (refs repeat across planets: every scenario planet has `col_0`). */
export const orderIdOf = (planetId: string, ref: string): string =>
  `mo_${createHash('sha256').update(`${planetId}\u0000${ref}`).digest('hex').slice(0, 40)}`;

export interface PlaceDraftRequest {
  readonly ref: string;
  readonly resource: ResourceKey;
  readonly amount: number;
  readonly side: 'buy' | 'sell';
  readonly colonyId: string;
  readonly colonyIndex: number;
  readonly playerId?: string;
  readonly hubEntityId: number;
  readonly stallFeeBp: number;
  readonly maxStallFeeBp?: number;
  readonly ttlS: number;
  readonly price: { readonly token: QuoteToken; readonly amount: string };
}

export interface PlacePolicy {
  readonly policyVersion: string;
  readonly policyHash: string;
  readonly platformFeeBp: number;
  readonly stallFeeMaxBp: number;
}

/** Pinned terms for one `marketOrderRequested`. The stall fee cap applies to buys only. */
export function orderDraft(
  planetId: string,
  d: PlaceDraftRequest,
  accountId: string,
  cfg: PlacePolicy,
  claimed: boolean,
  actorKind?: string,
  stakerPlatformFeeBp?: number,
  platformAccountId: string = PLATFORM_ACCOUNT_ID,
): CreateMarketOrderInput {
  const maxStall = d.maxStallFeeBp ?? cfg.stallFeeMaxBp;
  const hasStakerDiscount =
    stakerPlatformFeeBp !== undefined && stakerPlatformFeeBp !== cfg.platformFeeBp;
  return {
    orderId: orderIdOf(planetId, d.ref),
    ref: d.ref,
    planetId,
    pair: pairId(d.resource, d.price.token),
    base: d.resource,
    quote: d.price.token,
    side: d.side,
    colonyId: d.colonyId,
    colonyIndex: d.colonyIndex,
    playerId: d.playerId ?? null,
    accountId,
    stallColonyId: d.colonyId,
    stallAccountId: accountId,
    stallHubEntityId: d.hubEntityId,
    platformAccountId,
    amount: BigInt(d.amount),
    priceAmount: BigInt(d.price.amount),
    fillPolicy: claimed ? 'all_or_nothing' : 'partial',
    policyVersion: cfg.policyVersion,
    policyHash: cfg.policyHash,
    platformFeeBp: cfg.platformFeeBp,
    stallFeeBp: d.stallFeeBp,
    maxStallFeeBp: d.side === 'buy' ? maxStall : null,
    ttlS: d.ttlS,
    expiresAt: new Date(Date.now() + d.ttlS * 1000),
    ...(actorKind ? { actorKind } : {}),
    ...(hasStakerDiscount ? { signedTerms: { stakerPlatformFeeBp } } : {}),
  };
}

export function stallCap(d: PlaceDraftRequest, cfg: PlacePolicy): number {
  return d.maxStallFeeBp ?? cfg.stallFeeMaxBp;
}

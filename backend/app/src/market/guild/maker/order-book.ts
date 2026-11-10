import type { Prisma, PrismaClient } from '@terra/db';
import { decimalToBigint } from '../../book/decimal.js';
import { MarketOrderRepository } from '../../book/market-order.repository.js';
import { OrderRelease } from '../../orders/cancel-order.service.js';
import { requirementOf } from '../../orders/order-funds.js';
import { PLATFORM_ACCOUNT_ID } from '../../orders/market-policy.provider.js';
import { orderIdOf } from '../../orders/place-order.service.js';
import type { FundingBucket } from '../funding/exposure.js';
import type { GuildOrderIntent } from './plan.js';

export interface RestingGuildOrder {
  readonly orderId: string;
  readonly planetId: string;
  readonly colonyId: string;
  readonly base: string;
  readonly side: 'buy' | 'sell';
  readonly actorKind: string;
  readonly bucket: FundingBucket;
  readonly reserve: bigint;
  readonly notional: bigint;
}

export interface GuildOrderPort {
  resting(npcId: string, planetId?: string): Promise<RestingGuildOrder[]>;
  place(intent: GuildOrderIntent): Promise<{ orderId: string; created: boolean }>;
  cancel(order: RestingGuildOrder): Promise<void>;
}

interface StoredTerms {
  readonly bucket?: FundingBucket;
  readonly reserve?: string;
}

/** Writes guild quotes on `chain.market_order` and cancels them through `OrderRelease`. */
export class GuildOrderBook implements GuildOrderPort {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly repo: MarketOrderRepository,
    private readonly release: OrderRelease,
  ) {}

  async resting(npcId: string, planetId?: string): Promise<RestingGuildOrder[]> {
    const rows = await this.prisma.marketOrder.findMany({
      where: {
        colonyId: npcId,
        actorKind: { in: ['npc', 'guild'] },
        state: { in: ['OPEN', 'PARTIAL'] },
        ...(planetId ? { planetId } : {}),
      },
      select: {
        orderId: true, planetId: true, colonyId: true, base: true, side: true, actorKind: true, signedTerms: true, priceAmount: true,
      },
    });
    return rows.map(toResting);
  }

  async place(intent: GuildOrderIntent): Promise<{ orderId: string; created: boolean }> {
    const need = requirementOf({
      side: intent.side,
      base: intent.base,
      quote: intent.quote,
      amount: intent.amount,
      priceAmount: intent.priceAmount,
      platformFeeBp: intent.platformFeeBp,
      maxStallFeeBp: intent.maxStallFeeBp,
    });
    const { order, created } = await this.repo.createFromRequest({
      orderId: orderIdOf(intent.planetId, intent.ref),
      ref: intent.ref,
      planetId: intent.planetId,
      pair: intent.pair,
      base: intent.base,
      quote: intent.quote,
      side: intent.side,
      colonyId: intent.npcId,
      colonyIndex: intent.colonyIndex,
      playerId: null,
      accountId: intent.accountId,
      stallColonyId: intent.npcId,
      stallAccountId: intent.accountId,
      stallHubEntityId: 0,
      platformAccountId: PLATFORM_ACCOUNT_ID,
      amount: intent.amount,
      priceAmount: intent.priceAmount,
      fillPolicy: 'partial',
      policyVersion: intent.policyVersion,
      policyHash: intent.policyHash,
      platformFeeBp: intent.platformFeeBp,
      stallFeeBp: intent.stallFeeBp,
      maxStallFeeBp: intent.side === 'buy' ? intent.maxStallFeeBp : null,
      actorKind: 'npc',
      signedTerms: termsOf(intent),
      ttlS: intent.ttlS,
      expiresAt: new Date(Date.now() + intent.ttlS * 1000),
      state: 'OPEN',
      reservedPrincipal: need.principal,
      reservedFees: need.fees,
    });
    return { orderId: order.orderId, created };
  }

  async cancel(order: RestingGuildOrder): Promise<void> {
    await this.release.release(order.orderId, 'cancelled', order.colonyId, order.planetId);
  }
}

function termsOf(intent: GuildOrderIntent): Prisma.InputJsonValue {
  return {
    tradeKeyId: intent.tradeKeyId,
    source: intent.source,
    actorKind: intent.actorKind,
    bucket: intent.bucket,
    reserve: intent.reserve.toString(),
    npcId: intent.npcId,
  };
}

function toResting(row: {
  orderId: string;
  planetId: string;
  colonyId: string;
  base: string;
  side: string;
  actorKind: string;
  signedTerms: Prisma.JsonValue | null;
  priceAmount: Prisma.Decimal;
}): RestingGuildOrder {
  const terms = termsFrom(row.signedTerms);
  return {
    orderId: row.orderId,
    planetId: row.planetId,
    colonyId: row.colonyId,
    base: row.base,
    side: row.side === 'buy' ? 'buy' : 'sell',
    actorKind: row.actorKind,
    bucket: terms.bucket === 'cash' ? 'cash' : 'inventory',
    reserve: reserveOf(terms.reserve),
    notional: decimalToBigint(row.priceAmount),
  };
}

function termsFrom(value: Prisma.JsonValue | null): StoredTerms {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const row = value as StoredTerms;
  return { bucket: row.bucket, reserve: row.reserve };
}

function reserveOf(value: string | undefined): bigint {
  return value && /^(0|[1-9]\d*)$/.test(value) ? BigInt(value) : 0n;
}

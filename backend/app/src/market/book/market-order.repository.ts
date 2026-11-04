import { Inject, Injectable } from '@nestjs/common';
import { Prisma, RepositoryBase, type DbClient, type PrismaClient, type TransactionClient } from '@terra/db';
import { PRISMA } from '../../db/db.module.js';
import { toDecimalInput } from './decimal.js';
import { OPEN_STATES, toRecord, type FeeBuckets, type MarketOrderRecord } from './market-order.record.js';

/** Terms pinned at creation (never change afterwards) plus the order's identity. Amounts are exact bigint / decimal strings. */
export interface CreateMarketOrderInput {
  readonly orderId: string;
  readonly ref: string;
  readonly planetId: string;
  readonly pair: string;
  readonly base: string;
  readonly quote: string;
  readonly side: 'buy' | 'sell';
  readonly colonyId: string;
  readonly colonyIndex?: number | null;
  readonly playerId?: string | null;
  readonly accountId: string;
  readonly stallColonyId: string;
  readonly stallAccountId: string;
  readonly stallHubEntityId?: number | null;
  readonly platformAccountId: string;
  readonly amount: bigint | string;
  readonly priceAmount: bigint | string;
  readonly fillPolicy: string;
  readonly policyVersion: string;
  readonly policyHash: string;
  readonly platformFeeBp: number;
  readonly stallFeeBp: number;
  readonly maxStallFeeBp?: number | null;
  readonly actorKind?: string;
  readonly signedTerms?: Prisma.InputJsonValue;
  readonly ttlS: number;
  readonly expiresAt: Date;
  /** Defaults to `PENDING` (accepted, not yet reserved). */
  readonly state?: string;
  readonly reservedPrincipal?: bigint | string;
  readonly reservedFees?: bigint | string;
}

export interface FillUpdate {
  readonly filled: bigint | string;
  readonly cumNotional: bigint | string;
  readonly feeBuckets: FeeBuckets;
  readonly state?: string;
}

export interface ReservationUpdate {
  readonly reservedPrincipal: bigint | string;
  readonly reservedFees: bigint | string;
  readonly state?: string;
}

/** Called after a write that used the root client (no caller transaction), so `MarketBooks` stays in sync. */
export type OrderWriteListener = (order: MarketOrderRecord) => void;

/**
 * Persistence of `chain.market_order`. Fills, reservations and buckets change only under a row lock: take
 * `lockForUpdate` first inside a `withTransaction`. Writes that join a caller's `tx` do NOT notify the book (the
 * transaction may still roll back); call `MarketBooks.sync(orderId)` after commit.
 */
@Injectable()
export class MarketOrderRepository extends RepositoryBase {
  private readonly listeners = new Set<OrderWriteListener>();

  constructor(@Inject(PRISMA) prisma: PrismaClient) {
    super(prisma);
  }

  onWrite(listener: OrderWriteListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(order: MarketOrderRecord, tx?: DbClient): MarketOrderRecord {
    if (!tx) for (const l of this.listeners) l(order);
    return order;
  }

  /** Idempotent on `ref`: a repeat returns the existing row unchanged (`created: false`), never a second one. */
  async createFromRequest(input: CreateMarketOrderInput, tx?: DbClient): Promise<{ order: MarketOrderRecord; created: boolean }> {
    const db = this.db(tx);
    const { count } = await db.marketOrder.createMany({
      data: [
        {
          orderId: input.orderId,
          ref: input.ref,
          planetId: input.planetId,
          pair: input.pair,
          base: input.base,
          quote: input.quote,
          side: input.side,
          colonyId: input.colonyId,
          colonyIndex: input.colonyIndex ?? null,
          playerId: input.playerId ?? null,
          accountId: input.accountId,
          stallColonyId: input.stallColonyId,
          stallAccountId: input.stallAccountId,
          stallHubEntityId: input.stallHubEntityId ?? null,
          platformAccountId: input.platformAccountId,
          amount: toDecimalInput(input.amount),
          priceAmount: toDecimalInput(input.priceAmount),
          fillPolicy: input.fillPolicy,
          policyVersion: input.policyVersion,
          policyHash: input.policyHash,
          platformFeeBp: input.platformFeeBp,
          stallFeeBp: input.stallFeeBp,
          maxStallFeeBp: input.maxStallFeeBp ?? null,
          reservedPrincipal: toDecimalInput(input.reservedPrincipal ?? 0n),
          reservedFees: toDecimalInput(input.reservedFees ?? 0n),
          actorKind: input.actorKind ?? 'player',
          state: input.state ?? 'PENDING',
          signedTerms: input.signedTerms,
          ttlS: input.ttlS,
          expiresAt: input.expiresAt,
        },
      ],
      skipDuplicates: true,
    });
    const order = toRecord(await db.marketOrder.findUniqueOrThrow({ where: { ref: input.ref } }));
    if (count > 0) this.notify(order, tx);
    return { order, created: count > 0 };
  }

  async find(orderId: string, tx?: DbClient): Promise<MarketOrderRecord | null> {
    const row = await this.db(tx).marketOrder.findUnique({ where: { orderId } });
    return row ? toRecord(row) : null;
  }

  /**
   * `SELECT … FOR UPDATE` on the given orders (ascending id, so concurrent lockers cannot deadlock), then returns their
   * fresh rows in that order. Missing ids are skipped.
   */
  async lockForUpdate(orderIds: readonly string[], tx: TransactionClient): Promise<MarketOrderRecord[]> {
    if (orderIds.length === 0) return [];
    await tx.$queryRaw`SELECT id FROM chain.market_order WHERE order_id IN (${Prisma.join([...orderIds])}) ORDER BY id FOR UPDATE`;
    const rows = await tx.marketOrder.findMany({ where: { orderId: { in: [...orderIds] } }, orderBy: { id: 'asc' } });
    return rows.map(toRecord);
  }

  async updateFill(orderId: string, u: FillUpdate, tx?: DbClient): Promise<MarketOrderRecord> {
    const row = await this.db(tx).marketOrder.update({
      where: { orderId },
      data: { filled: toDecimalInput(u.filled), cumNotional: toDecimalInput(u.cumNotional), feeBuckets: u.feeBuckets, state: u.state },
    });
    return this.notify(toRecord(row), tx);
  }

  async updateReservation(orderId: string, u: ReservationUpdate, tx?: DbClient): Promise<MarketOrderRecord> {
    const row = await this.db(tx).marketOrder.update({
      where: { orderId },
      data: { reservedPrincipal: toDecimalInput(u.reservedPrincipal), reservedFees: toDecimalInput(u.reservedFees), state: u.state },
    });
    return this.notify(toRecord(row), tx);
  }

  async setState(orderId: string, state: string, lastError?: string | null, tx?: DbClient): Promise<MarketOrderRecord> {
    const row = await this.db(tx).marketOrder.update({
      where: { orderId },
      data: { state, ...(lastError !== undefined ? { lastError: lastError?.slice(0, 400) ?? null } : {}) },
    });
    return this.notify(toRecord(row), tx);
  }

  /** Resting orders (OPEN/PARTIAL) of one book in price-time storage order (id ascending; the book sorts by price). */
  async listOpen(planetId: string, pair: string, tx?: DbClient): Promise<MarketOrderRecord[]> {
    const rows = await this.db(tx).marketOrder.findMany({
      where: { planetId, pair, state: { in: [...OPEN_STATES] } },
      orderBy: { id: 'asc' },
    });
    return rows.map(toRecord);
  }

  async listOpenByColony(colonyId: string, tx?: DbClient): Promise<MarketOrderRecord[]> {
    const rows = await this.db(tx).marketOrder.findMany({ where: { colonyId, state: { in: [...OPEN_STATES] } }, orderBy: { id: 'asc' } });
    return rows.map(toRecord);
  }

  /** Every resting order on every book (restart rebuild). */
  async listAllOpen(tx?: DbClient): Promise<MarketOrderRecord[]> {
    const rows = await this.db(tx).marketOrder.findMany({ where: { state: { in: [...OPEN_STATES] } }, orderBy: { id: 'asc' } });
    return rows.map(toRecord);
  }
}


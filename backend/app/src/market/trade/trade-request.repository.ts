import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { PrismaClient, TransactionClient } from '@terra/db';
import { PRISMA } from '../../db/db.module.js';
import type { AllowanceUsage } from './allowance.js';
import { dayStart } from './allowance.js';

export type RequestState = 'PENDING' | 'SUBMITTED' | 'LINKED' | 'ACCEPTED' | 'REJECTED' | 'CANCELLED' | 'FAILED';
export type RequestRow = NonNullable<Awaited<ReturnType<PrismaClient['tradeApiRequest']['findUnique']>>>;

export interface NewRequest {
  readonly requestId?: string;
  readonly ownerRef: string;
  readonly keyId: string | null;
  readonly idemKey: string;
  readonly bodyHash: string;
  readonly kind: 'place' | 'cancel';
  readonly planetId: string;
  readonly colonyId: string;
  readonly colonyIndex: number;
  readonly ownerId: string;
  readonly pair?: string;
  readonly side?: string;
  readonly resource?: string;
  readonly amount?: bigint;
  readonly priceAmount?: bigint;
  readonly notional?: bigint;
  readonly targetOrderId?: string;
  readonly state?: RequestState;
  readonly errorCode?: string;
  readonly errorDetail?: string;
}

export const newRequestId = (): string => `rq_${randomBytes(12).toString('hex')}`;
export const bodyHashOf = (body: unknown): string => createHash('sha256').update(JSON.stringify(body)).digest('hex');
/** States of a place request that has no settled outcome yet: they count against the allowance before any order exists. */
const IN_FLIGHT: string[] = ['PENDING', 'SUBMITTED', 'LINKED'];
const OPEN_ORDER_STATES = ['PENDING', 'OPEN', 'PARTIAL'];
const TERMINAL_ORDER = new Set(['MATCHED', 'FILLED', 'CANCELLED', 'EXPIRED', 'REJECTED']);

/** The idempotency record and the allowance ledger of mutating trade API calls (`chain.trade_api_request`). */
@Injectable()
export class TradeRequestRepository {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  /** Serializes the owner's requests: take it first inside the transaction that checks the allowance and inserts. */
  async lockOwner(tx: TransactionClient, ownerRef: string): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`trade-owner:${ownerRef}`}, 0))`;
  }

  findByIdem(ownerRef: string, idemKey: string, db: PrismaClient | TransactionClient = this.prisma): Promise<RequestRow | null> {
    return db.tradeApiRequest.findUnique({ where: { ownerRef_idemKey: { ownerRef, idemKey } } });
  }

  get(requestId: string): Promise<RequestRow | null> {
    return this.prisma.tradeApiRequest.findUnique({ where: { requestId } });
  }

  insert(tx: TransactionClient, r: NewRequest): Promise<RequestRow> {
    return tx.tradeApiRequest.create({
      data: {
        requestId: r.requestId ?? newRequestId(), ownerRef: r.ownerRef, keyId: r.keyId, idemKey: r.idemKey, bodyHash: r.bodyHash, kind: r.kind,
        planetId: r.planetId, colonyId: r.colonyId, colonyIndex: r.colonyIndex, ownerId: r.ownerId, pair: r.pair ?? null, side: r.side ?? null,
        resource: r.resource ?? null, amount: r.amount?.toString() ?? null, priceAmount: r.priceAmount?.toString() ?? null,
        notional: (r.notional ?? 0n).toString(), targetOrderId: r.targetOrderId ?? null, state: r.state ?? 'PENDING',
        errorCode: r.errorCode ?? null, errorDetail: r.errorDetail?.slice(0, 400) ?? null,
      },
    });
  }

  async setState(requestId: string, state: RequestState, extra: { errorCode?: string; errorDetail?: string; orderId?: string; commandId?: string } = {}): Promise<void> {
    await this.prisma.tradeApiRequest.updateMany({
      where: { requestId },
      data: { state, ...(extra.errorCode ? { errorCode: extra.errorCode } : {}), ...(extra.errorDetail ? { errorDetail: extra.errorDetail.slice(0, 400) } : {}),
        ...(extra.orderId ? { orderId: extra.orderId } : {}), ...(extra.commandId ? { commandId: extra.commandId } : {}) },
    });
  }

  /**
   * Atomically takes the oldest SUBMITTED place request of the colony with these terms (SUBMITTED -> LINKED) and returns it:
   * matches a `marketOrderRequested` event to its API call. Two concurrent events never take the same request.
   */
  async claimSubmitted(t: { planetId: string; colonyId: string; side: string; resource: string; amount: bigint; priceAmount: bigint }): Promise<RequestRow | null> {
    const where = { kind: 'place', state: 'SUBMITTED', planetId: t.planetId, colonyId: t.colonyId, side: t.side, resource: t.resource, amount: t.amount.toString(), priceAmount: t.priceAmount.toString() };
    for (const c of await this.prisma.tradeApiRequest.findMany({ where, orderBy: { createdAt: 'asc' }, take: 5 })) {
      const won = await this.prisma.tradeApiRequest.updateMany({ where: { requestId: c.requestId, state: 'SUBMITTED' }, data: { state: 'LINKED' } });
      if (won.count === 1) return { ...c, state: 'LINKED' };
    }
    return null;
  }

  /** Requests of the key that are in flight (PENDING / SUBMITTED / LINKED). */
  inFlight(keyId: string, tx?: TransactionClient): Promise<RequestRow[]> {
    return (tx ?? this.prisma).tradeApiRequest.findMany({ where: { keyId, kind: 'place', state: { in: IN_FLIGHT } } });
  }

  /** Requests of the key that became orders. */
  accepted(keyId: string): Promise<RequestRow[]> {
    return this.prisma.tradeApiRequest.findMany({ where: { keyId, kind: 'place', state: 'ACCEPTED', orderId: { not: null } } });
  }

  /** Cancels (never submits) every PENDING request of the key; returns how many. */
  async cancelUnsubmitted(keyId: string): Promise<number> {
    const r = await this.prisma.tradeApiRequest.updateMany({
      where: { keyId, state: 'PENDING' }, data: { state: 'CANCELLED', errorCode: 'key_revoked', errorDetail: 'revoked before it was submitted' },
    });
    return r.count;
  }

  /** What the allowance counts for a key now: outstanding orders (open + in flight) and today's committed quote. */
  async usage(keyId: string, colonyId: string, tx: TransactionClient, nowMs: number): Promise<Omit<AllowanceUsage, 'reference'>> {
    const [open, pending, today] = await Promise.all([
      tx.marketOrder.count({ where: { colonyId, state: { in: OPEN_ORDER_STATES } } }),
      tx.tradeApiRequest.count({ where: { keyId, kind: 'place', state: { in: IN_FLIGHT } } }),
      tx.tradeApiRequest.findMany({ where: { keyId, kind: 'place', createdAt: { gte: dayStart(nowMs) }, state: { in: [...IN_FLIGHT, 'ACCEPTED'] } } }),
    ]);
    const orders = new Map((await tx.marketOrder.findMany({ where: { orderId: { in: today.flatMap((r) => (r.orderId ? [r.orderId] : [])) } }, select: { orderId: true, state: true, cumNotional: true } })).map((o) => [o.orderId, o]));
    let committed = 0n;
    for (const r of today) {
      const o = r.orderId ? orders.get(r.orderId) : undefined;
      committed += o && TERMINAL_ORDER.has(o.state) ? BigInt(o.cumNotional.toFixed()) : BigInt(r.notional.toFixed());
    }
    return { outstandingOrders: open + pending, committedToday: committed };
  }
}

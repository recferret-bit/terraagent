import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { eventDef } from '@terra/contracts';
import { withTransaction, type PrismaClient } from '@terra/db';
import type { PlanetEventOf } from '../../bus/channels.js';
import { EventBus } from '../../bus/event-bus.js';
import { databaseEnabled } from '../../core/persistence.js';
import { APP_ENV, type AppEnv } from '../../core/tokens.js';
import { PRISMA } from '../../db/db.module.js';
import { MarketBooks } from '../book/market-books.js';
import { isBookable, toRecord, type MarketOrderRecord } from '../book/market-order.record.js';
import { MarketOrderRepository } from '../book/market-order.repository.js';
import { MarketSimGateway, type SimTarget } from './market-sim-gateway.js';
import { simDeltas } from './place-order.service.js';

export type ReleaseReason = 'cancelled' | 'expired';

export type ReleaseOutcome =
  | { readonly kind: 'released'; readonly order: MarketOrderRecord }
  | { readonly kind: 'noop'; readonly order: MarketOrderRecord }
  | { readonly kind: 'unknown' }
  | { readonly kind: 'foreign' };

const TERMINAL: Record<ReleaseReason, string> = { cancelled: 'CANCELLED', expired: 'EXPIRED' };

/**
 * Ends a resting order (W13-15): under `FOR UPDATE` it checks the owner and that the order is still OPEN/PARTIAL, then moves it
 * to CANCELLED/EXPIRED and zeroes both reservations in the same UPDATE, so a second cancel, an expiry sweep and a concurrent
 * fill (which also locks the row and re-reads its state) can never release the same reservation twice. After commit it syncs
 * the book and tells the sim (`market.release`). Deposited cargo stays in the verifier (no withdraw): once the reservation is 0
 * it shows up as free verifier cargo.
 */
@Injectable()
export class OrderRelease {
  constructor(
    private readonly repo: MarketOrderRepository,
    private readonly books: MarketBooks,
    private readonly gateway: MarketSimGateway,
    @Inject(PRISMA) private readonly prisma: PrismaClient,
  ) {}

  /** `idOrRef` is the server order id or the sim's `ref`. `ownerColonyId` is checked when given (player cancels). */
  async release(idOrRef: string, reason: ReleaseReason, ownerColonyId?: string, planetId?: string): Promise<ReleaseOutcome> {
    // refs are only unique per planet (`market-order:col_0:1` exists on every scenario planet): scope by planet when the caller knows it
    const row = await this.prisma.marketOrder.findFirst({ where: { OR: [{ orderId: idOrRef }, { ref: idOrRef }], ...(planetId ? { planetId } : {}) }, select: { orderId: true } });
    if (!row) return { kind: 'unknown' };
    const out = await withTransaction(this.prisma, async (tx): Promise<ReleaseOutcome> => {
      const [order] = await this.repo.lockForUpdate([row.orderId], tx);
      if (!order) return { kind: 'unknown' };
      if (ownerColonyId !== undefined && order.colonyId !== ownerColonyId) return { kind: 'foreign' };
      if (!isBookable(order.state)) return { kind: 'noop', order };
      await this.repo.updateReservation(order.orderId, { reservedPrincipal: 0n, reservedFees: 0n, state: TERMINAL[reason] }, tx);
      return { kind: 'released', order };
    });
    if (out.kind === 'released') {
      await this.books.sync(out.order.orderId);
      const o = out.order;
      if (o.actorKind === 'fixture') return out; // dev seed bots have no sim colony: nothing to tell the sim
      this.gateway.release(
        { planetId: o.planetId, colonyId: o.colonyId, colonyIndex: o.colonyIndex },
        { ref: o.ref, orderId: o.orderId, deltas: simDeltas(o), reason },
      );
    }
    return out;
  }

  /** Raw row lookup for callers that need the owner of an id/ref. */
  async find(idOrRef: string): Promise<MarketOrderRecord | null> {
    const row = await this.prisma.marketOrder.findFirst({ where: { OR: [{ orderId: idOrRef }, { ref: idOrRef }] } });
    return row ? toRecord(row) : null;
  }
}

/** Acts on the sim's `marketCancelRequested` (owner only). */
@Injectable()
export class CancelOrderHandler implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(CancelOrderHandler.name);
  private stop: (() => void) | null = null;

  constructor(
    private readonly bus: EventBus,
    private readonly release: OrderRelease,
    private readonly gateway: MarketSimGateway,
    @Inject(APP_ENV) private readonly env: AppEnv,
  ) {}

  onModuleInit(): void {
    this.stop ??= this.bus.onPlanetEvent('marketCancelRequested', (e) => {
      void this.handle(e).catch((err: unknown) => this.log.warn(`cancel failed: ${err instanceof Error ? err.message : String(err)}`));
    }, { module: 'CancelOrderHandler' });
  }

  onModuleDestroy(): void {
    this.stop?.();
    this.stop = null;
  }

  async handle(event: PlanetEventOf<'marketCancelRequested'>): Promise<ReleaseOutcome | null> {
    if (!databaseEnabled(this.env)) return null;
    const d = eventDef('marketCancelRequested').data.parse(event.data);
    const out = await this.release.release(d.orderId, 'cancelled', d.colonyId, event.planetId);
    if (out.kind === 'unknown' || out.kind === 'foreign') {
      // The sim held an order the server does not have (or not for this colony): drop the sim's mirror with a reject.
      const target: SimTarget = { planetId: event.planetId, colonyId: d.colonyId, colonyIndex: d.colonyIndex };
      this.gateway.release(target, { ref: d.orderId, orderId: d.orderId, deltas: {}, reason: 'rejected', code: 'unknown_order', detail: 'No such open order.' });
    }
    return out;
  }
}

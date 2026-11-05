import { Inject, Injectable, Logger, Optional, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { contractSignedText } from '@terra/contracts';
import type { PrismaClient } from '@terra/db';
import type { PlanetEventOf } from '../../bus/channels.js';
import { EventBus, type Unsubscribe } from '../../bus/event-bus.js';
import { databaseEnabled } from '../../core/persistence.js';
import { APP_ENV, type AppEnv } from '../../core/tokens.js';
import { PRISMA } from '../../db/db.module.js';
import { FlagsService } from '../../flags/flags.service.js';
import { ProgressionEventForwarder } from '../../game/progression-events.service.js';

/** Payload kind of a trade row in the player's history (`GET /v1/me/profile` `activity`). */
export const HISTORY_TRADE_KIND = 'history.trade';

/**
 * W13-24: writes one `history.trade` row (a `core.player_notification` with that payload kind) per participating colony's
 * player for every FINAL trade, with the same sentence as the toast. The row id is `history.trade:<tradeId>:<colonyId>`
 * and the write is an upsert-by-id, so replays and restarts never duplicate it. Off while W13 is off or without a database.
 */
@Injectable()
export class TradeHistoryProducer implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(TradeHistoryProducer.name);
  private readonly unsubs: Unsubscribe[] = [];
  private readonly inflight = new Set<Promise<void>>();

  constructor(
    private readonly bus: EventBus,
    private readonly forwarder: ProgressionEventForwarder,
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(APP_ENV) private readonly env: AppEnv,
    @Optional() private readonly flags?: FlagsService,
  ) {}

  onModuleInit(): void {
    this.unsubs.push(this.bus.onPlanetEvent('tradeSettled', (e) => this.onSettled(e), { module: 'trade-history' }));
  }

  onModuleDestroy(): void {
    for (const u of this.unsubs.splice(0)) u();
  }

  async idle(): Promise<void> {
    await Promise.allSettled([...this.inflight]);
  }

  private onSettled(e: PlanetEventOf<'tradeSettled'>): void {
    if (!databaseEnabled(this.env) || (this.flags && !this.flags.has('W13'))) return;
    const d = e.data;
    const playerId = this.forwarder.resolvePlayerId(d.colonyId);
    if (!playerId) return;
    const title = contractSignedText({ base: d.base, amount: d.amount, quote: d.quote, notional: d.notional, stallFeeBp: d.stallFeeBp, stallName: d.stallName });
    const id = `${HISTORY_TRADE_KIND}:${d.tradeId}:${d.colonyId}`;
    const p = this.prisma.playerNotification
      .upsert({ where: { id }, update: {}, create: { id, playerId, payload: { kind: HISTORY_TRADE_KIND, title, tradeId: d.tradeId, colonyId: d.colonyId, planetId: e.planetId, role: d.role } } })
      .then(() => undefined, (err: unknown) => this.log.error(`trade history ${id} dropped: ${err instanceof Error ? err.message : String(err)}`))
      .finally(() => this.inflight.delete(p));
    this.inflight.add(p);
  }
}

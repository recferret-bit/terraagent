import { Injectable, Logger, Optional, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { ProgressEventV1 } from '@terra/contracts';
import type { PlanetEventOf } from '../../bus/channels.js';
import { EventBus, type Unsubscribe } from '../../bus/event-bus.js';
import { FlagsService } from '../../flags/flags.service.js';
import { ProgressionEventForwarder } from '../../game/progression-events.service.js';
import { FactsUpdaterService } from '../../progression/facts-updater.service.js';
import { merchantEvent, portAuthorityEvent, type MarketProgressSource } from './market-progress-events.js';

const ATTEMPTS = 3;

/**
 * W13-27 registered progression producer (PROGRESSION_ENGINE.md): turns the sim's FINAL-trade events into W12 facts.
 * `tradeSettled` -> Merchant +1 per participating colony's player; `feeEarned` -> Port Authority +fee units for the stall
 * owner. Event ids are `market:<kind>:<tradeId>:<colonyId>`, so replays, restarts and re-sent events never count twice
 * (the engine keeps a receipt per id). Trades are durable in Postgres before the sim is told, so facts are applied
 * directly (not through the world checkpoint). Does nothing while W13 is off; an unresolvable player is skipped.
 */
@Injectable()
export class MarketProgressionProducer implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(MarketProgressionProducer.name);
  private readonly unsubs: Unsubscribe[] = [];
  private readonly inflight = new Set<Promise<void>>();

  constructor(
    private readonly bus: EventBus,
    private readonly facts: FactsUpdaterService,
    private readonly forwarder: ProgressionEventForwarder,
    @Optional() private readonly flags?: FlagsService,
  ) {}

  onModuleInit(): void {
    const opts = { module: 'market-progression' };
    this.unsubs.push(
      this.bus.onPlanetEvent('tradeSettled', (e) => this.onSettled(e), opts),
      this.bus.onPlanetEvent('feeEarned', (e) => this.onFee(e), opts),
    );
  }

  onModuleDestroy(): void {
    for (const u of this.unsubs.splice(0)) u();
  }

  /** Resolves when every fact handed to the engine so far is applied (tests, shutdown). */
  async idle(): Promise<void> {
    await Promise.allSettled([...this.inflight]);
  }

  private onSettled(e: PlanetEventOf<'tradeSettled'>): void {
    const s = this.source(e, e.data.colonyId, e.data.tradeId);
    if (s) this.deliver(merchantEvent(s));
  }

  private onFee(e: PlanetEventOf<'feeEarned'>): void {
    const s = this.source(e, e.data.colonyId, e.data.tradeId);
    const ev = s ? portAuthorityEvent(s, e.data.token, e.data.amount) : null;
    if (ev) this.deliver(ev);
  }

  private source(e: { planetId: string; tick?: number }, colonyId: string, tradeId: string): MarketProgressSource | null {
    if (this.flags && !this.flags.has('W13')) return null;
    const playerId = this.forwarder.resolvePlayerId(colonyId);
    if (!playerId) {
      this.log.warn(`market progression skipped: no player for colony ${colonyId} (trade ${tradeId})`);
      return null;
    }
    return { planetId: e.planetId, tick: e.tick, colonyId, playerId, tradeId };
  }

  private deliver(event: ProgressEventV1): void {
    const p = this.apply(event).finally(() => this.inflight.delete(p));
    this.inflight.add(p);
  }

  private async apply(event: ProgressEventV1): Promise<void> {
    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
      try {
        await this.facts.applyProgressEvent(event);
        return;
      } catch (err) {
        if (attempt === ATTEMPTS) this.log.error(`market progression ${event.eventId} dropped: ${err instanceof Error ? err.message : String(err)}`);
        else await new Promise((r) => setTimeout(r, 50 * attempt));
      }
    }
  }
}

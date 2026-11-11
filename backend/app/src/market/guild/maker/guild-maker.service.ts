import { Inject, Injectable, Logger, Optional, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import type { GuildArrivedPayload, GuildDepartedPayload, TradeOverviewResponse } from '@terra/contracts';
import type { DbClient, PrismaClient } from '@terra/db';
import { compileData, type CompiledDataLike } from '@terra/sim';
import { EventBus } from '../../../bus/event-bus.js';
import { APP_ENV, type AppEnv } from '../../../core/tokens.js';
import { PRISMA } from '../../../db/db.module.js';
import { FlagsService } from '../../../flags/flags.service.js';
import { MarketOrderRepository } from '../../book/market-order.repository.js';
import type { MatchOutcome } from '../../matching/market-matcher.service.js';
import { OrderRelease } from '../../orders/cancel-order.service.js';
import { TradeKeyRepository, type KeyRecord } from '../../trade/trade-key.repository.js';
import { TradeReadService } from '../../trade/trade-read.service.js';
import { fundingEnabled } from '../funding/caps.js';
import { GuildFundingService } from '../funding/guild-funding.service.js';
import { GuildNpcRepository } from '../guild-npc.repository.js';
import { applyFill, type CargoFillResult, type GuildCargoFill } from '../inventory.js';
import { stockpileTargets } from '../strategy/apply.js';
import { GuildStrategyPort } from '../strategy/port.js';
import { GuildMetrics } from '../telemetry/guild-metrics.js';
import type { GuildFillSink } from './fill-sink.js';
import { GuildOrderBook, type GuildOrderPort } from './order-book.js';
import { admitQuotes, cancelResting, gateIntent, type DockIo, type DockReport } from './parts/dock-pass.js';
import { runRequote, type RequoteIo } from './parts/requote-pass.js';
import { planQuotes, type GuildOrderIntent, type MakerNpc } from './plan.js';
import { noticeFromFill, type GuildFillNotice, type RequoteReport } from './requote.js';
import { NpcTurnQueue } from './turn-queue.js';

export type { DockReport };

export interface GuildBookDiscovery {
  overview(planetId: string): Promise<TradeOverviewResponse>;
}

/** Test seam. The Nest app leaves this unbound and uses `TradeReadService` / the order repositories. */
export const GUILD_ORDER_PORT = Symbol('GUILD_ORDER_PORT');
export const GUILD_BOOK_DISCOVERY = Symbol('GUILD_BOOK_DISCOVERY');

/**
 * While a Guild NPC is docked, rest one bid and one ask per Tier-1 barter pair that `quoteGuild` prices.
 * Actor kind is `npc`. Departure, kill, and a fill delegate to `parts/`.
 */
@Injectable()
export class GuildMakerService implements OnModuleInit, OnModuleDestroy, GuildFillSink {
  private readonly log = new Logger(GuildMakerService.name);
  private readonly turns = new NpcTurnQueue();
  private off: Array<() => void> = [];
  private book: GuildOrderPort | null = null;

  constructor(
    private readonly flags: FlagsService,
    private readonly funding: GuildFundingService,
    private readonly npcs: GuildNpcRepository,
    private readonly keys: TradeKeyRepository,
    private readonly moduleRef: ModuleRef,
    private readonly bus: EventBus,
    @Optional() @Inject(APP_ENV) private readonly env?: AppEnv,
    @Optional() @Inject(PRISMA) private readonly prisma?: PrismaClient,
    @Optional() @Inject(GUILD_ORDER_PORT) private readonly orders?: GuildOrderPort,
    @Optional() @Inject(GUILD_BOOK_DISCOVERY) private readonly discovery?: GuildBookDiscovery,
    @Optional() private readonly telemetry?: GuildMetrics,
    @Optional() @Inject(GuildStrategyPort) private readonly strategy?: GuildStrategyPort,
  ) {}

  onModuleInit(): void {
    this.off = [
      this.bus.on('guild.arrived', (ev) => void this.onArrived(ev.payload), { module: 'GuildMakerService' }),
      this.bus.on('guild.departed', (ev) => void this.onDeparted(ev.payload), { module: 'GuildMakerService' }),
    ];
  }

  onModuleDestroy(): void {
    for (const stop of this.off) stop();
    this.off = [];
  }

  async onArrived(payload: GuildArrivedPayload): Promise<DockReport> {
    if (!this.live()) return { placed: [], skipped: ['wave_disabled'] };
    try {
      return await this.arrive(payload);
    } catch (err) {
      this.log.warn(`guild quote failed: ${err instanceof Error ? err.message : String(err)}`);
      return { placed: [], skipped: ['failed'] };
    }
  }

  async onDeparted(payload: GuildDepartedPayload): Promise<string[]> {
    if (!this.live()) return [];
    return cancelResting(this.dockIo(), payload.npcId, payload.planetId);
  }

  /** Kill switch: drop every resting guild quote for this NPC and do not place another. */
  onKilled(npcId: string): Promise<string[]> {
    if (!this.live()) return Promise.resolve([]);
    return cancelResting(this.dockIo(), npcId);
  }

  /**
   * Record one guild fill on the NPC row. A player buy is `side: 'sell'` and decreases stock.
   * Does not re-quote. Fills that must re-quote go through `onGuildFill`.
   */
  recordFill(npcId: string, fill: GuildCargoFill): Promise<CargoFillResult | null> {
    if (!this.live()) return Promise.resolve(null);
    return this.turns.run(npcId, () => this.npcs.withLock(npcId, (db) => this.writeFill(npcId, fill, db)));
  }

  /** After the match transaction commits: one guild leg becomes one re-quote. */
  async onMatched(outcome: MatchOutcome): Promise<void> {
    if (!this.live()) return;
    const orders = [outcome.incoming, ...outcome.makers.values()];
    for (const fill of outcome.fills) {
      const notice = noticeFromFill(fill, orders);
      if (notice) await this.onGuildFill(notice);
    }
  }

  /**
   * Serialize this NPC's inventory, consume the filled hold, cancel the old quote, and rest a new one.
   * A non-positive amount does not write and does not re-quote.
   */
  onGuildFill(notice: GuildFillNotice): Promise<RequoteReport | null> {
    if (!this.live()) return Promise.resolve(null);
    if (!Number.isSafeInteger(notice.amount) || notice.amount <= 0) return Promise.resolve({ requoted: false, reason: 'zero' });
    return this.turns.run(notice.npcId, () => runRequote(this.requoteIo(), notice));
  }

  private async arrive(payload: GuildArrivedPayload): Promise<DockReport> {
    const npc = await this.npcOf(payload.npcId);
    if (!npc) return { placed: [], skipped: ['not_provisioned'] };
    const key = await this.keys.find(npc.tradeKeyId);
    if (!key || key.revokedAt) return { placed: [], skipped: ['no_key'] };
    const overview = await this.overview(payload.planetId);
    const planned = planQuotes(this.data(), npc, { planetId: payload.planetId, departAt: payload.departAt }, overview.overview, await this.quoteTargets(npc.npcId));
    return admitQuotes(this.dockIo(), npc, key, planned, payload.planetId);
  }

  private async writeFill(npcId: string, fill: GuildCargoFill, db: DbClient): Promise<CargoFillResult | null> {
    const row = await this.npcs.find(npcId, db);
    if (!row || row.actorKind !== 'npc') return null;
    const result = applyFill(row, fill);
    if (result.ok) await this.npcs.saveInventory(npcId, result.inventory, db);
    return result;
  }

  private async npcOf(npcId: string): Promise<MakerNpc | null> {
    const row = await this.npcs.find(npcId);
    if (!row || row.actorKind !== 'npc') return null;
    return { npcId: row.npcId, accountId: row.accountId, tradeKeyId: row.tradeKeyId, inventory: row.inventory, lossAtomic: row.lossAtomic };
  }

  private async overview(planetId: string): Promise<TradeOverviewResponse> {
    if (this.discovery) return this.discovery.overview(planetId);
    const res = await this.moduleRef.get(TradeReadService, { strict: false }).overview(planetId);
    if (this.env?.TA_SEED_RIVAL_AI !== '1' && this.env?.TA_SEED_RIVAL_AI !== 'true') return res;
    return {
      ...res,
      overview: res.overview.map((row) =>
        row.last === null && row.bestBid === null && row.bestAsk === null
          ? { ...row, last: { num: '1', den: 1 }, volume24h: Math.max(100, row.volume24h) }
          : row,
      ),
    };
  }

  private port(): GuildOrderPort {
    if (this.orders) return this.orders;
    if (!this.book) {
      if (!this.prisma) throw new Error('guild maker has no order book');
      this.book = new GuildOrderBook(this.prisma, this.moduleRef.get(MarketOrderRepository, { strict: false }), this.moduleRef.get(OrderRelease, { strict: false }));
    }
    return this.book;
  }

  private data(): CompiledDataLike {
    return compileData(this.flags.flags);
  }

  /** Strategy stockpile, or `undefined` when there is no port or the payload is rejected. */
  private async quoteTargets(npcId: string): Promise<ReadonlyMap<string, bigint> | undefined> {
    if (!this.strategy) return undefined;
    return stockpileTargets(await this.strategy.choose({ id: npcId }, { nowMs: Date.now() }));
  }

  private live(): boolean {
    return fundingEnabled(this.flags, this.env);
  }

  private note(reason: string): string {
    this.telemetry?.reject(reason);
    return reason;
  }

  private dockIo(): DockIo {
    return {
      port: () => this.port(),
      funding: this.funding,
      has: (wave) => this.flags.has(wave),
      note: (reason) => this.note(reason),
      cancelNpc: (npcId, planetId) => cancelResting(this.dockIo(), npcId, planetId),
      gate: (npc, key, intent, outstanding, committed) => this.gate(key, npc.npcId, intent, outstanding, committed),
    };
  }

  private gate(key: KeyRecord, npcId: string, intent: GuildOrderIntent, outstanding: number, committed: bigint): Promise<string | null> {
    return gateIntent(this.dockIo(), key, npcId, intent, outstanding, committed);
  }

  private requoteIo(): RequoteIo {
    return {
      prisma: this.prisma,
      npcs: this.npcs,
      keys: this.keys,
      funding: this.funding,
      port: () => this.port(),
      data: () => this.data(),
      has: (wave) => this.flags.has(wave),
      note: (reason) => this.note(reason),
      overview: (planetId) => this.overview(planetId),
      quoteTargets: (npcId) => this.quoteTargets(npcId),
      writeFill: (npcId, fill, db) => this.writeFill(npcId, fill, db),
      npcOf: (npcId) => this.npcOf(npcId),
    };
  }
}

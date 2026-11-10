import { Inject, Injectable, Logger, Optional, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import type { GuildArrivedPayload, GuildDepartedPayload, TradeOverviewResponse } from '@terra/contracts';
import type { DbClient, PrismaClient } from '@terra/db';
import { checkAllowance, type ReferencePrice } from '../../trade/allowance.js';
import { TradeKeyRepository, type KeyRecord } from '../../trade/trade-key.repository.js';
import { TradeReadService } from '../../trade/trade-read.service.js';
import { MarketOrderRepository } from '../../book/market-order.repository.js';
import { OrderRelease } from '../../orders/cancel-order.service.js';
import { EventBus } from '../../../bus/event-bus.js';
import { APP_ENV, type AppEnv } from '../../../core/tokens.js';
import { PRISMA } from '../../../db/db.module.js';
import { FlagsService } from '../../../flags/flags.service.js';
import { fundingEnabled } from '../funding/caps.js';
import { GuildFundingService, type AllowQuoteRequest } from '../funding/guild-funding.service.js';
import { GuildNpcRepository } from '../guild-npc.repository.js';
import { loadPolicy } from '../guild-plan.js';
import { applyFill, type CargoFillResult, type GuildCargoFill } from '../inventory.js';
import { compileData, type CompiledDataLike } from '@terra/sim';
import { decimalToBigint } from '../../book/decimal.js';
import type { MatchOutcome } from '../../matching/market-matcher.service.js';
import type { GuildFillSink } from './fill-sink.js';
import { GuildOrderBook, type GuildOrderPort, type RestingGuildOrder } from './order-book.js';
import { barterPairIds } from './pairs.js';
import { cancelIds, planQuotes, type GuildOrderIntent, type MakerNpc } from './plan.js';
import {
  consumedHold, lossBlocksBid, noticeFromFill, termsMeta, withQuoteSeq,
  type GuildFillNotice, type OrderMeta, type RequoteReport,
} from './requote.js';
import { NpcTurnQueue } from './turn-queue.js';

export interface DockReport {
  readonly placed: readonly string[];
  readonly skipped: readonly string[];
}

export interface GuildBookDiscovery {
  overview(planetId: string): Promise<TradeOverviewResponse>;
}

/** Test seam. The Nest app leaves this unbound and uses `TradeReadService` / the order repositories. */
export const GUILD_ORDER_PORT = Symbol('GUILD_ORDER_PORT');
export const GUILD_BOOK_DISCOVERY = Symbol('GUILD_BOOK_DISCOVERY');

/**
 * While a Guild NPC is docked, rest one bid and one ask per Tier-1 barter pair that `quoteGuild` prices.
 * Actor kind is `npc`. The command source recorded on the order is `bot`. One overview call discovers the book.
 * Departure and the kill switch cancel those orders and release the funding hold.
 * A guild fill records cargo, consumes the funding hold, and replaces that quote in the same turn.
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
    if (!this.live()) return report([], ['wave_disabled']);
    try {
      return await this.arrive(payload);
    } catch (err) {
      this.log.warn(`guild quote failed: ${err instanceof Error ? err.message : String(err)}`);
      return report([], ['failed']);
    }
  }

  async onDeparted(payload: GuildDepartedPayload): Promise<string[]> {
    if (!this.live()) return [];
    return this.cancelNpc(payload.npcId, payload.planetId);
  }

  /** Kill switch: drop every resting guild quote for this NPC and do not place another. */
  onKilled(npcId: string): Promise<string[]> {
    if (!this.live()) return Promise.resolve([]);
    return this.cancelNpc(npcId);
  }

  /**
   * Record one guild fill on the NPC row. A player buy is `side: 'sell'` and decreases stock.
   * Does not re-quote. Fills that must re-quote go through `onGuildFill` (it writes the same cache).
   * W15 off writes nothing. Departure does not clear the cache.
   */
  recordFill(npcId: string, fill: GuildCargoFill): Promise<CargoFillResult | null> {
    if (!this.live()) return Promise.resolve(null);
    return this.turns.run(npcId, () => this.npcs.withLock(npcId, (db) => this.writeFill(npcId, fill, db)));
  }

  /**
   * After the match transaction commits: one guild leg becomes one re-quote.
   * W15 off does nothing. A zero-qty leg is ignored inside `onGuildFill`.
   */
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
   * A non-positive amount does not write and does not re-quote. W15 off returns null.
   * Do not call this from inside `recordFill`: both take the same per-NPC turn.
   */
  onGuildFill(notice: GuildFillNotice): Promise<RequoteReport | null> {
    if (!this.live()) return Promise.resolve(null);
    if (!Number.isSafeInteger(notice.amount) || notice.amount <= 0) return Promise.resolve({ requoted: false, reason: 'zero' });
    return this.turns.run(notice.npcId, () => this.requote(notice));
  }

  private async arrive(payload: GuildArrivedPayload): Promise<DockReport> {
    const npc = await this.npcOf(payload.npcId);
    if (!npc) return report([], ['not_provisioned']);
    const key = await this.keys.find(npc.tradeKeyId);
    if (!key || key.revokedAt) return report([], ['no_key']);
    const overview = await this.overview(payload.planetId);
    const planned = planQuotes(this.data(), npc, { planetId: payload.planetId, departAt: payload.departAt }, overview.overview);
    return this.admit(npc, key, planned, payload.planetId);
  }

  private async admit(npc: MakerNpc, key: KeyRecord, planned: readonly GuildOrderIntent[], planetId: string): Promise<DockReport> {
    const placed: string[] = [];
    const skipped: string[] = [];
    let open = await this.port().resting(npc.npcId, planetId);
    let committed = open.reduce((sum, row) => sum + row.notional, 0n);
    for (const intent of planned) {
      if (open.some((row) => row.base === intent.base && row.side === intent.side)) {
        skipped.push('duplicate');
        continue;
      }
      const reason = await this.gate(npc, key, intent, open.length, committed);
      if (reason === 'killed') {
        await this.cancelNpc(npc.npcId, planetId);
        return report(placed, [...skipped, 'killed']);
      }
      if (reason) {
        skipped.push(reason);
        continue;
      }
      const row = await this.placeOrRelease(npc.npcId, intent);
      if (!row) {
        skipped.push('duplicate');
        continue;
      }
      placed.push(row);
      committed += intent.priceAmount;
      open = [...open, restingFrom(intent, row)];
    }
    return report(placed, skipped);
  }

  private async placeOrRelease(npcId: string, intent: GuildOrderIntent): Promise<string | null> {
    try {
      const row = await this.port().place(intent);
      if (row.created) return row.orderId;
      await this.funding.release(npcId, intent.bucket, intent.reserve);
      return null;
    } catch (err) {
      await this.funding.release(npcId, intent.bucket, intent.reserve);
      throw err;
    }
  }

  private async gate(
    npc: MakerNpc,
    key: KeyRecord,
    intent: GuildOrderIntent,
    outstanding: number,
    committed: bigint,
  ): Promise<string | null> {
    const allowance = this.allowanceOf(key, intent, outstanding, committed);
    if (allowance) return allowance;
    const preview = await this.funding.allowQuote(quoteRequest(npc.npcId, intent, (wave) => this.flags.has(wave)));
    if (!preview.ok) return preview.reason;
    const held = await this.funding.reserve(npc.npcId, intent.bucket, intent.reserve);
    return held.ok ? null : held.reason;
  }

  private allowanceOf(key: KeyRecord, intent: GuildOrderIntent, outstanding: number, committed: bigint): string | null {
    const reference: ReferencePrice | null = intent.reference;
    const rejection = checkAllowance(
      { ...key.allowance, allowedPairs: [...new Set([...key.allowance.allowedPairs, ...barterPairIds()])] },
      { pair: intent.pair, amount: intent.amount, notional: intent.priceAmount },
      { outstandingOrders: outstanding, committedToday: committed, reference },
    );
    return rejection?.code ?? null;
  }

  private async cancelNpc(npcId: string, planetId?: string): Promise<string[]> {
    const rows = await this.port().resting(npcId, planetId);
    const ids = cancelIds(rows);
    for (const row of rows) {
      await this.port().cancel(row);
      if (row.reserve > 0n) await this.funding.release(npcId, row.bucket, row.reserve);
    }
    return ids;
  }

  private async requote(notice: GuildFillNotice): Promise<RequoteReport> {
    const meta = await this.metaOf(notice);
    const wrote = await this.npcs.withLock(notice.npcId, (db) => this.writeFill(notice.npcId, cargoOf(notice), db));
    if (!wrote?.ok) return { requoted: false, reason: wrote ? wrote.reason : 'no_npc', previousOrderId: notice.orderId };
    await this.settleHold(notice, meta);
    return this.placeNext(notice, meta);
  }

  private async metaOf(notice: GuildFillNotice): Promise<OrderMeta> {
    const open = await this.openQuote(notice);
    const stored = await this.storedMeta(notice.orderId);
    return {
      reserve: open?.reserve ?? stored?.reserve ?? notice.reserve,
      departAt: open?.departAt || stored?.departAt || notice.departAt,
      quoteSeq: open?.quoteSeq ?? stored?.quoteSeq ?? notice.quoteSeq,
      orderAmount: open && open.amount > 0n ? open.amount : stored?.orderAmount ?? notice.orderAmount,
      bucket: open?.bucket ?? stored?.bucket ?? 'inventory',
    };
  }

  private async storedMeta(orderId: string): Promise<OrderMeta | null> {
    if (!this.prisma) return null;
    const row = await this.prisma.marketOrder.findUnique({
      where: { orderId }, select: { signedTerms: true, ref: true, amount: true },
    });
    return row ? termsMeta(row.signedTerms, row.ref, decimalToBigint(row.amount)) : null;
  }

  private async settleHold(notice: GuildFillNotice, meta: OrderMeta): Promise<void> {
    const qty = BigInt(notice.amount);
    const size = meta.orderAmount > 0n ? meta.orderAmount : qty;
    const held = consumedHold(meta.reserve, size, qty);
    if (held > 0n) await this.funding.consume(notice.npcId, meta.bucket, held);
    const open = await this.openQuote(notice);
    if (!open) return;
    const left = meta.reserve > held ? meta.reserve - held : 0n;
    if (left > 0n) await this.funding.release(notice.npcId, open.bucket, left);
    await this.port().cancel(open);
  }

  private async placeNext(notice: GuildFillNotice, meta: OrderMeta): Promise<RequoteReport> {
    const npc = await this.npcOf(notice.npcId);
    const previousOrderId = notice.orderId;
    if (!npc) return { requoted: false, reason: 'no_npc', previousOrderId };
    const quoteSeq = meta.quoteSeq + 1;
    if (notice.side === 'buy' && lossBlocksBid(npc.lossAtomic, loadPolicy((wave) => this.flags.has(wave)).dailyLossAtomic)) {
      return { requoted: false, reason: 'loss', quoteSeq, previousOrderId };
    }
    const key = await this.keys.find(npc.tradeKeyId);
    if (!key || key.revokedAt) return { requoted: false, reason: 'no_key', previousOrderId };
    const overview = await this.overview(notice.planetId);
    const dock = { planetId: notice.planetId, departAt: meta.departAt || notice.departAt };
    const intent = planQuotes(this.data(), npc, dock, overview.overview)
      .find((row) => row.base === notice.base && row.quote === notice.quote && row.side === notice.side);
    if (!intent) return { requoted: false, reason: 'paused', previousOrderId };
    const stamped = withQuoteSeq(intent, quoteSeq);
    const open = await this.port().resting(npc.npcId, notice.planetId);
    const committed = open.reduce((sum, row) => sum + row.notional, 0n);
    const reason = await this.gate(npc, key, stamped, open.length, committed);
    if (reason) return { requoted: false, reason, previousOrderId };
    const orderId = await this.placeOrRelease(npc.npcId, stamped);
    if (!orderId) return { requoted: false, reason: 'duplicate', previousOrderId };
    return { requoted: true, orderId, quoteSeq, bid: stamped.priceAmount, previousOrderId };
  }

  private async openQuote(notice: GuildFillNotice): Promise<RestingGuildOrder | null> {
    const rows = await this.port().resting(notice.npcId, notice.planetId);
    return rows.find((row) => row.orderId === notice.orderId)
      ?? rows.find((row) => row.base === notice.base && row.side === notice.side)
      ?? null;
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

  private overview(planetId: string): Promise<TradeOverviewResponse> {
    if (this.discovery) return this.discovery.overview(planetId);
    const read = this.moduleRef.get(TradeReadService, { strict: false });
    return read.overview(planetId);
  }

  private port(): GuildOrderPort {
    if (this.orders) return this.orders;
    if (!this.book) {
      if (!this.prisma) throw new Error('guild maker has no order book');
      this.book = new GuildOrderBook(
        this.prisma,
        this.moduleRef.get(MarketOrderRepository, { strict: false }),
        this.moduleRef.get(OrderRelease, { strict: false }),
      );
    }
    return this.book;
  }

  private data(): CompiledDataLike {
    return compileData(this.flags.flags);
  }

  private live(): boolean {
    return fundingEnabled(this.flags, this.env);
  }
}

function report(placed: readonly string[], skipped: readonly string[]): DockReport {
  return { placed, skipped };
}

function quoteRequest(npcId: string, intent: GuildOrderIntent, has: (wave: string) => boolean): AllowQuoteRequest {
  const policy = loadPolicy(has);
  return {
    npcId,
    side: intent.side,
    quote: 'inventory',
    size: intent.reserve,
    stock: intent.stock,
    cashEnabled: policy.cashEnabled,
    referenceAgeS: 0,
    eligibleVolume: policy.params.minReferenceVolume,
    referenceMaxAgeS: policy.params.referenceMaxAgeS,
    minReferenceVolume: policy.params.minReferenceVolume,
  };
}

function cargoOf(notice: GuildFillNotice): GuildCargoFill {
  return { resource: notice.base, side: notice.side, amount: notice.amount, planetId: notice.planetId };
}

function restingFrom(intent: GuildOrderIntent, orderId: string): RestingGuildOrder {
  return {
    orderId,
    planetId: intent.planetId,
    colonyId: intent.npcId,
    base: intent.base,
    quote: intent.quote,
    side: intent.side,
    actorKind: 'npc',
    bucket: intent.bucket,
    reserve: intent.reserve,
    notional: intent.priceAmount,
    amount: intent.amount,
    ref: intent.ref,
    departAt: intent.departAt,
    quoteSeq: intent.quoteSeq,
  };
}

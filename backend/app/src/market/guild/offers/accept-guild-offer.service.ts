import { Inject, Injectable, Logger, Optional, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { RejectCode } from '@terra/contracts';
import type { PrismaClient } from '@terra/db';
import { EventBus } from '../../../bus/event-bus.js';
import { databaseEnabled } from '../../../core/persistence.js';
import { APP_ENV, type AppEnv } from '../../../core/tokens.js';
import { PRISMA } from '../../../db/db.module.js';
import { FlagsService } from '../../../flags/flags.service.js';
import { MarketBooks } from '../../book/market-books.js';
import { MarketOrderRepository } from '../../book/market-order.repository.js';
import { MarketFillsHook } from '../../orders/market-fills.hook.js';
import { resolveMarketAccountId } from '../../orders/colony-account.js';
import { PLATFORM_ACCOUNT_ID } from '../../orders/market-policy.provider.js';
import { GUILD_FILL_SINK, type GuildFillSink } from '../maker/fill-sink.js';
import { crossGuildOffer } from './cross-offer.js';
import { GuildOffersService } from './guild-offers.service.js';
import { ensureMockSigners } from './signers.js';

export interface AcceptGuildOfferInput {
  readonly offerId: string;
  readonly planetId: string;
  readonly colonyId: string;
  readonly colonyIndex: number;
  readonly playerId: string;
}

export type AcceptGuildOfferResult =
  | { readonly ok: true; readonly tradeId: string; readonly npcAccountId: string }
  | { readonly ok: false; readonly code: RejectCode; readonly detail?: string };

/**
 * Crosses one curated Guild offer against its NPC quote through the W13 fills hook.
 * W15 off is `wave_disabled`. A stale id, a departed ship or a filled quote is `offer_expired`.
 */
@Injectable()
export class AcceptGuildOfferService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(AcceptGuildOfferService.name);
  private off: (() => void) | null = null;

  constructor(
    private readonly flags: FlagsService,
    private readonly offers: GuildOffersService,
    private readonly repo: MarketOrderRepository,
    private readonly books: MarketBooks,
    private readonly fills: MarketFillsHook,
    private readonly bus: EventBus,
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(APP_ENV) private readonly env: AppEnv,
    @Optional() @Inject(GUILD_FILL_SINK) private readonly guild?: GuildFillSink,
  ) {}

  onModuleInit(): void {
    this.off ??= this.bus.onPlanetEvent('guildOfferAcceptRequested', (ev) => {
      void this.accept({
        offerId: ev.data.offerId,
        planetId: ev.planetId,
        colonyId: ev.data.colonyId,
        colonyIndex: ev.data.colonyIndex,
        playerId: ev.data.playerId ?? ev.data.colonyId,
      }).catch((err: unknown) => this.log.warn(`guild accept failed: ${err instanceof Error ? err.message : String(err)}`));
    }, { module: 'AcceptGuildOfferService' });
  }

  onModuleDestroy(): void {
    this.off?.();
    this.off = null;
  }

  async accept(input: AcceptGuildOfferInput): Promise<AcceptGuildOfferResult> {
    if (!this.flags.has('W15')) return { ok: false, code: 'wave_disabled' };
    if (!databaseEnabled(this.env)) return { ok: false, code: 'market_unavailable' };
    const judged = await this.offers.judge(input.planetId, input.offerId);
    if (!judged.ok) return { ok: false, code: 'offer_expired', ...(judged.detail ? { detail: judged.detail } : {}) };
    try {
      return await this.settle(input, judged);
    } catch (err) {
      this.log.warn(`guild accept failed: ${err instanceof Error ? err.message : String(err)}`);
      return { ok: false, code: 'market_unavailable', detail: 'The Guild offer could not be settled.' };
    }
  }

  private async settle(input: AcceptGuildOfferInput, judged: Extract<Awaited<ReturnType<GuildOffersService['judge']>>, { ok: true }>): Promise<AcceptGuildOfferResult> {
    const accountId = await resolveMarketAccountId(this.prisma, input.colonyId, input.playerId, input.planetId, input.colonyIndex);
    await ensureMockSigners(this.env, this.prisma, [accountId, judged.quote.npcAccountId, PLATFORM_ACCOUNT_ID]);
    const crossed = await crossGuildOffer(this.prisma, this.repo, this.fills, this.books, { ...input, accountId }, judged.quote, judged.offer);
    if (!crossed.ok) return crossed;
    await this.requote(input.planetId, judged);
    this.bus.emit('planet.event', {
      planetId: input.planetId,
      tick: 0,
      kind: 'guildTradeSettled',
      severity: 'info',
      colonyIds: [input.colonyId],
      data: {
        tradeId: crossed.tradeId,
        colonyId: input.colonyId,
        colonyIndex: input.colonyIndex,
        npcId: judged.quote.npcId,
        npcAccountId: judged.quote.npcAccountId,
        shipId: judged.quote.shipId,
        action: judged.offer.action,
        resource: judged.offer.resource,
        amount: judged.offer.amount,
        price: judged.offer.price,
      },
    });
    return { ok: true, tradeId: crossed.tradeId, npcAccountId: crossed.npcAccountId };
  }

  /** The trade is already committed. The maker re-reads the filled row for the hold and the depart time. */
  private async requote(planetId: string, judged: Extract<Awaited<ReturnType<GuildOffersService['judge']>>, { ok: true }>): Promise<void> {
    if (!this.guild) return;
    const quote = judged.quote;
    await this.guild.onGuildFill({
      npcId: quote.npcId,
      planetId,
      base: quote.base,
      quote: quote.quote,
      side: quote.side,
      amount: judged.offer.amount,
      orderId: quote.orderId,
      reserve: 0n,
      orderAmount: quote.amount,
      departAt: 0,
      quoteSeq: quote.quoteSeq,
    }).catch((err: unknown) => this.log.warn(`guild re-quote failed: ${err instanceof Error ? err.message : String(err)}`));
  }
}

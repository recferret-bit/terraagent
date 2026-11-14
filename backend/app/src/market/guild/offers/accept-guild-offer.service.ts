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
import { MarketPolicyProvider, resolveProtocolAccountId } from '../../orders/market-policy.provider.js';
import { resolveDbStakerPerks } from '../../../near/staking/staker-perks.js';
import { GUILD_FILL_SINK, type GuildFillSink } from '../maker/fill-sink.js';
import { GuildContactProducer } from '../../progression/guild-contact.producer.js';
import { crossGuildOffer } from './cross-offer.js';
import { GuildOffersService } from './guild-offers.service.js';
import { ensureMockSigners, ensureVerifierBalance } from './signers.js';

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
    @Optional() private readonly guildContact?: GuildContactProducer,
    @Optional() private readonly policy?: MarketPolicyProvider,
  ) {}

  onModuleInit(): void {
    this.off ??= this.bus.onPlanetEvent(
      'guildOfferAcceptRequested',
      (ev) => {
        void this.accept({
          offerId: ev.data.offerId,
          planetId: ev.planetId,
          colonyId: ev.data.colonyId,
          colonyIndex: ev.data.colonyIndex,
          playerId: ev.data.playerId ?? ev.data.colonyId,
        }).catch((err: unknown) =>
          this.log.warn(`guild accept failed: ${err instanceof Error ? err.message : String(err)}`),
        );
      },
      { module: 'AcceptGuildOfferService' },
    );
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

  private async settle(
    input: AcceptGuildOfferInput,
    judged: Extract<Awaited<ReturnType<GuildOffersService['judge']>>, { ok: true }>,
  ): Promise<AcceptGuildOfferResult> {
    const accountId = await resolveMarketAccountId(
      this.prisma,
      input.colonyId,
      input.playerId,
      input.planetId,
      input.colonyIndex,
    );
    const envBag = this.env as unknown as Record<string, string | undefined>;
    const platformAccountId = resolveProtocolAccountId(envBag);
    await ensureMockSigners(this.env, this.prisma, [accountId, judged.quote.npcAccountId, platformAccountId]);
    const npcSellToken = judged.quote.side === 'sell' ? judged.quote.base : judged.quote.quote;
    const npcSellUnits = judged.quote.side === 'sell' ? judged.quote.amount : judged.quote.priceAmount * 2n;
    await ensureVerifierBalance(this.prisma, judged.quote.npcAccountId, npcSellToken, npcSellUnits, this.env);
    if (this.env.TA_SEED_RIVAL_AI === '1' || this.env.TA_SEED_RIVAL_AI === 'true') {
      const playerSellToken = judged.quote.side === 'sell' ? judged.quote.quote : judged.quote.base;
      const playerSellUnits = judged.quote.side === 'sell' ? judged.quote.priceAmount * 2n : judged.quote.amount * 2n;
      await ensureVerifierBalance(this.prisma, accountId, playerSellToken, playerSellUnits, this.env);
    }
    const perks = await resolveDbStakerPerks(this.prisma, {
      colonyId: input.colonyId,
      accountId,
      ...(this.policy ? { standardPlatformFeeBp: this.policy.current().platformFeeBp } : {}),
      env: envBag,
    });
    const crossed = await crossGuildOffer(
      this.prisma,
      this.repo,
      this.fills,
      this.books,
      {
        ...input,
        accountId,
        platformAccountId,
        ...(perks.active ? { stakerPlatformFeeBp: perks.platformFeeBp } : {}),
      },
      judged.quote,
      judged.offer,
    );
    if (!crossed.ok) return crossed;
    await this.noteContact(input, crossed.tradeId, judged.quote.npcId, judged.offer.action, judged.offer.amount);
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

  /** The trade row is already committed. Player `buy` means the NPC was the seller. */
  private async noteContact(
    input: AcceptGuildOfferInput,
    tradeId: string,
    npcId: string,
    action: 'buy' | 'sell',
    amount: number,
  ): Promise<void> {
    if (!this.guildContact) return;
    const player = { actorKind: 'player', colonyId: input.colonyId, playerId: input.playerId };
    const npc = { actorKind: 'npc', colonyId: npcId, playerId: null };
    const buy = action === 'buy';
    await this.guildContact
      .note({
        tradeId,
        planetId: input.planetId,
        amount,
        buyer: buy ? player : npc,
        seller: buy ? npc : player,
      })
      .catch((err: unknown) =>
        this.log.warn(`guild contact fact failed: ${err instanceof Error ? err.message : String(err)}`),
      );
  }

  /** The trade is already committed. The maker re-reads the filled row for the hold and the depart time. */
  private async requote(
    planetId: string,
    judged: Extract<Awaited<ReturnType<GuildOffersService['judge']>>, { ok: true }>,
  ): Promise<void> {
    if (!this.guild) return;
    const quote = judged.quote;
    await this.guild
      .onGuildFill({
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
      })
      .catch((err: unknown) =>
        this.log.warn(`guild re-quote failed: ${err instanceof Error ? err.message : String(err)}`),
      );
  }
}

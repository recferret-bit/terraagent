import { Inject, Injectable } from '@nestjs/common';
import type { GuildOffer } from '@terra/contracts';
import { Prisma, type PrismaClient } from '@terra/db';
import { PRISMA } from '../../../db/db.module.js';
import { FlagsService } from '../../../flags/flags.service.js';
import { GuildMakerService } from '../maker/guild-maker.service.js';
import type { ArrivedInput } from '../visit/guild-visit.publisher.js';
import { curateGuildOffers, judgeOffer, type OfferJudge, type OfferQuote } from './curate.js';
import { parseGuildOfferId } from './offer-id.js';
import { quoteSeqOf, toOfferQuote, type QuoteRow } from './quote-row.js';

/** Reads the maker's resting quotes and turns them into the top 6 `guild.arrived` offers. */
@Injectable()
export class GuildOffersService {
  constructor(
    private readonly flags: FlagsService,
    private readonly maker: GuildMakerService,
    @Inject(PRISMA) private readonly prisma: PrismaClient,
  ) {}

  /** Places this dock's quotes if they are not already resting, then curates them. */
  async offersFor(input: ArrivedInput): Promise<GuildOffer[]> {
    if (!this.flags.has('W15')) return [];
    await this.maker.onArrived({ ...input, offers: [] });
    const ships = new Map([[input.npcId, input.shipId]]);
    return curateGuildOffers(await this.openQuotes(input.planetId, input.npcId, ships));
  }

  /** Read-only. A missing, departed or re-quoted id is `offer_expired`. */
  async judge(planetId: string, offerId: string): Promise<OfferJudge> {
    const ships = await this.dockedShips(planetId);
    const rows = await this.openQuotes(planetId, undefined, ships);
    const parsed = parseGuildOfferId(offerId);
    const quote = parsed ? rows.find((row) => row.orderId === parsed.orderId) : undefined;
    return judgeOffer(offerId, rows, quote ? ships.has(quote.npcId) : false);
  }

  /** The next quote sequence on one resting NPC order. The previous offer id then expires. */
  async bumpQuoteSeq(orderId: string): Promise<number | null> {
    const row = await this.prisma.marketOrder.findUnique({ where: { orderId }, select: { signedTerms: true, state: true } });
    if (!row || (row.state !== 'OPEN' && row.state !== 'PARTIAL')) return null;
    const next = quoteSeqOf(row.signedTerms) + 1;
    const terms = row.signedTerms && typeof row.signedTerms === 'object' && !Array.isArray(row.signedTerms) ? row.signedTerms : {};
    await this.prisma.marketOrder.update({
      where: { orderId },
      data: { signedTerms: { ...terms, quoteSeq: next } as Prisma.InputJsonValue },
    });
    return next;
  }

  private async dockedShips(planetId: string): Promise<Map<string, string>> {
    const rows = await this.prisma.guildVisit.findMany({
      where: { planetId, status: 'docked' },
      select: { npcId: true, shipId: true },
      orderBy: { arriveAt: 'desc' },
    });
    const ships = new Map<string, string>();
    for (const row of rows) if (!ships.has(row.npcId)) ships.set(row.npcId, row.shipId);
    return ships;
  }

  private async openQuotes(planetId: string, npcId: string | undefined, ships: ReadonlyMap<string, string>): Promise<OfferQuote[]> {
    const rows = await this.prisma.marketOrder.findMany({
      where: {
        planetId,
        actorKind: { in: ['npc', 'guild'] },
        state: { in: ['OPEN', 'PARTIAL'] },
        ...(npcId ? { colonyId: npcId } : {}),
      },
      select: {
        orderId: true, colonyId: true, accountId: true, base: true, quote: true, side: true,
        amount: true, filled: true, priceAmount: true, signedTerms: true,
      },
    });
    const out: OfferQuote[] = [];
    for (const row of rows) {
      const quote = toOfferQuote(row as QuoteRow, ships.get(row.colonyId) ?? row.colonyId);
      if (quote) out.push(quote);
    }
    return out;
  }
}

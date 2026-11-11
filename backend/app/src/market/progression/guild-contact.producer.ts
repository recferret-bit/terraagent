import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { ProgressEventV1 } from '@terra/contracts';
import type { PrismaClient } from '@terra/db';
import { PRISMA } from '../../db/db.module.js';
import { FlagsService } from '../../flags/flags.service.js';
import { ProgressionEventForwarder } from '../../game/progression-events.service.js';
import { FactsUpdaterService } from '../../progression/facts-updater.service.js';
import {
  guildContactEvent,
  guildContactFills,
  liveTradeId,
  type GuildContactFill,
  type GuildContactMatch,
  type GuildContactParty,
} from './guild-contact-events.js';

const ATTEMPTS = 3;

/**
 * W15-25 progression producer. A committed fill with `actorKind === 'npc'` on one side and a player or bot
 * on the other is `guild-contact` +1 for that owner. The event id is `guild:guildContact:<tradeId>:<playerId>`,
 * so a replay does not count twice. W15 off does nothing. This file does not mint achievements: it submits
 * the fact, and W12's engine evaluates the catalogue.
 */
@Injectable()
export class GuildContactProducer {
  private readonly log = new Logger(GuildContactProducer.name);
  private readonly seen = new Set<string>();
  private readonly pending = new Map<string, Promise<void>>();

  constructor(
    private readonly facts: FactsUpdaterService,
    @Optional() private readonly flags?: FlagsService,
    @Optional() private readonly forwarder?: ProgressionEventForwarder,
    @Optional() @Inject(PRISMA) private readonly prisma?: PrismaClient,
  ) {}

  /** Book path, after the match transaction commits. */
  async noteOutcome(outcome: GuildContactMatch): Promise<void> {
    if (this.blocked()) return;
    for (const fill of guildContactFills(outcome)) await this.note(fill);
  }

  /** One fill. A no-op when W15 is off, the fill is not a guild-player trade, or this trade id was already applied. */
  async note(fill: GuildContactFill): Promise<void> {
    if (this.blocked()) return;
    const ready = this.withPlayers(fill);
    if (!guildContactEvent(ready)) {
      this.warnIfUnowned(ready);
      return;
    }
    const canonical = await this.canonical(ready);
    if (!canonical) return;
    const event = guildContactEvent(canonical);
    if (event) await this.deliver(event);
  }

  private blocked(): boolean {
    return Boolean(this.flags && !this.flags.has('W15'));
  }

  private withPlayers(fill: GuildContactFill): GuildContactFill {
    return { ...fill, buyer: this.playerOf(fill.buyer), seller: this.playerOf(fill.seller) };
  }

  private playerOf(side: GuildContactParty): GuildContactParty {
    if (side.actorKind === 'npc' || side.playerId || !side.colonyId) return side;
    const playerId = this.forwarder?.resolvePlayerId(side.colonyId);
    return playerId ? { ...side, playerId } : side;
  }

  private warnIfUnowned(fill: GuildContactFill): void {
    if (!Number.isSafeInteger(fill.amount) || fill.amount <= 0) return;
    const npc = [fill.buyer, fill.seller].filter((side) => side.actorKind === 'npc');
    if (npc.length !== 1) return;
    const other = fill.buyer.actorKind === 'npc' ? fill.seller : fill.buyer;
    if ((other.actorKind === 'player' || other.actorKind === 'bot') && !other.playerId) {
      this.log.warn(`guild contact skipped: no player for colony ${other.colonyId} (trade ${fill.tradeId})`);
    }
  }

  /** Prefer the stored trade id. A FAILED row with no live retry is not a contact. Lookup errors keep the computed id. */
  private async canonical(fill: GuildContactFill): Promise<GuildContactFill | null> {
    if (!this.prisma) return fill;
    try {
      const exact = await this.prisma.intentTrade.findUnique({
        where: { tradeId: fill.tradeId },
        select: { state: true },
      });
      const retries =
        exact?.state === 'FAILED' && fill.takerOrderId && fill.makerOrderId
          ? await this.prisma.intentTrade.findMany({
              where: { takerOrderId: fill.takerOrderId, makerOrderId: fill.makerOrderId },
              select: { tradeId: true, state: true },
            })
          : [];
      const tradeId = liveTradeId(fill.tradeId, exact, retries);
      if (tradeId === null) return null;
      return tradeId === fill.tradeId ? fill : { ...fill, tradeId };
    } catch (err) {
      this.log.warn(`guild contact trade lookup failed: ${err instanceof Error ? err.message : String(err)}`);
      return fill;
    }
  }

  private deliver(event: ProgressEventV1): Promise<void> {
    const id = event.eventId ?? '';
    if (!id || this.seen.has(id)) return Promise.resolve();
    const pending = this.pending.get(id);
    if (pending) return pending;
    const job = this.write(event, id);
    this.pending.set(id, job);
    return job;
  }

  private async write(event: ProgressEventV1, id: string): Promise<void> {
    try {
      if (await this.apply(event)) this.seen.add(id);
    } finally {
      this.pending.delete(id);
    }
  }

  private async apply(event: ProgressEventV1): Promise<boolean> {
    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
      try {
        await this.facts.applyProgressEvent(event);
        return true;
      } catch (err) {
        if (attempt === ATTEMPTS) {
          this.log.error(`guild contact ${event.eventId} dropped: ${err instanceof Error ? err.message : String(err)}`);
          return false;
        }
        await new Promise((resolve) => setTimeout(resolve, 50 * attempt));
      }
    }
    return false;
  }
}

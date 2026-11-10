import { Inject, Injectable, Logger, Optional, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { PrismaClient } from '@terra/db';
import type { PlanetState } from '@terra/sim';
import { readAwaySettings } from '@terra/sim/systems/away/store';
import { colonyIsAway } from '@terra/sim/systems/away/gate';
import { EventBus } from '../../bus/event-bus.js';
import { PRISMA } from '../../db/db.module.js';
import { FlagsService } from '../../flags/flags.service.js';
import { AwayDigestService } from '../../game/digest/service.js';
import { BountyRepository } from '../bounty/bounty.repository.js';
import { PlanetBountyWorld, type BountyWorldSource } from '../bounty/world.js';
import {
  defendTile,
  defenseBudgetFits,
  mercenaryDigestLine,
  pickAwaySquad,
  raidTarget,
  type AwayRaid,
  type AwaySquad,
} from './away-pick.js';
import { MercenaryHireService } from './hire.service.js';
import { mercenaryRoster } from './roster.js';

interface WaveFlags {
  has(wave: string): boolean;
}

export interface AwayRaidEvent {
  readonly planetId: string;
  readonly kind: string;
  readonly colonyIds?: readonly string[];
  readonly data?: unknown;
}

/**
 * One squad when an away colony is raided (W22-31). Calls {@link MercenaryHireService}.
 * W22 off or W09 off does nothing. A second raid does not hire while a mercenary bounty is active.
 */
@Injectable()
export class MercenaryAwayService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(MercenaryAwayService.name);
  private readonly tails = new Map<string, Promise<unknown>>();
  private stop: (() => void) | null = null;

  constructor(
    @Inject(FlagsService) private readonly flags: WaveFlags,
    @Inject(MercenaryHireService) private readonly hires: MercenaryHireService,
    @Inject(BountyRepository) private readonly bounties: BountyRepository,
    @Inject(PlanetBountyWorld) private readonly world: BountyWorldSource,
    @Optional() @Inject(PRISMA) private readonly prisma?: PrismaClient,
    @Optional() @Inject(AwayDigestService) private readonly digests?: AwayDigestService,
    @Optional() @Inject(EventBus) private readonly bus?: EventBus,
  ) {}

  onModuleInit(): void {
    if (!this.bus || this.stop) return;
    this.stop = this.bus.on('planet.event', (event) => {
      void this.onRaid(event).catch((err: unknown) => this.log.warn(`away hire: ${text(err)}`));
    }, { module: 'MercenaryAway' });
  }

  onModuleDestroy(): void {
    this.stop?.();
    this.stop = null;
  }

  /** True when this raid hired a squad. */
  onRaid(event: AwayRaidEvent): Promise<boolean> {
    if (!this.flags.has('W22') || !this.flags.has('W09')) return Promise.resolve(false);
    const raid = raidTarget(event);
    if (!raid) return Promise.resolve(false);
    return this.enqueue(raid.colonyId, () => this.hireDue(event.planetId, raid));
  }

  private async hireDue(planetId: string, raid: AwayRaid): Promise<boolean> {
    const state = await this.world.load(planetId);
    if (!state) return false;
    const settings = readAwaySettings(state, raid.colonyIndex);
    if (!settings?.hireMercenaries) return false;
    if (!(await this.isAway(state, raid))) return false;
    if (await this.mercenaryLive(raid.colonyId)) return false;
    const squad = pickAwaySquad(this.flags, settings.mercenaryMaxSpend);
    if (!squad || !this.defenseFits(state, raid, squad.total)) return false;
    const tile = defendTile(state, raid.colonyIndex, raid.q, raid.r);
    const accountId = await this.accountOf(raid.colonyId);
    if (!tile || !accountId) return false;
    return this.place(planetId, raid, accountId, squad, tile);
  }

  private defenseFits(state: PlanetState, raid: AwayRaid, total: number): boolean {
    if (colonyIsAway(state, raid.colonyIndex)) return defenseBudgetFits(state, raid.colonyIndex, total, 0);
    return true;
  }

  private async isAway(state: PlanetState, raid: AwayRaid): Promise<boolean> {
    if (colonyIsAway(state, raid.colonyIndex)) return true;
    return this.digestOpen(raid.colonyId);
  }

  private async place(
    planetId: string,
    raid: AwayRaid,
    accountId: string,
    squad: AwaySquad,
    tile: { q: number; r: number },
  ): Promise<boolean> {
    try {
      const hired = await this.hires.hire({
        planetId,
        colonyId: raid.colonyId,
        colonyIndex: raid.colonyIndex,
        accountId,
        rosterId: squad.rosterId,
        hours: squad.hours,
        q: tile.q,
        r: tile.r,
        nowMs: Date.now(),
      });
      await this.note(raid.colonyId, hired.rosterId, hired.total, hired.resource);
      return true;
    } catch (err) {
      this.log.warn(`away hire ${raid.colonyId}: ${text(err)}`);
      return false;
    }
  }

  private async note(colonyId: string, rosterId: string, total: number, resource: string): Promise<void> {
    if (!this.digests) return;
    try {
      const saved = await this.digests.noteHighlight(colonyId, new Date(), mercenaryDigestLine(rosterId, total, resource));
      if (!saved) this.log.warn(`away hire ${colonyId} has no open digest`);
    } catch (err) {
      this.log.warn(`away digest ${colonyId}: ${text(err)}`);
    }
  }

  private async mercenaryLive(colonyId: string): Promise<boolean> {
    const claimers = new Set(await this.bounties.activeClaimers(colonyId));
    return mercenaryRoster(this.flags).some((row) => claimers.has(row.accountId));
  }

  private async digestOpen(colonyId: string): Promise<boolean> {
    if (!this.prisma) return false;
    const row = await this.prisma.planetEventDigest.findFirst({
      where: { colonyId, closedAt: null },
      select: { id: true },
    });
    return row !== null;
  }

  private async accountOf(colonyId: string): Promise<string | null> {
    if (!this.prisma) return null;
    const row = await this.prisma.nearColonyAccount.findFirst({
      where: { colonyId },
      select: { accountId: true },
    });
    return row?.accountId ?? null;
  }

  private enqueue<T>(colonyId: string, work: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(colonyId) ?? Promise.resolve();
    const run = prev.then(work, work);
    this.tails.set(colonyId, run.then(() => undefined, () => undefined));
    return run;
  }
}

function text(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

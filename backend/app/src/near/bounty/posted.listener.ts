import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { PrismaClient } from '@terra/db';
import type { PlanetEventV1 } from '../../bus/channels.js';
import { EventBus } from '../../bus/event-bus.js';
import { PRISMA } from '../../db/db.module.js';
import { FlagsService } from '../../flags/flags.service.js';
import { resolveColonyAccountId } from '../cargo/cargo-export-outbox.js';
import { BountyPostService } from './post.service.js';

/**
 * A sim `bounty.post` that passed the precheck emits `bountyPosted` with id `bt:{colony}:{tick}`.
 * Escrow opens here, under that id, and only then is the chain row `open`.
 */
@Injectable()
export class BountyPostedListener implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(BountyPostedListener.name);
  private stop: (() => void) | null = null;

  constructor(
    private readonly bus: EventBus,
    @Inject(BountyPostService) private readonly posts: BountyPostService,
    @Inject(FlagsService) private readonly flags: FlagsService,
    @Inject(PRISMA) private readonly prisma: PrismaClient,
  ) {}

  onModuleInit(): void {
    if (this.stop) return;
    this.stop = this.bus.on('planet.event', (event) => this.onPlanet(event), { module: 'BountyPostedListener' });
  }

  onModuleDestroy(): void {
    this.stop?.();
    this.stop = null;
  }

  private onPlanet(event: PlanetEventV1): void {
    if (event.kind !== 'bountyPosted' || !this.flags.has('W22')) return;
    void this.open(event).catch((err: unknown) => {
      this.log.warn(`bounty escrow failed: ${err instanceof Error ? err.message : String(err)}`);
    });
  }

  private async open(event: PlanetEventV1): Promise<void> {
    if (event.kind !== 'bountyPosted') return;
    const posterId = event.data.posterId;
    const colonyIndex = await this.colonyIndex(event.planetId, posterId);
    if (colonyIndex === null) {
      this.log.warn(`bounty ${event.data.bountyId} has no colony index`);
      return;
    }
    const accountId = await resolveColonyAccountId(this.prisma, posterId, null, event.planetId, colonyIndex);
    await this.posts.post({
      planetId: event.planetId,
      colonyId: posterId,
      colonyIndex,
      accountId,
      bountyId: event.data.bountyId,
      args: { target: event.data.target, reward: event.data.reward, expiresAt: event.data.expiresAt },
    });
  }

  private async colonyIndex(planetId: string, posterId: string): Promise<number | null> {
    const inline = /^col_(\d+)$/.exec(posterId);
    if (inline) return Number(inline[1]);
    const row = await this.prisma.colony.findFirst({
      where: { id: posterId, planetId },
      select: { colonyIndex: true },
    });
    return row?.colonyIndex ?? null;
  }
}

import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { PrismaClient } from '@terra/db';
import type { PlanetEventV1 } from '../../bus/channels.js';
import { EventBus } from '../../bus/event-bus.js';
import { PRISMA } from '../../db/db.module.js';
import { FlagsService } from '../../flags/flags.service.js';
import { resolveColonyAccountId } from '../cargo/cargo-export-outbox.js';
import { BountyRepository } from './bounty.repository.js';
import { BountyClaimService } from './claim.service.js';
import { BountyExpiryService } from './expiry.service.js';
import { BountyPayService } from './pay.service.js';

/**
 * Sim `bountyClaimed` stores the caller on the chain row.
 * Sim `bountyCompleted` names the winner, then `BountyPayService` pays that account once.
 * Sim `bountyRefunded` returns the hold to the poster (`bounty-refund:{id}`).
 */
@Injectable()
export class BountyLifecycleListener implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(BountyLifecycleListener.name);
  private stop: (() => void) | null = null;

  constructor(
    private readonly bus: EventBus,
    @Inject(BountyClaimService) private readonly claims: BountyClaimService,
    @Inject(BountyPayService) private readonly pay: BountyPayService,
    @Inject(BountyExpiryService) private readonly expiry: BountyExpiryService,
    @Inject(BountyRepository) private readonly repo: BountyRepository,
    @Inject(FlagsService) private readonly flags: FlagsService,
    @Inject(PRISMA) private readonly prisma: PrismaClient,
  ) {}

  onModuleInit(): void {
    if (this.stop) return;
    this.stop = this.bus.on('planet.event', (event) => this.onPlanet(event), { module: 'BountyLifecycleListener' });
  }

  onModuleDestroy(): void {
    this.stop?.();
    this.stop = null;
  }

  private onPlanet(event: PlanetEventV1): void {
    if (!this.flags.has('W22')) return;
    if (event.kind === 'bountyClaimed') {
      const { bountyId, claimer } = event.data;
      void this.claimed(event.planetId, bountyId, claimer).catch((err) => this.warn(bountyId, err));
    } else if (event.kind === 'bountyCompleted') {
      const { bountyId, claimer } = event.data;
      void this.completed(event.planetId, bountyId, claimer).catch((err) => this.warn(bountyId, err));
    } else if (event.kind === 'bountyRefunded') {
      const { bountyId } = event.data;
      void this.expiry.refundIfOpen(event.planetId, bountyId).catch((err) => this.warn(bountyId, err));
    }
  }

  private async claimed(planetId: string, bountyId: string, claimer: string): Promise<void> {
    const accountId = await this.account(planetId, claimer);
    await this.claims.claim({ planetId, bountyId, accountId });
  }

  private async completed(planetId: string, bountyId: string, claimer: string): Promise<void> {
    const row = await this.repo.find(bountyId);
    if (!row || row.planetId !== planetId) {
      this.log.warn(`bounty ${bountyId} has no chain row`);
      return;
    }
    if (row.state === 'open' || row.state === 'claimed') {
      await this.repo.completeForPayout(bountyId, await this.account(planetId, claimer));
    }
    const paid = await this.pay.pay(bountyId, claimer);
    if (!paid) this.log.warn(`bounty ${bountyId} completed but not paid`);
  }

  private account(planetId: string, claimer: string): Promise<string> {
    return resolveColonyAccountId(this.prisma, claimer, null, planetId, colonyIndex(claimer));
  }

  private warn(bountyId: string, err: unknown): void {
    this.log.warn(`bounty ${bountyId} lifecycle failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function colonyIndex(id: string): number | undefined {
  const match = /^col_(\d+)$/.exec(id);
  return match ? Number(match[1]) : undefined;
}

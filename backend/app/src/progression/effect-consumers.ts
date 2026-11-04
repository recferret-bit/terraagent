import { Inject, Injectable, Logger, Optional, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ACHIEVEMENT_BY_ID } from '@terra/contracts';
import type { PrismaClient } from '@terra/db';
import { databaseEnabled } from '../core/persistence.js';
import { APP_ENV, type AppEnv } from '../core/tokens.js';
import { PRISMA } from '../db/db.module.js';
import { BadgeNftPort } from '../near/application/ports/badge-nft.port.js';
import { FlagsService } from '../flags/flags.service.js';
import { ProgressionEffects, type ProgressionEffectDelivery } from './progression-effects.js';

/** Independent durable consumers. External push has no recipient model yet; notification delivery is an in-app inbox. */
@Injectable()
export class ProgressionConsumers implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<unknown>;
  private readonly log = new Logger('ProgressionConsumers');

  constructor(@Inject(PRISMA) private readonly db: PrismaClient,
    @Inject(ProgressionEffects) private readonly queue: ProgressionEffects,
    @Inject(APP_ENV) private readonly env: AppEnv,
    @Inject(FlagsService) private readonly flags: FlagsService,
    @Optional() @Inject(BadgeNftPort) private readonly badges?: BadgeNftPort) {}

  async notification(effect: ProgressionEffectDelivery): Promise<void> {
    await this.db.playerNotification.upsert({ where: { id: effect.id }, update: {},
      create: { id: effect.id, playerId: effect.playerId, payload: effect.payload as object } });
  }

  async badge(effect: ProgressionEffectDelivery): Promise<void> {
    if (!this.badges) throw new Error('Badge adapter unavailable');
    const achievementId = (effect.payload as { achievementId?: string }).achievementId ?? '';
    const def = ACHIEVEMENT_BY_ID.get(achievementId);
    if (!def) throw new Error('Unknown achievement');
    const identity = await this.db.socialIdentity.findFirst({ where: { playerId: effect.playerId }, orderBy: { createdAt: 'asc' } });
    if (!identity) throw new Error('Waiting for pilot to link an account');
    const where = { playerId_achievementId: { playerId: effect.playerId, achievementId } };
    const unlock = await this.db.achievementUnlock.findUnique({ where });
    if (!unlock) throw new Error('Achievement no longer exists');
    if (unlock.nftStatus === 'minted') return;
    await this.db.achievementUnlock.update({ where, data: { nftStatus: 'pending' } });
    try {
      const minted = await this.badges.mint({ opId: effect.id, collection: 'badge', ownerAccountId: identity.accountId,
        metadata: { achievementId, title: `${def.familyName} ${def.tierName}`, earnedAt: unlock.earnedAt.toISOString() } });
      if (minted.receipt.status !== 'success') throw new Error(`Mint ${minted.receipt.status}`);
      await this.db.achievementUnlock.update({ where, data: { nftStatus: 'minted', nftTokenId: minted.tokenId, nftTxHash: minted.receipt.txHash } });
    } catch (error) {
      await this.db.achievementUnlock.update({ where, data: { nftStatus: 'failed' } });
      throw error;
    }
  }

  async drain(now = new Date()): Promise<void> {
    await this.queue.drain('achievement.notification', effect => this.notification(effect), now);
    await this.queue.drain('achievement.badge', effect => this.badge(effect), now);
  }

  onModuleInit(): void {
    if (this.env.PROGRESSION_WORKERS === 'off' || !databaseEnabled(this.env) || !this.flags.has('W12')) return;
    this.timer = setInterval(() => {
      if (!this.running) this.running = this.drain().catch(error => this.log.error(String(error))).finally(() => { this.running = undefined; });
    }, 1000);
    this.timer.unref();
  }

  async onModuleDestroy(): Promise<void> { clearInterval(this.timer); await this.running; }
}

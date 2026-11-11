import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { CommandPrechecks, type CommandPrecheck } from '../../../core/command-prechecks.js';
import { databaseEnabled } from '../../../core/persistence.js';
import { APP_ENV, type AppEnv } from '../../../core/tokens.js';
import { FlagsService } from '../../../flags/flags.service.js';
import { GuildOffersService } from './guild-offers.service.js';

/** Synchronous `offer_expired` before the sim acks. The event handler checks the same id again under the row lock. */
@Injectable()
export class AcceptGuildOfferPrecheck implements OnModuleInit, OnModuleDestroy {
  private off: (() => void) | null = null;

  constructor(
    private readonly prechecks: CommandPrechecks,
    private readonly flags: FlagsService,
    private readonly offers: GuildOffersService,
    @Inject(APP_ENV) private readonly env: AppEnv,
  ) {}

  onModuleInit(): void {
    this.off ??= this.prechecks.register('market.acceptGuildOffer', this.check);
  }

  onModuleDestroy(): void {
    this.off?.();
    this.off = null;
  }

  readonly check: CommandPrecheck = async (input) => {
    if (!this.flags.has('W15')) return { code: 'wave_disabled' };
    if (!databaseEnabled(this.env)) return null;
    const offerId = (input.args as { offerId?: unknown }).offerId;
    if (typeof offerId !== 'string' || offerId.length === 0) return null;
    const judged = await this.offers.judge(input.planetId, offerId);
    if (judged.ok) return null;
    return { code: 'offer_expired', ...(judged.detail ? { detail: judged.detail } : {}) };
  };
}

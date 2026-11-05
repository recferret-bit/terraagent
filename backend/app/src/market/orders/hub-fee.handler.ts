import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { eventDef } from '@terra/contracts';
import type { PrismaClient } from '@terra/db';
import type { PlanetEventOf } from '../../bus/channels.js';
import { EventBus } from '../../bus/event-bus.js';
import { databaseEnabled } from '../../core/persistence.js';
import { APP_ENV, type AppEnv } from '../../core/tokens.js';
import { PRISMA } from '../../db/db.module.js';
import { resolveMarketAccountId } from './colony-account.js';

/**
 * Persists the sim's `marketHubFeeSet` (W13-22 `market.setHubFee`) into `chain.market_stall`, so `GET /v1/market` `stall.hubFeeBp`
 * and the next order read the colony's chosen fee. The stall name is kept (written at order placement).
 */
@Injectable()
export class HubFeeHandler implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(HubFeeHandler.name);
  private stop: (() => void) | null = null;

  constructor(private readonly bus: EventBus, @Inject(PRISMA) private readonly prisma: PrismaClient, @Inject(APP_ENV) private readonly env: AppEnv) {}

  onModuleInit(): void {
    this.stop ??= this.bus.onPlanetEvent('marketHubFeeSet', (e) => {
      void this.handle(e).catch((err: unknown) => this.log.warn(`hub fee not stored: ${err instanceof Error ? err.message : String(err)}`));
    }, { module: 'HubFeeHandler' });
  }

  onModuleDestroy(): void {
    this.stop?.();
    this.stop = null;
  }

  async handle(event: PlanetEventOf<'marketHubFeeSet'>): Promise<void> {
    if (!databaseEnabled(this.env)) return;
    const d = eventDef('marketHubFeeSet').data.parse(event.data);
    const accountId = await resolveMarketAccountId(this.prisma, d.colonyId, null, event.planetId, d.colonyIndex);
    await this.prisma.marketStall.upsert({
      where: { planetId_colonyId: { planetId: event.planetId, colonyId: d.colonyId } },
      create: { planetId: event.planetId, colonyId: d.colonyId, colonyIndex: d.colonyIndex, hubEntityId: d.hubEntityId, accountId, feeBp: d.bp },
      update: { feeBp: d.bp, hubEntityId: d.hubEntityId, colonyIndex: d.colonyIndex, accountId },
    });
  }
}

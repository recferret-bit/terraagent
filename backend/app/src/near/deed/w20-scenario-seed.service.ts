import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type { PrismaClient } from '@terra/db';
import { EventBus } from '../../bus/event-bus.js';
import { databaseEnabled } from '../../core/persistence.js';
import { APP_ENV, type AppEnv } from '../../core/tokens.js';
import { PRISMA } from '../../db/db.module.js';
import { FlagsService } from '../../flags/flags.service.js';
import { GamePlanets } from '../../game/game-planets.service.js';
import { OutboxRelayService } from '../application/outbox/outbox.module.js';
import { mockChainControls } from '../infrastructure/mock/mock-controls.js';
import { AccountClaimService } from '../staking/account-claim.service.js';
import { StakingPositionSyncService } from '../staking/staking-position-sync.service.js';
import { StakingService } from '../staking/staking.service.js';
import { DeedDebounceService } from './deed-debounce.service.js';
import { DeedImageRendererService } from './deed-image.renderer.js';
import { DeedMintOutboxService } from './deed-mint-outbox.service.js';
import { DeedProjectorService } from './deed-projector.service.js';
import { DeedRepository } from './deed.repository.js';

/**
 * Seeds the `w20` scenario state on `dev.scenario.created` and advances staking clocks on planet `warp`:
 * - Mints a fresh `v1` active Colony Deed (`Aegis Spire`, `stage: 4`, `terraformBp: 4000`, `settled: false`).
 * - Resets any prior claim or staking state for `col_0` and funds the colony wallet with `100 NEAR`.
 * - No-op when `W20` is disabled (`TA_WAVES=..19`), keeping existing DB rows untouched.
 */
@Injectable()
export class W20ScenarioSeedService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(W20ScenarioSeedService.name);
  private readonly stops: Array<() => void> = [];
  private activeSeed: Promise<void> | null = null;

  constructor(
    @Inject(FlagsService) private readonly flags: FlagsService,
    @Inject(DeedRepository) private readonly deeds: DeedRepository,
    @Inject(DeedMintOutboxService) private readonly mintService: DeedMintOutboxService,
    @Inject(DeedProjectorService) private readonly projector: DeedProjectorService,
    @Inject(DeedDebounceService) private readonly debounce: DeedDebounceService,
    @Inject(AccountClaimService) private readonly claimService: AccountClaimService,
    @Inject(StakingService) private readonly stakingService: StakingService,
    @Inject(StakingPositionSyncService) private readonly positionSync: StakingPositionSyncService,
    @Optional() @Inject(DeedImageRendererService) private readonly imageRenderer?: DeedImageRendererService,
    @Optional() @Inject(OutboxRelayService) private readonly outboxRelay?: OutboxRelayService,
    @Optional() @Inject(EventBus) private readonly bus?: EventBus,
    @Optional() @Inject(GamePlanets) private readonly planets?: GamePlanets,
    @Optional() @Inject(APP_ENV) private readonly env?: AppEnv,
    @Optional() @Inject(PRISMA) private readonly prisma?: PrismaClient,
  ) {}

  onModuleInit(): void {
    if (this.stops.length > 0) return;
    if (this.bus) {
      this.stops.push(
        this.bus.on(
          'dev.scenario.created',
          (e) => {
            if (e.scenario === 'w20') {
              this.activeSeed = this.seedW20(e.planetId).catch((err: unknown) => {
                this.log.warn(
                  `w20 scenario seed failed: ${err instanceof Error ? err.message : String(err)}`,
                );
              });
            }
          },
          { module: 'W20ScenarioSeedService' },
        ),
      );
    }
    if (this.planets) {
      this.stops.push(
        this.planets.onWarp((_planetId, k) => {
          if (k > 1 && this.flags.has('W20')) {
            const deltaMs = k >= 100 ? 172_800_000 : k * 4_320_000;
            this.stakingService.advanceClockMs(deltaMs);
            void this.positionSync.syncAll().catch(() => {});
          }
        }),
      );
    }
  }

  onModuleDestroy(): void {
    for (const stop of this.stops.splice(0)) stop();
  }

  async waitForSeed(): Promise<void> {
    if (this.activeSeed) {
      await this.activeSeed;
    }
  }

  async seedW20(planetId: string): Promise<void> {
    if (!this.flags.has('W20')) return;
    mockChainControls.setFail('deed', 0);
    this.debounce.clearColony('col_0');
    this.projector.clearQueuedMilestone('col_0');
    this.claimService.clearColonyClaim('col_0');
    this.positionSync.clearCache();
    this.imageRenderer?.invalidate('deed:col_0');

    const db = this.env && databaseEnabled(this.env) && this.prisma ? this.prisma : null;
    if (db) {
      const existing = await db.deed.findUnique({ where: { colonyId: 'col_0' } });
      await db.deedHistory.deleteMany({ where: { colonyId: 'col_0' } });
      await db.deed.deleteMany({ where: { colonyId: 'col_0' } });
      await db.mockChainNft.deleteMany({
        where: { collection: 'deed', tokenId: 'deed:col_0' },
      });
      await db.chainOutbox.deleteMany({
        where: {
          OR: [
            { opId: { startsWith: 'deed-mint:col_0' } },
            { opId: { startsWith: 'deed-meta:col_0' } },
            { opId: { startsWith: 'deed-settle:col_0' } },
            { opId: { startsWith: 'deed-final:col_0' } },
          ],
        },
      });
      await db.stakingPosition.deleteMany({ where: { colonyId: 'col_0' } });
      if (existing?.accountId) {
        await db.mockChainStaking.deleteMany({ where: { accountId: existing.accountId } });
      }
      await db.nearColonyAccount.updateMany({
        where: { OR: [{ colonyId: 'col_0' }, { slot: 'col_0' }] },
        data: { claimedAt: null, claimedByAccountId: null },
      });
    }

    const enq = await this.mintService.mintForColony({
      colonyId: 'col_0',
      planetId,
      colonyName: 'Aegis Spire',
      planetType: 'temperate',
      stage: 4,
      terraformBp: 4000,
    });
    await this.outboxRelay?.pollOnce();
    const record = (await this.deeds.findByColonyId('col_0')) ?? enq?.record;
    if (record) {
      await this.stakingService.fundWalletNear(record.accountId, '100');
    }
  }
}

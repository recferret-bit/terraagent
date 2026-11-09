import { Inject, Injectable, Optional, type OnModuleInit } from '@nestjs/common';
import { z } from 'zod';
import { CoreException } from '../../core/errors/index.js';
import {
  defineDevCommand,
  type DevCommand,
  DevCommandRegistry,
} from '../../dev/dev-command.registry.js';
import { FlagsService } from '../../flags/flags.service.js';
import { GamePlanets } from '../../game/game-planets.service.js';
import { OutboxRelayService } from '../application/outbox/outbox.module.js';
import { mockChainControls } from '../infrastructure/mock/mock-controls.js';
import { AccountClaimService } from '../staking/account-claim.service.js';
import { StakingService } from '../staking/staking.service.js';
import { DeedDebounceService } from './deed-debounce.service.js';
import { DeedMintOutboxService } from './deed-mint-outbox.service.js';
import { DeedProjectorService, type DeedMilestonePatch } from './deed-projector.service.js';
import { DeedSettledService } from './deed-settled.service.js';
import { DeedRepository, type StoredDeedRecord } from './deed.repository.js';

const showArgs = z
  .object({
    colony: z.string().min(1).optional(),
    planetId: z.string().min(1).optional(),
  })
  .strict();

const bumpArgs = z
  .object({
    field: z.enum(['terraform', 'stage', 'walls', 'tradeVolume', 'truces', 'rank']),
    value: z.number().finite(),
    colony: z.string().min(1).optional(),
    planetId: z.string().min(1).optional(),
  })
  .strict();

const settleArgs = z
  .object({
    colony: z.string().min(1).optional(),
    planetId: z.string().min(1).optional(),
  })
  .strict();

const stakeFundArgs = z
  .object({
    account: z.string().min(1).optional(),
    colony: z.string().min(1).optional(),
    near: z.union([z.string().min(1), z.number().positive()]),
  })
  .strict();

const accountClaimArgs = z
  .object({
    colony: z.string().min(1).optional(),
    walletAccountId: z.string().min(1).optional(),
    mock: z.boolean().optional(),
  })
  .strict();

/**
 * W20-27 Dev-console commands:
 * - `deed.show [colony]`
 * - `deed.bump <field> <value>`
 * - `deed.settle [colony]`
 * - `stake.fund [account] <near>`
 * - `account.claim [--mock]`
 */
@Injectable()
export class DeedDevCommand implements OnModuleInit {
  constructor(
    @Inject(DevCommandRegistry) private readonly registry: DevCommandRegistry,
    @Inject(FlagsService) private readonly flags: FlagsService,
    @Inject(DeedRepository) private readonly deeds: DeedRepository,
    @Inject(DeedMintOutboxService) private readonly mintService: DeedMintOutboxService,
    @Inject(DeedProjectorService) private readonly projector: DeedProjectorService,
    @Inject(DeedDebounceService) private readonly debounce: DeedDebounceService,
    @Inject(DeedSettledService) private readonly settledService: DeedSettledService,
    @Inject(AccountClaimService) private readonly claimService: AccountClaimService,
    @Inject(StakingService) private readonly stakingService: StakingService,
    @Optional() @Inject(OutboxRelayService) private readonly outboxRelay?: OutboxRelayService,
    @Optional() @Inject(GamePlanets) private readonly planets?: GamePlanets,
  ) {}

  onModuleInit(): void {
    this.registry.register(this.deedShowCommand());
    this.registry.register(this.deedBumpCommand());
    this.registry.register(this.deedSettleCommand());
    this.registry.register(this.stakeFundCommand());
    this.registry.register(this.accountClaimCommand());
  }

  private assertW20(): void {
    if (!this.flags.has('W20')) {
      throw new CoreException('NOT_FOUND', { status: 404, message: 'Wave W20 is not enabled' });
    }
  }

  private deedShowCommand(): DevCommand<typeof showArgs> {
    return defineDevCommand({
      name: 'deed.show',
      help: 'Server: deed.show [colony] returns the current Colony Deed metadata and chain status.',
      args: showArgs,
      run: async ({ colony, planetId }) => {
        this.assertW20();
        const record = await this.ensureDeedRecord(colony, planetId);
        const view = await this.deeds.toDeedView(record);
        return {
          colonyId: view.colonyId,
          planetId: view.planetId,
          tokenId: view.tokenId,
          accountId: view.accountId,
          version: view.version,
          status: view.status,
          settled: view.settled,
          stage: view.metadata.stage ?? 0,
          terraformBp: view.metadata.terraformBp ?? 0,
          pendingState: view.pendingState,
          retries: view.pendingRetries ?? 0,
        };
      },
    });
  }

  private deedBumpCommand(): DevCommand<typeof bumpArgs> {
    return defineDevCommand({
      name: 'deed.bump',
      help: 'Server: deed.bump <field> <value> queues a Colony Deed milestone update (e.g. deed.bump terraform 10).',
      args: bumpArgs,
      run: async ({ field, value, colony, planetId }) => {
        this.assertW20();
        const record = await this.ensureDeedRecord(colony, planetId);
        const failRate = mockChainControls.getFail('deed') ?? 0;
        const prior = this.projector.getQueuedMilestone(record.colonyId);
        const patch = {
          ...this.buildBumpPatch(record, prior, field, value),
          ...(failRate > 0 ? { forceImmediate: true } : {}),
        };

        await this.projector.projectMilestone(patch);

        if (failRate > 0) {
          await this.outboxRelay?.pollOnce();
        }

        const updated = (await this.deeds.findByColonyId(record.colonyId)) ?? record;
        const view = await this.deeds.toDeedView(updated);
        const retries = view.pendingRetries ?? 0;
        return {
          colonyId: updated.colonyId,
          tokenId: updated.tokenId,
          field,
          value,
          change: patch.change,
          version: view.version,
          pendingState: failRate > 0 ? (retries > 0 ? 'retrying' : view.pendingState) : 'pending',
          retries,
        };
      },
    });
  }

  private deedSettleCommand(): DevCommand<typeof settleArgs> {
    return defineDevCommand({
      name: 'deed.settle',
      help: 'Server: deed.settle [colony] seals the Colony Deed as Settled (one-way) and triggers the settler achievement.',
      args: settleArgs,
      run: async ({ colony, planetId }) => {
        this.assertW20();
        const record = await this.ensureDeedRecord(colony, planetId);
        const res = await this.settledService.settleColonyDeed({
          colonyId: record.colonyId,
          planetId: record.planetId,
          reason: 'Settled via dev console (deed.settle)',
        });
        await this.outboxRelay?.pollOnce();
        const updated = (await this.deeds.findByColonyId(record.colonyId)) ?? record;
        return {
          colonyId: updated.colonyId,
          tokenId: updated.tokenId,
          version: res?.version ?? updated.metadataVersion,
          settled: true,
          status: updated.status,
          txHash: updated.lastUpdateTx ?? 'mock:settle',
        };
      },
    });
  }

  private stakeFundCommand(): DevCommand<typeof stakeFundArgs> {
    return defineDevCommand({
      name: 'stake.fund',
      help: 'Server: stake.fund [account] <near> funds a mock NEAR wallet for staking.',
      args: stakeFundArgs,
      run: async ({ account, colony, near }) => {
        this.assertW20();
        const record = await this.ensureDeedRecord(colony, undefined);
        const claimInfo = await this.claimService.isAccountClaimed(
          record.colonyId,
          record.accountId,
        );
        const targetAccount =
          account?.trim() || claimInfo.claimedByAccountId || claimInfo.accountId || record.accountId;

        const funded = await this.stakingService.fundWalletNear(targetAccount, near);
        if (!account) {
          if (record.accountId !== targetAccount) {
            await this.stakingService.fundWalletNear(record.accountId, near);
          }
          if (targetAccount !== 'pilot.mock') {
            await this.stakingService.fundWalletNear('pilot.mock', near);
          }
        }
        return funded;
      },
    });
  }

  private accountClaimCommand(): DevCommand<typeof accountClaimArgs> {
    return defineDevCommand({
      name: 'account.claim',
      help: 'Server: account.claim [--mock] claims the colony NEAR account with a mock NEP-413 signature.',
      args: accountClaimArgs,
      run: async ({ colony, walletAccountId }) => {
        this.assertW20();
        const record = await this.ensureDeedRecord(colony, undefined);
        const wallet = walletAccountId?.trim() || 'pilot.mock';
        const res = await this.claimService.claimColonyAccount({
          colonyId: record.colonyId,
          walletAccountId: wallet,
          signature: {
            accountId: wallet,
            publicKey: 'ed25519:mock-dev-key',
            signature: 'mock-dev-sig',
            message: `claim:${record.colonyId}`,
            nonce: `dev-claim-${Date.now()}`,
            recipient: 'terraagent.mock',
          },
        });
        await this.mintService.pushDeedUpdated(record, `Account claimed by ${wallet}`, res.txHash);
        return res;
      },
    });
  }

  private buildBumpPatch(
    record: StoredDeedRecord,
    prior: DeedMilestonePatch | null,
    field: 'terraform' | 'stage' | 'walls' | 'tradeVolume' | 'truces' | 'rank',
    value: number,
  ): DeedMilestonePatch {
    const baseMeta = record.metadata;
    if (field === 'terraform') {
      const curBp = prior?.terraformBp ?? baseMeta.terraformBp ?? 0;
      const deltaBp = Math.abs(value) <= 100 ? Math.round(value * 100) : Math.round(value);
      const nextBp = Math.max(0, Math.min(10_000, curBp + deltaBp));
      const pct = Math.round(nextBp / 100);
      return {
        colonyId: record.colonyId,
        planetId: record.planetId,
        terraformBp: nextBp,
        change: `Terraform ${pct} %`,
      };
    }
    if (field === 'stage') {
      const nextStage = Math.max(0, Math.min(10, Math.round(value)));
      return {
        colonyId: record.colonyId,
        planetId: record.planetId,
        stage: nextStage,
        change: `Stage ${nextStage}`,
      };
    }
    const nextVal = Math.max(0, Math.round(value));
    return {
      colonyId: record.colonyId,
      planetId: record.planetId,
      [field]: nextVal,
      change: `${field} ${nextVal}`,
    };
  }

  private async ensureDeedRecord(
    colony?: string,
    planetId?: string,
  ): Promise<StoredDeedRecord> {
    const normalizedColony =
      !colony || colony === '0' || colony === 'col-0' || colony === 'me' ? 'col_0' : colony;
    const found =
      (await this.deeds.findByColonyId(normalizedColony)) ??
      (await this.deeds.listForPlayerOrColony({ colonyId: colony, planetId }))[0] ??
      (await this.deeds.listAll())[0];
    if (found) return found;

    const targetPlanet = planetId ?? this.planets?.loadedIds()[0] ?? 'planet_w20';
    const enq = await this.mintService.mintForColony({
      colonyId: normalizedColony,
      planetId: targetPlanet,
      colonyName: 'Aegis Spire',
      planetType: 'temperate',
      stage: 4,
      terraformBp: 4000,
    });
    await this.outboxRelay?.pollOnce();
    const afterMint =
      (await this.deeds.findByColonyId(normalizedColony)) ?? enq?.record;
    if (!afterMint) {
      throw new CoreException('DEED_NOT_FOUND', { status: 404, message: 'Colony Deed not found' });
    }
    return afterMint;
  }
}

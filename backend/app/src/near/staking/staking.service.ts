import {
  Inject,
  Injectable,
  Optional,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import {
  StakingActionResponse,
  StakingStatusResponse,
  type Nep413Signature,
  type StakeRequest,
  type StakingPositionDto,
  type UnstakeRequest,
  type WithdrawRequest,
} from '@terra/contracts';
import type { PrismaClient } from '@terra/db';
import { CoreException } from '../../core/errors/index.js';
import { databaseEnabled } from '../../core/persistence.js';
import { APP_ENV, type AppEnv } from '../../core/tokens.js';
import { PRISMA } from '../../db/db.module.js';
import { FlagsService } from '../../flags/flags.service.js';
import { GamePlanets } from '../../game/game-planets.service.js';
import { StakingPort } from '../application/ports/staking.port.js';
import { DeedTelemetryService } from '../deed/deed-telemetry.service.js';
import { DeedRepository, type StoredDeedRecord } from '../deed/deed.repository.js';
import { NearException } from '../domain/errors.js';
import { AccountClaimService, type AccountClaimStatus } from './account-claim.service.js';
import { StakingPositionSyncService } from './staking-position-sync.service.js';
import { buildStakerPerksFromYocto, sumDtoStakedYocto } from './staker-perks.js';
import {
  CLAIM_ACCOUNT_PATH,
  NEAR_TOKEN_ID,
  nearToYocto,
  stakeOpId,
  unstakeOpId,
  withdrawOpId,
  yoctoToNear,
} from './yocto.js';

export { nearToYocto, stakeOpId, unstakeOpId, withdrawOpId, yoctoToNear };

export interface StakingStatusQuery {
  readonly colonyId?: string;
  readonly accountId?: string;
}

export interface FundWalletNearResult {
  readonly accountId: string;
  readonly walletBalanceNear: string;
  readonly walletBalanceYocto: string;
}

interface StakingPortBalanceHooks {
  creditNear?(accountId: string, yoctoAmount: string): Promise<void>;
  nearBalanceOf?(accountId: string): Promise<string>;
  advanceClockMs?(deltaMs: number): void;
  advanceGameDays?(days: number): void;
}

/**
 * Staking domain rules and read/write orchestration (`W20-18`, `NEAR-92`, `D-18`).
 *
 * Enforces:
 * 1. Target Colony Deed must exist (`DEED_NOT_FOUND`, 404). Day-1 staking is enabled without waiting for `Settled`.
 * 2. Colony NEAR account must be claimed by the player (`ACCOUNT_NOT_CLAIMED`, 409 with `claimUrl: '/v1/near/claim-account'`).
 * 3. Pool must be in `NEAR_STAKING_POOLS` (`POOL_NOT_WHITELISTED`, 422) and staked amount must come from the player's own NEAR wallet balance (`STAKE_INSUFFICIENT_BALANCE`, 409), never from game funds.
 */
@Injectable()
export class StakingService implements OnModuleInit, OnModuleDestroy {
  readonly walletBalancesYocto = new Map<string, bigint>();
  private readonly stops: Array<() => void> = [];
  private opCounter = 0;

  constructor(
    @Inject(FlagsService) private readonly flags: FlagsService,
    @Inject(StakingPort) private readonly staking: StakingPort,
    @Inject(DeedRepository) private readonly deeds: DeedRepository,
    @Inject(AccountClaimService) private readonly claimService: AccountClaimService,
    @Inject(StakingPositionSyncService) private readonly positionSync: StakingPositionSyncService,
    @Optional() @Inject(GamePlanets) private readonly planets?: GamePlanets,
    @Optional() @Inject(APP_ENV) private readonly env?: AppEnv,
    @Optional() @Inject(PRISMA) private readonly prisma?: PrismaClient,
    @Optional() @Inject(DeedTelemetryService) private readonly telemetry?: DeedTelemetryService,
  ) {}

  onModuleInit(): void {
    if (this.stops.length > 0 || !this.planets) return;
    this.stops.push(
      this.planets.onWarp((_planetId, k) => {
        if (k > 1 && this.flags.has('W20')) {
          this.advanceClockMs(k * 3_600_000);
          void this.positionSync.syncAll().catch(() => undefined);
        }
      }),
    );
  }

  onModuleDestroy(): void {
    for (const stop of this.stops.splice(0)) stop();
  }

  advanceClockMs(deltaMs: number): void {
    const hooks = this.portHooks();
    hooks.advanceClockMs?.(deltaMs);
  }

  advanceGameDays(days: number): void {
    const hooks = this.portHooks();
    if (hooks.advanceGameDays) {
      hooks.advanceGameDays(days);
      return;
    }
    this.advanceClockMs(days * 86_400_000);
  }

  async fundWalletNear(accountId: string, amountNear: string | number): Promise<FundWalletNearResult> {
    this.assertWaveEnabled();
    const normAccountId = accountId.trim() || 'col_0.pilot.terraagent.mock';
    const deltaYocto = BigInt(nearToYocto(amountNear));
    const hooks = this.portHooks();
    const db = this.db();

    if (hooks.creditNear) {
      await hooks.creditNear(normAccountId, deltaYocto.toString());
    } else if (db) {
      await db.mockChainAccount.upsert({
        where: { accountId: normAccountId },
        create: { accountId: normAccountId, kind: 'colony' },
        update: {},
      });
      await db.$executeRaw`INSERT INTO chain.mock_chain_balance (account_id, token_id, amount)
        VALUES (${normAccountId}, ${NEAR_TOKEN_ID}, ${deltaYocto.toString()}::numeric)
        ON CONFLICT (account_id, token_id) DO UPDATE SET amount = chain.mock_chain_balance.amount + EXCLUDED.amount`;
    }

    const portBal = await this.readPortOrDbBalanceYocto(normAccountId);
    const nextYocto =
      portBal !== null
        ? portBal
        : (this.walletBalancesYocto.get(normAccountId) ?? 0n) + deltaYocto;
    this.walletBalancesYocto.set(normAccountId, nextYocto);

    return {
      accountId: normAccountId,
      walletBalanceNear: yoctoToNear(nextYocto, 6),
      walletBalanceYocto: nextYocto.toString(),
    };
  }

  async getStatus(query?: StakingStatusQuery): Promise<StakingStatusResponse> {
    this.assertWaveEnabled();
    const deed = await this.resolveDeed(query?.colonyId);
    const colonyId = deed?.colonyId ?? (query?.colonyId?.trim() || 'col_0');
    const claimInfo = await this.claimService.isAccountClaimed(
      colonyId,
      query?.accountId ?? deed?.accountId,
    );
    const accountId =
      query?.accountId?.trim() ||
      (claimInfo.claimed ? claimInfo.accountId : deed?.accountId ?? claimInfo.accountId);
    const walletAccountId = claimInfo.claimedByAccountId ?? accountId;
    const pools = await this.staking.listPools();
    const positions = await this.positionSync.syncAccountPositions(accountId, colonyId);
    const walletBalanceNear = await this.readWalletBalanceNear([
      accountId,
      deed?.accountId,
      claimInfo.claimedByAccountId,
    ]);

    const grossApyBp = pools[0]?.apyBp ?? 900;
    const perks = buildStakerPerksFromYocto(sumDtoStakedYocto(positions), { grossApyBp });

    return StakingStatusResponse.parse({
      colonyId,
      accountId,
      walletAccountId,
      walletBalanceNear,
      deedSettled: Boolean(deed?.settled),
      accountClaimed: claimInfo.claimed,
      claimedByAccountId: claimInfo.claimedByAccountId,
      pools: pools.map((p) => ({ poolId: p.poolId, name: p.name, apyBp: p.apyBp })),
      positions,
      perks: {
        active: perks.active,
        minStakeNear: perks.minStakeNear,
        totalStakedNear: perks.totalStakedNear,
        grossApyBp: perks.grossApyBp,
        netApyBp: perks.netApyBp,
        protocolYieldShareBp: perks.protocolYieldShareBp,
        platformFeeBp: perks.platformFeeBp,
        standardPlatformFeeBp: perks.standardPlatformFeeBp,
        managedAutopilotUnlocked: perks.managedAutopilotUnlocked,
        protocolAccountId: perks.protocolAccountId,
      },
    });
  }

  async stake(
    input: StakeRequest & { readonly signature?: Nep413Signature },
  ): Promise<StakingActionResponse> {
    this.assertWaveEnabled();
    const { deed, claimInfo } = await this.requireSettledAndClaimed(input.colonyId);
    const amountYocto = nearToYocto(input.amount);
    const nonce = input.walletSignature?.nonce ?? input.signature?.nonce ?? String(++this.opCounter);
    const opId = input.opId?.trim() || stakeOpId(deed.colonyId, input.pool, nonce);
    const payerAccountId = await this.resolvePayerAccount(
      [claimInfo.accountId, deed.accountId, claimInfo.claimedByAccountId],
      BigInt(amountYocto),
    );

    const receipt = await this.staking.stake({
      opId,
      accountId: claimInfo.accountId,
      pool: input.pool,
      amount: amountYocto,
      ...(payerAccountId !== claimInfo.accountId ? { walletAccountId: payerAccountId } : {}),
    });
    this.telemetry?.recordTx('stake');

    const synced = await this.positionSync.syncAccount(claimInfo.accountId, {
      colonyId: deed.colonyId,
      pool: input.pool,
    });
    const position =
      synced && synced.pool === input.pool
        ? synced
        : await this.buildFallbackPosition(deed.colonyId, claimInfo.accountId, input.pool);
    const walletBalanceNear = await this.readWalletBalanceNear([
      claimInfo.accountId,
      deed.accountId,
      claimInfo.claimedByAccountId,
    ]);

    return StakingActionResponse.parse({
      txHash: receipt.txHash,
      position,
      walletBalanceNear,
    });
  }

  async unstake(
    input: UnstakeRequest & { readonly signature?: Nep413Signature },
  ): Promise<StakingActionResponse> {
    this.assertWaveEnabled();
    const { deed, claimInfo } = await this.requireSettledAndClaimed(input.colonyId);
    const amountYocto = nearToYocto(input.amount);
    const nonce = input.walletSignature?.nonce ?? input.signature?.nonce ?? String(++this.opCounter);
    const opId = input.opId?.trim() || unstakeOpId(deed.colonyId, input.pool, nonce);

    const receipt = await this.staking.unstake({
      opId,
      accountId: claimInfo.accountId,
      pool: input.pool,
      amount: amountYocto,
    });

    const synced = await this.positionSync.syncAccount(claimInfo.accountId, {
      colonyId: deed.colonyId,
      pool: input.pool,
    });
    const position =
      synced && synced.pool === input.pool
        ? synced
        : await this.buildFallbackPosition(deed.colonyId, claimInfo.accountId, input.pool);
    const walletBalanceNear = await this.readWalletBalanceNear([
      claimInfo.accountId,
      deed.accountId,
      claimInfo.claimedByAccountId,
    ]);

    return StakingActionResponse.parse({
      txHash: receipt.txHash,
      position,
      walletBalanceNear,
    });
  }

  async withdraw(
    input: WithdrawRequest & { readonly amount?: string; readonly signature?: Nep413Signature },
  ): Promise<StakingActionResponse> {
    this.assertWaveEnabled();
    const { deed, claimInfo } = await this.requireSettledAndClaimed(input.colonyId);
    const nonce = input.walletSignature?.nonce ?? input.signature?.nonce ?? String(++this.opCounter);
    const opId = input.opId?.trim() || withdrawOpId(deed.colonyId, input.pool, nonce);

    const receipt = await this.staking.withdraw({
      opId,
      accountId: claimInfo.accountId,
      pool: input.pool,
    });

    const synced = await this.positionSync.syncAccount(claimInfo.accountId, {
      colonyId: deed.colonyId,
      pool: input.pool,
    });
    const position =
      synced && synced.pool === input.pool
        ? synced
        : await this.buildFallbackPosition(deed.colonyId, claimInfo.accountId, input.pool);
    const walletBalanceNear = await this.readWalletBalanceNear([
      claimInfo.accountId,
      deed.accountId,
      claimInfo.claimedByAccountId,
    ]);

    return StakingActionResponse.parse({
      txHash: receipt.txHash,
      position,
      walletBalanceNear,
    });
  }

  private assertWaveEnabled(): void {
    if (!this.flags.has('W20')) {
      throw new CoreException('NOT_FOUND', { status: 404, message: 'Not found' });
    }
  }

  private async requireSettledAndClaimed(
    colonyId?: string,
  ): Promise<{ deed: StoredDeedRecord; claimInfo: AccountClaimStatus }> {
    const deed = await this.resolveDeed(colonyId);
    if (!deed) {
      throw new NearException('DEED_NOT_FOUND', {
        status: 404,
        message: 'Colony Deed not found.',
        details: { colonyId: colonyId ?? 'col_0' },
      });
    }
    const claimInfo = await this.claimService.isAccountClaimed(deed.colonyId, deed.accountId);
    if (!claimInfo.claimed) {
      throw new NearException('ACCOUNT_NOT_CLAIMED', {
        status: 409,
        message: 'Claim your colony account before staking NEAR.',
        details: {
          colonyId: deed.colonyId,
          accountId: deed.accountId,
          claimUrl: CLAIM_ACCOUNT_PATH,
        },
      });
    }
    return { deed, claimInfo };
  }

  private async resolveDeed(colonyId?: string): Promise<StoredDeedRecord | null> {
    const trimmed = colonyId?.trim();
    if (trimmed) {
      const direct = await this.deeds.findByColonyId(trimmed);
      if (direct) return direct;
      const byToken = await this.deeds.findByTokenId(trimmed);
      if (byToken) return byToken;
      if (trimmed === 'col_0' || trimmed === '0') {
        const all = await this.deeds.listAll();
        return all[0] ?? null;
      }
      return null;
    }
    const defaultColony = await this.deeds.findByColonyId('col_0');
    if (defaultColony) return defaultColony;
    const all = await this.deeds.listAll();
    return all[0] ?? null;
  }

  private async buildFallbackPosition(
    colonyId: string,
    accountId: string,
    poolId: string,
  ): Promise<StakingPositionDto> {
    const pools = await this.staking.listPools();
    const poolInfo = pools.find((p) => p.poolId === poolId);
    return {
      colonyId,
      accountId,
      pool: poolId,
      ...(poolInfo ? { poolName: poolInfo.name, apyBp: poolInfo.apyBp } : {}),
      staked: '0',
      unbonding: '0',
      unbondingReadyAtMs: null,
      withdrawable: '0',
      rewards: '0',
      updatedAt: Date.now(),
    };
  }

  private async resolvePayerAccount(
    candidates: readonly (string | null | undefined)[],
    neededYocto: bigint,
  ): Promise<string> {
    const unique = Array.from(
      new Set(candidates.map((c) => c?.trim()).filter((c): c is string => Boolean(c))),
    );
    const primary = unique[0] ?? 'col_0.pilot.terraagent.mock';
    for (const candidate of unique) {
      const bal = await this.readSingleAccountBalanceYocto(candidate);
      if (bal >= neededYocto) return candidate;
    }
    return primary;
  }

  async readWalletBalanceNear(
    candidates: string | readonly (string | null | undefined)[],
  ): Promise<string> {
    const list = typeof candidates === 'string' ? [candidates] : candidates;
    const unique = Array.from(
      new Set(list.map((c) => c?.trim()).filter((c): c is string => Boolean(c))),
    );
    let total = 0n;
    for (const acct of unique) {
      const bal = await this.readSingleAccountBalanceYocto(acct);
      this.walletBalancesYocto.set(acct, bal);
      total += bal;
    }
    return yoctoToNear(total, 6);
  }

  private async readSingleAccountBalanceYocto(accountId: string): Promise<bigint> {
    const portOrDb = await this.readPortOrDbBalanceYocto(accountId);
    if (portOrDb !== null) return portOrDb;
    return this.walletBalancesYocto.get(accountId) ?? 0n;
  }

  private async readPortOrDbBalanceYocto(accountId: string): Promise<bigint | null> {
    const hooks = this.portHooks();
    if (hooks.nearBalanceOf) {
      const raw = await hooks.nearBalanceOf(accountId);
      return BigInt(raw || '0');
    }
    const db = this.db();
    if (db) {
      const row = await db.mockChainBalance.findUnique({
        where: { accountId_tokenId: { accountId, tokenId: NEAR_TOKEN_ID } },
      });
      return BigInt(row?.amount.toFixed(0) ?? '0');
    }
    return null;
  }

  private portHooks(): StakingPortBalanceHooks {
    return this.staking as unknown as StakingPortBalanceHooks;
  }

  private db(): PrismaClient | null {
    return databaseEnabled(this.env) && this.prisma ? this.prisma : null;
  }
}

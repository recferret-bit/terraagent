import { Inject, Injectable, Optional } from '@nestjs/common';
import type { DbClient, PrismaClient } from '@terra/db';
import { APP_ENV, type AppEnv } from '../../../../core/tokens.js';
import { PRISMA } from '../../../../db/db.module.js';
import { adapterOf } from '../../../../ports/adapters.js';
import {
  PositionInput,
  RewardsInput,
  type RewardsResult,
  StakeInput,
  StakingPoolView,
  StakingPort,
  type StakingPositionView,
  UnstakeInput,
  WithdrawInput,
} from '../../../application/ports/staking.port.js';
import { NearException } from '../../../domain/errors.js';
import type { ChainReceipt } from '../../../domain/types.js';
import { parseStakingPoolsConfig } from '../../../staking/staking-pools.config.js';
import {
  computeAccruedRewardDelta,
  GAME_DAY_MS,
  NEAR_TOKEN_ID,
  nearToYocto,
  ONE_NEAR_YOCTO,
  UNBONDING_DURATION_MS,
  UNBONDING_GAME_DAYS,
  yoctoToNear,
} from '../../../staking/yocto.js';

export {
  computeAccruedRewardDelta,
  GAME_DAY_MS,
  NEAR_TOKEN_ID,
  nearToYocto,
  ONE_NEAR_YOCTO,
  UNBONDING_DURATION_MS,
  UNBONDING_GAME_DAYS,
  yoctoToNear,
};
import {
  MOCK_CHAIN_CONFIG,
  MOCK_CHAIN_RUNTIME,
  MockChainBase,
  type MockChainRuntime,
} from '../../mock/mock-chain.base.js';
import type { MockChainConfig } from '../../mock/mock-chain.config.js';

let sharedStakingClockOffsetMs = 0;

export function advanceMockStakingClockMs(deltaMs: number): number {
  if (Number.isFinite(deltaMs) && deltaMs > 0) {
    sharedStakingClockOffsetMs += Math.floor(deltaMs);
  }
  return sharedStakingClockOffsetMs;
}

export function resetMockStakingClock(): void {
  sharedStakingClockOffsetMs = 0;
}

export function getMockStakingClockOffsetMs(): number {
  return sharedStakingClockOffsetMs;
}

/**
 * Postgres-backed `MockStakingAdapter` (`StakingPort`, W20-16 / NEAR §9).
 * Enforces `NEAR_STAKING_POOLS` whitelist, debits/credits `NEAR` in `chain.mock_chain_balance`,
 * tracks 4-epoch (~2 game-day) unbonding, and accrues 9 % APY validator rewards over game time.
 */
@Injectable()
export class MockStakingAdapter extends MockChainBase implements StakingPort {
  private localOffsetMs = 0;

  constructor(
    @Inject(PRISMA) prisma: PrismaClient,
    @Optional() @Inject(MOCK_CHAIN_CONFIG) config?: MockChainConfig,
    @Optional() @Inject(MOCK_CHAIN_RUNTIME) runtime?: Partial<MockChainRuntime>,
    @Optional() @Inject(APP_ENV) private readonly env?: AppEnv,
  ) {
    super(prisma, config, runtime);
  }

  advanceClockMs(deltaMs: number): void {
    if (Number.isFinite(deltaMs) && deltaMs > 0) {
      this.localOffsetMs += Math.floor(deltaMs);
    }
  }

  advanceGameDays(days: number): void {
    this.advanceClockMs(days * GAME_DAY_MS);
  }

  private nowMs(): number {
    return this.runtime.now() + sharedStakingClockOffsetMs + this.localOffsetMs;
  }

  private resolvePools(): readonly StakingPoolView[] {
    const bag = this.env as { NEAR_STAKING_POOLS?: string } | undefined;
    const raw = bag?.NEAR_STAKING_POOLS ?? process.env.NEAR_STAKING_POOLS;
    return parseStakingPoolsConfig(raw);
  }

  private assertPoolWhitelisted(poolId: string): StakingPoolView {
    const found = this.resolvePools().find((p) => p.poolId === poolId);
    if (!found) {
      throw new NearException('POOL_NOT_WHITELISTED', {
        details: { pool: poolId },
      });
    }
    return found;
  }

  async listPools(): Promise<readonly StakingPoolView[]> {
    return this.resolvePools();
  }

  async stake(raw: StakeInput): Promise<ChainReceipt> {
    const input = StakeInput.parse(raw);
    const pool = this.assertPoolWhitelisted(input.pool);
    const amountBig = BigInt(input.amount);
    if (amountBig <= 0n) {
      throw new NearException('STAKE_INSUFFICIENT_BALANCE', {
        message: 'Stake amount must be greater than zero.',
      });
    }
    return this.call('Staking', 'stake', input.opId, async (tx) => {
      const payer = input.walletAccountId ?? input.accountId;
      await this.debitNearOrThrow(tx, payer, input.amount);
      await this.ensureAccount(tx, input.accountId, 'colony');
      const now = this.nowMs();
      const snap = await this.loadAndSettleRow(tx, input.accountId, pool.poolId, pool.apyBp, now);
      const nextStaked = snap.staked + amountBig;
      await this.saveRow(tx, input.accountId, pool.poolId, {
        ...snap,
        staked: nextStaked,
        lastAccruedAtMs: now,
      });
      return {
        accountId: input.accountId,
        pool: pool.poolId,
        amount: input.amount,
        staked: nextStaked.toString(),
      };
    });
  }

  async unstake(raw: UnstakeInput): Promise<ChainReceipt> {
    const input = UnstakeInput.parse(raw);
    const pool = this.assertPoolWhitelisted(input.pool);
    const amountBig = BigInt(input.amount);
    if (amountBig <= 0n) {
      throw new NearException('STAKE_INSUFFICIENT_BALANCE', {
        message: 'Unstake amount must be greater than zero.',
      });
    }
    return this.call('Staking', 'unstake', input.opId, async (tx) => {
      const now = this.nowMs();
      const snap = await this.loadAndSettleRow(tx, input.accountId, pool.poolId, pool.apyBp, now);
      if (snap.staked < amountBig) {
        throw new NearException('STAKE_INSUFFICIENT_BALANCE', {
          message: 'Insufficient staked NEAR to unstake.',
          details: { accountId: input.accountId, pool: pool.poolId, staked: snap.staked.toString(), requested: input.amount },
        });
      }
      const nextStaked = snap.staked - amountBig;
      const nextUnbonding = snap.unbonding + amountBig;
      const readyAtMs = now + UNBONDING_DURATION_MS;
      await this.saveRow(tx, input.accountId, pool.poolId, {
        ...snap,
        staked: nextStaked,
        unbonding: nextUnbonding,
        unbondingReadyAtMs: readyAtMs,
        lastAccruedAtMs: now,
      });
      return {
        accountId: input.accountId,
        pool: pool.poolId,
        amount: input.amount,
        unbonding: nextUnbonding.toString(),
        unbondingReadyAtMs: readyAtMs,
      };
    });
  }

  async withdraw(raw: WithdrawInput): Promise<ChainReceipt> {
    const input = WithdrawInput.parse(raw);
    const pool = this.assertPoolWhitelisted(input.pool);
    return this.call('Staking', 'withdraw', input.opId, async (tx) => {
      const now = this.nowMs();
      const snap = await this.loadAndSettleRow(tx, input.accountId, pool.poolId, pool.apyBp, now);
      if (snap.withdrawable <= 0n) {
        throw new NearException('STAKE_INSUFFICIENT_BALANCE', {
          message: snap.unbonding > 0n
            ? 'Unbonding period (4 epochs) has not finished yet.'
            : 'No withdrawable NEAR available.',
          details: {
            accountId: input.accountId,
            pool: pool.poolId,
            unbonding: snap.unbonding.toString(),
            unbondingReadyAtMs: snap.unbondingReadyAtMs,
          },
        });
      }
      const payout = snap.withdrawable + snap.rewards;
      const recipient = input.toAccountId ?? input.accountId;
      await this.credit(tx, recipient, NEAR_TOKEN_ID, payout.toString());
      await this.saveRow(tx, input.accountId, pool.poolId, {
        ...snap,
        withdrawable: 0n,
        rewards: 0n,
        lastAccruedAtMs: now,
      });
      return {
        accountId: input.accountId,
        recipient,
        pool: pool.poolId,
        withdrawn: payout.toString(),
      };
    });
  }

  async rewards(raw: RewardsInput): Promise<RewardsResult> {
    const input = RewardsInput.parse(raw);
    const pos = await this.position(input);
    return { accrued: pos.rewards };
  }

  async position(raw: PositionInput): Promise<StakingPositionView> {
    const input = PositionInput.parse(raw);
    const pool = this.assertPoolWhitelisted(input.pool);
    const now = this.nowMs();
    const row = await this.prisma.mockChainStaking.findUnique({
      where: { accountId_poolId: { accountId: input.accountId, poolId: pool.poolId } },
    });
    if (!row) {
      return {
        accountId: input.accountId,
        pool: pool.poolId,
        staked: '0',
        unbonding: '0',
        unbondingReadyAtMs: null,
        withdrawable: '0',
        rewards: '0',
      };
    }
    const settled = this.projectRow(row, pool.apyBp, now);
    return {
      accountId: input.accountId,
      pool: pool.poolId,
      staked: settled.staked.toString(),
      unbonding: settled.unbonding.toString(),
      unbondingReadyAtMs: settled.unbondingReadyAtMs,
      withdrawable: settled.withdrawable.toString(),
      rewards: settled.rewards.toString(),
    };
  }

  /** Helper to credit mock NEAR to a wallet/colony account in tests and dev console (`stake.fund`). */
  async creditNear(accountId: string, yoctoAmount: string): Promise<void> {
    await this.credit(this.prisma, accountId, NEAR_TOKEN_ID, yoctoAmount);
  }

  async nearBalanceOf(accountId: string): Promise<string> {
    return this.balanceOf(this.prisma, accountId, NEAR_TOKEN_ID);
  }

  private async debitNearOrThrow(tx: DbClient, accountId: string, amount: string): Promise<void> {
    try {
      await this.debit(tx, accountId, NEAR_TOKEN_ID, amount);
    } catch (err) {
      if (err instanceof NearException && err.errorCode === 'NEAR_INSUFFICIENT_BALANCE') {
        throw new NearException('STAKE_INSUFFICIENT_BALANCE', {
          details: err.details,
        });
      }
      throw err;
    }
  }

  private projectRow(
    row: {
      staked: { toFixed(): string };
      unbonding: { toFixed(): string };
      unbondingReadyAt: Date | null;
      withdrawable: { toFixed(): string };
      rewardsAccrued: { toFixed(): string };
      lastAccruedAt: Date;
    },
    apyBp: number,
    nowMs: number,
  ) {
    const staked = BigInt(row.staked.toFixed());
    let unbonding = BigInt(row.unbonding.toFixed());
    let unbondingReadyAtMs = row.unbondingReadyAt ? row.unbondingReadyAt.getTime() : null;
    let withdrawable = BigInt(row.withdrawable.toFixed());
    const baseRewards = BigInt(row.rewardsAccrued.toFixed());
    const elapsedMs = Math.max(0, nowMs - row.lastAccruedAt.getTime());
    const rewards = baseRewards + computeAccruedRewardDelta(staked, apyBp, elapsedMs);

    if (unbonding > 0n && unbondingReadyAtMs !== null && nowMs >= unbondingReadyAtMs) {
      withdrawable += unbonding;
      unbonding = 0n;
      unbondingReadyAtMs = null;
    }

    return { staked, unbonding, unbondingReadyAtMs, withdrawable, rewards, lastAccruedAtMs: nowMs };
  }

  private async loadAndSettleRow(
    tx: DbClient,
    accountId: string,
    poolId: string,
    apyBp: number,
    nowMs: number,
  ) {
    const row = await tx.mockChainStaking.findUnique({
      where: { accountId_poolId: { accountId, poolId } },
    });
    if (!row) {
      return {
        staked: 0n,
        unbonding: 0n,
        unbondingReadyAtMs: null as number | null,
        withdrawable: 0n,
        rewards: 0n,
        lastAccruedAtMs: nowMs,
      };
    }
    return this.projectRow(row, apyBp, nowMs);
  }

  private async saveRow(
    tx: DbClient,
    accountId: string,
    poolId: string,
    state: {
      staked: bigint;
      unbonding: bigint;
      unbondingReadyAtMs: number | null;
      withdrawable: bigint;
      rewards: bigint;
      lastAccruedAtMs: number;
    },
  ): Promise<void> {
    const nowDate = new Date(state.lastAccruedAtMs);
    const readyDate = state.unbondingReadyAtMs !== null ? new Date(state.unbondingReadyAtMs) : null;
    await tx.mockChainStaking.upsert({
      where: { accountId_poolId: { accountId, poolId } },
      create: {
        accountId,
        poolId,
        staked: state.staked.toString(),
        unbonding: state.unbonding.toString(),
        unbondingReadyAt: readyDate,
        withdrawable: state.withdrawable.toString(),
        rewardsAccrued: state.rewards.toString(),
        lastAccruedAt: nowDate,
        updatedAt: nowDate,
      },
      update: {
        staked: state.staked.toString(),
        unbonding: state.unbonding.toString(),
        unbondingReadyAt: readyDate,
        withdrawable: state.withdrawable.toString(),
        rewardsAccrued: state.rewards.toString(),
        lastAccruedAt: nowDate,
        updatedAt: nowDate,
      },
    });
  }
}

export const adapter = adapterOf({ port: StakingPort, kind: 'mock', useClass: MockStakingAdapter });

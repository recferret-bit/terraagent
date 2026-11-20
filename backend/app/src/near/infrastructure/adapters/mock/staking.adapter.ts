import { Inject, Injectable, Optional } from '@nestjs/common';
import { earlyExitFeeBp, MARKET_TOKENS, toChainUnits } from '@terra/contracts';
import type { DbClient, PrismaClient } from '@terra/db';
import { APP_ENV, type AppEnv } from '../../../../core/tokens.js';
import { PRISMA } from '../../../../db/db.module.js';
import { adapterOf } from '../../../../ports/adapters.js';
import {
  CompoundInput,
  PositionInput,
  RewardsInput,
  type RewardsResult,
  StakeInput,
  StakeProfitsInput,
  StakingPoolView,
  StakingPort,
  type StakingPositionView,
  UnstakeInput,
  WithdrawInput,
} from '../../../application/ports/staking.port.js';
import { NearException } from '../../../domain/errors.js';
import type { ChainReceipt } from '../../../domain/types.js';
import { isW28Enabled } from '../../../staking/perks/legacy-ladder.js';
import { parseStakingPoolsConfig } from '../../../staking/staking-pools.config.js';
import { debitVerifier } from './intents-ledger.js';
import {
  clearClocksWhenEmpty,
  loadStakingRow,
  projectStakingRow,
  saveStakingRow,
  withDeposit,
  type SettledStakingRow,
} from './staking-ledger.js';
import { resolveProtocolFeeSchedule } from '../../network/protocol-fee.config.js';
import {
  computeAccruedRewardDelta,
  GAME_DAY_MS,
  NEAR_TOKEN_ID,
  nearToYocto,
  ONE_NEAR_YOCTO,
  PROTOCOL_STAKING_ACCOUNT_ID,
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

  private resolveProtocolAccount(): string {
    const bag = this.env as { NEAR_PROTOCOL_ACCOUNT?: string } | undefined;
    return bag?.NEAR_PROTOCOL_ACCOUNT?.trim() || process.env.NEAR_PROTOCOL_ACCOUNT?.trim() || PROTOCOL_STAKING_ACCOUNT_ID;
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

  private yieldShareBp(): number {
    const envBag = (this.env ?? process.env) as Record<string, string | undefined>;
    return resolveProtocolFeeSchedule(envBag).protocolStakingYieldShareBp;
  }

  private load(tx: DbClient, accountId: string, pool: StakingPoolView, now: number): Promise<SettledStakingRow> {
    return loadStakingRow(tx, accountId, pool.poolId, pool.apyBp, now, this.yieldShareBp());
  }

  private async creditProtocolYield(tx: DbClient, snap: SettledStakingRow): Promise<void> {
    if (snap.protocolYieldDelta > 0n) {
      await this.credit(tx, this.resolveProtocolAccount(), NEAR_TOKEN_ID, snap.protocolYieldDelta.toString());
    }
  }

  /** The `< 7 day` early-exit fee in bp. Only with `W28` on: the W20 ladder has no exit fee. */
  private earlyExitBp(snap: SettledStakingRow, now: number): number {
    return isW28Enabled((this.env ?? process.env) as Record<string, string | undefined>) ? earlyExitFeeBp(snap.lastStakedAtMs, now) : 0;
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
      const snap = await this.load(tx, input.accountId, pool, now);
      await this.creditProtocolYield(tx, snap);
      const next = withDeposit(snap, amountBig, now, input.asset ?? 'near');
      await saveStakingRow(tx, input.accountId, pool.poolId, next);
      return {
        accountId: input.accountId,
        pool: pool.poolId,
        amount: input.amount,
        staked: next.staked.toString(),
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
      const snap = await this.load(tx, input.accountId, pool, now);
      if (snap.staked < amountBig) {
        throw new NearException('STAKE_INSUFFICIENT_BALANCE', {
          message: 'Insufficient staked NEAR to unstake.',
          details: { accountId: input.accountId, pool: pool.poolId, staked: snap.staked.toString(), requested: input.amount },
        });
      }
      await this.creditProtocolYield(tx, snap);
      // `< 7 days` since the last deposit: the fee is taken from the unstaked principal and goes to the protocol (Rust `unstake`).
      const feeBp = this.earlyExitBp(snap, now);
      const fee = (amountBig * BigInt(feeBp)) / 10_000n;
      if (fee > 0n) await this.credit(tx, this.resolveProtocolAccount(), NEAR_TOKEN_ID, fee.toString());
      const readyAtMs = now + UNBONDING_DURATION_MS;
      const next = clearClocksWhenEmpty({
        ...snap,
        staked: snap.staked - amountBig,
        unbonding: snap.unbonding + amountBig - fee,
        unbondingReadyAtMs: readyAtMs,
        lastAccruedAtMs: now,
      });
      await saveStakingRow(tx, input.accountId, pool.poolId, next);
      return {
        accountId: input.accountId,
        pool: pool.poolId,
        amount: input.amount,
        unbonding: next.unbonding.toString(),
        unbondingReadyAtMs: readyAtMs,
        earlyExitFee: fee.toString(),
      };
    });
  }

  async withdraw(raw: WithdrawInput): Promise<ChainReceipt> {
    const input = WithdrawInput.parse(raw);
    const pool = this.assertPoolWhitelisted(input.pool);
    return this.call('Staking', 'withdraw', input.opId, async (tx) => {
      const now = this.nowMs();
      const snap = await this.load(tx, input.accountId, pool, now);
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
      await this.creditProtocolYield(tx, snap);
      const payout = snap.withdrawable + snap.rewards;
      const recipient = input.toAccountId ?? input.accountId;
      await this.credit(tx, recipient, NEAR_TOKEN_ID, payout.toString());
      await saveStakingRow(tx, input.accountId, pool.poolId, {
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

  /** W28 `compound_yield`: the staker's 80 % yield becomes principal (`0 %` fee); the 20 % protocol cut was already credited. */
  async compound(raw: CompoundInput): Promise<ChainReceipt> {
    const input = CompoundInput.parse(raw);
    const pool = this.assertPoolWhitelisted(input.pool);
    return this.call('Staking', 'compound', input.opId, async (tx) => {
      const now = this.nowMs();
      const snap = await this.load(tx, input.accountId, pool, now);
      if (snap.rewards <= 0n) {
        throw new NearException('NOTHING_TO_COMPOUND', { details: { accountId: input.accountId, pool: pool.poolId } });
      }
      await this.creditProtocolYield(tx, snap);
      // Clocks stay as they are: compounding is not a deposit, so the 7-day maturity does not restart.
      await saveStakingRow(tx, input.accountId, pool.poolId, { ...snap, staked: snap.staked + snap.rewards, rewards: 0n, lastAccruedAtMs: now });
      return {
        accountId: input.accountId,
        pool: pool.poolId,
        compounded: snap.rewards.toString(),
        protocolCut: snap.protocolYieldDelta.toString(),
      };
    });
  }

  /** W28 `stake-profits`: debit the wallet's `USDC` (verifier ledger), swap to `stNEAR` and deposit, in one DB transaction. */
  async stakeProfits(raw: StakeProfitsInput): Promise<ChainReceipt> {
    const input = StakeProfitsInput.parse(raw);
    const pool = this.assertPoolWhitelisted(input.pool);
    const usdc = BigInt(input.usdcAtomic);
    const near = BigInt(input.nearYocto);
    if (usdc <= 0n || near <= 0n) {
      throw new NearException('INSUFFICIENT_USDC', { message: 'Profit stake amount must be greater than zero.' });
    }
    return this.call('Staking', 'stake_profits', input.opId, async (tx) => {
      try {
        await debitVerifier(tx, input.payerAccountId ?? input.accountId, MARKET_TOKENS.USDC.verifierId, toChainUnits('USDC', usdc));
      } catch (err) {
        if (err instanceof NearException && err.errorCode === 'NEAR_INSUFFICIENT_BALANCE') {
          throw new NearException('INSUFFICIENT_USDC', { details: err.details });
        }
        throw err;
      }
      await this.ensureAccount(tx, input.accountId, 'colony');
      const now = this.nowMs();
      const snap = await this.load(tx, input.accountId, pool, now);
      await this.creditProtocolYield(tx, snap);
      const next = withDeposit(snap, near, now, input.asset);
      await saveStakingRow(tx, input.accountId, pool.poolId, next);
      return { accountId: input.accountId, pool: pool.poolId, usdc: input.usdcAtomic, near: input.nearYocto, staked: next.staked.toString() };
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
    const row = await this.prisma.mockChainStaking.findUnique({
      where: { accountId_poolId: { accountId: input.accountId, poolId: pool.poolId } },
    });
    return viewOf(input.accountId, pool.poolId, row ? projectStakingRow(row, pool.apyBp, this.nowMs(), this.yieldShareBp()) : null);
  }

  /** W28 `get_account_positions`: every whitelisted pool position of the wallet, independent of Colony Deeds. */
  async accountPositions(accountId: string): Promise<readonly StakingPositionView[]> {
    const pools = this.resolvePools();
    const rows = await this.prisma.mockChainStaking.findMany({ where: { accountId }, orderBy: { poolId: 'asc' } });
    const now = this.nowMs();
    const out: StakingPositionView[] = [];
    for (const row of rows) {
      const pool = pools.find((p) => p.poolId === row.poolId);
      if (pool) out.push(viewOf(accountId, pool.poolId, projectStakingRow(row, pool.apyBp, now, this.yieldShareBp())));
    }
    return out;
  }

  /** The staking clock (real time plus the dev warp offsets), so callers evaluate clocks against the same `now`. */
  clockNowMs(): number {
    return this.nowMs();
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
}

function viewOf(accountId: string, pool: string, s: SettledStakingRow | null): StakingPositionView {
  if (!s) {
    return { accountId, pool, staked: '0', unbonding: '0', unbondingReadyAtMs: null, withdrawable: '0', rewards: '0', stakedSinceMs: null, lastStakedAtMs: null };
  }
  return {
    accountId,
    pool,
    staked: s.staked.toString(),
    unbonding: s.unbonding.toString(),
    unbondingReadyAtMs: s.unbondingReadyAtMs,
    withdrawable: s.withdrawable.toString(),
    rewards: s.rewards.toString(),
    stakedSinceMs: s.stakedSinceMs,
    lastStakedAtMs: s.lastStakedAtMs,
    asset: s.asset,
  };
}

export const adapter = adapterOf({ port: StakingPort, kind: 'mock', useClass: MockStakingAdapter });

import {
  PositionInput,
  RewardsInput,
  type RewardsResult,
  StakeInput,
  type StakingPoolView,
  StakingPort,
  type StakingPositionView,
  UnstakeInput,
  WithdrawInput,
} from '../application/ports/staking.port.js';
import { NearException } from '../domain/errors.js';
import type { ChainReceipt } from '../domain/types.js';
import {
  computeAccruedRewardDelta,
  GAME_DAY_MS,
  UNBONDING_DURATION_MS,
} from '../infrastructure/adapters/mock/staking.adapter.js';
import { parseStakingPoolsConfig } from '../staking/staking-pools.config.js';
import { InMemoryChain } from './in-memory-chain.js';

interface MemStakingState {
  staked: bigint;
  unbonding: bigint;
  unbondingReadyAtMs: number | null;
  withdrawable: bigint;
  rewards: bigint;
  lastAccruedAtMs: number;
}

/** In-memory `StakingPort` for unit tests and contract runs without Postgres. */
export class InMemoryStaking extends StakingPort {
  private readonly balances = new Map<string, bigint>();
  private readonly positions = new Map<string, MemStakingState>();
  private clockMs = Date.now();

  constructor(
    private readonly chain: InMemoryChain = new InMemoryChain(),
    private readonly rawPools?: string,
  ) {
    super();
  }

  advanceClockMs(deltaMs: number): void {
    if (Number.isFinite(deltaMs) && deltaMs > 0) {
      this.clockMs += Math.floor(deltaMs);
    }
  }

  advanceGameDays(days: number): void {
    this.advanceClockMs(days * GAME_DAY_MS);
  }

  async creditNear(accountId: string, yoctoAmount: string): Promise<void> {
    const prev = this.balances.get(accountId) ?? 0n;
    this.balances.set(accountId, prev + BigInt(yoctoAmount));
  }

  async nearBalanceOf(accountId: string): Promise<string> {
    return (this.balances.get(accountId) ?? 0n).toString();
  }

  async listPools(): Promise<readonly StakingPoolView[]> {
    return parseStakingPoolsConfig(this.rawPools ?? process.env.NEAR_STAKING_POOLS);
  }

  private async assertPool(poolId: string): Promise<StakingPoolView> {
    const pools = await this.listPools();
    const found = pools.find((p) => p.poolId === poolId);
    if (!found) throw new NearException('POOL_NOT_WHITELISTED', { details: { pool: poolId } });
    return found;
  }

  private settle(accountId: string, pool: StakingPoolView): MemStakingState {
    const key = `${accountId}::${pool.poolId}`;
    const existing = this.positions.get(key);
    const now = this.clockMs;
    if (!existing) {
      return {
        staked: 0n,
        unbonding: 0n,
        unbondingReadyAtMs: null,
        withdrawable: 0n,
        rewards: 0n,
        lastAccruedAtMs: now,
      };
    }
    const elapsed = Math.max(0, now - existing.lastAccruedAtMs);
    const rewards = existing.rewards + computeAccruedRewardDelta(existing.staked, pool.apyBp, elapsed);
    let unbonding = existing.unbonding;
    let unbondingReadyAtMs = existing.unbondingReadyAtMs;
    let withdrawable = existing.withdrawable;
    if (unbonding > 0n && unbondingReadyAtMs !== null && now >= unbondingReadyAtMs) {
      withdrawable += unbonding;
      unbonding = 0n;
      unbondingReadyAtMs = null;
    }
    return {
      staked: existing.staked,
      unbonding,
      unbondingReadyAtMs,
      withdrawable,
      rewards,
      lastAccruedAtMs: now,
    };
  }

  async stake(raw: StakeInput): Promise<ChainReceipt> {
    const input = StakeInput.parse(raw);
    const pool = await this.assertPool(input.pool);
    const amount = BigInt(input.amount);
    if (amount <= 0n) throw new NearException('STAKE_INSUFFICIENT_BALANCE');
    return this.chain.write(input.opId, () => {
      const payer = input.walletAccountId ?? input.accountId;
      const bal = this.balances.get(payer) ?? 0n;
      if (bal < amount) {
        throw new NearException('STAKE_INSUFFICIENT_BALANCE', {
          details: { accountId: payer, needed: input.amount, available: bal.toString() },
        });
      }
      this.balances.set(payer, bal - amount);
      const next = this.settle(input.accountId, pool);
      next.staked += amount;
      this.positions.set(`${input.accountId}::${pool.poolId}`, next);
    }).receipt;
  }

  async unstake(raw: UnstakeInput): Promise<ChainReceipt> {
    const input = UnstakeInput.parse(raw);
    const pool = await this.assertPool(input.pool);
    const amount = BigInt(input.amount);
    if (amount <= 0n) throw new NearException('STAKE_INSUFFICIENT_BALANCE');
    return this.chain.write(input.opId, () => {
      const next = this.settle(input.accountId, pool);
      if (next.staked < amount) {
        throw new NearException('STAKE_INSUFFICIENT_BALANCE', {
          details: { accountId: input.accountId, staked: next.staked.toString(), requested: input.amount },
        });
      }
      next.staked -= amount;
      next.unbonding += amount;
      next.unbondingReadyAtMs = this.clockMs + UNBONDING_DURATION_MS;
      this.positions.set(`${input.accountId}::${pool.poolId}`, next);
    }).receipt;
  }

  async withdraw(raw: WithdrawInput): Promise<ChainReceipt> {
    const input = WithdrawInput.parse(raw);
    const pool = await this.assertPool(input.pool);
    return this.chain.write(input.opId, () => {
      const next = this.settle(input.accountId, pool);
      if (next.withdrawable <= 0n) {
        throw new NearException('STAKE_INSUFFICIENT_BALANCE', {
          message: 'No withdrawable NEAR available.',
        });
      }
      const payout = next.withdrawable + next.rewards;
      const recipient = input.toAccountId ?? input.accountId;
      this.balances.set(recipient, (this.balances.get(recipient) ?? 0n) + payout);
      next.withdrawable = 0n;
      next.rewards = 0n;
      this.positions.set(`${input.accountId}::${pool.poolId}`, next);
    }).receipt;
  }

  async rewards(raw: RewardsInput): Promise<RewardsResult> {
    const pos = await this.position(raw);
    return { accrued: pos.rewards };
  }

  async position(raw: PositionInput): Promise<StakingPositionView> {
    const input = PositionInput.parse(raw);
    const pool = await this.assertPool(input.pool);
    const snap = this.settle(input.accountId, pool);
    return {
      accountId: input.accountId,
      pool: pool.poolId,
      staked: snap.staked.toString(),
      unbonding: snap.unbonding.toString(),
      unbondingReadyAtMs: snap.unbondingReadyAtMs,
      withdrawable: snap.withdrawable.toString(),
      rewards: snap.rewards.toString(),
    };
  }
}

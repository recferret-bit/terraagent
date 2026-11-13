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
  computeSplitRewardDelta,
  GAME_DAY_MS,
  PROTOCOL_STAKING_ACCOUNT_ID,
  UNBONDING_DURATION_MS,
} from '../staking/yocto.js';
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
    private readonly protocolAccountId?: string,
  ) {
    super();
  }

  private resolveProtocolAccount(): string {
    return this.protocolAccountId?.trim() || process.env.NEAR_PROTOCOL_ACCOUNT?.trim() || PROTOCOL_STAKING_ACCOUNT_ID;
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

  private settle(accountId: string, pool: StakingPoolView): MemStakingState & { protocolYieldDelta: bigint } {
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
        protocolYieldDelta: 0n,
      };
    }
    const elapsed = Math.max(0, now - existing.lastAccruedAtMs);
    const split = computeSplitRewardDelta(existing.staked, pool.apyBp, elapsed);
    const rewards = existing.rewards + split.userReward;
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
      protocolYieldDelta: split.protocolYield,
    };
  }

  async stake(raw: StakeInput): Promise<ChainReceipt> {
    const input = StakeInput.parse(raw);
    return this.mutatePoolAmount(input.opId, input.accountId, input.pool, input.amount, (next, amount) => {
      const payer = input.walletAccountId ?? input.accountId;
      const bal = this.balances.get(payer) ?? 0n;
      if (bal < amount) {
        throw new NearException('STAKE_INSUFFICIENT_BALANCE', {
          details: { accountId: payer, needed: input.amount, available: bal.toString() },
        });
      }
      this.balances.set(payer, bal - amount);
      next.staked += amount;
    });
  }

  async unstake(raw: UnstakeInput): Promise<ChainReceipt> {
    const input = UnstakeInput.parse(raw);
    return this.mutatePoolAmount(input.opId, input.accountId, input.pool, input.amount, (next, amount) => {
      if (next.staked < amount) {
        throw new NearException('STAKE_INSUFFICIENT_BALANCE', {
          details: { accountId: input.accountId, staked: next.staked.toString(), requested: input.amount },
        });
      }
      next.staked -= amount;
      next.unbonding += amount;
      next.unbondingReadyAtMs = this.clockMs + UNBONDING_DURATION_MS;
    });
  }

  private async mutatePoolAmount(
    opId: string,
    accountId: string,
    poolId: string,
    rawAmount: string,
    mutate: (next: ReturnType<InMemoryStaking['settle']>, amount: bigint) => void,
  ): Promise<ChainReceipt> {
    const pool = await this.assertPool(poolId);
    const amount = BigInt(rawAmount);
    if (amount <= 0n) throw new NearException('STAKE_INSUFFICIENT_BALANCE');
    return this.chain.write(opId, () => {
      const next = this.settle(accountId, pool);
      mutate(next, amount);
      if (next.protocolYieldDelta > 0n) {
        const proto = this.resolveProtocolAccount();
        this.balances.set(proto, (this.balances.get(proto) ?? 0n) + next.protocolYieldDelta);
      }
      this.positions.set(`${accountId}::${pool.poolId}`, next);
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
      if (next.protocolYieldDelta > 0n) {
        const proto = this.resolveProtocolAccount();
        this.balances.set(proto, (this.balances.get(proto) ?? 0n) + next.protocolYieldDelta);
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

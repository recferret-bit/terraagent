import type { DbClient } from '@terra/db';
import type { StakingAssetKind } from '../../../application/ports/staking.port.js';
import { computeSplitRewardDelta } from '../../../staking/yocto.js';

/** One `chain.mock_chain_staking` row as the mock staking adapter sees it: balances in yocto, clocks in unix ms. */
export interface StakingRowState {
  staked: bigint;
  unbonding: bigint;
  unbondingReadyAtMs: number | null;
  withdrawable: bigint;
  rewards: bigint;
  lastAccruedAtMs: number;
  /** Start of the continuous stake (24h fee warmup); `null` while nothing is staked. */
  stakedSinceMs: number | null;
  /** Latest deposit (7-day early-exit clock); compounding never touches it. */
  lastStakedAtMs: number | null;
  asset: StakingAssetKind;
}

/** A row projected to `nowMs`: accrued yield split, matured unbonding moved to `withdrawable`. */
export interface SettledStakingRow extends StakingRowState {
  /** The protocol's 20 % cut of the yield accrued since the last settle (the caller credits it). */
  protocolYieldDelta: bigint;
}

type DecimalLike = { toFixed(): string };

export interface StakingDbRow {
  staked: DecimalLike;
  unbonding: DecimalLike;
  unbondingReadyAt: Date | null;
  withdrawable: DecimalLike;
  rewardsAccrued: DecimalLike;
  lastAccruedAt: Date;
  stakedSinceAt?: Date | null;
  lastStakedAt?: Date | null;
  asset?: string | null;
}

const ASSETS: readonly StakingAssetKind[] = ['near', 'stNEAR', 'LiNEAR'];

export const emptyStakingRow = (nowMs: number): SettledStakingRow => ({
  staked: 0n,
  unbonding: 0n,
  unbondingReadyAtMs: null,
  withdrawable: 0n,
  rewards: 0n,
  lastAccruedAtMs: nowMs,
  stakedSinceMs: null,
  lastStakedAtMs: null,
  asset: 'near',
  protocolYieldDelta: 0n,
});

/** Projects a stored row to `nowMs`: accrues the user's share of validator yield and matures finished unbonding. */
export function projectStakingRow(row: StakingDbRow, apyBp: number, nowMs: number, yieldShareBp: number): SettledStakingRow {
  const staked = BigInt(row.staked.toFixed());
  let unbonding = BigInt(row.unbonding.toFixed());
  let unbondingReadyAtMs = row.unbondingReadyAt ? row.unbondingReadyAt.getTime() : null;
  let withdrawable = BigInt(row.withdrawable.toFixed());
  const elapsedMs = Math.max(0, nowMs - row.lastAccruedAt.getTime());
  const split = computeSplitRewardDelta(staked, apyBp, elapsedMs, yieldShareBp);
  if (unbonding > 0n && unbondingReadyAtMs !== null && nowMs >= unbondingReadyAtMs) {
    withdrawable += unbonding;
    unbonding = 0n;
    unbondingReadyAtMs = null;
  }
  const asset = ASSETS.find((a) => a === row.asset) ?? 'near';
  return {
    staked,
    unbonding,
    unbondingReadyAtMs,
    withdrawable,
    rewards: BigInt(row.rewardsAccrued.toFixed()) + split.userReward,
    protocolYieldDelta: split.protocolYield,
    lastAccruedAtMs: nowMs,
    stakedSinceMs: row.stakedSinceAt?.getTime() ?? null,
    lastStakedAtMs: row.lastStakedAt?.getTime() ?? null,
    asset,
  };
}

export async function loadStakingRow(
  tx: DbClient,
  accountId: string,
  poolId: string,
  apyBp: number,
  nowMs: number,
  yieldShareBp: number,
): Promise<SettledStakingRow> {
  const row = await tx.mockChainStaking.findUnique({ where: { accountId_poolId: { accountId, poolId } } });
  return row ? projectStakingRow(row, apyBp, nowMs, yieldShareBp) : emptyStakingRow(nowMs);
}

/** Records a deposit: the first deposit of a continuous stake starts the warmup clock, every deposit bumps `lastStakedAt`. */
export function withDeposit(snap: SettledStakingRow, amount: bigint, nowMs: number, asset: StakingAssetKind): StakingRowState {
  const fresh = snap.staked === 0n || snap.stakedSinceMs === null;
  return {
    ...snap,
    staked: snap.staked + amount,
    stakedSinceMs: fresh ? nowMs : snap.stakedSinceMs,
    lastStakedAtMs: nowMs,
    asset,
    lastAccruedAtMs: nowMs,
  };
}

/** An emptied position forgets its maturity clocks (a later deposit starts a fresh warmup). */
export const clearClocksWhenEmpty = <T extends StakingRowState>(row: T): T =>
  row.staked > 0n ? row : { ...row, stakedSinceMs: null, lastStakedAtMs: null };

export async function saveStakingRow(tx: DbClient, accountId: string, poolId: string, state: StakingRowState): Promise<void> {
  const nowDate = new Date(state.lastAccruedAtMs);
  const data = {
    staked: state.staked.toString(),
    unbonding: state.unbonding.toString(),
    unbondingReadyAt: state.unbondingReadyAtMs !== null ? new Date(state.unbondingReadyAtMs) : null,
    withdrawable: state.withdrawable.toString(),
    rewardsAccrued: state.rewards.toString(),
    lastAccruedAt: nowDate,
    stakedSinceAt: state.stakedSinceMs !== null ? new Date(state.stakedSinceMs) : null,
    lastStakedAt: state.lastStakedAtMs !== null ? new Date(state.lastStakedAtMs) : null,
    asset: state.asset,
    updatedAt: nowDate,
  };
  await tx.mockChainStaking.upsert({
    where: { accountId_poolId: { accountId, poolId } },
    create: { accountId, poolId, ...data },
    update: data,
  });
}

import { z } from 'zod';
import { AccountId, type ChainReceipt, OpId, TokenAmount } from '../../domain/types';

export const NEAR_ADAPTER_STAKING = 'NEAR_ADAPTER_STAKING';

export const StakingPoolView = z.strictObject({
  poolId: AccountId,
  name: z.string().min(1).max(80),
  apyBp: z.number().int().nonnegative().max(100_000),
});
export type StakingPoolView = z.infer<typeof StakingPoolView>;

/** W28: staked asset (native `stake_payable` or LST `stake_lst` / `withdraw_lst`). Defaults to `near`. */
export const StakingAssetKind = z.enum(['near', 'stNEAR', 'LiNEAR']);
export type StakingAssetKind = z.infer<typeof StakingAssetKind>;

export const StakeInput = z.object({
  opId: OpId,
  accountId: AccountId,
  pool: AccountId,
  amount: TokenAmount,
  walletAccountId: AccountId.optional(),
  asset: StakingAssetKind.optional(),
  /** Meta Pool / LiNEAR builder referral id forwarded on mainnet `deposit_and_stake`. */
  referralId: AccountId.optional(),
});
export type StakeInput = z.infer<typeof StakeInput>;

export const UnstakeInput = z.object({
  opId: OpId,
  accountId: AccountId,
  pool: AccountId,
  amount: TokenAmount,
  asset: StakingAssetKind.optional(),
});
export type UnstakeInput = z.infer<typeof UnstakeInput>;

export const WithdrawInput = z.object({
  opId: OpId,
  accountId: AccountId,
  pool: AccountId,
  toAccountId: AccountId.optional(),
  asset: StakingAssetKind.optional(),
});

/** W28 `compound_yield(pool_id)`: accrued 80 % yield → principal, `0 %` fee, 7-day maturity clock untouched. */
export const CompoundInput = z.object({ opId: OpId, accountId: AccountId, pool: AccountId });
export type CompoundInput = z.infer<typeof CompoundInput>;
export type WithdrawInput = z.infer<typeof WithdrawInput>;

export const RewardsInput = z.object({ accountId: AccountId, pool: AccountId });
export type RewardsInput = z.infer<typeof RewardsInput>;
export type RewardsResult = { readonly accrued: TokenAmount };

export const PositionInput = z.object({ accountId: AccountId, pool: AccountId });
export type PositionInput = z.infer<typeof PositionInput>;

export const StakingPositionView = z.strictObject({
  accountId: AccountId,
  pool: AccountId,
  staked: TokenAmount,
  unbonding: TokenAmount,
  unbondingReadyAtMs: z.number().int().nonnegative().nullable(),
  withdrawable: TokenAmount,
  rewards: TokenAmount,
  /** W28: continuous-stake start (24h fee warmup) and last deposit (7-day early-exit fee). */
  stakedSinceMs: z.number().int().nonnegative().nullable().optional(),
  lastStakedAtMs: z.number().int().nonnegative().nullable().optional(),
  asset: StakingAssetKind.optional(),
});
export type StakingPositionView = z.infer<typeof StakingPositionView>;

/**
 * Own-NEAR validator staking port (`StakingPort`, W20-01 / NEAR §9).
 * Enforces whitelisted pools (`NEAR_STAKING_POOLS`), 4-epoch unbonding (~2 game-days), and 9 % APY rewards.
 */
export abstract class StakingPort {
  abstract listPools(): Promise<readonly StakingPoolView[]>;
  abstract stake(input: StakeInput): Promise<ChainReceipt>;
  abstract unstake(input: UnstakeInput): Promise<ChainReceipt>;
  abstract withdraw(input: WithdrawInput): Promise<ChainReceipt>;
  abstract rewards(input: RewardsInput): Promise<RewardsResult>;
  abstract position(input: PositionInput): Promise<StakingPositionView>;

  /** W28 `compound_yield` (optional until every adapter implements it; W28-02 / W28-04 add mock + testnet). */
  compound?(input: CompoundInput): Promise<ChainReceipt>;

  /** W28 `get_account_positions(account_id)`: every pool position of a wallet, independent of Colony Deeds. */
  accountPositions?(accountId: string): Promise<readonly StakingPositionView[]>;
}

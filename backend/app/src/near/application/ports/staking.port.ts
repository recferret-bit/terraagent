import { z } from 'zod';
import { AccountId, type ChainReceipt, OpId, TokenAmount } from '../../domain/types';

export const NEAR_ADAPTER_STAKING = 'NEAR_ADAPTER_STAKING';

export const StakingPoolView = z.strictObject({
  poolId: AccountId,
  name: z.string().min(1).max(80),
  apyBp: z.number().int().nonnegative().max(100_000),
});
export type StakingPoolView = z.infer<typeof StakingPoolView>;

export const StakeInput = z.object({
  opId: OpId,
  accountId: AccountId,
  pool: AccountId,
  amount: TokenAmount,
  walletAccountId: AccountId.optional(),
});
export type StakeInput = z.infer<typeof StakeInput>;

export const UnstakeInput = z.object({
  opId: OpId,
  accountId: AccountId,
  pool: AccountId,
  amount: TokenAmount,
});
export type UnstakeInput = z.infer<typeof UnstakeInput>;

export const WithdrawInput = z.object({
  opId: OpId,
  accountId: AccountId,
  pool: AccountId,
  toAccountId: AccountId.optional(),
});
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
}

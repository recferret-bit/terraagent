import type { AccountId, ChainReceipt, OpId, TokenAmount } from '../../domain/types.js';

export interface StakeInput { readonly opId: OpId; readonly accountId: AccountId; readonly pool: string; readonly amount: TokenAmount }
export interface RewardsInput { readonly accountId: AccountId; readonly pool: string }
export interface RewardsResult { readonly staked: TokenAmount; readonly rewards: TokenAmount }

export abstract class StakingPort {
  abstract stake(input: StakeInput): Promise<ChainReceipt>;
  abstract unstake(input: StakeInput): Promise<ChainReceipt>;
  abstract rewards(input: RewardsInput): Promise<RewardsResult>;
}

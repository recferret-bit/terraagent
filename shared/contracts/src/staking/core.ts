import { z } from 'zod';
import { Nep413Signature } from '../deed/nep413';

/**
 * W20 staking DTOs (moved here from `deed/` in W28-01), extended additively for W28 wallet-first staking:
 * `colonyId` is optional everywhere (a wallet with zero colonies can stake), and the asset (`near | stNEAR | LiNEAR`)
 * plus the wallet `accountId` may be named explicitly.
 */

const AccountId = z.string().min(2).max(64);
const Near = z.string().regex(/^\d+(\.\d+)?$/);
/** Staked asset: native `NEAR` (`stake_payable`) or a liquid-staking token (`stake_lst` / `ft_transfer_call`). */
export const STAKING_ASSETS = ['near', 'stNEAR', 'LiNEAR'] as const;
export const StakingAsset = z.enum(STAKING_ASSETS);
export type StakingAsset = z.infer<typeof StakingAsset>;

export const StakingPoolInfo = z.strictObject({
  poolId: z.string().min(2).max(64),
  name: z.string().min(1).max(80),
  apyBp: z.number().int().nonnegative().max(100_000),
});
export type StakingPoolInfo = z.infer<typeof StakingPoolInfo>;

export const StakingPositionDto = z.strictObject({
  colonyId: z.string().min(1).optional(),
  accountId: AccountId,
  pool: z.string().min(2).max(64),
  poolName: z.string().optional(),
  apyBp: z.number().int().nonnegative().optional(),
  asset: StakingAsset.optional(),
  staked: Near,
  unbonding: Near,
  unbondingReadyAtMs: z.number().int().nonnegative().nullable(),
  withdrawable: Near,
  rewards: Near,
  /** Start of the continuous stake (fee warmup clock); `null` when nothing is staked. */
  stakedSinceMs: z.number().int().nonnegative().nullable().optional(),
  /** Last deposit (7-day early-exit clock; compounding does not reset it). */
  lastStakedAtMs: z.number().int().nonnegative().nullable().optional(),
  updatedAt: z.number().int().nonnegative().optional(),
});
export type StakingPositionDto = z.infer<typeof StakingPositionDto>;

const actionBase = {
  colonyId: z.string().min(1).optional(),
  /** W28 wallet-first: the staking wallet; defaults to the colony / session account when omitted. */
  accountId: AccountId.optional(),
  pool: z.string().min(2).max(64),
  asset: StakingAsset.optional(),
  opId: z.string().min(1).max(200).optional(),
  walletSignature: Nep413Signature.optional(),
};

export const StakeRequestSchema = z.strictObject({ ...actionBase, amount: Near });
export type StakeRequest = z.infer<typeof StakeRequestSchema>;

export const UnstakeRequestSchema = z.strictObject({ ...actionBase, amount: Near });
export type UnstakeRequest = z.infer<typeof UnstakeRequestSchema>;

export const WithdrawRequestSchema = z.strictObject(actionBase);
export type WithdrawRequest = z.infer<typeof WithdrawRequestSchema>;

export const StakerPerksInfo = z.strictObject({
  active: z.boolean(),
  minStakeNear: z.string(),
  totalStakedNear: z.string(),
  grossApyBp: z.number().int().nonnegative(),
  netApyBp: z.number().int().nonnegative(),
  protocolYieldShareBp: z.number().int().nonnegative(),
  platformFeeBp: z.number().int().nonnegative(),
  stakerPlatformFeeBp: z.number().int().nonnegative().optional(),
  standardPlatformFeeBp: z.number().int().nonnegative(),
  managedAutopilotUnlocked: z.boolean(),
  protocolAccountId: z.string().min(2).max(64),
});
export type StakerPerksInfo = z.infer<typeof StakerPerksInfo>;

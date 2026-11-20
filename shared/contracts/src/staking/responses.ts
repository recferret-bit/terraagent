import { z } from 'zod';
import { StakerPerksInfo, StakingPoolInfo, StakingPositionDto } from './core';
import { EvaluatedStakerPerksV2 } from './perks';

/** Perks as V2 (W28 on) or the W20 shape (W28 off via `TA_WAVES`). */
export const StakerPerksAny = z.union([EvaluatedStakerPerksV2, StakerPerksInfo]);
export type StakerPerksAny = z.infer<typeof StakerPerksAny>;

/** `GET /v1/near/staking?colonyId=…|accountId=…`. `colonyId` is absent for a wallet with no colony (W28). */
export const StakingStatusResponse = z.strictObject({
  colonyId: z.string().min(1).optional(),
  accountId: z.string().min(2).max(64),
  walletAccountId: z.string().min(2).max(64),
  walletBalanceNear: z.string(),
  deedSettled: z.boolean(),
  accountClaimed: z.boolean(),
  claimedByAccountId: z.string().nullable(),
  pools: z.array(StakingPoolInfo),
  positions: z.array(StakingPositionDto),
  perks: StakerPerksAny.optional(),
});
export type StakingStatusResponse = z.infer<typeof StakingStatusResponse>;

export const StakingActionResponse = z.strictObject({
  txHash: z.string().min(1),
  position: StakingPositionDto,
  walletBalanceNear: z.string(),
  /** W28 unstake: `25 bp` within 7 days of the last deposit, routed to `protocol.<root>`. */
  earlyExitFeeBp: z.number().int().nonnegative().optional(),
  earlyExitFeeNear: z.string().regex(/^\d+(\.\d+)?$/).optional(),
  /** W28 compound: NEAR rolled from accrued yield into principal. */
  compoundedNear: z.string().regex(/^\d+(\.\d+)?$/).optional(),
  perks: StakerPerksAny.optional(),
});
export type StakingActionResponse = z.infer<typeof StakingActionResponse>;

import { z } from 'zod';
import { Nep413Signature } from '../deed/nep413';
import { StakingAsset, StakingPositionDto } from './core';
import { EvaluatedStakerPerksV2 } from './perks';

const AccountId = z.string().min(2).max(64);
const Near = z.string().regex(/^\d+(\.\d+)?$/);

/** `POST /v1/near/stake/compound`: roll accrued 80 % yield into principal (`0 %` fee, keeps the 7-day maturity clock). */
export const CompoundYieldRequest = z.strictObject({
  accountId: AccountId.optional(),
  colonyId: z.string().min(1).optional(),
  pool: z.string().min(2).max(64),
  opId: z.string().min(1).max(200).optional(),
  walletSignature: Nep413Signature.optional(),
});
export const CompoundYieldRequestSchema = CompoundYieldRequest;
export type CompoundYieldRequest = z.infer<typeof CompoundYieldRequest>;

/** `POST /v1/near/stake/profits`: swap `USDC` trade profits to `stNEAR` and stake them (`dry: true` on testnet). */
export const StakeProfitsRequest = z.strictObject({
  accountId: AccountId.optional(),
  colonyId: z.string().min(1).optional(),
  /** Human USDC amount, at most 6 decimals (`10.00`). */
  amountUsdc: z.string().regex(/^\d+(\.\d{1,6})?$/),
  pool: z.string().min(2).max(64).optional(),
  asset: StakingAsset.default('stNEAR'),
  dry: z.boolean().optional(),
  opId: z.string().min(1).max(200).optional(),
  walletSignature: Nep413Signature.optional(),
});
export const StakeProfitsRequestSchema = StakeProfitsRequest;
export type StakeProfitsRequest = z.input<typeof StakeProfitsRequest>;

export const StakeProfitsQuote = z.strictObject({
  amountInUsdc: Near,
  /** USDC atomic units (6 decimals): `10.00` → `10000000`. */
  amountInAtomic: z.string().regex(/^\d+$/),
  amountOutNear: Near,
  nearUsd: z.number().positive(),
  source: z.enum(['mock', '1click']),
  dry: z.boolean(),
});
export type StakeProfitsQuote = z.infer<typeof StakeProfitsQuote>;

export const StakeProfitsResponse = z.strictObject({
  quote: StakeProfitsQuote,
  /** `null` on a dry run (quote only, nothing staked). */
  txHash: z.string().min(1).nullable(),
  position: StakingPositionDto.nullable(),
  walletBalanceNear: Near,
  perks: EvaluatedStakerPerksV2.optional(),
});
export type StakeProfitsResponse = z.infer<typeof StakeProfitsResponse>;

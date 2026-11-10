import { z } from 'zod';
import { AccountId, ChainReceipt, OpId, TokenAmount } from '../../domain/types.js';

/** Env binding `NEAR_ADAPTER_ESCROW` (mock | testnet | devnet | mainnet). The adapter is W22-17. */
export const NEAR_ADAPTER_ESCROW = 'NEAR_ADAPTER_ESCROW';

export const ESCROW_STATUSES = ['open', 'claimed', 'refunded'] as const;
export const EscrowStatus = z.enum(ESCROW_STATUSES);
export type EscrowStatus = z.infer<typeof EscrowStatus>;

const EscrowId = z.string().min(1).max(80);
const TokenId = z.string().min(1).max(64);
/** Colony account, or the escrow hold id (`escrow:` + 32 hex) when nobody has claimed yet (BE-70, W22-19). */
const EscrowBeneficiary = z.union([AccountId, z.string().regex(/^escrow:[0-9a-f]{32}$/)]);

/**
 * `beneficiary` stays required (W00-30). A bounty has no claimer at post (Q-05-26, BE-70):
 * open to a holding account; `claim` pays `caller` (NEAR-111).
 */
export const EscrowOpenInput = z.strictObject({
  opId: OpId,
  funder: AccountId,
  beneficiary: EscrowBeneficiary,
  tokenId: TokenId,
  amount: TokenAmount,
  expiresAtMs: z.number().int().nonnegative(),
});
export type EscrowOpenInput = z.infer<typeof EscrowOpenInput>;

export const EscrowOpenResult = z.strictObject({
  escrowId: EscrowId,
  receipt: ChainReceipt,
});
export type EscrowOpenResult = z.infer<typeof EscrowOpenResult>;

export const EscrowActionInput = z.strictObject({
  opId: OpId,
  escrowId: EscrowId,
  caller: AccountId,
  /**
   * Base units `refund` returns to the opener. Omit it to return the whole hold and close the escrow.
   * A smaller amount leaves the row `open` with the rest (W22-28). `0` moves nothing. `claim` ignores it.
   */
  amount: TokenAmount.optional(),
});
export type EscrowActionInput = z.infer<typeof EscrowActionInput>;

/** Read. No `opId`: a get does not spend. */
export const EscrowGetInput = z.strictObject({
  escrowId: EscrowId,
});
export type EscrowGetInput = z.infer<typeof EscrowGetInput>;

export const EscrowView = z.strictObject({
  escrowId: EscrowId,
  status: EscrowStatus,
  funder: AccountId,
  beneficiary: EscrowBeneficiary,
  tokenId: TokenId,
  amount: TokenAmount,
  expiresAtMs: z.number().int().nonnegative(),
});
export type EscrowView = z.infer<typeof EscrowView>;

/**
 * Bounty escrow (`EscrowPort`, W00-30 + W22-02, NEAR-110..111).
 * `claim` is the operator call that pays the claimer the current hold. `refund` returns the opener
 * the whole hold, or `amount` when that is set (the unused part of a mercenary hire).
 */
export abstract class EscrowPort {
  abstract open(input: EscrowOpenInput): Promise<EscrowOpenResult>;
  abstract claim(input: EscrowActionInput): Promise<ChainReceipt>;
  abstract refund(input: EscrowActionInput): Promise<ChainReceipt>;
  abstract get(input: EscrowGetInput): Promise<EscrowView>;
}

import { z } from 'zod';
import { AccountId, ChainReceipt, OpId, TokenAmount } from '../../domain/types.js';

/** Env binding `NEAR_ADAPTER_ESCROW` (mock | testnet | devnet | mainnet). The adapter is W22-17. */
export const NEAR_ADAPTER_ESCROW = 'NEAR_ADAPTER_ESCROW';

export const ESCROW_STATUSES = ['open', 'claimed', 'refunded', 'slashed'] as const;
export const EscrowStatus = z.enum(ESCROW_STATUSES);
export type EscrowStatus = z.infer<typeof EscrowStatus>;

/** Default slash split: 10% (1,000 bp) to `TerraAgent Protocol`, 90% (9,000 bp) to betrayed partner / defender. */
export const DEFAULT_ESCROW_SLASH_PROTOCOL_BP = 1_000;

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

export const EscrowSlashInput = z.strictObject({
  opId: OpId,
  escrowId: EscrowId,
  victimAccountId: AccountId,
  protocolAccountId: AccountId,
  protocolFeeBp: z.number().int().min(0).max(10_000).default(DEFAULT_ESCROW_SLASH_PROTOCOL_BP),
});
export type EscrowSlashInput = z.infer<typeof EscrowSlashInput>;

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
 * Bounty, Peace Treaty & War Bond escrow (`EscrowPort`, W00-30 + W22-02, NEAR-110..111).
 * `claim` pays the claimer the current hold; `refund` returns the opener all or `amount`;
 * `slash` forfeits an open diplomacy/war bond `90%` to `victimAccountId` and `10%` to `protocolAccountId`.
 */
export abstract class EscrowPort {
  abstract open(input: EscrowOpenInput): Promise<EscrowOpenResult>;
  abstract claim(input: EscrowActionInput): Promise<ChainReceipt>;
  abstract refund(input: EscrowActionInput): Promise<ChainReceipt>;
  abstract slash(input: EscrowSlashInput): Promise<ChainReceipt>;
  abstract get(input: EscrowGetInput): Promise<EscrowView>;
}

import { z } from 'zod';
import { NearAccountId } from './near-account';

/**
 * `POST /v1/near/claim` (PROTOCOL §7–§8, D-18). The endpoint answers `409 not_available_yet` until W21.
 * Wallet fields stay optional so the claim screen can send them later without a second schema.
 */
export const NearClaimRequest = z.strictObject({
  accountId: NearAccountId,
  walletAccountId: NearAccountId.optional(),
  walletPublicKey: z.string().min(1).max(128).optional(),
});
export const NearClaimRequestSchema = NearClaimRequest;
export type NearClaimRequest = z.infer<typeof NearClaimRequest>;

/** Stable domain code of the claim stub. Real claim (W21) returns a receipt instead. */
export const NEAR_CLAIM_NOT_AVAILABLE = 'NOT_AVAILABLE_YET' as const;

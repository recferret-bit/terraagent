// Stable NEAR error codes (NEAR §1a rule 4). Mock and real adapters throw the same codes so callers switch on `errorCode`.
import { CoreException, type CoreExceptionOptions } from '../../core/errors';

export interface NearErrorDef {
  readonly status: number;
  readonly description: string;
}

/** The documented error codes: HTTP status (used by the REST filter) and meaning. Add codes here, never inline. */
export const NEAR_ERROR_CODES = {
  NEAR_INSUFFICIENT_BALANCE: { status: 409, description: 'The account holds less of the token than the operation needs.' },
  NEAR_INTENT_DIFF_NOT_ZERO: { status: 422, description: 'Token diffs of an intent do not sum to zero per token.' },
  // W13 Intents (NEAR-61, NEAR-62): a batch is rejected as a whole, with no balance change
  NEAR_INTENT_NONCE_REUSED: { status: 409, description: 'The intent nonce was already used by this signer (replay).' },
  NEAR_INTENT_EXPIRED: { status: 422, description: 'The intent deadline has passed.' },
  NEAR_INTENT_BAD_SIGNATURE: { status: 422, description: 'The NEP-413 signature does not verify against the signer key and payload.' },
  NEAR_ACCOUNT_EXISTS: { status: 409, description: 'The account id is already registered.' },
  NEAR_ACCOUNT_NOT_FOUND: { status: 404, description: 'The account id does not exist on chain.' },
  NEAR_NFT_EXISTS: { status: 409, description: 'An NFT with this collection and token id already exists.' },
  NEAR_NFT_NOT_FOUND: { status: 404, description: 'No NFT with this collection and token id.' },
  NEAR_NFT_INVALID: { status: 400, description: 'The NFT input is invalid: metadata is not plain JSON, is too large, or names another collection.' },
  NEAR_NOT_OWNER: { status: 403, description: 'The caller does not own the asset.' },
  NEAR_ESCROW_NOT_FOUND: { status: 404, description: 'No escrow with this id.' },
  NEAR_ESCROW_STATE: { status: 409, description: 'The escrow is not in a state that allows this action.' },
  NEAR_DAO_NOT_FOUND: { status: 404, description: 'No DAO or proposal with this id.' },
  NEAR_DAO_STATE: { status: 409, description: 'The proposal is not in a state that allows this action.' },
  NEAR_MOCK_INJECTED_FAILURE: { status: 503, description: 'Failure injected by MOCK_FAIL_RATE to exercise pending/failed UI states.' },
  NEAR_UNAVAILABLE: { status: 503, description: 'The chain or its RPC is temporarily unavailable; retry with the same opId.' },
  // F5 (W06). Player-facing text: no wallet, gas, transaction, or key wording (NEAR §1 principle 1).
  NEAR_PROVIDER_REJECTED: { status: 401, description: 'That sign-in could not be confirmed. Try again.' },
  NEAR_NAME_TAKEN: { status: 409, description: 'That Pilot ID is already in use.' },
  NEAR_RELAY_FAILED: { status: 503, description: "Couldn't save to orbit. Retrying." },
  NEAR_RELAY_RECEIVER_NOT_ALLOWED: { status: 403, description: 'That save is not allowed for this colony.' },
  // F6 (W20). Colony Deed & Staking error codes (NEAR §6, §9).
  DEED_NOT_FOUND: { status: 404, description: 'Colony Deed not found.' },
  DEED_NOT_SETTLED: { status: 409, description: 'Available after your colony is Settled.' },
  ACCOUNT_NOT_CLAIMED: { status: 409, description: 'Claim your colony account before staking NEAR.' },
  POOL_NOT_WHITELISTED: { status: 422, description: 'Staking pool is not in NEAR_STAKING_POOLS.' },
  STAKE_INSUFFICIENT_BALANCE: { status: 409, description: 'Insufficient NEAR balance in your wallet for this stake.' },
  // F3/F4 (W15). Limited-key principal is exhausted. Gas is a separate allowance and does not use this code.
  NEAR_ALLOWANCE_EXHAUSTED: { status: 409, description: 'The limited key has no remaining allowance for this token.' },
} as const satisfies Record<string, NearErrorDef>;

export type NearErrorCode = keyof typeof NEAR_ERROR_CODES;

/** Domain error of the NEAR module; `status` defaults to the code's documented HTTP status. */
export class NearException extends CoreException {
  constructor(errorCode: NearErrorCode, opts: CoreExceptionOptions = {}) {
    super(errorCode, { ...opts, status: opts.status ?? NEAR_ERROR_CODES[errorCode].status, message: opts.message ?? NEAR_ERROR_CODES[errorCode].description });
  }
}

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
  NEAR_ACCOUNT_EXISTS: { status: 409, description: 'The account id is already registered.' },
  NEAR_ACCOUNT_NOT_FOUND: { status: 404, description: 'The account id does not exist on chain.' },
  NEAR_NFT_EXISTS: { status: 409, description: 'An NFT with this collection and token id already exists.' },
  NEAR_NFT_NOT_FOUND: { status: 404, description: 'No NFT with this collection and token id.' },
  NEAR_NOT_OWNER: { status: 403, description: 'The caller does not own the asset.' },
  NEAR_ESCROW_NOT_FOUND: { status: 404, description: 'No escrow with this id.' },
  NEAR_ESCROW_STATE: { status: 409, description: 'The escrow is not in a state that allows this action.' },
  NEAR_DAO_NOT_FOUND: { status: 404, description: 'No DAO or proposal with this id.' },
  NEAR_DAO_STATE: { status: 409, description: 'The proposal is not in a state that allows this action.' },
  NEAR_MOCK_INJECTED_FAILURE: { status: 503, description: 'Failure injected by MOCK_FAIL_RATE to exercise pending/failed UI states.' },
  NEAR_UNAVAILABLE: { status: 503, description: 'The chain or its RPC is temporarily unavailable; retry with the same opId.' },
} as const satisfies Record<string, NearErrorDef>;

export type NearErrorCode = keyof typeof NEAR_ERROR_CODES;

/** Domain error of the NEAR module; `status` defaults to the code's documented HTTP status. */
export class NearException extends CoreException {
  constructor(errorCode: NearErrorCode, opts: CoreExceptionOptions = {}) {
    super(errorCode, { ...opts, status: opts.status ?? NEAR_ERROR_CODES[errorCode].status, message: opts.message ?? NEAR_ERROR_CODES[errorCode].description });
  }
}

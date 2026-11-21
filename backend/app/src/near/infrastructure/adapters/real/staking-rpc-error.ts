import { NearException } from '../../../domain/errors.js';
import { formatErrorText } from '../../rpc/near-error-map.js';

/** Why a staking chain read or call failed. Nothing in the staking adapters swallows these any more. */
export type StakingRpcErrorCode =
  | 'rpc_unreachable'
  | 'rpc_timeout'
  | 'rpc_error'
  | 'invalid_response'
  | 'withdraw_rolled_back'
  | 'apy_unavailable';

export interface StakingRpcErrorDetails {
  readonly operation: string;
  readonly accountId?: string;
  readonly contractId?: string;
  readonly cause?: unknown;
}

/** Typed failure of the staking RPC path (node down, timeout, JSON-RPC error body, malformed view, rolled-back payout). */
export class StakingRpcError extends Error {
  readonly code: StakingRpcErrorCode;
  readonly details: StakingRpcErrorDetails;

  constructor(code: StakingRpcErrorCode, message: string, details: StakingRpcErrorDetails) {
    super(`${code}: ${message}`, details.cause === undefined ? undefined : { cause: details.cause });
    this.name = 'StakingRpcError';
    this.code = code;
    this.details = details;
  }

  /** The API-facing exception (the REST error envelope stays the NEAR one). */
  toNearException(): NearException {
    return new NearException('NEAR_UNAVAILABLE', { message: this.message, details: { code: this.code, operation: this.details.operation, accountId: this.details.accountId, contractId: this.details.contractId } });
  }
}

const TIMEOUT_RE = /timeout|timed out|etimedout|aborterror|aborted/i;
const UNREACHABLE_RE = /fetch failed|econnrefused|econnreset|enotfound|eai_again|socket|network|unreachable|ehostunreach/i;

/** Classifies a thrown chain error (already-typed errors pass through unchanged). */
export function classifyStakingRpcFailure(err: unknown, details: Omit<StakingRpcErrorDetails, 'cause'>): StakingRpcError {
  if (err instanceof StakingRpcError) return err;
  const text = formatErrorText(err).slice(0, 300);
  const withCause = { ...details, cause: err };
  if (TIMEOUT_RE.test(text)) return new StakingRpcError('rpc_timeout', text, withCause);
  if (UNREACHABLE_RE.test(text)) return new StakingRpcError('rpc_unreachable', text, withCause);
  return new StakingRpcError('rpc_error', text, withCause);
}

/** True for the node's "this account does not exist" answer: a legitimate zero balance, not an outage. */
export const isUnknownAccountError = (err: unknown): boolean => /does not exist|UNKNOWN_ACCOUNT|AccountDoesNotExist/i.test(formatErrorText(err));

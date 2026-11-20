import { NearException } from '../../../domain/errors.js';
import { formatErrorText } from '../../rpc/near-error-map.js';

/** Why an `IntentsPort` chain interaction failed. Nothing in the intents adapters swallows these any more. */
export type IntentsRpcErrorCode =
  | 'rpc_unreachable'
  | 'rpc_timeout'
  | 'rpc_error'
  | 'key_not_registered'
  | 'insufficient_onchain_balance'
  | 'verifier_not_configured'
  | 'invalid_key_material';

export interface IntentsRpcErrorDetails {
  readonly operation: string;
  readonly accountId?: string;
  readonly publicKey?: string;
  readonly tokenId?: string;
  readonly required?: string;
  readonly available?: string;
  readonly cause?: unknown;
}

/** Typed failure of the verifier / intents chain path (RPC down, JSON-RPC error body, timeout, key or balance gap). */
export class IntentsRpcError extends Error {
  readonly code: IntentsRpcErrorCode;
  readonly details: IntentsRpcErrorDetails;

  constructor(code: IntentsRpcErrorCode, message: string, details: IntentsRpcErrorDetails) {
    super(`${code}: ${message}`, details.cause === undefined ? undefined : { cause: details.cause });
    this.name = 'IntentsRpcError';
    this.code = code;
    this.details = details;
  }

  /** The canonical API-facing exception for this failure (so controllers keep their existing error envelope). */
  toNearException(): NearException {
    if (this.code === 'insufficient_onchain_balance') {
      return new NearException('NEAR_INSUFFICIENT_BALANCE', { message: this.message });
    }
    if (this.code === 'key_not_registered') return new NearException('NEAR_INTENT_BAD_SIGNATURE', { message: this.message });
    return new NearException('NEAR_UNAVAILABLE', { message: this.message });
  }
}

const TIMEOUT_RE = /timeout|timed out|etimedout|aborterror|aborted/i;
const UNREACHABLE_RE = /fetch failed|econnrefused|econnreset|enotfound|eai_again|socket|network|unreachable|ehostunreach/i;

/** Classifies a thrown chain error into an `IntentsRpcError` (already-typed errors pass through unchanged). */
export function classifyIntentsRpcFailure(err: unknown, details: Omit<IntentsRpcErrorDetails, 'cause'>): IntentsRpcError {
  if (err instanceof IntentsRpcError) return err;
  const text = formatErrorText(err).slice(0, 300);
  const withCause = { ...details, cause: err };
  if (err instanceof NearException && err.errorCode === 'NEAR_INSUFFICIENT_BALANCE') {
    return new IntentsRpcError('insufficient_onchain_balance', text, withCause);
  }
  if (/NEAR_INSUFFICIENT_FUNDS|NEAR_INSUFFICIENT_BALANCE/.test(text)) {
    return new IntentsRpcError('insufficient_onchain_balance', text, withCause);
  }
  if (TIMEOUT_RE.test(text)) return new IntentsRpcError('rpc_timeout', text, withCause);
  if (UNREACHABLE_RE.test(text)) return new IntentsRpcError('rpc_unreachable', text, withCause);
  return new IntentsRpcError('rpc_error', text, withCause);
}

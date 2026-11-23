import { LlmProviderError, type LlmFailureKind } from '../../ports/llm-provider.port.js';

/**
 * NEAR AI Cloud error types (nearai/cloud-api `crates/api/src/middleware/usage.rs`, `crates/services/src/usage/budget.rs`,
 * `crates/api/src/middleware/auth.rs`). A zero balance is HTTP 402 with `{ error: { message, type } }` where `type` is
 * `no_credits`, `insufficient_credits`, `api_key_limit_exceeded` or `no_limit_configured`; an upstream vendor's 402 is
 * relabelled `provider_error` and is not our balance.
 */
const UNFUNDED_TYPES = new Set(['no_credits', 'insufficient_credits', 'api_key_limit_exceeded', 'no_limit_configured', 'insufficient_quota', 'billing_hard_limit_reached', 'payment_required']);
const UNAUTHORIZED_TYPES = new Set(['authentication_error', 'invalid_api_key', 'invalid_auth_header', 'missing_auth_header', 'unauthorized', 'permission_error']);
const UNFUNDED_WORDS = /\b(balance|credits?|quota|insufficient|billing|payment|top[ -]?up|spend limit)\b/i;

interface ErrorBody {
  readonly type?: string;
  readonly code?: string;
  readonly message?: string;
}

/** Reads `{ error: { type, code, message } }` (OpenAI / NEAR AI) or `{ type, message }` from a response body. */
export function parseErrorBody(raw: string): ErrorBody {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { message: raw.slice(0, 300) };
  }
  if (!parsed || typeof parsed !== 'object') return {};
  const outer = parsed as Record<string, unknown>;
  const inner = outer.error && typeof outer.error === 'object' ? (outer.error as Record<string, unknown>) : outer;
  const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : undefined);
  return {
    type: str(inner.type),
    code: str(inner.code),
    message: str(inner.message) ?? (typeof outer.error === 'string' ? outer.error : undefined),
  };
}

function kindFromType(type: string | undefined): LlmFailureKind | null {
  if (!type) return null;
  const t = type.toLowerCase();
  if (UNFUNDED_TYPES.has(t)) return 'unfunded';
  if (UNAUTHORIZED_TYPES.has(t)) return 'unauthorized';
  if (t === 'rate_limit_exceeded' || t === 'rate_limit_error') return 'rate_limited';
  return null;
}

function kindFromStatus(status: number, body: ErrorBody): LlmFailureKind {
  const typed = (body.type ?? body.code)?.toLowerCase();
  if (status === 402) return typed === 'provider_error' ? 'server' : 'unfunded';
  if (status === 401 || status === 403) return 'unauthorized';
  if (status === 429) return UNFUNDED_WORDS.test(body.message ?? '') ? 'unfunded' : 'rate_limited';
  if (status === 408 || status === 504) return 'timeout';
  if (status >= 500) return 'server';
  return 'rejected';
}

/**
 * Classifies a non-200 NEAR AI Cloud reply by `error.type`, then `error.code`, then status, then message keywords
 * (an unknown 4xx whose message talks about balance / credit / quota is still `unfunded`).
 */
export function classifyNearAiFailure(status: number, rawBody: string): LlmProviderError {
  const body = parseErrorBody(rawBody);
  let kind = kindFromType(body.type) ?? kindFromType(body.code) ?? kindFromStatus(status, body);
  if (kind === 'rejected' && UNFUNDED_WORDS.test(body.message ?? '')) kind = 'unfunded';
  return new LlmProviderError(kind, `NEAR AI Cloud HTTP ${status}`, status, body.type ?? body.code);
}

/** Maps a thrown fetch / abort error. `callerAborted` = the caller's own signal fired (not a provider fault). */
export function classifyTransportError(err: unknown, timedOut: boolean, callerAborted: boolean): unknown {
  if (err instanceof LlmProviderError || callerAborted) return err;
  if (timedOut) return new LlmProviderError('timeout', 'NEAR AI Cloud request timed out');
  return new LlmProviderError('server', 'NEAR AI Cloud network error');
}

export interface LlmMessage { readonly role: 'user' | 'assistant'; readonly content: string }
export interface LlmRequest {
  readonly system: string;
  readonly messages: readonly LlmMessage[];
  readonly maxTokens: number;
  readonly temperature?: number;
  /** Ask for a JSON-only reply (the caller still validates it with zod). */
  readonly json?: boolean;
  /** Optional per-request model override (e.g. player-selected NEAR.AI model, defaults to z-ai/glm-5.3-flash). */
  readonly model?: string;
  /** Optional per-request NEAR.AI API key override (e.g. player-connected API key from /me). */
  readonly apiKey?: string;
  /** Cancels the provider call. A missing signal does not disable abort support. */
  readonly signal?: AbortSignal;
  /** Whole-call deadline in ms (adapter default 30 s); expiry is an `LlmProviderError('timeout')`. */
  readonly timeoutMs?: number;
}
export interface LlmAttestation {
  readonly chatId: string;
  readonly requestHash: string;
  readonly responseHash: string;
  readonly signingAddress?: string;
  readonly signature?: string;
  readonly signedText?: string;
  readonly signingAlgo?: 'ed25519' | 'ecdsa';
  readonly signatureKind?: 'provider_tee' | 'gateway' | 'legacy';
  readonly verified: boolean;
  /** True when `signature` was cryptographically verified (Ed25519 or EIP-191 secp256k1) against `signingAddress`. */
  readonly cryptoVerified?: boolean;
  /** Present when `NEAR_AI_TRUSTED_SIGNERS` pins allowed TEE enclave addresses/pubkeys. */
  readonly enclaveAllowlisted?: boolean;
}
export interface LlmResponse {
  readonly text: string;
  readonly usage: { readonly inputTokens: number; readonly outputTokens: number };
  readonly model: string;
  readonly attestation?: LlmAttestation;
}

export function isTeeAttestationRejected(
  attestation?: Pick<LlmAttestation, 'verified'> | null,
): boolean {
  return Boolean(attestation && attestation.verified === false);
}

/**
 * Why a provider call failed (AI §7 rules-only fallback). `unfunded`: the account or key has no balance / credit
 * (NEAR AI Cloud HTTP 402 `no_credits` | `insufficient_credits` | `api_key_limit_exceeded`); `unauthorized`: missing,
 * invalid or revoked key; `rate_limited`: 429; `timeout`: no reply in time; `server`: 5xx, network or upstream vendor
 * error; `bad_response`: a 200 the adapter cannot read; `rejected`: a 4xx about the request itself (never trips a circuit).
 */
export type LlmFailureKind = 'unfunded' | 'unauthorized' | 'rate_limited' | 'timeout' | 'server' | 'bad_response' | 'rejected';

/** A typed provider failure. `message` never contains the API key or the provider's response text. */
export class LlmProviderError extends Error {
  constructor(
    readonly kind: LlmFailureKind,
    message: string,
    readonly status?: number,
    /** Provider error type / code (`no_credits`, `rate_limit_exceeded`, …), when the body had one. */
    readonly providerType?: string,
  ) {
    super(message);
    this.name = 'LlmProviderError';
  }
}

/**
 * The guarded provider refused the call without any HTTP request: the key's circuit is open after `kind`
 * (`unfunded` / `unauthorized` for 15 min, else the 5-failure rule). Callers fall back to rules immediately.
 */
export class LlmProviderUnavailableError extends LlmProviderError {
  constructor(
    kind: LlmFailureKind,
    readonly scope: 'protocol' | 'byok',
    readonly retryAtMs: number,
  ) {
    super(kind, `LLM provider unavailable (${scope}: ${kind})`);
    this.name = 'LlmProviderUnavailableError';
  }
}

/** The typed failure behind `err`, or `null` when `err` is not a provider failure. */
export function llmFailureOf(err: unknown): LlmProviderError | null {
  return err instanceof LlmProviderError ? err : null;
}

export abstract class LlmProviderPort {
  abstract complete(req: LlmRequest): Promise<LlmResponse>;
}

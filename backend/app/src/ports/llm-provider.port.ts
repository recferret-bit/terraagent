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
}
export interface LlmAttestation {
  readonly chatId: string;
  readonly requestHash: string;
  readonly responseHash: string;
  readonly signingAddress?: string;
  readonly signature?: string;
  readonly signingAlgo?: 'ed25519' | 'ecdsa';
  readonly signatureKind?: 'provider_tee' | 'gateway' | 'legacy';
  readonly verified: boolean;
}
export interface LlmResponse {
  readonly text: string;
  readonly usage: { readonly inputTokens: number; readonly outputTokens: number };
  readonly model: string;
  readonly attestation?: LlmAttestation;
}

export abstract class LlmProviderPort {
  abstract complete(req: LlmRequest): Promise<LlmResponse>;
}

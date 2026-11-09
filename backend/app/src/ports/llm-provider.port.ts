export interface LlmMessage { readonly role: 'user' | 'assistant'; readonly content: string }
export interface LlmRequest {
  readonly system: string;
  readonly messages: readonly LlmMessage[];
  readonly maxTokens: number;
  readonly temperature?: number;
  /** Ask for a JSON-only reply (the caller still validates it with zod). */
  readonly json?: boolean;
  /** Cancels the provider call. A missing signal does not disable abort support. */
  readonly signal?: AbortSignal;
}
export interface LlmResponse {
  readonly text: string;
  readonly usage: { readonly inputTokens: number; readonly outputTokens: number };
  readonly model: string;
}

export abstract class LlmProviderPort {
  abstract complete(req: LlmRequest): Promise<LlmResponse>;
}

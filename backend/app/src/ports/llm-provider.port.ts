export interface LlmMessage { readonly role: 'user' | 'assistant'; readonly content: string }
export interface LlmRequest {
  readonly system: string;
  readonly messages: readonly LlmMessage[];
  readonly maxTokens: number;
  readonly temperature?: number;
  /** Ask for a JSON-only reply (the caller still validates it with zod). */
  readonly json?: boolean;
}
export interface LlmResponse {
  readonly text: string;
  readonly usage: { readonly inputTokens: number; readonly outputTokens: number };
  readonly model: string;
}

export abstract class LlmProviderPort {
  abstract complete(req: LlmRequest): Promise<LlmResponse>;
}

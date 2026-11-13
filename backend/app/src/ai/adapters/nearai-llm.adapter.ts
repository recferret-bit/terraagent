import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { adapterOf } from '../../ports/adapters.js';
import {
  LlmProviderPort,
  type LlmAttestation,
  type LlmRequest,
  type LlmResponse,
} from '../../ports/llm-provider.port.js';
import {
  DEFAULT_NEAR_AI_BASE,
  DEFAULT_NEAR_AI_MODEL,
  NEAR_AI_MODELS,
  normalizeNearAiModel,
} from '../nearai-models.js';

export { DEFAULT_NEAR_AI_BASE, DEFAULT_NEAR_AI_MODEL, NEAR_AI_MODELS, normalizeNearAiModel };
export const NEAR_AI_KEY_MISSING = 'NEAR_AI_API_KEY is not set';

export type FetchLike = typeof globalThis.fetch;

export function nearAiKey(env: Readonly<Record<string, string | undefined>>): string {
  const key = env.NEAR_AI_API_KEY || env.NEARAI_API_KEY || env.NEARAI_CLOUD_API_KEY;
  if (!key) throw new Error(NEAR_AI_KEY_MISSING);
  return key;
}

export function usageFrom(
  raw: { inputTokens?: number; outputTokens?: number } | undefined,
): LlmResponse['usage'] {
  const inputTokens = raw?.inputTokens;
  const outputTokens = raw?.outputTokens;
  if (typeof inputTokens !== 'number' || typeof outputTokens !== 'number') {
    throw new Error('NEAR AI response usage missing numeric inputTokens/outputTokens');
  }
  return { inputTokens, outputTokens };
}

export function sha256Hex(payload: string): string {
  return createHash('sha256').update(payload, 'utf8').digest('hex');
}

interface RawChatCompletion {
  id?: string;
  model?: string;
  choices?: Array<{ message?: { content?: string | null } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; inputTokens?: number; outputTokens?: number };
}

interface RawSignaturePayload {
  text?: string;
  signature?: string;
  signing_address?: string;
  signing_algo?: string;
  signature_kind?: string;
}

function parseCompletionJson(rawBody: string): RawChatCompletion {
  try {
    return JSON.parse(rawBody) as RawChatCompletion;
  } catch {
    throw new Error('NEAR AI Cloud returned non-JSON response');
  }
}

export function verifySignatureHashes(
  sig: RawSignaturePayload,
  modelId: string,
  requestHash: string,
  responseHash: string,
): { verified: boolean; kind: 'provider_tee' | 'gateway' | 'legacy' } {
  const text = typeof sig.text === 'string' ? sig.text : '';
  const hasSig = typeof sig.signature === 'string' && sig.signature.length > 0;
  const hasAddr = typeof sig.signing_address === 'string' && sig.signing_address.length > 0;
  if (!text || !hasSig || !hasAddr) return { verified: false, kind: 'legacy' };

  const providerExpected = `${modelId}:${requestHash}:${responseHash}`;
  const gatewayExpected = `${requestHash}:${responseHash}`;
  if (text === providerExpected) {
    const kind = sig.signature_kind === 'gateway' ? 'gateway' : 'provider_tee';
    return { verified: true, kind };
  }
  if (text === gatewayExpected) {
    return { verified: true, kind: sig.signature_kind === 'provider_tee' ? 'provider_tee' : 'gateway' };
  }
  return { verified: false, kind: 'legacy' };
}

async function fetchAttestationSignature(
  fetchImpl: FetchLike,
  baseUrl: string,
  key: string,
  chatId: string,
  modelId: string,
  requestHash: string,
  responseHash: string,
  signal?: AbortSignal,
): Promise<LlmAttestation> {
  const algo: 'ecdsa' | 'ed25519' = 'ecdsa';
  const url = `${baseUrl.replace(/\/+$/, '')}/signature/${encodeURIComponent(chatId)}?model=${encodeURIComponent(modelId)}&signing_algo=${algo}`;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const res = await fetchImpl(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
        signal,
      });
      if (!res.ok) continue;
      const sig = (await res.json()) as RawSignaturePayload;
      const check = verifySignatureHashes(sig, modelId, requestHash, responseHash);
      return {
        chatId,
        requestHash,
        responseHash,
        signingAddress: sig.signing_address,
        signature: sig.signature,
        signingAlgo: sig.signing_algo === 'ed25519' ? 'ed25519' : 'ecdsa',
        signatureKind: check.kind,
        verified: check.verified,
      };
    } catch {
      break;
    }
  }
  return { chatId, requestHash, responseHash, verified: false };
}

@Injectable()
export class NearAiLlmAdapter extends LlmProviderPort {
  private readonly fetchImpl: FetchLike;

  constructor(fetchImpl?: FetchLike) {
    super();
    this.fetchImpl = fetchImpl ?? globalThis.fetch;
  }

  async complete(req: LlmRequest, env: Readonly<Record<string, string | undefined>> = process.env): Promise<LlmResponse> {
    const key = req.apiKey?.trim() || nearAiKey(env);
    const baseUrl = (env.NEAR_AI_BASE_URL || env.NEARAI_BASE_URL || env.AI_BASE_URL || DEFAULT_NEAR_AI_BASE).replace(/\/+$/, '');
    const modelId = normalizeNearAiModel(req.model || env.NEAR_AI_MODEL || env.NEARAI_MODEL || env.AI_MODEL || DEFAULT_NEAR_AI_MODEL);
    const messages = [
      ...(req.system ? [{ role: 'system' as const, content: req.system }] : []),
      ...req.messages.map((m) => ({ role: m.role, content: m.content })),
    ];
    const bodyObj: Record<string, unknown> = {
      model: modelId,
      messages,
      max_tokens: req.maxTokens,
      stream: false,
      ...(typeof req.temperature === 'number' ? { temperature: req.temperature } : {}),
      ...(req.json ? { response_format: { type: 'json_object' } } : {}),
    };
    const requestBody = JSON.stringify(bodyObj);
    const requestHash = sha256Hex(requestBody);

    const res = await this.fetchImpl(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: requestBody,
      signal: req.signal,
    });
    if (!res.ok) {
      throw new Error(`NEAR AI Cloud HTTP ${res.status}`);
    }
    const responseBody = await res.text();
    const responseHash = sha256Hex(responseBody);
    const parsed = parseCompletionJson(responseBody);
    const text = parsed.choices?.[0]?.message?.content ?? '';
    const usage = usageFrom({
      inputTokens: parsed.usage?.prompt_tokens ?? parsed.usage?.inputTokens,
      outputTokens: parsed.usage?.completion_tokens ?? parsed.usage?.outputTokens,
    });
    const chatId = parsed.id || '';
    const attestation =
      chatId && env.NEAR_AI_ATTEST !== '0'
        ? await fetchAttestationSignature(
            this.fetchImpl,
            baseUrl,
            key,
            chatId,
            modelId,
            requestHash,
            responseHash,
            req.signal,
          )
        : chatId
          ? { chatId, requestHash, responseHash, verified: false }
          : undefined;

    return { text, usage, model: parsed.model || modelId, ...(attestation ? { attestation } : {}) };
  }
}

export const adapter = adapterOf({ port: LlmProviderPort, kind: 'nearai', useClass: NearAiLlmAdapter });

import { createHash } from 'node:crypto';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { APP_ENV, type AppEnv } from '../../core/tokens.js';
import { adapterOf } from '../../ports/adapters.js';
import {
  LlmProviderError,
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
import {
  evaluateTeeAttestation,
  verifyCryptographicSignature,
  verifySignatureHashes,
  type RawSignaturePayload,
} from './nearai-signature.js';
import { classifyNearAiFailure, classifyTransportError } from './nearai-errors.js';

export {
  DEFAULT_NEAR_AI_BASE,
  DEFAULT_NEAR_AI_MODEL,
  NEAR_AI_MODELS,
  normalizeNearAiModel,
  verifyCryptographicSignature,
  verifySignatureHashes,
};
export const NEAR_AI_KEY_MISSING = 'NEAR_AI_API_KEY is not set';
/** Whole request budget (completion + attestation signature) unless the request names its own `timeoutMs`. */
export const NEAR_AI_TIMEOUT_MS = 30_000;

export type FetchLike = typeof globalThis.fetch;

export function nearAiKey(env: Readonly<Record<string, string | undefined>>): string {
  const key = env.NEAR_AI_API_KEY || env.NEARAI_API_KEY || env.NEARAI_CLOUD_API_KEY;
  if (!key) throw new LlmProviderError('unauthorized', NEAR_AI_KEY_MISSING);
  return key;
}

export function usageFrom(
  raw: { inputTokens?: number; outputTokens?: number } | undefined,
): LlmResponse['usage'] {
  const inputTokens = raw?.inputTokens;
  const outputTokens = raw?.outputTokens;
  if (typeof inputTokens !== 'number' || typeof outputTokens !== 'number') {
    throw new LlmProviderError('bad_response', 'NEAR AI response usage missing numeric inputTokens/outputTokens');
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

function parseCompletionJson(rawBody: string): RawChatCompletion {
  try {
    return JSON.parse(rawBody) as RawChatCompletion;
  } catch {
    throw new LlmProviderError('bad_response', 'NEAR AI Cloud returned non-JSON response');
  }
}

function resolveSigningAlgo(env: Readonly<Record<string, string | undefined>>): 'ecdsa' | 'ed25519' {
  return env.NEAR_AI_SIGNING_ALGO?.trim().toLowerCase() === 'ed25519' ? 'ed25519' : 'ecdsa';
}

async function fetchAttestationSignature(params: {
  readonly fetchImpl: FetchLike;
  readonly baseUrl: string;
  readonly key: string;
  readonly chatId: string;
  readonly modelId: string;
  readonly responseModelId?: string;
  readonly requestHash: string;
  readonly responseHash: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly signal?: AbortSignal;
}): Promise<LlmAttestation> {
  const { fetchImpl, baseUrl, key, chatId, modelId, responseModelId, requestHash, responseHash, env, signal } = params;
  const algo = resolveSigningAlgo(env);
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
      return evaluateTeeAttestation({
        sig,
        chatId,
        modelId,
        responseModelId,
        requestHash,
        responseHash,
        requestedAlgo: algo,
        env,
      });
    } catch {
      break;
    }
  }
  return { chatId, requestHash, responseHash, verified: false };
}

interface RequestTimer {
  readonly signal: AbortSignal;
  timedOut(): boolean;
  clear(): void;
}

/** One abort signal for the whole call: fires on the caller's signal or after `ms`. */
function requestTimer(caller: AbortSignal | undefined, ms: number): RequestTimer {
  const ctl = new AbortController();
  let fired = false;
  const timer = setTimeout(() => {
    fired = true;
    ctl.abort(new Error('timeout'));
  }, ms);
  timer.unref?.();
  const onCaller = (): void => ctl.abort(caller?.reason);
  if (caller?.aborted) onCaller();
  else caller?.addEventListener('abort', onCaller, { once: true });
  return {
    signal: ctl.signal,
    timedOut: () => fired,
    clear: () => {
      clearTimeout(timer);
      caller?.removeEventListener('abort', onCaller);
    },
  };
}

function glmReasoningControl(modelId: string, env: Readonly<Record<string, string | undefined>>): Record<string, unknown> {
  if (env.NEAR_AI_THINKING === '1') return {};
  if (modelId.startsWith('z-ai/glm-5')) return { reasoning_effort: 'low' };
  return {};
}

@Injectable()
export class NearAiLlmAdapter extends LlmProviderPort {
  private readonly fetchImpl: FetchLike;
  private readonly defaultEnv?: AppEnv;

  constructor(
    @Optional() fetchImpl?: FetchLike,
    @Optional() @Inject(APP_ENV) defaultEnv?: AppEnv,
  ) {
    super();
    this.fetchImpl = fetchImpl ?? globalThis.fetch;
    this.defaultEnv = defaultEnv;
  }

  async complete(req: LlmRequest, env?: Readonly<Record<string, string | undefined>>): Promise<LlmResponse> {
    const resolvedEnv =
      env ??
      ({ ...(this.defaultEnv as Record<string, string | undefined> | undefined), ...process.env } as Readonly<
        Record<string, string | undefined>
      >);
    const key = req.apiKey?.trim() || nearAiKey(resolvedEnv);
    const timer = requestTimer(req.signal, req.timeoutMs ?? NEAR_AI_TIMEOUT_MS);
    try {
      return await this.send(req, resolvedEnv, key, timer.signal);
    } catch (err) {
      throw classifyTransportError(err, timer.timedOut(), Boolean(req.signal?.aborted));
    } finally {
      timer.clear();
    }
  }

  private async send(
    req: LlmRequest,
    resolvedEnv: Readonly<Record<string, string | undefined>>,
    key: string,
    signal: AbortSignal,
  ): Promise<LlmResponse> {
    const baseUrl = (
      resolvedEnv.NEAR_AI_BASE_URL ||
      resolvedEnv.NEARAI_BASE_URL ||
      resolvedEnv.AI_BASE_URL ||
      DEFAULT_NEAR_AI_BASE
    ).replace(/\/+$/, '');
    const modelId = normalizeNearAiModel(
      req.model || resolvedEnv.NEAR_AI_MODEL || resolvedEnv.NEARAI_MODEL || resolvedEnv.AI_MODEL || DEFAULT_NEAR_AI_MODEL,
    );
    const requestBody = JSON.stringify(requestBodyOf(req, modelId, resolvedEnv));
    const requestHash = sha256Hex(requestBody);

    const res = await this.fetchImpl(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: requestBody,
      signal,
    });
    if (!res.ok) {
      throw classifyNearAiFailure(res.status, await res.text().catch(() => ''));
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
      chatId && resolvedEnv.NEAR_AI_ATTEST !== '0'
        ? await fetchAttestationSignature({
            fetchImpl: this.fetchImpl,
            baseUrl,
            key,
            chatId,
            modelId,
            responseModelId: parsed.model,
            requestHash,
            responseHash,
            env: resolvedEnv,
            signal,
          })
        : chatId
          ? { chatId, requestHash, responseHash, verified: false }
          : undefined;

    return { text, usage, model: parsed.model || modelId, ...(attestation ? { attestation } : {}) };
  }
}

function requestBodyOf(
  req: LlmRequest,
  modelId: string,
  env: Readonly<Record<string, string | undefined>>,
): Record<string, unknown> {
  const messages = [
    ...(req.system ? [{ role: 'system' as const, content: req.system }] : []),
    ...req.messages.map((m) => ({ role: m.role, content: m.content })),
  ];
  return {
    model: modelId,
    messages,
    max_tokens: req.maxTokens,
    stream: false,
    ...(typeof req.temperature === 'number' ? { temperature: req.temperature } : {}),
    ...(req.json ? { response_format: { type: 'json_object' } } : {}),
    ...glmReasoningControl(modelId, env),
  };
}

export const adapter = adapterOf({ port: LlmProviderPort, kind: 'nearai', useClass: NearAiLlmAdapter });

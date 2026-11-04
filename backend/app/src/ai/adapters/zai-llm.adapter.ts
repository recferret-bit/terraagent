import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { generateText } from 'ai';
import { Injectable } from '@nestjs/common';
import { adapterOf } from '../../ports/adapters.js';
import { LlmProviderPort, type LlmRequest, type LlmResponse } from '../../ports/llm-provider.port.js';

export const ZAI_KEY_MISSING = 'ZAI_API_KEY is not set';
const DEFAULT_BASE = 'https://api.z.ai/api/paas/v4';
const DEFAULT_MODEL = 'glm-5.3';

export function zaiKey(env: Readonly<Record<string, string | undefined>>): string {
  const key = env.ZAI_API_KEY;
  if (!key) throw new Error(ZAI_KEY_MISSING);
  return key;
}

/** Missing usage is an error so the caller keeps the token reservation (AI-04). */
export function usageFrom(raw: { inputTokens?: number; outputTokens?: number } | undefined): LlmResponse['usage'] {
  if (!raw || typeof raw.inputTokens !== 'number' || typeof raw.outputTokens !== 'number') {
    throw new Error('provider usage missing');
  }
  return { inputTokens: raw.inputTokens, outputTokens: raw.outputTokens };
}

@Injectable()
export class ZaiLlmAdapter extends LlmProviderPort {
  async complete(req: LlmRequest, env: Readonly<Record<string, string | undefined>> = process.env): Promise<LlmResponse> {
    const key = zaiKey(env);
    const provider = createOpenAICompatible({
      name: 'zai',
      baseURL: env.AI_BASE_URL || DEFAULT_BASE,
      apiKey: key,
    });
    const modelId = env.AI_MODEL || DEFAULT_MODEL;
    const result = await generateText({
      model: provider.chatModel(modelId),
      system: req.system,
      messages: req.messages.map((message) => ({ role: message.role, content: message.content })),
      maxOutputTokens: req.maxTokens,
      abortSignal: req.signal,
    });
    return { text: result.text, usage: usageFrom(result.usage), model: modelId };
  }
}

export const adapter = adapterOf({ port: LlmProviderPort, kind: 'zai', useClass: ZaiLlmAdapter });

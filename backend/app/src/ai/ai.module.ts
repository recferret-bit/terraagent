import { z } from 'zod';
import { fileURLToPath } from 'node:url';
import { LlmProviderPort } from '../ports/llm-provider.port.js';
import { discoverAdapters } from '../ports/adapters.js';
import { bindPorts } from '../ports/binding.js';
import { guardedEnv } from '../ports/prod-guard.js';
import { aiProvider } from './ai-selection.js';

export const aiAdapters = await discoverAdapters(fileURLToPath(new URL('./adapters/', import.meta.url)));

export const env = guardedEnv('ai', { AI_PROVIDER: z.string().optional(), AI_LIVE: z.string().optional() }, 'AI_ALLOW_MOCK_IN_PROD',
  [{ name: 'LlmProvider', token: LlmProviderPort, key: 'AI_PROVIDER', kind: aiProvider }], aiAdapters);

/** Binds `LlmProviderPort` to the adapter selected by `AI_PROVIDER` (the only importer of `ai/adapters`). */
export const AiModule = bindPorts('AiModule', [{ name: 'LlmProvider', token: LlmProviderPort, select: (e) => aiProvider(e as Record<string, string>) }], aiAdapters);

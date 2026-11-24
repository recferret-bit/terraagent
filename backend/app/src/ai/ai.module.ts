import { z } from 'zod';
import { fileURLToPath } from 'node:url';
import type { Logger } from 'pino';
import { MetricsRegistry } from '../core/metrics.registry.js';
import { LOGGER } from '../core/tokens.js';
import { LlmProviderPort } from '../ports/llm-provider.port.js';
import { discoverAdapters } from '../ports/adapters.js';
import { bindPorts } from '../ports/binding.js';
import { guardedEnv } from '../ports/prod-guard.js';
import { aiProvider } from './ai-selection.js';
import { GuardedLlmProvider } from './provider/guarded-llm.js';
import { providerHealth } from './provider/provider-health.js';
import { providerTelemetry } from './provider/provider-telemetry.js';

/** Internal token for the raw selected adapter; every consumer gets the guarded `LlmProviderPort` instead. */
export abstract class RawLlmProvider extends LlmProviderPort {}

export const aiAdapters = await discoverAdapters(fileURLToPath(new URL('./adapters/', import.meta.url)));

export const env = guardedEnv(
  'ai',
  {
    AI_PROVIDER: z.string().optional(),
    AI_LIVE: z.string().optional(),
    NEAR_AI_API_KEY: z.string().optional(),
    NEARAI_API_KEY: z.string().optional(),
    NEARAI_CLOUD_API_KEY: z.string().optional(),
    NEAR_AI_MODEL: z.string().optional(),
    NEARAI_MODEL: z.string().optional(),
    AI_MODEL: z.string().optional(),
    NEAR_AI_BASE_URL: z.string().optional(),
    NEARAI_BASE_URL: z.string().optional(),
    AI_BASE_URL: z.string().optional(),
    NEAR_AI_ATTEST: z.string().optional(),
    NEAR_AI_THINKING: z.string().optional(),
    NEAR_AI_SIGNING_ALGO: z.string().optional(),
    NEAR_AI_STRICT_CRYPTO_VERIFY: z.string().optional(),
    NEAR_AI_TRUSTED_SIGNERS: z.string().optional(),
    TA_DEV_AUTO_FUND_AI_TRADES: z.string().optional(),
    TA_ALLOW_PUBLIC_LIVE_SIM_LLM: z.string().optional(),
  },
  'AI_ALLOW_MOCK_IN_PROD',
  [{ name: 'LlmProvider', token: LlmProviderPort, key: 'AI_PROVIDER', kind: aiProvider }],
  aiAdapters,
);

/**
 * Binds `LlmProviderPort` to the adapter selected by `AI_PROVIDER` (the only importer of `ai/adapters`), wrapped in
 * `GuardedLlmProvider` so every caller shares the per-key provider circuits (AI §7) and their telemetry.
 */
export const AiModule = bindPorts(
  'AiModule',
  [{ name: 'LlmProvider', token: RawLlmProvider, select: (e) => aiProvider(e as Record<string, string>) }],
  aiAdapters.map((a) => (a.port === LlmProviderPort ? { ...a, port: RawLlmProvider } : a)),
  {
    providers: [
      {
        provide: LlmProviderPort,
        inject: [RawLlmProvider, { token: MetricsRegistry, optional: true }, { token: LOGGER, optional: true }],
        useFactory: (raw: LlmProviderPort, metrics?: MetricsRegistry, log?: Logger) => {
          providerHealth.setObserver(providerTelemetry(metrics?.registry, log?.child({ layer: 'infra', component: 'ai-provider' })));
          return new GuardedLlmProvider(raw, providerHealth);
        },
      },
    ],
    exports: [LlmProviderPort],
  },
);

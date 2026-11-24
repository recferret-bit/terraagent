import type { Logger } from 'pino';
import { Counter, Gauge, type Registry } from 'prom-client';
import type { ProviderHealthObserver, ProviderScope } from './provider-health.js';

export const PROVIDER_STATE_METRIC = 'ta_ai_provider_state';
export const FALLBACK_DECISIONS_METRIC = 'ta_ai_fallback_decisions_total';

function gauge(registry: Registry): Gauge<'key'> {
  const existing = registry.getSingleMetric(PROVIDER_STATE_METRIC) as Gauge<'key'> | undefined;
  return (
    existing ??
    new Gauge({
      name: PROVIDER_STATE_METRIC,
      help: 'Open AI provider circuits: protocol = 1 when the server key is open, byok = open player keys',
      labelNames: ['key'],
      registers: [registry],
    })
  );
}

function counter(registry: Registry): Counter<'reason'> {
  const existing = registry.getSingleMetric(FALLBACK_DECISIONS_METRIC) as Counter<'reason'> | undefined;
  return (
    existing ??
    new Counter({
      name: FALLBACK_DECISIONS_METRIC,
      help: 'Colony decisions that fell back to the rule-based policy, by reason',
      labelNames: ['reason'],
      registers: [registry],
    })
  );
}

/**
 * Health observer: one pino line and a gauge update per circuit state change (never per call), plus the fallback
 * decision counter. The key id is a SHA-256 prefix, never the key.
 */
export function providerTelemetry(registry: Registry | undefined, log: Logger | undefined): ProviderHealthObserver {
  const state = registry ? gauge(registry) : undefined;
  const fallbacks = registry ? counter(registry) : undefined;
  for (const key of ['protocol', 'byok'] as const) state?.set({ key }, 0);
  return {
    onStateChange(change, openKeys: Readonly<Record<ProviderScope, number>>) {
      for (const key of ['protocol', 'byok'] as const) state?.set({ key }, openKeys[key]);
      const fields = { key: change.scope, keyId: change.keyId, kind: change.kind, retryAtMs: change.retryAtMs };
      if (change.state === 'open') log?.warn(fields, 'ai provider circuit open: colonies fall back to rules');
      else log?.info(fields, 'ai provider circuit closed: AI decisions resume');
    },
    onOpenKeys(openKeys: Readonly<Record<ProviderScope, number>>) {
      for (const key of ['protocol', 'byok'] as const) state?.set({ key }, openKeys[key]);
    },
    onFallback(reason, decisions) {
      fallbacks?.inc({ reason }, decisions);
    },
  };
}

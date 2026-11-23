import {
  LlmProviderError,
  LlmProviderPort,
  LlmProviderUnavailableError,
  type LlmRequest,
  type LlmResponse,
} from '../../ports/llm-provider.port.js';
import { providerHealth, type CallOutcome, type ProviderHealth } from './provider-health.js';

/** Any thrown value as a typed failure (an untyped throw from an adapter counts as `server`). */
export function toProviderError(err: unknown): LlmProviderError {
  if (err instanceof LlmProviderError) return err;
  const name = err instanceof Error ? err.name : '';
  if (name === 'TimeoutError') return new LlmProviderError('timeout', 'LLM provider timed out');
  return new LlmProviderError('server', 'LLM provider call failed');
}

/**
 * Port decorator around the selected adapter (AI §7): one circuit per key fingerprint (protocol key vs each BYOK
 * key). While a key's circuit is open no HTTP call is made: `complete` rejects with `LlmProviderUnavailableError`
 * and callers fall back to the rule-based policy at once. Failures are rethrown as `LlmProviderError`.
 */
export class GuardedLlmProvider extends LlmProviderPort {
  constructor(
    private readonly inner: LlmProviderPort,
    readonly health: ProviderHealth = providerHealth,
  ) {
    super();
  }

  async complete(req: LlmRequest): Promise<LlmResponse> {
    const gate = this.health.acquire(req.apiKey);
    if (!gate.available) throw new LlmProviderUnavailableError(gate.kind, gate.scope, gate.retryAtMs);
    let outcome: CallOutcome = 'neutral';
    try {
      const res = await this.inner.complete(req);
      outcome = null;
      return res;
    } catch (err) {
      if (req.signal?.aborted) throw err;
      const typed = toProviderError(err);
      outcome = typed;
      throw typed;
    } finally {
      this.health.settle(req.apiKey, outcome);
    }
  }
}

/** The health registry behind `llm` (the process one unless `llm` is a guard with its own). */
export function healthOf(llm: LlmProviderPort): ProviderHealth {
  return llm instanceof GuardedLlmProvider ? llm.health : providerHealth;
}

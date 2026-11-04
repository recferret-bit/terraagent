import type { MockChainConfig } from './mock-chain.config.js';

interface LatencyOverride {
  readonly minMs: number;
  readonly maxMs: number;
}

/**
 * Process-wide mock-chain knobs for `near.mock.fail` and `near.mock.latency`.
 * One object, not a Nest provider: every `MockChainBase` reads it.
 * An unset port returns `base` unchanged, so a test that passes its own config keeps that fail rate
 * until something calls `setFail` or `setLatency` for that port. `setFail(port, 0)` stores 0 (it does
 * not delete the override), so it forces success even when the base rate is 1. `reset()` drops every override.
 */
class MockChainControls {
  private readonly failRates = new Map<string, number>();
  private readonly latencies = new Map<string, LatencyOverride>();

  setFail(port: string, rate: number): void {
    if (typeof rate !== 'number' || !Number.isFinite(rate) || rate < 0 || rate > 1) {
      throw new Error(`fail rate must be 0..1, got ${String(rate)}`);
    }
    this.failRates.set(portKey(port), rate);
  }

  setLatency(port: string, minMs: number, maxMs: number): void {
    if (!isLatencyBound(minMs) || !isLatencyBound(maxMs)) throw new Error('latency bounds must be integers >= 0');
    if (maxMs < minMs) throw new Error(`maxMs (${maxMs}) must be >= minMs (${minMs})`);
    this.latencies.set(portKey(port), { minMs, maxMs });
  }

  /** Case-insensitive port (`relayer` matches `Relayer`). No override → the same `base` object. */
  overlay(port: string, base: MockChainConfig): MockChainConfig {
    const failRate = this.failRates.get(portKey(port));
    const latency = this.latencies.get(portKey(port));
    if (failRate === undefined && latency === undefined) return base;
    return {
      ...base,
      ...(failRate === undefined ? {} : { failRate }),
      ...(latency === undefined ? {} : { latencyMinMs: latency.minMs, latencyMaxMs: latency.maxMs }),
    };
  }

  reset(): void {
    this.failRates.clear();
    this.latencies.clear();
  }
}

function portKey(port: string): string {
  const lower = port.toLowerCase();
  return lower === 'cargotoken' ? 'cargo' : lower;
}

function isLatencyBound(ms: number): boolean {
  return Number.isInteger(ms) && ms >= 0;
}

export const mockChainControls = new MockChainControls();

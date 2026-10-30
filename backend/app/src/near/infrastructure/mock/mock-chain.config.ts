import { defineEnv, parseEnv } from '@terra/config';
import { z } from 'zod';

/** Env of the mock chain (NEAR §1a rule 4). Read with `parseMockChainConfig`. */
export const mockChainEnv = defineEnv('mock-chain', {
  MOCK_LATENCY_MIN_MS: z.coerce.number().int().min(0).default(300),
  MOCK_LATENCY_MAX_MS: z.coerce.number().int().min(0).default(1500),
  /** Probability 0..1 that a mock call throws `NEAR_MOCK_INJECTED_FAILURE`. */
  MOCK_FAIL_RATE: z.coerce.number().min(0).max(1).default(0),
  /** Seeds the latency/failure/hash randomness for reproducible tests; unset = `Math.random`/crypto. */
  MOCK_SEED: z.coerce.number().int().optional(),
});

export interface MockChainConfig {
  readonly latencyMinMs: number;
  readonly latencyMaxMs: number;
  readonly failRate: number;
  readonly seed?: number;
}

export function parseMockChainConfig(source: Record<string, string | undefined> = process.env): MockChainConfig {
  const e = parseEnv([mockChainEnv], source) as Record<string, unknown>;
  const min = e.MOCK_LATENCY_MIN_MS as number;
  const max = e.MOCK_LATENCY_MAX_MS as number;
  if (max < min) throw new Error(`MOCK_LATENCY_MAX_MS (${max}) must be >= MOCK_LATENCY_MIN_MS (${min})`);
  return { latencyMinMs: min, latencyMaxMs: max, failRate: e.MOCK_FAIL_RATE as number, seed: e.MOCK_SEED as number | undefined };
}

/** mulberry32: small seeded PRNG returning [0,1). */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

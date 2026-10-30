import type { PrismaClient } from '@terra/db';
import { describe, expect, it } from 'vitest';
import { CoreException } from '../../src/core/errors';
import { MOCK_HASH_RE, mockTxHashFor, randomMockTxHash } from '../../src/near/infrastructure/mock/tx-hash';
import { parseMockChainConfig, seededRandom } from '../../src/near/infrastructure/mock/mock-chain.config';
import { FixtureMock } from './fixture-mock';

const cfg = (over: Partial<ReturnType<typeof parseMockChainConfig>> = {}) => ({ latencyMinMs: 300, latencyMaxMs: 1500, failRate: 0, ...over });
const fake = {} as PrismaClient; // never touched on the failure / latency paths (no opId)

describe('mock tx hashes', () => {
  it('are mock: + 44 base58 chars, deterministic per opId', () => {
    expect(mockTxHashFor('a:1')).toMatch(MOCK_HASH_RE);
    expect(mockTxHashFor('a:1')).toBe(mockTxHashFor('a:1'));
    expect(mockTxHashFor('a:1')).not.toBe(mockTxHashFor('a:2'));
    expect(randomMockTxHash(seededRandom(1))).toMatch(MOCK_HASH_RE);
  });
});

describe('config', () => {
  it('defaults to 300-1500 ms and rate 0, validates the rate', () => {
    expect(parseMockChainConfig({})).toMatchObject({ latencyMinMs: 300, latencyMaxMs: 1500, failRate: 0 });
    expect(() => parseMockChainConfig({ MOCK_FAIL_RATE: '2' })).toThrow();
    expect(() => parseMockChainConfig({ MOCK_LATENCY_MIN_MS: '900', MOCK_LATENCY_MAX_MS: '100' })).toThrow();
  });
});

describe('latency and failure injection', () => {
  it('sleeps within the configured bounds', async () => {
    const slept: number[] = [];
    const m = new FixtureMock(fake, cfg({ failRate: 1, seed: 7 }), { sleep: async (ms) => void slept.push(ms) });
    for (let i = 0; i < 200; i++) await m.fund(undefined, 'a.near', 'NEAR', '1').catch(() => undefined);
    expect(slept).toHaveLength(200);
    expect(Math.min(...slept)).toBeGreaterThanOrEqual(300);
    expect(Math.max(...slept)).toBeLessThanOrEqual(1500);
  });
  it('MOCK_FAIL_RATE=1 throws the documented CoreException', async () => {
    const m = new FixtureMock(fake, cfg({ failRate: 1 }), { sleep: async () => undefined });
    const err = await m.fund(undefined, 'a.near', 'NEAR', '1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CoreException);
    expect(err).toMatchObject({ errorCode: 'NEAR_MOCK_INJECTED_FAILURE', status: 503 });
  });
});

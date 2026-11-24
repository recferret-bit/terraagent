import 'reflect-metadata';
import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Registry } from 'prom-client';
import { describe, expect, it, vi } from 'vitest';
import { NearAiLlmAdapter, type FetchLike } from '../../src/ai/adapters/nearai-llm.adapter.js';
import { AiModule } from '../../src/ai/ai.module.js';
import { GuardedLlmProvider } from '../../src/ai/provider/guarded-llm.js';
import { BYOK_FORGET_MS, HARD_OPEN_MS, keyIdOf, ProviderHealth, type ProviderHealthObserver } from '../../src/ai/provider/provider-health.js';
import { providerTelemetry } from '../../src/ai/provider/provider-telemetry.js';
import { APP_ENV } from '../../src/core/tokens.js';
import { LlmProviderError, LlmProviderPort, LlmProviderUnavailableError, type LlmRequest } from '../../src/ports/llm-provider.port.js';

const REQ: LlmRequest = { system: 's', messages: [{ role: 'user', content: 'ping' }], maxTokens: 8 };
const OK_BODY = JSON.stringify({ id: '', model: 'm', choices: [{ message: { content: '{}' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
const NO_CREDITS = JSON.stringify({ error: { message: 'No credits available.', type: 'no_credits' } });

/** A fake NEAR AI Cloud: each key answers with its own status; counts HTTP calls per key. */
function fakeCloud(statusByKey: Record<string, number>) {
  const calls: Record<string, number> = {};
  const fetchImpl: FetchLike = async (_url, init) => {
    const key = String((init?.headers as Record<string, string>).Authorization).replace('Bearer ', '');
    calls[key] = (calls[key] ?? 0) + 1;
    const status = statusByKey[key] ?? 200;
    if (status === 200) return new Response(OK_BODY, { status });
    return new Response(status === 402 ? NO_CREDITS : '{}', { status });
  };
  return { fetchImpl, calls, statusByKey };
}

function guarded(statusByKey: Record<string, number>) {
  let now = 1_000_000;
  const cloud = fakeCloud(statusByKey);
  const health = new ProviderHealth({ failuresToOpen: 5, openMs: 60_000 }, () => now);
  const changes: Parameters<ProviderHealthObserver['onStateChange']>[0][] = [];
  health.setObserver({ onStateChange: (c) => changes.push(c), onFallback: () => undefined });
  const inner = new NearAiLlmAdapter(cloud.fetchImpl, { NEAR_AI_API_KEY: 'protocol-key', NEAR_AI_ATTEST: '0' } as never);
  const llm = new GuardedLlmProvider(inner, health);
  return { llm, health, cloud, changes, advance: (ms: number) => (now += ms) };
}

describe('GuardedLlmProvider: per-key provider circuits', () => {
  it('402 zero balance: exactly one HTTP call, then none until the 15 min probe', async () => {
    const g = guarded({ 'protocol-key': 402 });
    await expect(g.llm.complete(REQ)).rejects.toMatchObject({ kind: 'unfunded' });
    for (let i = 0; i < 10; i++) {
      await expect(g.llm.complete(REQ)).rejects.toBeInstanceOf(LlmProviderUnavailableError);
      g.advance(60_000);
    }
    expect(g.cloud.calls['protocol-key']).toBe(1);
    expect(g.health.availability()).toMatchObject({ available: false, kind: 'unfunded', scope: 'protocol' });
    g.advance(HARD_OPEN_MS);
    // the probe fails again: one more call, then open for another 15 min
    await expect(g.llm.complete(REQ)).rejects.toMatchObject({ kind: 'unfunded' });
    await expect(g.llm.complete(REQ)).rejects.toBeInstanceOf(LlmProviderUnavailableError);
    expect(g.cloud.calls['protocol-key']).toBe(2);
    expect(g.changes.map((c) => c.state)).toEqual(['open']);
  });

  it('a successful probe closes the circuit and logs one close', async () => {
    const g = guarded({ 'protocol-key': 402 });
    await expect(g.llm.complete(REQ)).rejects.toMatchObject({ kind: 'unfunded' });
    g.cloud.statusByKey['protocol-key'] = 200;
    g.advance(HARD_OPEN_MS);
    await expect(g.llm.complete(REQ)).resolves.toMatchObject({ text: '{}' });
    await expect(g.llm.complete(REQ)).resolves.toMatchObject({ text: '{}' });
    expect(g.cloud.calls['protocol-key']).toBe(3);
    expect(g.changes.map((c) => [c.state, c.kind])).toEqual([['open', 'unfunded'], ['closed', undefined]]);
    expect(g.health.availability()).toEqual({ available: true });
  });

  it('only one caller gets the half-open probe while it is in flight', async () => {
    const health = new ProviderHealth({ failuresToOpen: 1, openMs: 1_000 }, () => 5_000);
    health.settle(undefined, new LlmProviderError('server', 'x'), 0);
    let release!: () => void;
    const inner = { complete: vi.fn(() => new Promise<never>((_r, reject) => (release = () => reject(new Error('down'))))) };
    const llm = new GuardedLlmProvider(inner as unknown as LlmProviderPort, health);
    const probe = llm.complete(REQ);
    await expect(llm.complete(REQ)).rejects.toBeInstanceOf(LlmProviderUnavailableError);
    release();
    await expect(probe).rejects.toMatchObject({ kind: 'server' });
    expect(inner.complete).toHaveBeenCalledTimes(1);
  });

  it('isolates keys: a drained BYOK key never blocks the protocol key or another player key', async () => {
    const g = guarded({ 'sk-drained': 402, 'sk-other': 200, 'protocol-key': 200 });
    await expect(g.llm.complete({ ...REQ, apiKey: 'sk-drained' })).rejects.toMatchObject({ kind: 'unfunded' });
    await expect(g.llm.complete({ ...REQ, apiKey: 'sk-drained' })).rejects.toMatchObject({ scope: 'byok' });
    await expect(g.llm.complete(REQ)).resolves.toBeTruthy();
    await expect(g.llm.complete({ ...REQ, apiKey: 'sk-other' })).resolves.toBeTruthy();
    expect(g.cloud.calls).toEqual({ 'sk-drained': 1, 'protocol-key': 1, 'sk-other': 1 });
    expect(g.health.openKeys()).toEqual({ protocol: 0, byok: 1 });
    expect(g.changes).toHaveLength(1);
    expect(g.changes[0]).toMatchObject({ scope: 'byok', keyId: keyIdOf('sk-drained') });
    expect(JSON.stringify(g.changes)).not.toContain('sk-drained');
  });

  it('401 opens for 15 min; 429 / 5xx use the 5-failure rule; 400 never trips', async () => {
    const g = guarded({ 'sk-bad': 401, 'sk-busy': 429, 'protocol-key': 400 });
    await expect(g.llm.complete({ ...REQ, apiKey: 'sk-bad' })).rejects.toMatchObject({ kind: 'unauthorized' });
    expect(g.health.availability('sk-bad')).toMatchObject({ available: false, kind: 'unauthorized' });
    for (let i = 0; i < 4; i++) await expect(g.llm.complete({ ...REQ, apiKey: 'sk-busy' })).rejects.toMatchObject({ kind: 'rate_limited' });
    expect(g.health.availability('sk-busy').available).toBe(true);
    await expect(g.llm.complete({ ...REQ, apiKey: 'sk-busy' })).rejects.toMatchObject({ kind: 'rate_limited' });
    expect(g.health.availability('sk-busy')).toMatchObject({ available: false, kind: 'rate_limited' });
    g.advance(60_000);
    expect(g.health.availability('sk-busy').available).toBe(true);
    for (let i = 0; i < 8; i++) await expect(g.llm.complete(REQ)).rejects.toMatchObject({ kind: 'rejected' });
    expect(g.cloud.calls['protocol-key']).toBe(8);
  });
});

describe('GuardedLlmProvider: recovery and stale keys', () => {
  it('a topped-up key whose probe hits a passing 429 is retried after the short window, not another 15 min', async () => {
    const g = guarded({ 'protocol-key': 402 });
    await expect(g.llm.complete(REQ)).rejects.toMatchObject({ kind: 'unfunded' });
    g.cloud.statusByKey['protocol-key'] = 429; // credits are back, the provider is briefly busy
    g.advance(HARD_OPEN_MS);
    await expect(g.llm.complete(REQ)).rejects.toMatchObject({ kind: 'rate_limited' });
    const state = g.health.availability();
    expect(state).toMatchObject({ available: false, kind: 'rate_limited' });
    expect(state.available === false && state.retryAtMs - (1_000_000 + HARD_OPEN_MS)).toBe(60_000);
    g.cloud.statusByKey['protocol-key'] = 200;
    g.advance(60_000);
    await expect(g.llm.complete(REQ)).resolves.toMatchObject({ text: '{}' });
    expect(g.health.availability()).toEqual({ available: true });
  });

  it('forgets player keys nobody used for an hour, so wrong keys cannot pile up as open forever', async () => {
    const statuses: Record<string, number> = { 'protocol-key': 200 };
    for (let i = 0; i < 50; i++) statuses[`sk-wrong-${i}`] = 401;
    const g = guarded(statuses);
    const gauge: Record<string, number>[] = [];
    g.health.setObserver({ onStateChange: () => undefined, onFallback: () => undefined, onOpenKeys: (k) => gauge.push({ ...k }) });
    for (let i = 0; i < 50; i++) await expect(g.llm.complete({ ...REQ, apiKey: `sk-wrong-${i}` })).rejects.toMatchObject({ kind: 'unauthorized' });
    expect(g.health.openKeys()).toEqual({ protocol: 0, byok: 50 });
    g.advance(BYOK_FORGET_MS + HARD_OPEN_MS);
    statuses['sk-good'] = 200;
    await expect(g.llm.complete({ ...REQ, apiKey: 'sk-good' })).resolves.toBeTruthy(); // a new key triggers the sweep
    expect(g.health.openKeys()).toEqual({ protocol: 0, byok: 0 });
    expect(gauge.at(-1)).toEqual({ protocol: 0, byok: 0 });
    // a key that is still inside its open window is kept
    await expect(g.llm.complete({ ...REQ, apiKey: 'sk-wrong-1' })).rejects.toMatchObject({ kind: 'unauthorized' });
    await expect(g.llm.complete({ ...REQ, apiKey: 'sk-newer' })).resolves.toBeTruthy();
    expect(g.health.openKeys()).toEqual({ protocol: 0, byok: 1 });
  });
});

describe('provider telemetry', () => {
  it('sets ta_ai_provider_state per state change and counts fallback decisions', async () => {
    const registry = new Registry();
    const log = { warn: vi.fn(), info: vi.fn() };
    const health = new ProviderHealth({ failuresToOpen: 5, openMs: 60_000 }, () => 0);
    health.setObserver(providerTelemetry(registry, log as never));
    for (let i = 0; i < 3; i++) health.settle(undefined, new LlmProviderError('unfunded', 'x'), 0);
    health.settle('sk-a', new LlmProviderError('unfunded', 'x'), 0);
    health.noteFallback('provider_unfunded', 4);
    const text = await registry.metrics();
    expect(text).toContain('ta_ai_provider_state{key="protocol"} 1');
    expect(text).toContain('ta_ai_provider_state{key="byok"} 1');
    expect(text).toContain('ta_ai_fallback_decisions_total{reason="provider_unfunded"} 4');
    expect(log.warn).toHaveBeenCalledTimes(2);
    health.settle(undefined, null, 0);
    expect(log.info).toHaveBeenCalledTimes(1);
    expect(await registry.metrics()).toContain('ta_ai_provider_state{key="protocol"} 0');
    // a second app on the same registry reuses the metrics instead of throwing
    expect(() => providerTelemetry(registry, undefined)).not.toThrow();
  });
});

describe('AiModule binding', () => {
  it('every consumer of LlmProviderPort gets the guarded provider', async () => {
    @Global() @Module({ providers: [{ provide: APP_ENV, useValue: { NODE_ENV: 'test' } }], exports: [APP_ENV] })
    class EnvModule {}
    const mod = await Test.createTestingModule({ imports: [EnvModule, AiModule] }).compile();
    const llm = mod.get(LlmProviderPort, { strict: false });
    expect(llm).toBeInstanceOf(GuardedLlmProvider);
    await expect(llm.complete(REQ)).resolves.toHaveProperty('text');
  });
});

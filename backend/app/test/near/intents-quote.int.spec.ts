import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app';

const body = { originAsset: 'nep141:wrap.near', destinationAsset: 'nep141:usdc.near', amount: '10000000' };
let db: TestDatabase;
let app: INestApplication | undefined;

beforeAll(async () => { db = await createTestDatabase(); });
afterAll(async () => { await db?.drop(); });

async function boot(env: Record<string, string>) {
  const created = await createApp({
    source: {
      NODE_ENV: 'test', LOG_LEVEL: 'silent', SIM_THREADS: '1', DATABASE_URL: db.url,
      JWT_ACCESS_SECRET: 'intents-quote-jwt-secret-0123456789abcdef', MOCK_LATENCY_MIN_MS: '0', MOCK_LATENCY_MAX_MS: '0', ...env,
    },
  });
  app = created.app;
  await app.listen(0, '127.0.0.1');
  return (await app.getUrl()).replace('[::1]', '127.0.0.1');
}

/** Routes the Nest call through the real fetch but answers the 1Click upstream from a stub, recording its body. */
function stubOneClick() {
  const upstream: Record<string, unknown>[] = [];
  const real = globalThis.fetch;
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if (String(url).startsWith('http://oneclick.test')) {
      upstream.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ quote: { amountIn: '10000000', amountOut: '9900000', amountOutFormatted: '9.9' }, timestamp: 'now' }), { status: 200 });
    }
    return real(url, init);
  });
  return upstream;
}

const post = (base: string, b: unknown) => fetch(`${base}/v1/near/intents/quote`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });

afterEach(async () => { vi.unstubAllGlobals(); await app?.close(); app = undefined; });

describe('POST /near/intents/quote (stubbed 1Click)', () => {
  const base = { NEAR_ONECLICK_URL: 'http://oneclick.test' };
  it('forwards the atomic amount unscaled with dry:true on a non-mainnet host (mock) even when confirmed', async () => {
    const upstream = stubOneClick();
    const url = await boot({ ...base, NEAR_MODE: 'mock', NEAR_ALLOW_MAINNET: '1' });
    const res = await post(url, { ...body, dry: false, confirmMainnet: true });
    expect(res.status).toBe(200);
    expect(upstream[0]).toMatchObject({ dry: true, amount: '10000000' });
    expect(await res.json()).toMatchObject({ dry: true, source: 'live-1click', amountIn: '10000000' });
  });
  it('mainnet + allow + confirm sends dry:false; without confirm stays dry', async () => {
    const upstream = stubOneClick();
    const url = await boot({ ...base, NEAR_MODE: 'mainnet', NEAR_ALLOW_MAINNET: '1' });
    expect((await post(url, { ...body, dry: false, confirmMainnet: true })).status).toBe(200);
    expect((await post(url, { ...body, dry: false })).status).toBe(200);
    expect(upstream.map((u) => u.dry)).toEqual([false, true]);
  });
  it('rejects a human-decimal amount with 400 and never calls upstream', async () => {
    const upstream = stubOneClick();
    const url = await boot({ ...base, NEAR_MODE: 'mock' });
    const res = await post(url, { ...body, amount: '10.00' });
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json()).toLowerCase()).toContain('validation');
    expect(upstream).toHaveLength(0);
  });
});

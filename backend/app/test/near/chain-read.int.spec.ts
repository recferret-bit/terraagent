import type { INestApplication } from '@nestjs/common';
import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { describeChainReadContract } from '../../src/near/__contract__/chain-read.contract';
import { MockChainReadAdapter } from '../../src/near/infrastructure/adapters/chain-read/mock-chain-read.adapter';
import { MOCK_HASH_RE } from '../../src/near/infrastructure/mock/tx-hash';

let db: TestDatabase;
beforeAll(async () => { db = await createTestDatabase(); });
afterAll(async () => { await db?.drop(); });

const fast = { latencyMinMs: 0, latencyMaxMs: 0, failRate: 0 };

describeChainReadContract('MockChainReadAdapter', () => {
  const adapter = new MockChainReadAdapter(db.prisma, fast);
  return { port: adapter, mock: true, writeReceipt: () => adapter.ping() };
});

describe('MockChainReadAdapter specifics', () => {
  it('health() is not ok with detail when the database is down', async () => {
    const broken = { $queryRaw: async () => { throw new Error('db down'); } } as unknown as typeof db.prisma;
    const h = await new MockChainReadAdapter(broken, fast).health();
    expect(h).toMatchObject({ ok: false, network: 'mock', detail: 'db down' });
  });

  it('receipt() neither sleeps nor injects failures; ping() sleeps within bounds', async () => {
    const slept: number[] = [];
    const a = new MockChainReadAdapter(db.prisma, { latencyMinMs: 300, latencyMaxMs: 1500, failRate: 0 }, { sleep: async (ms) => void slept.push(ms) });
    const failing = new MockChainReadAdapter(db.prisma, { ...fast, failRate: 1 });
    const r = await a.ping();
    expect(slept).toHaveLength(1);
    expect(slept[0]).toBeGreaterThanOrEqual(300);
    expect(slept[0]).toBeLessThanOrEqual(1500);
    expect(await failing.receipt(r.txHash)).not.toBeNull();
    expect(await failing.receipt('mock:nope')).toBeNull();
  });
});

describe('dev chain routes', () => {
  const boot = async (source: Record<string, string>) => {
    const { app } = await createApp({ source: { SIM_THREADS: '1', DATABASE_URL: db.url, ...source } });
    await app.listen(0, '127.0.0.1');
    return { app, url: (await app.getUrl()).replace('[::1]', '127.0.0.1') };
  };
  let app: INestApplication;
  let url: string;
  afterAll(async () => { await app?.close(); });

  it('POST /v1/dev/chain/ping returns a mock: receipt after the default 300-1500 ms latency; GET lists it', async () => {
    ({ app, url } = await boot({ NODE_ENV: 'test' }));
    const t0 = Date.now();
    const res = await fetch(`${url}/v1/dev/chain/ping`, { method: 'POST' });
    const elapsed = Date.now() - t0;
    expect(res.status).toBe(200);
    const r = (await res.json()) as { txHash: string; status: string; network: string };
    expect(r.txHash).toMatch(MOCK_HASH_RE);
    expect(r).toMatchObject({ status: 'success', network: 'mock' });
    expect(elapsed).toBeGreaterThanOrEqual(290);
    expect(elapsed).toBeLessThan(2500);
    const list = (await (await fetch(`${url}/v1/dev/chain/receipts?limit=5`)).json()) as { txHash: string }[];
    expect(list.map((x) => x.txHash)).toContain(r.txHash);
    expect(list.length).toBeLessThanOrEqual(5);
  });

  it('is 404 in production (mock allowed there explicitly)', async () => {
    const prod = await boot({ NODE_ENV: 'production', NEAR_ALLOW_MOCK_IN_PROD: 'true', AI_ALLOW_MOCK_IN_PROD: 'true', NOTIFY_ALLOW_MOCK_IN_PROD: 'true' });
    try {
      expect((await fetch(`${prod.url}/v1/dev/chain/ping`, { method: 'POST' })).status).toBe(404);
      expect((await fetch(`${prod.url}/v1/dev/chain/receipts`)).status).toBe(404);
    } finally { await prod.app.close(); }
  });
});

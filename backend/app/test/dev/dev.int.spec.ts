import type { INestApplication } from '@nestjs/common';
import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { MOCK_HASH_RE } from '../../src/near/infrastructure/mock/tx-hash';

let db: TestDatabase;
let app: INestApplication;
let url: string;
beforeAll(async () => {
  db = await createTestDatabase();
  ({ app } = await createApp({ source: { NODE_ENV: 'test', SIM_THREADS: '1', DATABASE_URL: db.url } }));
  await app.listen(0, '127.0.0.1');
  url = (await app.getUrl()).replace('[::1]', '127.0.0.1');
});
afterAll(async () => { await app?.close(); await db?.drop(); });

describe('chain.ping dev command', () => {
  it('returns a mock: receipt through the mock ChainRead adapter', async () => {
    const res = await fetch(`${url}/v1/dev/commands/chain.ping`, { method: 'POST' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ txHash: expect.stringMatching(MOCK_HASH_RE), status: 'success', network: 'mock' });
  });
});

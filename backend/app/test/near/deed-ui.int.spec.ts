import type { INestApplication } from '@nestjs/common';
import { DeedView, NearDeedListResponse } from '@terra/contracts';
import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';

let db: TestDatabase;
let app: INestApplication;
let url: string;

beforeAll(async () => {
  db = await createTestDatabase();
  const created = await createApp({
    source: {
      NODE_ENV: 'test',
      SIM_THREADS: '1',
      DATABASE_URL: db.url,
      NEAR_MODE: 'mock',
      TA_WAVES: 'W00,W02,W05,W06,W08,W12,W20',
    },
  });
  app = created.app;
  await app.listen(0, '127.0.0.1');
  url = (await app.getUrl()).replace('[::1]', '127.0.0.1');
});

afterAll(async () => {
  await app?.close();
  await db?.drop();
});

describe('W20-10 DeedPanel client <-> server HTTP integration', () => {
  it('loads the Colony Deed from GET /v1/near/deed and seals Settled Deed via POST /v1/near/deed/settle', async () => {
    const seed = await fetch(`${url}/v1/dev/commands/deed.show`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(seed.status).toBe(200);

    const listRes = await fetch(`${url}/v1/near/deed?colonyId=col_0`);
    expect(listRes.status).toBe(200);
    const listBody = NearDeedListResponse.parse(await listRes.json());
    const loaded = listBody.deeds[0];
    expect(loaded?.tokenId).toBe('deed:col_0');
    expect(loaded?.settled).toBe(false);
    expect(loaded?.status).toBe('active');
    expect(loaded?.version).toBe(1);

    const settleRes = await fetch(`${url}/v1/near/deed/settle`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        colonyId: loaded!.colonyId,
        planetId: loaded!.planetId,
      }),
    });
    expect(settleRes.status).toBe(200);
    const settleJson = (await settleRes.json()) as { deed: unknown };
    const settledDeed = DeedView.parse(settleJson.deed);
    expect(settledDeed.settled).toBe(true);
    expect(settledDeed.status).toBe('settled');
    expect(settledDeed.version).toBeGreaterThanOrEqual(2);
  });
});

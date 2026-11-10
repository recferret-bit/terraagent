import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { OutboxRelayService } from '../../src/near/application/outbox/outbox.module.js';
import { DeedMintOutboxService } from '../../src/near/deed/deed-mint-outbox.service.js';

let db: TestDatabase;
const apps: INestApplication[] = [];

async function boot(extra: Record<string, string> = {}) {
  const created = await createApp({
    source: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      SIM_THREADS: '1',
      DATABASE_URL: db.url,
      JWT_ACCESS_SECRET: 'deed-share-jwt-secret-0123456789abcdef',
      MOCK_LATENCY_MIN_MS: '0',
      MOCK_LATENCY_MAX_MS: '0',
      ...extra,
    },
  });
  await created.app.listen(0, '127.0.0.1');
  apps.push(created.app);
  const url = (await created.app.getUrl()).replace('[::1]', '127.0.0.1');
  return { app: created.app, url };
}

beforeAll(async () => {
  db = await createTestDatabase();
});

afterAll(async () => {
  await Promise.all(apps.map((app) => app.close()));
  await db?.drop();
});

describe('W20-12 GET /deed/:tokenId & /v1/deed/:tokenId Postgres HTTP integration', () => {
  it('renders OpenGraph & Twitter Card HTML at /deed/deed-col_0 and /deed/deed:col_0 with 1200x630 PNG preview', async () => {
    const { app, url } = await boot({ TA_WAVES: '..20' });
    const minter = app.get(DeedMintOutboxService, { strict: false });
    const relay = app.get(OutboxRelayService, { strict: false });

    await minter.mintForColony({
      colonyId: 'col_0',
      planetId: 'pl_share_int_1',
      playerId: 'secret_share_owner_77',
      colonyName: 'Aurora Citadel',
      planetType: 'oceanForest',
      stage: 4,
      terraformBp: 6000,
    });
    await relay.pollOnce();

    for (const path of ['/deed/deed-col_0', '/deed/deed%3Acol_0', '/v1/deed/deed-col_0']) {
      const res = await fetch(`${url}${path}`);
      expect(res.status, path).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/html');
      const html = await res.text();
      expect(html).toContain('property="og:image" content="/v1/near/deed/deed%3Acol_0/image.png?v=1"');
      expect(html).toContain('property="og:title" content="Aurora Citadel — Stage S4 Colony Deed | TerraAgent"');
      expect(html).toContain('property="og:description"');
      expect(html).toContain('Terraform 60%');
      expect(html).toContain('name="twitter:card" content="summary_large_image"');
      expect(html).toContain('Colonize on TerraAgent');
      expect(html).toContain('Share on X');
      expect(html).toContain('https://twitter.com/intent/tweet?');
      expect(html).not.toContain('secret_share_owner_77');
    }

    const imgRes = await fetch(`${url}/v1/near/deed/deed%3Acol_0/image.png?v=1`);
    expect(imgRes.status).toBe(200);
    expect(imgRes.headers.get('content-type')).toBe('image/png');
    const png = Buffer.from(await imgRes.arrayBuffer());
    expect(png.readUInt32BE(16)).toBe(1200);
    expect(png.readUInt32BE(20)).toBe(630);
  });

  it('returns 404 for missing deed and 404 when W20 flag is disabled', async () => {
    const { url } = await boot({ TA_WAVES: '..20' });
    const missingRes = await fetch(`${url}/deed/deed-missing_999`);
    expect(missingRes.status).toBe(404);

    const { url: urlOff } = await boot({ TA_WAVES: '..19' });
    const offRes = await fetch(`${urlOff}/deed/deed-col_0`);
    expect(offRes.status).toBe(404);
  });
});

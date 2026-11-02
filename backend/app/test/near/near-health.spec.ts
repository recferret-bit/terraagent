import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';

const apps: INestApplication[] = [];
afterAll(async () => {
  await Promise.all(apps.map((app) => app.close()));
});

async function boot(extra: Record<string, string> = {}) {
  const created = await createApp({
    source: {
      NODE_ENV: 'test',
      SIM_THREADS: '1',
      JWT_ACCESS_SECRET: 'test-jwt-secret-0123456789abcdef',
      LOG_LEVEL: 'info',
      ...extra,
    },
  });
  await created.app.listen(0, '127.0.0.1');
  apps.push(created.app);
  const url = (await created.app.getUrl()).replace('[::1]', '127.0.0.1');
  return { app: created.app, url };
}

describe('GET /v1/near/health', () => {
  it('returns the mock adapter health when W06 is on', async () => {
    const { url } = await boot();
    const res = await fetch(`${url}/v1/near/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, adapter: 'mock' });
  });

  it('is 404 when TA_WAVES=..05', async () => {
    const { url } = await boot({ TA_WAVES: '..05' });
    const res = await fetch(`${url}/v1/near/health`);
    expect(res.status).toBe(404);
  });
});

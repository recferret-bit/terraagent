import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';

const PROD = {
  NODE_ENV: 'production', PROGRESSION_WORKERS: 'off', SIM_THREADS: '1', LOG_LEVEL: 'info', JWT_ACCESS_SECRET: 'prod-test-jwt-secret-0123456789',
  NEAR_ALLOW_MOCK_IN_PROD: 'true', AI_ALLOW_MOCK_IN_PROD: 'true', NOTIFY_ALLOW_MOCK_IN_PROD: 'true',
};

let app: INestApplication;
let url: string;
const routes: { path: string; method: string }[] = [];

beforeAll(async () => {
  // Nest logs every mapped route ("Mapped {/v1/dev/chain/ping, POST} route"): the list of routes the app really serves.
  const logDestination = {
    write: (s: string) => {
      const m = /Mapped \{([^,]+), (\w+)\} route/.exec(String((JSON.parse(s) as { msg?: unknown }).msg ?? ''));
      if (m) routes.push({ path: m[1]!, method: m[2]! });
    },
  };
  ({ app } = await createApp({ source: PROD, logDestination }));
  await app.listen(0, '127.0.0.1');
  url = (await app.getUrl()).replace('[::1]', '127.0.0.1');
});
afterAll(async () => { await app?.close(); });

describe('every /v1/dev route is 404 in production (BE-18)', () => {
  it('walks the mapped routes: each /v1/dev/* answers 404 not_found, whatever the method', async () => {
    const dev = routes.filter((r) => r.path.startsWith('/v1/dev'));
    expect(dev.length).toBeGreaterThanOrEqual(10); // planets, ledger, scenarios ×2, commands ×2, chain ping + 8 explorer reads
    for (const r of dev) {
      const res = await fetch(`${url}${r.path.replace(/:\w+/g, 'x')}`, {
        method: r.method, headers: { 'content-type': 'application/json' }, ...(r.method === 'GET' ? {} : { body: '{}' }),
      });
      expect({ ...r, status: res.status }).toEqual({ ...r, status: 404 });
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe('not_found');
    }
  });

  it('the home route is mounted once: /v1/v1/me/home does not exist (BE-19)', async () => {
    expect(routes.filter((r) => r.path.endsWith('/me/home'))).toEqual([{ path: '/v1/me/home', method: 'GET' }]);
  });
});

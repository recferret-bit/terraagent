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
      LOG_LEVEL: 'silent',
      SIM_THREADS: '1',
      JWT_ACCESS_SECRET: 'test-jwt-secret-0123456789abcdef',
      ...extra,
    },
  });
  await created.app.listen(0, '127.0.0.1');
  apps.push(created.app);
  const url = (await created.app.getUrl()).replace('[::1]', '127.0.0.1');
  return { app: created.app, url };
}

describe('W20-17 StakingPoolsController integration', () => {
  it('acceptance: createApp refuses to start when NEAR_STAKING_POOLS is malformed', async () => {
    await expect(
      createApp({
        source: {
          NODE_ENV: 'test',
          LOG_LEVEL: 'silent',
          SIM_THREADS: '1',
          NEAR_STAKING_POOLS: 'malformed!!pool',
        },
      }),
    ).rejects.toThrow(/NEAR_STAKING_POOLS/);
  });

  it('serves GET /v1/admin/near/staking-pools when W20 is enabled and 404 when W20 is off', async () => {
    const { url } = await boot({
      TA_WAVES: '..20',
      NEAR_STAKING_POOLS: 'astro-stakers.pool.mock:Astro Stakers:900,kiln.pool.mock:Kiln Validator:950',
    });
    const adminRes = await fetch(`${url}/v1/admin/near/staking-pools`);
    expect(adminRes.status).toBe(200);
    expect(await adminRes.json()).toEqual({
      pools: [
        { poolId: 'astro-stakers.pool.mock', name: 'Astro Stakers', apyBp: 900 },
        { poolId: 'kiln.pool.mock', name: 'Kiln Validator', apyBp: 950 },
      ],
    });

    const pubRes = await fetch(`${url}/v1/near/staking-pools`);
    expect(pubRes.status).toBe(200);
    expect(((await pubRes.json()) as { pools: unknown[] }).pools).toHaveLength(2);

    const { url: urlOff } = await boot({ TA_WAVES: '..19' });
    const offRes = await fetch(`${urlOff}/v1/admin/near/staking-pools`);
    expect(offRes.status).toBe(404);
  });
});

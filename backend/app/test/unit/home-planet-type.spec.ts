import 'reflect-metadata';
import { fileURLToPath } from 'node:url';
import type { INestApplication } from '@nestjs/common';
import { AuthResponseSchema, HomeResponseSchema, type HomeResponse } from '@terra/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';

const coreOnlyDir = fileURLToPath(new URL('../core/fixtures/base/', import.meta.url));
let currentApp: INestApplication | undefined;

async function boot() {
  const created = await createApp({
    source: { NODE_ENV: 'test', JWT_ACCESS_SECRET: 'test-home-type-jwt-secret-0123456789ab' },
    modulesDirs: [coreOnlyDir],
  });
  await created.app.listen(0, '127.0.0.1');
  currentApp = created.app;
  return (await created.app.getUrl()).replace('[::1]', '127.0.0.1');
}

async function guest(url: string, deviceSecret: string) {
  const res = await fetch(`${url}/v1/auth/guest`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ deviceSecret }) });
  return AuthResponseSchema.parse(await res.json());
}

async function home(url: string, token: string, type?: string): Promise<HomeResponse> {
  const res = await fetch(`${url}/v1/me/home${type ? `?type=${type}` : ''}`, { headers: { authorization: `Bearer ${token}` } });
  expect(res.status).toBe(200);
  return HomeResponseSchema.parse(await res.json());
}

afterEach(async () => {
  await currentApp?.close();
  currentApp = undefined;
});

describe('GET /v1/me/home?type= — one dev planet per type', () => {
  it('seats a NEW colony on the dev planet family of the picked type', async () => {
    const url = await boot();
    const cases: Array<[string | undefined, string, string]> = [
      [undefined, 'pl_dev', 'desert'],
      ['desert', 'pl_dev', 'desert'],
      ['ocean', 'pl_dev_ocean', 'ocean'],
      ['temperate', 'pl_dev_temperate', 'temperate'],
      ['lava', 'pl_dev', 'desert'], // unknown type → the default family
    ];
    for (const [i, [type, planetId, planetType]] of cases.entries()) {
      const g = await guest(url, `home-type-device-secret-${i}-0000000`);
      const body = await home(url, g.accessToken, type);
      if (body.state !== 'ACTIVE') throw new Error('expected ACTIVE');
      expect([body.planet.id, body.planet.type, body.colony.planetId]).toEqual([planetId, planetType, planetId]);
    }
  });

  it('an existing colony keeps its planet whatever type is asked later', async () => {
    const url = await boot();
    const g = await guest(url, 'home-type-device-secret-keep-00000');
    const first = await home(url, g.accessToken, 'ocean');
    const again = await home(url, g.accessToken, 'temperate');
    if (first.state !== 'ACTIVE' || again.state !== 'ACTIVE') throw new Error('expected ACTIVE');
    expect(again.colony.id).toBe(first.colony.id);
    expect([again.planet.id, again.planet.type]).toEqual(['pl_dev_ocean', 'ocean']);
  });
});

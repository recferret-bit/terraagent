import 'reflect-metadata';
import { fileURLToPath } from 'node:url';
import type { INestApplication } from '@nestjs/common';
import { AuthResponseSchema, HomeResponseSchema, type HomeResponse } from '@terra/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { HomeRepository, HomeService } from '../../src/core/home';

const coreOnlyDir = fileURLToPath(new URL('../core/fixtures/base/', import.meta.url));

let currentApp: INestApplication | undefined;

async function bootHomeApp() {
  const created = await createApp({
    source: { NODE_ENV: 'test', JWT_ACCESS_SECRET: 'test-home-jwt-secret-0123456789abcdef' },
    modulesDirs: [coreOnlyDir],
  });
  await created.app.listen(0, '127.0.0.1');
  currentApp = created.app;
  const url = (await created.app.getUrl()).replace('[::1]', '127.0.0.1');
  return { app: created.app, url };
}

async function createGuest(url: string, deviceSecret: string, handle?: string) {
  const res = await fetch(`${url}/v1/auth/guest`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ deviceSecret, ...(handle ? { handle } : {}) }),
  });
  expect(res.status).toBe(200);
  return AuthResponseSchema.parse(await res.json());
}

async function fetchHome(url: string, accessToken: string): Promise<{ status: number; body: HomeResponse }> {
  const res = await fetch(`${url}/v1/me/home`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  const raw = await res.json();
  return { status: res.status, body: HomeResponseSchema.parse(raw) };
}

afterEach(async () => {
  await currentApp?.close();
  currentApp = undefined;
});

describe('GET /v1/me/home (W01-04)', () => {
  it('auto-seats a new guest on pl_dev and returns ACTIVE with a colony id (acceptance check)', async () => {
    const { app, url } = await bootHomeApp();
    const homeService = app.get(HomeService);
    const seatedIds: string[] = [];
    homeService.onColonySeated(({ colony }) => {
      seatedIds.push(colony.id);
    });

    const guest = await createGuest(url, 'home-guest-device-secret-0001', 'Pioneer');
    const { status, body } = await fetchHome(url, guest.accessToken);

    expect(status).toBe(200);
    expect(body.state).toBe('ACTIVE');
    if (body.state !== 'ACTIVE') throw new Error('expected ACTIVE home state');

    expect(body.colony.id).toMatch(/^col_/);
    expect(body.colony.planetId).toBe('pl_dev');
    expect(body.colony.colonyIndex).toBe(0);
    expect(body.colony.playerId).toBe(guest.player.id);
    expect(typeof body.colony.spawnQ).toBe('number');
    expect(typeof body.colony.spawnR).toBe('number');

    expect(body.planet.id).toBe('pl_dev');
    expect(body.planet.type).toBe('temperate');
    expect(body.planet.seats).toEqual({ taken: 1, capacity: 5 });
    expect(seatedIds).toEqual([body.colony.id]);
  });

  it('returns the same colony.id and colonyIndex on subsequent calls for the same guest', async () => {
    const { url } = await bootHomeApp();
    const guest = await createGuest(url, 'home-guest-device-secret-0002', 'Voyager');

    const first = await fetchHome(url, guest.accessToken);
    const second = await fetchHome(url, guest.accessToken);

    expect(first.body.state).toBe('ACTIVE');
    expect(second.body.state).toBe('ACTIVE');
    if (first.body.state !== 'ACTIVE' || second.body.state !== 'ACTIVE') {
      throw new Error('expected ACTIVE home state');
    }

    expect(second.body.colony.id).toBe(first.body.colony.id);
    expect(second.body.colony.colonyIndex).toBe(first.body.colony.colonyIndex);
    expect(second.body.colony.spawnQ).toBe(first.body.colony.spawnQ);
    expect(second.body.colony.spawnR).toBe(first.body.colony.spawnR);
    expect(second.body.planet.seats.taken).toBe(1);
  });
});

describe('GET /v1/me/home state transitions, auth guard & overflow (W01-04)', () => {
  it('returns state ELIMINATED and PLANET_ENDED when colony or planet status is updated', async () => {
    const { app, url } = await bootHomeApp();
    const repo = app.get(HomeRepository);

    const guest1 = await createGuest(url, 'home-guest-device-secret-0003');
    const guest2 = await createGuest(url, 'home-guest-device-secret-0004');

    const home1 = await fetchHome(url, guest1.accessToken);
    const home2 = await fetchHome(url, guest2.accessToken);
    if (home1.body.state !== 'ACTIVE' || home2.body.state !== 'ACTIVE') {
      throw new Error('expected ACTIVE home state');
    }

    await repo.setColonyStatus(home1.body.colony.id, 'ELIMINATED');
    const eliminated = await fetchHome(url, guest1.accessToken);
    expect(eliminated.status).toBe(200);
    expect(eliminated.body.state).toBe('ELIMINATED');
    if (eliminated.body.state === 'ELIMINATED') {
      expect(eliminated.body.colony?.id).toBe(home1.body.colony.id);
      expect(eliminated.body.planet?.id).toBe('pl_dev');
    }

    await repo.setPlanetStatus('pl_dev', 'ENDED');
    const ended = await fetchHome(url, guest2.accessToken);
    expect(ended.status).toBe(200);
    expect(ended.body.state).toBe('PLANET_ENDED');
    if (ended.body.state === 'PLANET_ENDED') {
      expect(ended.body.colony?.id).toBe(home2.body.colony.id);
      expect(ended.body.planet?.id).toBe('pl_dev');
    }
  });

  it('returns 401 when called without a valid Bearer token', async () => {
    const { url } = await bootHomeApp();

    const noAuth = await fetch(`${url}/v1/me/home`);
    expect(noAuth.status).toBe(401);

    const badAuth = await fetch(`${url}/v1/me/home`, {
      headers: { authorization: 'Bearer invalid.jwt.token' },
    });
    expect(badAuth.status).toBe(401);
  });

  it('allocates colonyIndex 0..4 on pl_dev and overflows the 6th guest onto pl_dev_2', async () => {
    const { url } = await bootHomeApp();
    const results: HomeResponse[] = [];

    for (let i = 0; i < 6; i++) {
      const guest = await createGuest(url, `home-overflow-device-secret-000${i}`);
      const { body } = await fetchHome(url, guest.accessToken);
      results.push(body);
    }

    for (let i = 0; i < 5; i++) {
      const r = results[i]!;
      expect(r.state).toBe('ACTIVE');
      if (r.state === 'ACTIVE') {
        expect(r.planet.id).toBe('pl_dev');
        expect(r.colony.colonyIndex).toBe(i);
      }
    }

    const sixth = results[5]!;
    expect(sixth.state).toBe('ACTIVE');
    if (sixth.state === 'ACTIVE') {
      expect(sixth.planet.id).toBe('pl_dev_2');
      expect(sixth.colony.planetId).toBe('pl_dev_2');
      expect(sixth.colony.colonyIndex).toBe(0);
    }
  });
});

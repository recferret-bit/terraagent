import 'reflect-metadata';
import { fileURLToPath } from 'node:url';
import type { INestApplication } from '@nestjs/common';
import {
  AuthResponseSchema,
  decodeWire,
  HomeResponseSchema,
  newId,
  Welcome,
  type HomeResponse,
} from '@terra/contracts';
import { ENTITY_KIND, getColonyStock, getSpawnSlots, hexDistance, restore } from '@terra/sim';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { createApp } from '../../src/app';
import { HomeRepository, HomeService } from '../../src/core/home';
import { GamePlanets } from '../../src/game/game-planets.service';

const coreOnlyDir = fileURLToPath(new URL('../core/fixtures/base/', import.meta.url));
const openSockets: WebSocket[] = [];

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

async function bootFullHomeApp() {
  const created = await createApp({
    source: {
      NODE_ENV: 'test',
      SIM_THREADS: '1',
      JWT_ACCESS_SECRET: 'test-home-full-jwt-secret-0123456789',
    },
  });
  await created.app.listen(0, '127.0.0.1');
  currentApp = created.app;
  const url = (await created.app.getUrl()).replace('[::1]', '127.0.0.1');
  const port = new URL(url).port;
  return { app: created.app, url, wsUrl: `ws://127.0.0.1:${port}/ws` };
}

class WsSeatClient {
  readonly frames: { t: string; d: Record<string, unknown> }[] = [];
  private waiters: (() => void)[] = [];

  constructor(readonly ws: WebSocket) {
    openSockets.push(ws);
    ws.on('message', (data, isBinary) => {
      const buf = data as Buffer;
      const decoded = decodeWire(isBinary ? buf : buf.toString('utf8')) as {
        t: string;
        d: Record<string, unknown>;
      };
      this.frames.push(decoded);
      this.waiters.splice(0).forEach((w) => w());
    });
  }

  static async open(wsUrl: string): Promise<WsSeatClient> {
    const ws = new WebSocket(wsUrl);
    await new Promise<void>((res, rej) => {
      ws.once('open', () => res());
      ws.once('error', rej);
    });
    return new WsSeatClient(ws);
  }

  send(msg: object): void {
    this.ws.send(JSON.stringify({ v: 1, ...msg }));
  }

  async nextAny(ts: string[]): Promise<{ t: string; d: Record<string, unknown> }> {
    for (;;) {
      const idx = this.frames.findIndex((f) => ts.includes(f.t));
      if (idx >= 0) return this.frames.splice(idx, 1)[0]!;
      await new Promise<void>((r) => {
        this.waiters.push(r);
      });
    }
  }
}

afterEach(async () => {
  for (const s of openSockets.splice(0)) s.terminate();
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

describe('Dev planet seat assignment & system.spawnColony (W01-05)', () => {
  it('seats 5 guests on pl_dev, overflows the 6th onto pl_dev_2, and spawns all colonies in SimHost (acceptance check)', async () => {
    const { app, url } = await bootFullHomeApp();
    const gamePlanets = app.get(GamePlanets);
    const guests: Array<{ playerId: string; home: Extract<HomeResponse, { state: 'ACTIVE' }> }> = [];

    for (let i = 0; i < 6; i++) {
      const g = await createGuest(url, `w01-05-seat-device-secret-000${i}`, `Founder${i + 1}`);
      const { status, body } = await fetchHome(url, g.accessToken);
      expect(status).toBe(200);
      expect(body.state).toBe('ACTIVE');
      if (body.state !== 'ACTIVE') throw new Error('expected ACTIVE home state');
      guests.push({ playerId: g.player.id, home: body });
    }

    const plDevCoords = new Set<string>();
    for (let i = 0; i < 5; i++) {
      const { home } = guests[i]!;
      expect(home.planet.id).toBe('pl_dev');
      expect(home.planet.seats).toEqual({ taken: i + 1, capacity: 5 });
      expect(home.colony.planetId).toBe('pl_dev');
      expect(home.colony.colonyIndex).toBe(i);
      const q = home.colony.spawnQ!;
      const r = home.colony.spawnR!;
      const ringDist = hexDistance(0, 0, q, r);
      expect(ringDist).toBeGreaterThanOrEqual(29);
      expect(ringDist).toBeLessThanOrEqual(35);
      plDevCoords.add(`${q},${r}`);
    }
    expect(plDevCoords.size).toBe(5);

    const sixth = guests[5]!.home;
    expect(sixth.planet.id).toBe('pl_dev_2');
    expect(sixth.planet.seats).toEqual({ taken: 1, capacity: 5 });
    expect(sixth.colony.planetId).toBe('pl_dev_2');
    expect(sixth.colony.colonyIndex).toBe(0);

    expect(gamePlanets.isLoaded('pl_dev')).toBe(true);
    expect(gamePlanets.isLoaded('pl_dev_2')).toBe(true);

    const plDevState = restore((await gamePlanets.fullState('pl_dev')).bytes);
    expect(plDevState.meta.planetId).toBe('pl_dev');
    expect(plDevState.meta.planetType).toBe('temperate');
    expect(plDevState.grid.radius).toBe(56);
    expect(plDevState.colonies).toHaveLength(5);

    const plDevSlots = getSpawnSlots(plDevState);
    expect(plDevSlots).toHaveLength(5);
    for (let i = 0; i < 5; i++) {
      const { playerId, home } = guests[i]!;
      const col = plDevState.colonies[i]!;
      expect(col.id).toBe(home.colony.id);
      expect(col.playerId).toBe(playerId);
      expect(getColonyStock(plDevState, i)).toEqual({
        'metals.t1': 600,
        'minerals.t1': 350,
        'bio.biomass': 200,
        'bio.water': 200,
      });
      expect(plDevSlots[i]?.claimedBy).toBe(i);
      const podRow = [...Array(plDevState.entities.count).keys()].find(
        (r) => plDevState.entities.cols.kind[r] === ENTITY_KIND.pod && plDevState.entities.cols.owner[r] === i,
      );
      expect(podRow).toBeDefined();
      expect(plDevState.entities.cols.q[podRow!]).toBe(home.colony.spawnQ);
      expect(plDevState.entities.cols.r[podRow!]).toBe(home.colony.spawnR);
    }

    const plDev2State = restore((await gamePlanets.fullState('pl_dev_2')).bytes);
    expect(plDev2State.meta.planetId).toBe('pl_dev_2');
    expect(plDev2State.colonies).toHaveLength(1);
    expect(plDev2State.colonies[0]?.id).toBe(sixth.colony.id);
    expect(getColonyStock(plDev2State, 0)).toEqual({
      'metals.t1': 600,
      'minerals.t1': 350,
      'bio.biomass': 200,
      'bio.water': 200,
    });
  }, 15_000);
});

describe('Dev planet WebSocket colonyIndex resolution (W01-05)', () => {
  it('resolves the seated colonyIndex on WebSocket commands and rejects unseated non-dev commands', async () => {
    const { app, url, wsUrl } = await bootFullHomeApp();
    const gamePlanets = app.get(GamePlanets);

    const g1 = await createGuest(url, 'w01-05-ws-device-secret-0001', 'Alpha');
    const g2 = await createGuest(url, 'w01-05-ws-device-secret-0002', 'Bravo');
    const gUnseated = await createGuest(url, 'w01-05-ws-device-secret-0003', 'Outsider');

    const h1 = await fetchHome(url, g1.accessToken);
    const h2 = await fetchHome(url, g2.accessToken);
    if (h1.body.state !== 'ACTIVE' || h2.body.state !== 'ACTIVE') {
      throw new Error('expected ACTIVE home state');
    }
    expect(h1.body.colony.colonyIndex).toBe(0);
    expect(h2.body.colony.colonyIndex).toBe(1);

    const c2 = await WsSeatClient.open(wsUrl);
    c2.send({ t: 'hello', d: { accessToken: g2.accessToken, proto: [1], client: { app: 'game', version: '0.1.0' } } });
    await c2.nextAny(['ready']);
    c2.send({ t: 'join', d: { planetId: 'pl_dev' } });
    const welcome = Welcome.parse(await c2.nextAny(['welcome']));
    expect(welcome.d.colonyId).toBe(h2.body.colony.id);

    const landId = newId('cm');
    c2.send({ t: 'cmd', id: landId, d: { kind: 'dev.land', args: {} } });
    const landReply = await c2.nextAny(['cmd.ack', 'cmd.reject']);
    expect(landReply.t).toBe('cmd.ack');

    const stateAfterLand = restore((await gamePlanets.fullState('pl_dev')).bytes);
    const hqRows = [...Array(stateAfterLand.entities.count).keys()].filter(
      (r) => stateAfterLand.entities.cols.kind[r] === ENTITY_KIND.hq,
    );
    expect(hqRows).toHaveLength(1);
    const hqRow = hqRows[0]!;
    expect(stateAfterLand.entities.cols.owner[hqRow]).toBe(1);
    const hqEntityId = stateAfterLand.entities.cols.id[hqRow]!;

    const moveId = newId('cm');
    c2.send({
      t: 'cmd',
      id: moveId,
      d: { kind: 'moveUnit', args: { entityId: hqEntityId, q: h2.body.colony.spawnQ!, r: h2.body.colony.spawnR! } },
    });
    expect((await c2.nextAny(['cmd.ack', 'cmd.reject'])).t).toBe('cmd.ack');

    const cOutsider = await WsSeatClient.open(wsUrl);
    cOutsider.send({
      t: 'hello',
      d: { accessToken: gUnseated.accessToken, proto: [1], client: { app: 'game', version: '0.1.0' } },
    });
    await cOutsider.nextAny(['ready']);
    cOutsider.send({ t: 'join', d: { planetId: 'pl_dev' } });
    await cOutsider.nextAny(['welcome']);

    const badMoveId = newId('cm');
    cOutsider.send({
      t: 'cmd',
      id: badMoveId,
      d: { kind: 'moveUnit', args: { entityId: hqEntityId, q: 0, r: 0 } },
    });
    const badReply = await cOutsider.nextAny(['cmd.ack', 'cmd.reject']);
    expect(badReply.t).toBe('cmd.reject');
    expect(badReply.d.code).toBe('not_own_colony');
  }, 15_000);
});

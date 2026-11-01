import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import {
  AuthResponseSchema,
  CLOSE_CODES,
  decodeWire,
  HomeResponse,
  newId,
  Pong,
  Ready,
  type HomeResponse as HomeResponseType,
} from '@terra/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { createApp } from '../../src/app';
import { AuthTokenService } from '../../src/core/auth';
import { devPlanetIds } from '../../src/game/dev-planets';
import { DbHomeProvider, HOME_PROVIDER, type HomeProvider } from '../../src/ws/home-provider';
import { devPlayerId } from '../../src/ws/session-verifier';

const PLANET = devPlanetIds(1, 1)[0]!;
let app: INestApplication | undefined;
const sockets: WebSocket[] = [];

async function boot(extra: Record<string, string> = {}) {
  const created = await createApp({
    source: {
      NODE_ENV: 'test',
      SIM_THREADS: '1',
      GAME_DEV_PLANETS: '1',
      JWT_ACCESS_SECRET: 'ws-auth-test-jwt-secret-0123456789',
      ...extra,
    },
  });
  await created.app.listen(0, '127.0.0.1');
  app = created.app;
  const httpUrl = (await created.app.getUrl()).replace('[::1]', '127.0.0.1');
  const port = new URL(httpUrl).port;
  return {
    app: created.app,
    httpUrl,
    wsUrl: `ws://127.0.0.1:${port}/ws`,
    authTokens: created.app.get(AuthTokenService),
  };
}

class WsTestClient {
  readonly frames: { t: string; d: Record<string, unknown> }[] = [];
  readonly closed: Promise<{ code: number; reason: string }>;
  private waiters: (() => void)[] = [];

  constructor(readonly ws: WebSocket) {
    sockets.push(ws);
    ws.on('message', (data, isBinary) => {
      const buf = data as Buffer;
      const decoded = decodeWire(isBinary ? buf : buf.toString('utf8')) as { t: string; d: Record<string, unknown> };
      this.frames.push(decoded);
      this.waiters.splice(0).forEach((w) => w());
    });
    this.closed = new Promise((res) =>
      ws.on('close', (code, reason) => res({ code, reason: reason.toString() })),
    );
  }

  static async open(url: string): Promise<WsTestClient> {
    const ws = new WebSocket(url);
    await new Promise<void>((res, rej) => {
      ws.once('open', () => res());
      ws.once('error', rej);
    });
    return new WsTestClient(ws);
  }

  send(msg: object): void {
    this.ws.send(JSON.stringify({ v: 1, ...msg }));
  }

  hello(accessToken: string): void {
    this.send({
      t: 'hello',
      d: { accessToken, proto: [1], client: { app: 'game', version: '0.1.0' } },
    });
  }

  reauth(accessToken: string): void {
    this.send({ t: 'reauth', d: { accessToken } });
  }

  async next(t: string): Promise<{ t: string; d: Record<string, unknown> }> {
    for (;;) {
      const idx = this.frames.findIndex((f) => f.t === t);
      if (idx >= 0) return this.frames.splice(idx, 1)[0]!;
      await new Promise<void>((r) => {
        this.waiters.push(r);
      });
    }
  }
}

afterEach(async () => {
  for (const s of sockets.splice(0)) s.terminate();
  await app?.close();
  app = undefined;
});

describe('WS hello JWT verification (W01-03)', () => {
  it('closes 4003 forbidden when hello carries an expired JWT', async () => {
    const { wsUrl, authTokens } = await boot();
    const expiredToken = authTokens.signAccessToken({ sub: 'pr_1', handle: 'H' }, -10);

    const client = await WsTestClient.open(wsUrl);
    client.hello(expiredToken);

    const bye = await client.next('bye');
    expect(bye.d).toEqual({ code: CLOSE_CODES.forbidden, reason: 'forbidden' });
    const closed = await client.closed;
    expect(closed.code).toBe(4003);
    expect(closed.reason).toBe('forbidden');
  });

  it('closes 4003 forbidden when hello carries a tampered or malformed JWT or dev:expired', async () => {
    const { wsUrl, authTokens } = await boot();
    const valid = authTokens.signAccessToken({ sub: newId('pr'), handle: 'Pilot' }, 900);
    const tampered = `${valid}tampered`;

    for (const badToken of [tampered, 'not-a-valid-jwt', 'dev:expired']) {
      const client = await WsTestClient.open(wsUrl);
      client.hello(badToken);
      const bye = await client.next('bye');
      expect(bye.d.code).toBe(4003);
      const closed = await client.closed;
      expect(closed.code).toBe(4003);
      expect(closed.reason).toBe('forbidden');
    }
  });
});

describe('WS ready {playerId, home} payload (W01-03)', () => {
  it('accepts a valid JWT on hello and responds with ready {playerId, home}', async () => {
    const { wsUrl, httpUrl, authTokens } = await boot();

    // Direct signed token with short id 'pr_1'
    const c1 = await WsTestClient.open(wsUrl);
    c1.hello(authTokens.signAccessToken({ sub: 'pr_1', handle: 'H' }, 900));
    const rawReady = await c1.next('ready');
    expect(rawReady.d.playerId).toBe('pr_1');
    expect(HomeResponse.parse(rawReady.d.home)).toEqual({
      state: 'NEW',
      planets: [],
      newPlanetTypes: ['desert'], // DEV_PLANET_TYPE, as /me/home (BE-10)
    });

    // End-to-end with POST /v1/auth/guest ULID player
    const guestRes = await fetch(`${httpUrl}/v1/auth/guest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ deviceSecret: 'ws-guest-device-secret-0001' }),
    });
    const guest = AuthResponseSchema.parse(await guestRes.json());

    const c2 = await WsTestClient.open(wsUrl);
    c2.hello(guest.accessToken);
    const ready = Ready.parse(await c2.next('ready'));
    expect(ready.d.playerId).toBe(guest.player.id);
    expect(HomeResponse.parse(ready.d.home)).toEqual({
      state: 'NEW',
      planets: [],
      newPlanetTypes: ['desert'], // DEV_PLANET_TYPE, as /me/home (BE-10)
    });

    // Backward-compatible W00 dev:<name> shortcut
    const c3 = await WsTestClient.open(wsUrl);
    c3.hello('dev:alice');
    const devReady = Ready.parse(await c3.next('ready'));
    expect(devReady.d.playerId).toBe(devPlayerId('alice'));
    expect(HomeResponse.parse(devReady.d.home).state).toBe('NEW');
  });

  it('includes ACTIVE colony/planet summary in ready.d.home when the player has an active colony', async () => {
    const { app: nestApp, wsUrl, authTokens } = await boot();
    const playerId = newId('pr');
    const colonyId = newId('co');
    const activeHome: HomeResponseType = {
      state: 'ACTIVE',
      colony: {
        id: colonyId,
        planetId: PLANET,
        name: 'Ares Base',
        color: 2,
        state: 'ACTIVE',
        spawnQ: 4,
        spawnR: -3,
      },
      planet: {
        id: PLANET,
        name: 'Dev Alpha',
        type: 'temperate',
        state: 'ACTIVE',
        seats: { taken: 1, capacity: 5 },
      },
    };
    const provider = nestApp.get<HomeProvider>(HOME_PROVIDER);
    provider.getHome = async (id: string) => (id === playerId ? activeHome : { state: 'NEW', planets: [], newPlanetTypes: ['temperate'] });

    const client = await WsTestClient.open(wsUrl);
    client.hello(authTokens.signAccessToken({ sub: playerId, handle: 'Vega' }, 900));
    const ready = Ready.parse(await client.next('ready'));
    expect(ready.d.playerId).toBe(playerId);
    expect(HomeResponse.parse(ready.d.home)).toEqual(activeHome);
    expect(DbHomeProvider).toBeDefined();
  });
});

describe('WS reauth & token expiry (W01-03, LB-02)', () => {
  it('accepts reauth with a refreshed JWT for the same player and keeps the socket open', async () => {
    const { wsUrl, authTokens } = await boot();
    const playerId = newId('pr');
    const initialToken = authTokens.signAccessToken({ sub: playerId, handle: 'Pilot' }, 60);
    const refreshedToken = authTokens.signAccessToken({ sub: playerId, handle: 'Pilot' }, 900);

    const client = await WsTestClient.open(wsUrl);
    client.hello(initialToken);
    const ready1 = Ready.parse(await client.next('ready'));
    expect(ready1.d.playerId).toBe(playerId);

    client.reauth(refreshedToken);
    const ready2 = Ready.parse(await client.next('ready'));
    expect(ready2.d.playerId).toBe(playerId);
    expect(HomeResponse.parse(ready2.d.home).state).toBe('NEW');

    // Socket remains open and responsive after reauth
    client.send({ t: 'ping', d: { clientTimeMs: 123 } });
    const pong = Pong.parse(await client.next('pong'));
    expect(pong.d.clientTimeMs).toBe(123);
  });

  it('closes 4003 forbidden when reauth carries an expired JWT or a different player JWT', async () => {
    const { wsUrl, authTokens } = await boot();
    const playerA = newId('pr');
    const playerB = newId('pr');

    // 1. Expired JWT on reauth
    const c1 = await WsTestClient.open(wsUrl);
    c1.hello(authTokens.signAccessToken({ sub: playerA, handle: 'Alpha' }, 900));
    await c1.next('ready');

    c1.reauth(authTokens.signAccessToken({ sub: playerA, handle: 'Alpha' }, -5));
    const bye1 = await c1.next('bye');
    expect(bye1.d).toEqual({ code: 4003, reason: 'forbidden' });
    const closed1 = await c1.closed;
    expect(closed1.code).toBe(4003);
    expect(closed1.reason).toBe('forbidden');

    // 2. Valid JWT for a different player on reauth
    const c2 = await WsTestClient.open(wsUrl);
    c2.hello(authTokens.signAccessToken({ sub: playerA, handle: 'Alpha' }, 900));
    await c2.next('ready');

    c2.reauth(authTokens.signAccessToken({ sub: playerB, handle: 'Bravo' }, 900));
    const bye2 = await c2.next('bye');
    expect(bye2.d).toEqual({ code: 4003, reason: 'forbidden' });
    const closed2 = await c2.closed;
    expect(closed2.code).toBe(4003);
    expect(closed2.reason).toBe('forbidden');
  });

  it('closes 4003 at access-token exp unless reauth arrived first (LB-02)', async () => {
    const { wsUrl, authTokens } = await boot();
    const playerId = newId('pr');

    const c = await WsTestClient.open(wsUrl);
    c.hello(authTokens.signAccessToken({ sub: playerId, handle: 'ShortLived' }, 1));
    await c.next('ready');

    const bye = await c.next('bye');
    expect(bye.d.code).toBe(4003);
    const closed = await c.closed;
    expect(closed.code).toBe(4003);
    expect(closed.reason).toBe('forbidden');
  });
});

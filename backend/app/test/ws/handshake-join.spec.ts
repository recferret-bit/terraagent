import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { decodeWire, Delta, Pong, Ready, Welcome } from '@terra/contracts';
import { applyDiff, restore, SIM_VERSION } from '@terra/sim';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { createApp } from '../../src/app';
import { devPlanetIds } from '../../src/game/dev-planets';
import { GamePlanets } from '../../src/game/game-planets.service';
import { devPlayerId } from '../../src/ws/session-verifier';

const PLANET = devPlanetIds(1, 1)[0]!;
let app: INestApplication | undefined;
const sockets: WebSocket[] = [];

async function boot(extra: Record<string, string> = {}) {
  const created = await createApp({ source: { NODE_ENV: 'test', SIM_THREADS: '1', GAME_DEV_PLANETS: '1', ...extra } });
  await created.app.listen(0, '127.0.0.1');
  app = created.app;
  const port = new URL((await created.app.getUrl()).replace('[::1]', '127.0.0.1')).port;
  return { app: created.app, url: `ws://127.0.0.1:${port}/ws`, port };
}

class Client {
  readonly frames: unknown[] = [];
  closed: Promise<{ code: number; reason: string }>;
  private waiters: (() => void)[] = [];
  constructor(readonly ws: WebSocket) {
    sockets.push(ws);
    ws.on('message', (data, isBinary) => {
      const buf = data as Buffer;
      this.frames.push(decodeWire(isBinary ? buf : buf.toString('utf8')));
      this.waiters.splice(0).forEach((w) => w());
    });
    this.closed = new Promise((res) => ws.on('close', (code, reason) => res({ code, reason: reason.toString() })));
  }
  static async open(url: string, headers: Record<string, string> = {}): Promise<Client> {
    const ws = new WebSocket(url, { headers });
    await new Promise<void>((res, rej) => { ws.once('open', () => res()); ws.once('error', rej); });
    return new Client(ws);
  }
  send(msg: object) { this.ws.send(JSON.stringify({ v: 1, ...msg })); }
  hello(name = 'alice') { this.send({ t: 'hello', d: { accessToken: `dev:${name}`, proto: [1], client: { app: 'game', version: 't' } } }); }
  async next(t: string): Promise<{ t: string; d: Record<string, unknown> }> {
    for (;;) {
      const i = this.frames.findIndex((f) => (f as { t: string }).t === t);
      if (i >= 0) return this.frames.splice(i, 1)[0] as { t: string; d: Record<string, unknown> };
      await new Promise<void>((r) => { this.waiters.push(r); });
    }
  }
}

afterEach(async () => {
  for (const s of sockets.splice(0)) s.terminate();
  await app?.close();
  app = undefined;
});

describe('WS gateway', () => {
  it('hello + join gives ready then a welcome with the engine snapshot', async () => {
    const { url } = await boot();
    const c = await Client.open(url);
    c.hello('alice');
    const ready = Ready.parse(await c.next('ready'));
    expect(ready.d.playerId).toBe(devPlayerId('alice'));
    expect(ready.d.flags.length).toBeGreaterThan(0);
    c.send({ t: 'join', d: { planetId: PLANET } });
    const welcome = Welcome.parse(await c.next('welcome'));
    expect(welcome.d.simVersion).toBe(SIM_VERSION);
    expect(welcome.d.dataHash.length).toBeGreaterThan(0);
    expect(welcome.d.colonyId).toBeNull();
    expect(welcome.d.planet.id).toBe(PLANET);
    const state = restore(welcome.d.state);
    expect(state.meta.planetId).toBe(PLANET);
    expect(state.meta.simVersion).toBe(SIM_VERSION);
    expect(state.grid.count).toBe(9577);
  });

  it('welcome tick matches the restored state', async () => {
    const { url } = await boot();
    const c = await Client.open(url);
    c.hello();
    await c.next('ready');
    c.send({ t: 'join', d: { planetId: PLANET } });
    const welcome = Welcome.parse(await c.next('welcome'));
    expect(restore(welcome.d.state).meta.tick).toBe(welcome.d.tick);
  });

  it('after the welcome, binary deltas chain from the welcome tick and apply to the welcome state', async () => {
    const { url } = await boot();
    const c = await Client.open(url);
    c.hello();
    await c.next('ready');
    c.send({ t: 'join', d: { planetId: PLANET } });
    const welcome = Welcome.parse(await c.next('welcome'));
    const replica = restore(welcome.d.state);
    const deltas = [];
    for (let i = 0; i < 3; i++) deltas.push(Delta.parse(await c.next('delta')));
    expect(deltas[0]!.d.fromTick).toBe(welcome.d.tick);
    for (const [i, d] of deltas.entries()) {
      if (i > 0) expect(d.d.fromTick).toBe(deltas[i - 1]!.d.toTick);
      applyDiff(replica, d.d.diff);
      expect(replica.meta.tick).toBe(d.d.toTick);
    }
  });

  it('no hello in time closes 4000', async () => {
    const { url } = await boot({ WS_HELLO_TIMEOUT_MS: '200' });
    const c = await Client.open(url);
    const bye = await c.next('bye');
    expect(bye.d.code).toBe(4000);
    expect((await c.closed).code).toBe(4000);
  });

  it('a non-hello first frame closes 4000; a bad token too', async () => {
    const { url } = await boot();
    const a = await Client.open(url);
    a.send({ t: 'ping', d: { clientTimeMs: 1 } });
    expect((await a.closed).code).toBe(4000);
    const b = await Client.open(url);
    b.hello('BAD NAME');
    expect((await b.closed).code).toBe(4000);
  });

  it('refuses a foreign origin on upgrade and accepts localhost', async () => {
    const { url } = await boot();
    const err = await new Promise<Error>((res) => { const ws = new WebSocket(url, { headers: { origin: 'https://evil.example' } }); sockets.push(ws); ws.once('error', res); });
    expect(err.message).toMatch(/403|401/);
    await Client.open(url, { origin: 'http://localhost:5173' });
  });

  it('rejects other paths', async () => {
    const { port } = await boot();
    const err = await new Promise<Error>((res) => { const ws = new WebSocket(`ws://127.0.0.1:${port}/other`); sockets.push(ws); ws.once('error', res); });
    expect(err.message).toMatch(/404/);
  });

});

describe('WS gateway: join, leave, shutdown', () => {
  it('unknown planet closes 4003', async () => {
    const { url } = await boot();
    const c = await Client.open(url);
    c.hello();
    await c.next('ready');
    c.send({ t: 'join', d: { planetId: 'pl_ZZZZZZZZZZZZZZZZZZZZZZZZZZ' } });
    expect((await c.next('bye')).d.code).toBe(4003);
    expect((await c.closed).code).toBe(4003);
  });

  it('a second join by the same player replaces the older socket with 4001 after the new welcome', async () => {
    const { url } = await boot();
    const a = await Client.open(url);
    a.hello('bob');
    await a.next('ready');
    a.send({ t: 'join', d: { planetId: PLANET } });
    await a.next('welcome');
    const b = await Client.open(url);
    b.hello('bob');
    await b.next('ready');
    b.send({ t: 'join', d: { planetId: PLANET } });
    Welcome.parse(await b.next('welcome'));
    expect((await a.closed).code).toBe(4001);
  });

  it('answers ping with pong, and cmd with a reject until commands are wired', async () => {
    const { url } = await boot();
    const c = await Client.open(url);
    c.hello();
    await c.next('ready');
    c.send({ t: 'ping', d: { clientTimeMs: 42 } });
    const pong = Pong.parse(await c.next('pong'));
    expect(pong.d.clientTimeMs).toBe(42);
    c.send({ t: 'join', d: { planetId: PLANET } });
    await c.next('welcome');
    c.send({ t: 'cmd', id: 'cm_00000000000000000000000000', d: { kind: 'x', args: {} } });
    expect((await c.next('cmd.reject')).d).toMatchObject({ id: 'cm_00000000000000000000000000', code: 'internal' });
  });

  it('idle sockets close 1001', async () => {
    const { url } = await boot({ WS_IDLE_TIMEOUT_MS: '300' });
    const c = await Client.open(url);
    c.hello();
    await c.next('ready');
    expect((await c.closed).code).toBe(1001);
  });

  it('an oversize frame closes 1009', async () => {
    const { url } = await boot();
    const c = await Client.open(url);
    c.hello();
    await c.next('ready');
    c.ws.send('x'.repeat(65 * 1024));
    expect((await c.closed).code).toBe(1009);
  });

  it('leave unsubscribes and joining again works; the planet is unsubscribed when the last socket leaves', async () => {
    const { url, app: a } = await boot();
    const games = a.get(GamePlanets);
    const c = await Client.open(url);
    c.hello();
    await c.next('ready');
    c.send({ t: 'join', d: { planetId: PLANET } });
    await c.next('welcome');
    expect((await games.pool.stats())[0]!.planets[0]!.subscribed).toBe(true);
    c.send({ t: 'leave', d: {} });
    await until(async () => !(await games.pool.stats())[0]!.planets[0]!.subscribed);
    c.send({ t: 'join', d: { planetId: PLANET } });
    Welcome.parse(await c.next('welcome'));
  });

  it('app shutdown sends bye 4012 and closes with 4012', async () => {
    const { url, app: a } = await boot();
    const c = await Client.open(url);
    c.hello();
    await c.next('ready');
    c.send({ t: 'join', d: { planetId: PLANET } });
    await c.next('welcome');
    const closing = a.close();
    expect((await c.next('bye')).d.code).toBe(4012);
    expect((await c.closed).code).toBe(4012);
    await closing;
    app = undefined;
  });
});

async function until(fn: () => Promise<boolean>, ms = 3000) {
  const end = Date.now() + ms;
  while (!(await fn())) {
    if (Date.now() > end) throw new Error('condition not met');
    await new Promise((r) => setTimeout(r, 25));
  }
}

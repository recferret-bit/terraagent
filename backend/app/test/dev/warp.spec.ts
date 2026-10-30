import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { decodeWire, Welcome } from '@terra/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { createApp } from '../../src/app';
import { devPlanetIds } from '../../src/game/dev-planets';
import { GamePlanets } from '../../src/game/game-planets.service';

const PLANET = devPlanetIds(1, 1)[0]!;
const PROD = { NODE_ENV: 'production', NEAR_ALLOW_MOCK_IN_PROD: 'true', AI_ALLOW_MOCK_IN_PROD: 'true', NOTIFY_ALLOW_MOCK_IN_PROD: 'true' };
let app: INestApplication | undefined;
const sockets: WebSocket[] = [];
afterEach(async () => { for (const s of sockets.splice(0)) s.terminate(); await app?.close(); app = undefined; });

async function boot(extra: Record<string, string> = {}) {
  const created = await createApp({ source: { NODE_ENV: 'test', SIM_THREADS: '1', GAME_DEV_PLANETS: '1', ...extra } });
  await created.app.listen(0, '127.0.0.1');
  app = created.app;
  const url = (await created.app.getUrl()).replace('[::1]', '127.0.0.1');
  return { app: created.app, url, ws: `ws://${url.slice('http://'.length)}/ws` };
}
const warp = (url: string, body: unknown) =>
  fetch(`${url}/v1/dev/commands/warp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

async function join(wsUrl: string, name = 'alice') {
  const ws = new WebSocket(wsUrl);
  sockets.push(ws);
  const frames: { t: string; d: Record<string, unknown> }[] = [];
  ws.on('message', (data, bin) => { frames.push(decodeWire(bin ? (data as Buffer) : (data as Buffer).toString('utf8')) as never); });
  await new Promise<void>((res, rej) => { ws.once('open', () => res()); ws.once('error', rej); });
  const send = (m: object) => ws.send(JSON.stringify({ v: 1, ...m }));
  const wait = async (pred: (f: { t: string; d: Record<string, unknown> }) => boolean) => {
    for (let i = 0; i < 400; i++) { const f = frames.find(pred); if (f) return f; await new Promise((r) => setTimeout(r, 10)); }
    throw new Error('timeout waiting for frame');
  };
  send({ t: 'hello', d: { accessToken: `dev:${name}`, proto: [1], client: { app: 'game', version: 't' } } });
  await wait((f) => f.t === 'ready');
  send({ t: 'join', d: { planetId: PLANET } });
  const welcome = Welcome.parse(await wait((f) => f.t === 'welcome'));
  return { frames, wait, welcome };
}

describe('warp dev command', () => {
  it('400 on k=0 and k=101, 404 for an unloaded planet', async () => {
    const { url } = await boot();
    expect((await warp(url, { planetId: PLANET, k: 0 })).status).toBe(400);
    expect((await warp(url, { planetId: PLANET, k: 101 })).status).toBe(400);
    expect((await warp(url, { planetId: PLANET, k: 1.5 })).status).toBe(400);
    expect((await warp(url, { planetId: 'pl_missing', k: 5 })).status).toBe(404);
  });

  it('404 in production', async () => {
    const { url } = await boot(PROD);
    expect((await warp(url, { planetId: PLANET, k: 10 })).status).toBe(404);
  });

  it('warp 10 raises the real tick rate to about 50/s, broadcasts dev.warp, welcome reports it; warp 1 restores', async () => {
    const { app: a, url, ws } = await boot();
    const planets = a.get(GamePlanets);
    const tickOf = async () => (await planets.pool.stats())[0]!.planets[0]!.tick;
    const rate = async (ms: number) => { const t0 = await tickOf(); await new Promise((r) => setTimeout(r, ms)); return ((await tickOf()) - t0) / (ms / 1000); };
    const first = await join(ws);
    expect(first.welcome.d.warp).toBeUndefined();
    expect(await rate(1000)).toBeGreaterThan(3.5);

    expect((await warp(url, { planetId: PLANET, k: 10 })).status).toBe(200);
    const ev = await first.wait((f) => f.t === 'event' && f.d.kind === 'dev.warp');
    expect(ev.d.data).toEqual({ k: 10 });
    const r10 = await rate(1500);
    expect(r10).toBeGreaterThan(35);
    expect(r10).toBeLessThan(65);
    expect((await join(ws, 'bob')).welcome.d.warp).toBe(10);
    expect(planets.warpOf(PLANET)).toBe(10);

    first.frames.length = 0;
    expect((await warp(url, { planetId: PLANET, k: 1 })).status).toBe(200);
    expect((await first.wait((f) => f.t === 'event' && f.d.kind === 'dev.warp')).d.data).toEqual({ k: 1 });
    await new Promise((r) => setTimeout(r, 300));
    expect(await rate(1000)).toBeLessThan(7);
  }, 20_000);
});

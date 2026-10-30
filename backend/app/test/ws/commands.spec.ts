import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { decodeWire, newId, Welcome } from '@terra/contracts';
import { restore } from '@terra/sim';
import { Registry } from 'prom-client';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { createApp } from '../../src/app';
import { devPlanetIds } from '../../src/game/dev-planets';
import { COMMAND_INGRESS } from '../../src/ws/command-ingress';
import { SimCommandIngress } from '../../src/ws/sim-command-ingress';
import { MetricsRegistry } from '../../src/core/metrics.registry';

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
  async nextAny(ts: string[]): Promise<{ t: string; d: Record<string, unknown> }> {
    for (;;) {
      const i = this.frames.findIndex((f) => ts.includes((f as { t: string }).t));
      if (i >= 0) return this.frames.splice(i, 1)[0] as { t: string; d: Record<string, unknown> };
      await new Promise<void>((r) => { this.waiters.push(r); });
    }
  }
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


async function join(url: string, name = 'alice') {
  const c = await Client.open(url);
  c.hello(name);
  await c.next('ready');
  c.send({ t: 'join', d: { planetId: PLANET } });
  const welcome = Welcome.parse(await c.next('welcome'));
  return { c, welcome };
}

async function cmd(c: Client, kind: string, args: unknown) {
  const id = newId('cm');
  c.send({ t: 'cmd', id, d: { kind, args } });
  const f = await c.nextAny(['cmd.ack', 'cmd.reject']);
  expect(f.d.id).toBe(id);
  return f.t === 'cmd.ack' ? { ok: true as const, appliedAtTick: f.d.appliedAtTick as number } : { ok: false as const, code: f.d.code as string };
}

describe('command ingress', () => {
  it('dev.ping is acked with appliedAtTick >= the welcome tick', async () => {
    const { url } = await boot();
    const { c, welcome } = await join(url);
    const r = await cmd(c, 'dev.ping', { note: 'hi' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.appliedAtTick).toBeGreaterThanOrEqual(welcome.d.tick);
  });

  it('rejects bad args, unknown kinds and module-only/non-dev kinds', async () => {
    const { url } = await boot();
    const { c } = await join(url);
    expect(await cmd(c, 'dev.ping', { note: 'x', extra: 1 })).toMatchObject({ ok: false, code: 'invalid_args' });
    expect(await cmd(c, 'dev.spawn', { q: 'a', r: 0 })).toMatchObject({ ok: false, code: 'invalid_args' });
    expect(await cmd(c, 'nope.nothing', {})).toMatchObject({ ok: false, code: 'unknown_kind' });
  });

  it('wave_disabled when the kind belongs to a disabled wave', async () => {
    const { app, url } = await boot({ TA_WAVES: '..00' });
    (app.get(COMMAND_INGRESS) as SimCommandIngress).waveOf = (k) => (k === 'fixture.w01' ? 'W01' : undefined) ?? (k.startsWith('dev.') ? 'W00' : undefined);
    const { c } = await join(url);
    expect(await cmd(c, 'fixture.w01', {})).toMatchObject({ ok: false, code: 'wave_disabled' });
    expect((await cmd(c, 'dev.ping', {})).ok).toBe(true);
  });

  it('dev.spawn then dev.nudge move the entity (seen in a later welcome snapshot) and count in metrics', async () => {
    const { app, url } = await boot();
    const { c } = await join(url);
    expect((await cmd(c, 'dev.spawn', { q: 3, r: -2 })).ok).toBe(true);
    const bob = await join(url, 'bob');
    const e0 = restore(bob.welcome.d.state).entities;
    const row = [...Array(e0.count).keys()].find((i) => e0.cols.kind[i] === 1)!;
    const id = e0.cols.id[row]!;
    expect([e0.cols.x[row], e0.cols.y[row]]).toEqual([3, -2]);
    expect((await cmd(c, 'dev.nudge', { id })).ok).toBe(true);
    expect(await cmd(c, 'dev.nudge', { id: 987654 })).toMatchObject({ ok: false, code: 'unknown_entity' });
    const carol = await join(url, 'carol');
    const e1 = restore(carol.welcome.d.state).entities;
    const r1 = [...Array(e1.count).keys()].find((i) => e1.cols.id[i] === id)!;
    expect([e1.cols.x[r1], e1.cols.y[r1]]).toEqual([4, -2]);
    const text = await app.get(MetricsRegistry).registry.metrics();
    expect(text).toContain('ta_planet_cmd_acked_total{kind="dev.nudge"} 1');
    expect(text).toContain('ta_planet_cmd_rejected_total{kind="dev.nudge",code="unknown_entity"} 1');
  });
});

describe('SimCommandIngress rules without a server', () => {
  const run = (production: boolean, kind: string, args: unknown = {}) => {
    const submitted: unknown[] = [];
    const planets = { submit: async (_p: string, c: unknown) => { submitted.push(c); return { ok: true, commandId: 'x', appliedAtTick: 7 }; } };
    const flags = { gate: () => null };
    const ingress = new SimCommandIngress({ planets: planets as never, flags, registry: new Registry(), production });
    const replies: { t: string; d: { code?: string } }[] = [];
    ingress.handle({ playerId: 'p', planetId: 'pl', reply: (m) => replies.push(m as (typeof replies)[number]) }, { v: 1, t: 'cmd', id: 'cm_1', d: { kind, args } } as never);
    return new Promise<{ replies: { t: string; d: { code?: string } }[]; submitted: unknown[] }>((res) => setTimeout(() => res({ replies, submitted }), 5));
  };

  it('refuses dev kinds in production as unknown_kind and submits nothing', async () => {
    const r = await run(true, 'dev.ping');
    expect(r.replies[0].d.code).toBe('unknown_kind');
    expect(r.submitted).toEqual([]);
  });

  it('derives colony and source on the server', async () => {
    const r = await run(false, 'dev.ping');
    expect(r.submitted[0]).toMatchObject({ colonyIndex: null, source: 'dev', commandId: 'cm_1', kind: 'dev.ping' });
    expect(r.replies[0]).toMatchObject({ t: 'cmd.ack', d: { id: 'cm_1', appliedAtTick: 7 } });
  });
});

import { describe, expect, it } from 'vitest';
import { encodeWire, decodeWire, newId } from '@terra/contracts';
import { REAUTH_LEAD_MS, WsTransport, type SocketLike, type WsTransportDeps } from './WsTransport';
import type { SessionTarget } from './types';
import { backoffDelay } from './backoff';
import { bannerText } from './bannerText';
import type { ServerMessage } from '@terra/contracts';

class FakeSocket implements SocketLike {
  binaryType = 'blob';
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onclose: ((e: { code: number; reason: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  sent: { t: string; d: unknown }[] = [];
  closed = false;
  send(data: string | Uint8Array) { this.sent.push(decodeWire(data) as { t: string; d: unknown }); }
  close() { this.closed = true; }
  server(msg: object) { const f = encodeWire({ v: 1, ...msg }); this.onmessage?.({ data: typeof f === 'string' ? f : f.buffer.slice(f.byteOffset, f.byteOffset + f.byteLength) }); }
  drop(code: number, reason = '') { this.onclose?.({ code, reason }); }
}

function harness(target: Partial<SessionTarget> = {}) {
  let now = 0;
  const timers: { at: number; fn: () => void; h: number }[] = [];
  const sockets: FakeSocket[] = [];
  let id = 0;
  const deps: WsTransportDeps = {
    socket: () => { const s = new FakeSocket(); sockets.push(s); return s; },
    now: () => now,
    setTimer: (fn, ms) => { const h = ++id; timers.push({ at: now + ms, fn, h }); return h; },
    clearTimer: (h) => { const i = timers.findIndex((t) => t.h === h); if (i >= 0) timers.splice(i, 1); },
    random: () => 0.5,
    clientVersion: 'test',
  };
  const planetId = newId('pl');
  const tgt: SessionTarget = { url: 'ws://x/ws', accessToken: 'dev:alice', resolve: async () => ({ planetId }), ...target };
  const t = new WsTransport(tgt, deps);
  const got: ServerMessage[] = [];
  t.onMessage((m) => got.push(m));
  const flush = () => new Promise((r) => setTimeout(r, 0));
  const advance = async (ms: number) => {
    now += ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      const next = timers[0];
      if (!next || next.at > now) break;
      timers.shift();
      next.fn();
      await flush();
    }
  };
  const welcome = (s: FakeSocket, tick: number) => s.server({ t: 'welcome', d: {
    reason: 'join', colonyId: null, planet: { id: planetId, type: 'temperate', name: 'Dev' }, state: new Uint8Array([1]),
    simVersion: 1, dataHash: 'h', tick, serverTimeMs: 0, tickMs: 200, deltaHz: 5, flags: ['W00'] } });
  const handshake = async (s: FakeSocket, tick = 10) => {
    s.onopen?.();
    s.server({ t: 'ready', d: { playerId: newId('pr'), flags: ['W00'] } });
    welcome(s, tick);
  };
  return { t, tgt, sockets, got, flush, advance, handshake, welcome, planetId, timers, setNow: (n: number) => { now = n; } };
}

const delta = (from: number, to: number) => ({ t: 'delta', d: { fromTick: from, toTick: to, diff: new Uint8Array([0]) } });

describe('WsTransport', () => {
  it('hello → ready → join → welcome → streaming', async () => {
    const h = harness();
    h.t.start(); await h.flush();
    const s = h.sockets[0];
    await h.handshake(s);
    expect(s.sent.map((m) => m.t)).toEqual(['hello', 'join']);
    expect((s.sent[1].d as { planetId: string }).planetId).toBe(h.planetId);
    expect(h.t.state.phase).toBe('welcomed');
    s.server(delta(10, 11));
    expect(h.t.state.phase).toBe('streaming');
    expect(h.got.map((m) => m.t)).toEqual(['ready', 'welcome', 'delta']);
  });

  it('a delta gap re-joins and drops the delta', async () => {
    const h = harness();
    h.t.start(); await h.flush();
    const s = h.sockets[0];
    await h.handshake(s);
    s.server(delta(12, 13));
    expect(h.t.state.phase).toBe('resyncing');
    expect(s.sent.at(-1)?.t).toBe('join');
    expect(h.got.filter((m) => m.t === 'delta')).toHaveLength(0);
    h.welcome(s, 20);
    expect(h.t.state.phase).toBe('welcomed');
  });

  it('server restart (4012) reconnects with backoff and shows Reconnecting…', async () => {
    const h = harness();
    h.t.start(); await h.flush();
    await h.handshake(h.sockets[0]);
    h.sockets[0].drop(4012);
    expect(h.t.state.phase).toBe('reconnecting');
    expect(bannerText(h.t.state, 0)).toBe('Reconnecting…');
    await h.advance(499);
    expect(h.sockets).toHaveLength(1);
    await h.advance(1); // 500 ms first step (jitter 0 at rand 0.5)
    expect(h.sockets).toHaveLength(2);
    h.sockets[1].drop(1006);
    await h.advance(1000);
    expect(h.sockets).toHaveLength(3);
    expect(bannerText(h.t.state, 61_000)).toBe('Reconnecting… still trying');
    await h.handshake(h.sockets[2], 50);
    expect(h.t.state.phase).toBe('welcomed');
    expect(bannerText(h.t.state, 61_000)).toBeNull();
  });

  it('4001 replaced is terminal; a repeated 4000 within 30 s is terminal', async () => {
    const h = harness();
    h.t.start(); await h.flush();
    h.sockets[0].drop(4001);
    expect(h.t.state.phase).toBe('terminal');
    const g = harness();
    g.t.start(); await g.flush();
    g.sockets[0].drop(4000);
    await g.advance(0);
    expect(g.sockets).toHaveLength(2);
    g.sockets[1].drop(4000);
    expect(g.t.state.phase).toBe('terminal');
  });
});

describe('backoff', () => {
  it('0.5 → 1 → 2 → 4 → 8 → 10 s cap with ±20 % jitter', () => {
    expect([1, 2, 3, 4, 5, 6, 9].map((a) => backoffDelay(a, () => 0.5))).toEqual([500, 1000, 2000, 4000, 8000, 10000, 10000]);
    expect(backoffDelay(6, () => 0)).toBe(8000);
    expect(backoffDelay(6, () => 0.999999)).toBe(12000);
  });
});

/** A guest target whose `refresh` hands out `jwt-1`, `jwt-2`, … valid for 15 min from the fake clock. */
function renewingTarget(clock: () => number, ttlMs = 900_000) {
  const tgt: Partial<SessionTarget> & { refreshes: number } = {
    accessToken: 'jwt-0', tokenExpiresAtMs: ttlMs, refreshes: 0,
    async refresh(this: SessionTarget & { refreshes: number }) {
      this.refreshes++;
      this.accessToken = `jwt-${this.refreshes}`;
      this.tokenExpiresAtMs = clock() + ttlMs;
      return true;
    },
  };
  return tgt;
}

describe('WsTransport token lifetime (FA-01)', () => {
  it('renews the token before it expires and sends reauth; the reauth ready does not re-join', async () => {
    let clock = 0;
    const r = renewingTarget(() => clock);
    const h = harness(r);
    h.t.start(); await h.flush();
    const s = h.sockets[0];
    await h.handshake(s);
    expect(s.sent.map((m) => m.t)).toEqual(['hello', 'join']);
    expect((s.sent[0].d as { accessToken: string }).accessToken).toBe('jwt-0');
    clock = 900_000 - REAUTH_LEAD_MS - 1;
    await h.advance(900_000 - REAUTH_LEAD_MS - 1);
    expect(s.sent.some((m) => m.t === 'reauth')).toBe(false);
    clock += 1;
    await h.advance(1);
    const reauth = s.sent.filter((m) => m.t === 'reauth');
    expect(reauth).toEqual([{ v: 1, t: 'reauth', d: { accessToken: 'jwt-1' } }]);
    s.server({ t: 'ready', d: { playerId: newId('pr'), flags: ['W00'] } });
    expect(s.sent.filter((m) => m.t === 'join')).toHaveLength(1);
    expect(h.t.state.phase).toBe('welcomed');
    // the next renewal is armed from the new expiry
    clock += 900_000 - REAUTH_LEAD_MS;
    await h.advance(900_000 - REAUTH_LEAD_MS);
    expect(s.sent.filter((m) => m.t === 'reauth').map((m) => (m.d as { accessToken: string }).accessToken)).toEqual(['jwt-1', 'jwt-2']);
  });

  it('forbidden (4003) → the retry says hello with a fresh token', async () => {
    const r = renewingTarget(() => 0);
    const h = harness(r);
    h.t.start(); await h.flush();
    await h.handshake(h.sockets[0]);
    h.sockets[0].drop(4003);
    await h.advance(0);
    expect(h.sockets).toHaveLength(2);
    h.sockets[1].onopen?.();
    expect(h.sockets[1].sent[0]).toEqual(expect.objectContaining({ t: 'hello', d: expect.objectContaining({ accessToken: 'jwt-1' }) }));
    expect((h.tgt as SessionTarget & { refreshes: number }).refreshes).toBe(1);
  });

  it('a network reconnect with an expired token renews it first; a dev token (no expiry) never refreshes', async () => {
    const r = renewingTarget(() => 0, 1000);
    const h = harness(r);
    h.t.start(); await h.flush();
    // hello at t=0 with 1 s left (< REAUTH_LEAD_MS): renewed before the first hello too
    h.sockets[0].onopen?.();
    expect((h.sockets[0].sent[0].d as { accessToken: string }).accessToken).toBe('jwt-1');
    let calls = 0;
    const d = harness({ refresh: async () => { calls++; return true; } });
    d.t.start(); await d.flush();
    await d.handshake(d.sockets[0]);
    d.sockets[0].drop(1006);
    await d.advance(500);
    expect(d.sockets).toHaveLength(2);
    expect(calls).toBe(0);
  });
});

describe('WsTransport server refusals (WS-12, BE-11/BE-12)', () => {
  it("bye 4003 not_your_planet is terminal at once and the banner says why; a plain 4003 still retries", async () => {
    const h = harness();
    h.t.start(); await h.flush();
    await h.handshake(h.sockets[0]);
    h.sockets[0].server({ t: 'bye', d: { code: 4003, reason: 'not_your_planet' } });
    h.sockets[0].drop(4003, 'not_your_planet');
    await h.advance(60_000);
    expect(h.sockets).toHaveLength(1);
    expect(h.t.state).toMatchObject({ phase: 'terminal', code: 4003, reason: 'not_your_planet' });
    expect(bannerText(h.t.state, 0)).toBe("Not your colony's planet");
    expect(h.got.some((m) => m.t === 'bye')).toBe(true);
    const g = harness();
    g.t.start(); await g.flush();
    await g.handshake(g.sockets[0]);
    g.sockets[0].drop(4003, 'forbidden');
    expect(g.t.state.phase).toBe('reconnecting');
    expect(bannerText({ ...g.t.state, phase: 'terminal' }, 0)).toBe("Couldn't join colony");
  });

  it('bye 4012 planet_down reconnects with backoff (the planet is restored from its snapshot)', async () => {
    const h = harness();
    h.t.start(); await h.flush();
    await h.handshake(h.sockets[0]);
    h.sockets[0].server({ t: 'bye', d: { code: 4012, reason: 'planet_down' } });
    h.sockets[0].drop(4012, 'planet_down');
    expect(h.t.state).toMatchObject({ phase: 'reconnecting', attempt: 1, code: 4012, reason: 'planet_down' });
    await h.advance(backoffDelay(1, () => 0.5));
    expect(h.sockets).toHaveLength(2);
    await h.handshake(h.sockets[1]);
    expect(h.t.state.phase).toBe('welcomed');
  });
});

describe('WsTransport lifecycle (FA-02, FA-15)', () => {
  it('a resync welcome restarts the ping chain instead of adding a second one', async () => {
    const h = harness();
    h.t.start(); await h.flush();
    const s = h.sockets[0];
    await h.handshake(s);
    s.server(delta(12, 13)); // gap → re-join
    h.welcome(s, 20);
    h.welcome(s, 30); // another resync on the same socket
    await h.advance(20_000);
    expect(s.sent.filter((m) => m.t === 'ping')).toHaveLength(1);
    await h.advance(20_000);
    expect(s.sent.filter((m) => m.t === 'ping')).toHaveLength(2);
  });

  it('dispose() stops for good: start() afterwards does not connect', async () => {
    const h = harness();
    h.t.start(); await h.flush();
    h.t.dispose();
    expect(h.sockets[0].closed).toBe(true);
    h.t.start(); await h.flush();
    expect(h.sockets).toHaveLength(1);
    expect(h.t.state.phase).toBe('idle');
    // stop() is not permanent: the banner's Retry starts a stopped transport again
    const g = harness();
    g.t.start(); await g.flush();
    g.t.stop();
    g.t.start(); await g.flush();
    expect(g.sockets).toHaveLength(2);
  });
});

import { describe, expect, it } from 'vitest';
import { encodeWire, decodeWire, newId } from '@terra/contracts';
import { WsTransport, type SocketLike, type WsTransportDeps } from './WsTransport';
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
  drop(code: number) { this.onclose?.({ code, reason: '' }); }
}

function harness() {
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
  const t = new WsTransport({ url: 'ws://x/ws', accessToken: 'dev:alice', resolve: async () => ({ planetId }) }, deps);
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
  return { t, sockets, got, flush, advance, handshake, welcome, planetId, setNow: (n: number) => { now = n; } };
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

/* eslint-disable @typescript-eslint/no-explicit-any -- loosely typed JSON frames */
import { decodeWire } from '@terra/contracts';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { Exchange, ord, sleep } from '../exchange/exchange-harness.js';
import { realWorld, type RealWorld } from './real-planet.js';

const WATER = 'bio.water/USDC';
const METAL = 'metals.t1/USDC';

let ex: Exchange;
let w: RealWorld;
let seller: Awaited<ReturnType<RealWorld['bot']>>[];
let buyer: Awaited<ReturnType<RealWorld['bot']>>[];
beforeAll(async () => {
  ex = await Exchange.boot({}, { realSim: true });
  w = await realWorld(ex, 4);
  const rich = { USDC: '500', 'bio.water': '500', 'metals.t1': '500' } as const;
  seller = [await w.bot({ idx: 0, fund: rich }), await w.bot({ idx: 2, fund: rich })];
  buyer = [await w.bot({ idx: 1, fund: rich }), await w.bot({ idx: 3, fund: rich })];
});
const sockets: WebSocket[] = [];
afterEach(() => { for (const s of sockets.splice(0)) s.terminate(); });
afterAll(async () => { await ex?.close(); });

class Client {
  readonly frames: Array<{ t: string; d: any }> = [];
  private waiters: Array<() => void> = [];
  constructor(readonly ws: WebSocket) {
    sockets.push(ws);
    ws.on('message', (data, isBinary) => {
      const buf = data as Buffer;
      const f = decodeWire(isBinary ? buf : buf.toString('utf8')) as { t: string; d: any };
      this.frames.push(f);
      this.waiters.splice(0).forEach((x) => x());
    });
  }
  static async open(url: string): Promise<Client> {
    const ws = new WebSocket(url);
    await new Promise<void>((res, rej) => { ws.once('open', () => res()); ws.once('error', rej); });
    return new Client(ws);
  }
  send(msg: object) { this.ws.send(JSON.stringify({ v: 1, ...msg })); }
  async next(t: string): Promise<{ t: string; d: any }> {
    for (;;) {
      const i = this.frames.findIndex((f) => f.t === t);
      if (i >= 0) return this.frames.splice(i, 1)[0]!;
      await new Promise<void>((r) => { this.waiters.push(r); });
    }
  }
  /** Pairs of the `market.*` pushes received so far. */
  pairs(): Set<string> {
    const out = new Set<string>();
    for (const f of this.frames) {
      if (f.t === 'market.book') out.add(f.d.pair);
      if (f.t === 'market.trade') out.add(f.d.trade.pair);
    }
    return out;
  }
  clear() { this.frames.length = 0; }
}

const wsUrl = () => `${ex.url.replace('http', 'ws')}/ws`;
async function connect(name: string, planetId = w.planetId): Promise<Client> {
  const c = await Client.open(wsUrl());
  c.send({ t: 'hello', d: { accessToken: `dev:${name}`, proto: [1], client: { app: 'game', version: 't' } } });
  await c.next('ready');
  c.send({ t: 'join', d: { planetId } });
  await c.next('welcome');
  return c;
}

/** One FINAL trade on `pair`: a resting ask and a crossing bid between two different colonies. */
async function trade(pair: typeof WATER | typeof METAL): Promise<void> {
  const i = pair === WATER ? 0 : 1;
  const resource = pair === WATER ? 'bio.water' : 'metals.t1';
  expect((await seller[i]!.place(ord('sell', 10, 1_000_000, { resource }))).status).toBe(201);
  expect((await buyer[i]!.place(ord('buy', 10, 1_000_000, { resource }))).body.order.state).toBe('FILLED');
  await ex.settle();
}

/** Drives both pairs and waits until `probe` (a never-subscribed socket) saw a push of each, then lets stragglers arrive. */
async function drive(probe: Client): Promise<void> {
  probe.clear();
  await trade(WATER);
  await trade(METAL);
  await ex.until(async () => probe.pairs().has(WATER) && probe.pairs().has(METAL), 10_000, 'probe sees both pairs');
  await sleep(300);
}

describe('REAL WebSocket: per-socket market topics (LED-25)', () => {
  it('never subscribed = all pairs; subscribe a subset narrows; unsubscribe removes; sockets are independent', async () => {
    const all = await connect('topicall');
    const sub = await connect('topicsub');
    const two = await connect('topictwo');
    sub.send({ t: 'market.subscribe', d: { planetId: w.planetId, pairs: [WATER] } });
    two.send({ t: 'market.subscribe', d: { planetId: w.planetId, pairs: [WATER, METAL] } });
    two.send({ t: 'market.unsubscribe', d: { planetId: w.planetId, pairs: [WATER] } });
    await sleep(200); // topic frames are processed in order before the pushes below
    await drive(all);
    expect([...all.pairs()].sort()).toEqual([WATER, METAL]);
    expect([...sub.pairs()]).toEqual([WATER]);
    expect([...two.pairs()]).toEqual([METAL]);
    // the subset socket still receives every kind of push for its pair
    expect(sub.frames.some((f) => f.t === 'market.trade')).toBe(true);
    // unsubscribe without pairs silences the socket entirely, until it subscribes again
    sub.send({ t: 'market.unsubscribe', d: { planetId: w.planetId } });
    await sleep(200);
    sub.clear(); two.clear();
    await drive(all);
    expect(sub.pairs().size).toBe(0);
    sub.send({ t: 'market.subscribe', d: { planetId: w.planetId, pairs: [METAL] } });
    await sleep(200);
    sub.clear();
    await drive(all);
    expect([...sub.pairs()]).toEqual([METAL]);
  });

  it('a subscribe for another planet (or before joining) is ignored: the socket keeps receiving every pair', async () => {
    const c = await connect('topicother');
    c.send({ t: 'market.subscribe', d: { planetId: 'some-other-planet', pairs: [WATER] } });
    c.send({ t: 'market.unsubscribe', d: { planetId: 'some-other-planet' } });
    const lobby = await Client.open(wsUrl()); // never joined: the same frames are ignored, the socket stays open
    lobby.send({ t: 'hello', d: { accessToken: 'dev:topiclobby', proto: [1], client: { app: 'game', version: 't' } } });
    await lobby.next('ready');
    lobby.send({ t: 'market.subscribe', d: { planetId: w.planetId, pairs: [WATER] } });
    await sleep(200);
    await drive(c);
    expect([...c.pairs()].sort()).toEqual([WATER, METAL]);
    expect(lobby.ws.readyState).toBe(WebSocket.OPEN);
    expect(lobby.pairs().size).toBe(0); // not in the room: nothing is pushed
  });

  it('leave and re-join, and a reconnect (new socket), reset the filter to all pairs', async () => {
    const c = await connect('topicreset');
    c.send({ t: 'market.subscribe', d: { planetId: w.planetId, pairs: [WATER] } });
    await sleep(200);
    c.send({ t: 'leave', d: {} });
    await sleep(200);
    c.send({ t: 'join', d: { planetId: w.planetId } });
    await c.next('welcome');
    const probe = await connect('topicprobe');
    await drive(probe);
    expect([...c.pairs()].sort()).toEqual([WATER, METAL]); // re-join: back to all pairs
    c.send({ t: 'market.subscribe', d: { planetId: w.planetId, pairs: [WATER] } });
    await sleep(200);
    c.ws.terminate();
    const again = await connect('topicreset'); // reconnect of the same player
    await drive(probe);
    expect([...again.pairs()].sort()).toEqual([WATER, METAL]);
  });

  it('a malformed topic frame (bad pair id, too many pairs) is ignored and never closes the socket', async () => {
    const c = await connect('topicbad');
    c.send({ t: 'market.subscribe', d: { planetId: w.planetId, pairs: ['not a pair!'] } });
    c.send({ t: 'market.subscribe', d: { planetId: w.planetId, pairs: Array.from({ length: 65 }, () => WATER) } });
    c.send({ t: 'market.subscribe', d: { planetId: w.planetId } });
    await sleep(200);
    await drive(c);
    expect([...c.pairs()].sort()).toEqual([WATER, METAL]);
    expect(c.ws.readyState).toBe(WebSocket.OPEN);
  });
});

import { randomUUID } from 'node:crypto';
import { TradeBookResponse, TradeOverviewResponse, TRADE_API_ROUTES, tradeApiOpenApi, toChainUnits, marketOrderRef, type SimCommandV1 } from '@terra/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GamePlanets } from '../../src/game/game-planets.service.js';
import type { PlanetEventOf } from '../../src/bus/channels.js';
import { MarketColonies } from '../../src/market/orders/market-colonies.js';
import { TradeSimPort } from '../../src/market/trade/trade-sim.port.js';
import { devPlayerId } from '../../src/ws/session-verifier.js';
import { USDC, WATER, bootHarness, type Harness } from './market-harness.js';

let h: Harness;
let url: string;
const PLANET = 'povw';
const PAIR = 'bio.water/USDC';
const BURST = 40;
/** Public GETs that reached the throttle (guard-rejected ids never do). */
let publicCalls = 0;

async function call<T = unknown>(method: string, path: string, opts: { as?: string; body?: unknown; idem?: string; counted?: boolean } = {}): Promise<{ status: number; body: T; headers: Headers }> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.idem) headers['idempotency-key'] = opts.idem;
  if (method === 'GET' && path.startsWith('/trade/') && !opts.as && opts.counted !== false) publicCalls += 1;
  const r = await fetch(`${url}/v1${path}${opts.as ? `${path.includes('?') ? '&' : '?'}as=${opts.as}` : ''}`, { method, headers, ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }) });
  return { status: r.status, body: (await r.json().catch(() => ({}))) as T, headers: r.headers };
}

const seqs = new Map<string, number>();
function fakeSim(h2: Harness) {
  return async (planetId: string, cmd: SimCommandV1) => {
    const colonyId = `col_${cmd.colonyIndex}`;
    if (cmd.kind === 'market.placeOrder') {
      const orderSeq = (seqs.get(`${planetId}${colonyId}`) ?? 0) + 1;
      seqs.set(`${planetId}${colonyId}`, orderSeq);
      h2.bus.emit('planet.event', {
        planetId, tick: 1, kind: 'marketOrderRequested', severity: 'info', colonyIds: [colonyId],
        data: { ref: marketOrderRef(colonyId, orderSeq), orderSeq, colonyId, colonyIndex: cmd.colonyIndex, ...(cmd.args as Record<string, unknown>), stallFeeBp: 100, hubEntityId: 3 },
      } as unknown as PlanetEventOf<'marketOrderRequested'>);
    }
    return { ok: true, commandId: cmd.commandId, appliedAtTick: 1 } as never;
  };
}

const order = (side: 'buy' | 'sell', amount: number, total: string) => ({ planetId: PLANET, side, resource: 'bio.water', amount, price: { token: 'USDC', amount: total }, ttlS: 3600, ...(side === 'buy' ? { maxStallFeeBp: 100 } : {}) });
const rowOf = (o: TradeOverviewResponse, pair = PAIR) => o.overview.find((r) => r.pair === pair)!;

beforeAll(async () => {
  process.env.TA_TRADE_PUBLIC_RPS = '0.001';
  process.env.TA_TRADE_PUBLIC_BURST = String(BURST);
  h = await bootHarness();
  h.app.get(GamePlanets).markScenarioColonyPlanet(PLANET, [0, 1, 2, 3]);
  h.app.get(TradeSimPort).override = fakeSim(h);
  await h.app.listen(0, '127.0.0.1');
  url = (await h.app.getUrl()).replace('[::1]', '127.0.0.1');
  const colony = (await h.app.get(MarketColonies).ofPlayer(devPlayerId('olga'), PLANET, true))!;
  await h.intents.testRegisterSigner(colony.accountId);
  await h.intents.testSeedVerifier(colony.accountId, WATER, toChainUnits('bio.water', 600n));
  await h.intents.testSeedVerifier(colony.accountId, USDC, 50_000_000n);
});
afterAll(async () => {
  delete process.env.TA_TRADE_PUBLIC_RPS;
  delete process.env.TA_TRADE_PUBLIC_BURST;
  await h?.close();
});

describe('GET /v1/trade/overview/:planetId', () => {
  it('is in the route table and the OpenAPI document', () => {
    expect(TRADE_API_ROUTES.overview).toMatchObject({ method: 'GET', path: '/v1/trade/overview/:planetId', auth: 'none' });
    expect(Object.keys(tradeApiOpenApi().paths as Record<string, unknown>)).toContain('/v1/trade/overview/{planetId}');
  });

  it('empty books: one row per tradable pair, everything null / 0, bounded size', async () => {
    const r = await call('GET', `/trade/overview/${PLANET}`);
    expect(r.status).toBe(200);
    const o = TradeOverviewResponse.parse(r.body);
    const pairs = (await call<{ pairs: Array<{ pair: string }> }>('GET', '/trade/pairs')).body.pairs.map((p) => p.pair);
    expect(o.overview.map((x) => x.pair)).toEqual(pairs);
    expect(o.overview.length).toBeGreaterThan(50);
    expect(o.overview.every((x) => x.bestBid === null && x.bestAsk === null && x.last === null && x.volume24h === 0)).toBe(true);
    expect(JSON.stringify(r.body).length).toBeLessThan(200_000);
  });

  it('one-sided then both sides: best levels equal the book endpoint, exact rationals', async () => {
    expect((await call('POST', '/trade/orders', { as: 'olga', idem: randomUUID(), body: order('sell', 100, '5000000') })).status).toBe(201);
    expect((await call('POST', '/trade/orders', { as: 'olga', idem: randomUUID(), body: order('sell', 50, '2000000') })).status).toBe(201);
    const one = rowOf(TradeOverviewResponse.parse((await call('GET', `/trade/overview/${PLANET}`)).body));
    expect(one.bestBid).toBeNull();
    expect(one.bestAsk).toMatchObject({ num: '40000', den: 1, amount: 50, orders: 1 });
    expect((await call('POST', '/trade/orders', { as: 'olga', idem: randomUUID(), body: order('buy', 10, '100000') })).status).toBe(201);
    const o = TradeOverviewResponse.parse((await call('GET', `/trade/overview/${PLANET}`)).body);
    const row = rowOf(o);
    expect(row.bestBid).toMatchObject({ num: '10000', den: 1, amount: 10 });
    expect(row.bestAsk).toMatchObject({ num: '40000', den: 1 });
    const book = TradeBookResponse.parse((await call('GET', `/trade/book/${PLANET}/${encodeURIComponent(PAIR)}?levels=1`)).body);
    expect(row.bestBid).toEqual(book.bids[0]);
    expect(row.bestAsk).toEqual(book.asks[0]);
    expect(o.overview.filter((x) => x.bestBid || x.bestAsk)).toHaveLength(1); // other pairs stay empty
  });

  it('fixture orders (market.seed) show up on their pair', async () => {
    await call('POST', '/dev/commands/market.seed', { body: { planetId: 'povw2', pair: 'bio.water/metals.t1' } });
    const o = TradeOverviewResponse.parse((await call('GET', '/trade/overview/povw2')).body);
    const row = rowOf(o, 'bio.water/metals.t1');
    expect(row.bestBid).not.toBeNull();
    expect(row.bestAsk).not.toBeNull();
    expect(rowOf(o).bestAsk).toBeNull();
  });

  it('a malformed planet id is 400; an unknown planet is an empty overview (like the book and board routes), never a 5xx', async () => {
    const bad = await call<{ error: { code: string } }>('GET', '/trade/overview/bad%20id', { counted: false });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('invalid_request');
    expect((await call('GET', `/trade/overview/${'x'.repeat(200)}`, { counted: false })).status).toBe(400);
    const unknown = await call('GET', '/trade/overview/never-heard-of-it');
    expect(unknown.status).toBe(200);
    expect(TradeOverviewResponse.parse(unknown.body).overview.every((x) => x.bestBid === null && x.bestAsk === null)).toBe(true);
  });

  it('counts as ONE request of the per-IP bucket (env sized) and is limited like the other public reads', async () => {
    const left = BURST - publicCalls;
    expect(left).toBeGreaterThan(5);
    const ok: number[] = [];
    for (let i = 0; i < left; i++) ok.push((await call('GET', `/trade/overview/${PLANET}`)).status);
    expect(ok.every((s) => s === 200)).toBe(true); // `left` overview calls cost `left` tokens, not 110 x left
    const limited = await call<{ error: { code: string } }>('GET', `/trade/overview/${PLANET}`);
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('rate_limited');
    expect(limited.headers.get('retry-after')).not.toBeNull();
    expect((await call('GET', `/trade/board/${PLANET}`)).status).toBe(429); // the bucket is shared with the other public reads
  });
});

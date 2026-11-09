import { randomUUID } from 'node:crypto';
import { CreateTradeKeyResponse, marketOrderRef, type SimCommandV1 } from '@terra/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PlanetEventOf } from '../../src/bus/channels.js';
import { GamePlanets } from '../../src/game/game-planets.service.js';
import { MarketBooks } from '../../src/market/book/market-books.js';
import { PriceBoardService } from '../../src/market/board/price-board.service.js';
import { TradeSimPort } from '../../src/market/trade/trade-sim.port.js';
import { bootHarness, type Harness } from '../market/market-harness.js';

/** Adversarial review of the W13 trade API (security + money correctness). Each `it` is a proof of one finding or of a clean bill. */
let h: Harness;
let url: string;
const PLANET = 'preview';
const PLANET2 = 'preview2';
const seqs = new Map<string, number>();
let rejectCancels = false;

function fakeSim(h2: Harness) {
  return async (planetId: string, cmd: SimCommandV1) => {
    const colonyId = `col_${cmd.colonyIndex}`;
    if (cmd.kind === 'market.placeOrder') {
      const a = cmd.args as Record<string, unknown>;
      const orderSeq = (seqs.get(`${planetId}${colonyId}`) ?? 0) + 1;
      seqs.set(`${planetId}${colonyId}`, orderSeq);
      h2.bus.emit('planet.event', {
        planetId, tick: 1, kind: 'marketOrderRequested', severity: 'info', colonyIds: [colonyId],
        data: { ref: marketOrderRef(colonyId, orderSeq), orderSeq, colonyId, colonyIndex: cmd.colonyIndex, ...a, stallFeeBp: 100, hubEntityId: 3 },
      } as unknown as PlanetEventOf<'marketOrderRequested'>);
    } else if (cmd.kind === 'market.cancelOrder') {
      if (rejectCancels) return { ok: false, code: 'host_unavailable' } as never;
      h2.bus.emit('planet.event', {
        planetId, tick: 2, kind: 'marketCancelRequested', severity: 'info', colonyIds: [colonyId],
        data: { colonyId, colonyIndex: cmd.colonyIndex, orderId: (cmd.args as { orderId: string }).orderId },
      } as unknown as PlanetEventOf<'marketCancelRequested'>);
    }
    return { ok: true, commandId: cmd.commandId, appliedAtTick: 1 } as never;
  };
}

interface Reply<T = unknown> { status: number; body: T }
async function call<T = unknown>(method: string, path: string, opts: { key?: string; as?: string; body?: unknown; idem?: string } = {}): Promise<Reply<T>> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.key) headers.authorization = `Bearer ${opts.key}`;
  if (opts.idem) headers['idempotency-key'] = opts.idem;
  const q = opts.as ? `${path.includes('?') ? '&' : '?'}as=${opts.as}` : '';
  const r = await fetch(`${url}/v1${path}${q}`, { method, headers, ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }) });
  return { status: r.status, body: (await r.json().catch(() => ({}))) as T };
}
const sell = (over: Record<string, unknown> = {}) => ({ side: 'sell', resource: 'bio.water', amount: 10, price: { token: 'USDC', amount: '5000000' }, ttlS: 3600, ...over });
async function bot(name: string, index: number, extra: Record<string, unknown> = {}) {
  const r = await call('POST', '/dev/trade/bots', { body: { name, planetId: PLANET, colonyIndex: index, fund: { USDC: '1000', 'bio.water': '500' }, ...extra } });
  expect(r.status).toBe(201);
  return r.body as CreateTradeKeyResponse & { ownerId: string };
}

beforeAll(async () => {
  h = await bootHarness();
  h.app.get(GamePlanets).markScenarioColonyPlanet(PLANET, [0, 1, 2, 3, 4, 5, 6, 7]);
  h.app.get(GamePlanets).markScenarioColonyPlanet(PLANET2, [0, 1, 2, 3, 4, 5, 6, 7]);
  h.app.get(TradeSimPort).override = fakeSim(h);
  await h.app.listen(0, '127.0.0.1');
  url = (await h.app.getUrl()).replace('[::1]', '127.0.0.1');
});
afterAll(async () => h?.close());

describe('review: key management scope abuse (IDOR within one owner)', () => {
  it('a read-only key cannot revoke a sibling key of the same owner (revoke is session-only)', async () => {
    const owner = await bot('rv-owner', 1, { scopes: ['read'] });
    // the dev bot's ownerId is `bot:<name>`: the same name through the dev route yields a same-owner sibling key
    const sib = await bot('rv-owner', 1, { scopes: ['read', 'trade'] });
    const r = await call<{ error?: { code: string } }>('DELETE', `/trade/keys/${sib.keyId}`, { key: owner.secret });
    expect(r.status).toBe(403);
    expect((await call('GET', '/trade/orders', { key: sib.secret })).status).toBe(200); // still alive
  });

  it('a key cannot change its own or a sibling allowance beyond its own kill switch', async () => {
    const a = await bot('al-owner', 1);
    const b = await bot('al-owner', 1);
    const widen = await call('PATCH', `/trade/keys/${a.keyId}/allowance`, { key: a.secret, body: { dailyBudget: '99999999999' } });
    expect(widen.status).toBe(403);
    const other = await call('PATCH', `/trade/keys/${b.keyId}/allowance`, { key: a.secret, body: { killSwitch: true } });
    expect(other.status).toBe(403);
  });

  it('another owner can neither see, cancel nor revoke my key or order', async () => {
    const a = await bot('victim', 1);
    const placed = await call<{ order: { orderId: string } }>('POST', '/trade/orders', { key: a.secret, idem: randomUUID(), body: sell() });
    expect(placed.status).toBe(201);
    const thief = await bot('thief', 2);
    expect((await call('DELETE', `/trade/orders/${placed.body.order.orderId}`, { key: thief.secret })).status).toBe(404);
    expect((await call('DELETE', `/trade/keys/${a.keyId}`, { as: 'thief' })).status).toBe(404);
    expect((await call('DELETE', `/trade/keys/${a.keyId}`, { key: thief.secret })).status).toBe(403); // keys never manage keys
    const theirs = await call<{ orders: unknown[] }>('GET', '/trade/orders', { key: thief.secret });
    expect(theirs.body.orders).toHaveLength(0);
  });
});

describe('review: unbounded key creation defeats the per-key rate limit', () => {
  it('an owner session can hold only a bounded number of active keys', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 25; i++) codes.push((await call('POST', '/trade/keys', { as: 'keyhoarder', body: { planetId: PLANET, label: `k${i}` } })).status);
    expect(codes.filter((c) => c === 201).length).toBeLessThanOrEqual(20);
  });
});

describe('review: unparseable numeric query values are 400, never a 500', () => {
  it.each(['/trade/fills?limit=abc', '/trade/fills?limit=-5', '/trade/fills?limit=1e3', `/trade/book/${PLANET}/bio.water%2FUSDC?levels=abc`, `/trade/book/${PLANET}/bio.water%2FUSDC?levels=-1`])('%s', async (path) => {
    const b = await bot('numeric', 6);
    expect((await call('GET', path, { key: b.secret })).status).toBe(400);
  });
});

describe('review: public reads must not grow server memory per probed planet', () => {
  it('book / board of unknown planet ids do not create cache entries', async () => {
    const books = h.app.get(MarketBooks);
    const board = h.app.get(PriceBoardService) as unknown as { cache: Map<string, unknown> };
    const before = (await books.loadedPairs()).length;
    const beforeBoard = board.cache.size;
    for (let i = 0; i < 40; i++) {
      await call('GET', `/trade/book/probe-${i}/bio.water%2FUSDC`);
      await call('GET', `/trade/book/probe-${i}/bio.water%2FUSDC/orders`);
    }
    expect((await call('GET', `/trade/book/${PLANET}/%2525zz`)).status).toBe(400); // malformed escape: 400, not a URIError 500
    for (let i = 0; i < 300; i++) await call('GET', `/trade/board/probe-${i}`);
    expect((await books.loadedPairs()).length).toBe(before);
    expect(board.cache.size).toBeLessThanOrEqual(Math.max(beforeBoard, 256));
  });
});

describe('review: SSE connection limits', () => {
  it('a key may hold only a few streams at once, and a revoked key is cut off', async () => {
    const b = (await call<CreateTradeKeyResponse>('POST', '/trade/keys', { as: 'sse', body: { planetId: PLANET, label: 'sse' } })).body;
    const ctrls: AbortController[] = [];
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) {
      const c = new AbortController();
      ctrls.push(c);
      const r = await fetch(`${url}/v1/trade/stream`, { headers: { authorization: `Bearer ${b.secret}` }, signal: c.signal });
      statuses.push(r.status);
      if (r.status !== 200) await r.body?.cancel();
    }
    expect(statuses.filter((s) => s === 200).length).toBeLessThanOrEqual(5);
    for (const c of ctrls) c.abort();

    const live = new AbortController();
    const res = await fetch(`${url}/v1/trade/stream`, { headers: { authorization: `Bearer ${b.secret}` }, signal: live.signal });
    expect(res.status).toBe(200);
    const reader = res.body!.getReader();
    await reader.read(); // hello
    expect((await call('DELETE', `/trade/keys/${b.keyId}`, { as: 'sse' })).status).toBe(200);
    const ended = await Promise.race([
      (async () => { for (;;) { const { done } = await reader.read(); if (done) return true; } })().catch(() => true),
      new Promise<boolean>((r) => setTimeout(() => r(false), 6000)),
    ]);
    live.abort();
    expect(ended).toBe(true);
  }, 20_000);
});

describe('review: allowance cannot be raced', () => {
  it('parallel placements never exceed maxOpenOrders / dailyBudget', async () => {
    const b = await bot('racer', 3, { allowance: { maxOpenOrders: 3, dailyBudget: '12000000', maxOrderNotional: '6000000' } });
    const rs = await Promise.all(Array.from({ length: 10 }, () => call<{ status: string }>('POST', '/trade/orders', { key: b.secret, idem: randomUUID(), body: sell({ price: { token: 'USDC', amount: '5000000' } }) })));
    const ok = rs.filter((r) => r.status === 201 || r.status === 202).length;
    expect(ok).toBeLessThanOrEqual(2); // 12 USDC budget / 5 USDC per order
  });

  it('the same Idempotency-Key under two different keys / owners is two independent requests', async () => {
    const a = await bot('idem-a', 4);
    const b = await bot('idem-b', 5);
    const idem = randomUUID();
    const ra = await call<{ order: { orderId: string } }>('POST', '/trade/orders', { key: a.secret, idem, body: sell() });
    const rb = await call<{ order: { orderId: string } }>('POST', '/trade/orders', { key: b.secret, idem, body: sell() });
    expect([ra.status, rb.status]).toEqual([201, 201]);
    expect(ra.body.order.orderId).not.toBe(rb.body.order.orderId);
  });
});

describe('review round 2: cancel retry, carried-over budget, planet-scoped refs', () => {
  it('a rejected cancel without an Idempotency-Key can be retried', async () => {
    const b = await bot('retry', 1);
    const placed = await call<{ order: { orderId: string } }>('POST', '/trade/orders', { key: b.secret, idem: randomUUID(), body: sell() });
    rejectCancels = true;
    expect((await call('DELETE', `/trade/orders/${placed.body.order.orderId}`, { key: b.secret })).status).toBe(422);
    rejectCancels = false;
    const again = await call<{ status: string }>('DELETE', `/trade/orders/${placed.body.order.orderId}`, { key: b.secret });
    expect(again.status).toBe(200);
    expect(again.body.status).toBe('cancelled');
  });

  it('a resting order of a previous UTC day still counts towards today\'s dailyBudget', async () => {
    const b = await bot('carry', 2, { allowance: { dailyBudget: '8000000', maxOrderNotional: '6000000' } });
    const first = await call('POST', '/trade/orders', { key: b.secret, idem: randomUUID(), body: sell({ price: { token: 'USDC', amount: '5000000' } }) });
    expect(first.status).toBe(201);
    await h.db.prisma.tradeApiRequest.updateMany({ where: { keyId: b.keyId }, data: { createdAt: new Date(Date.now() - 36 * 3600_000) } });
    const second = await call<{ error?: { code: string } }>('POST', '/trade/orders', { key: b.secret, idem: randomUUID(), body: sell({ price: { token: 'USDC', amount: '5000000' } }) });
    expect(second.status).toBe(422);
    expect(second.body.error?.code).toBe('daily_budget_exceeded');
  });

  it('release by ref is scoped to the planet (same ref on two scenario planets)', async () => {
    const a = await bot('twinplanet', 7);
    const r2 = await call('POST', '/dev/trade/bots', { body: { name: 'twinplanet2', planetId: PLANET2, colonyIndex: 7, fund: { USDC: '1000', 'bio.water': '500' } } });
    const b = r2.body as CreateTradeKeyResponse;
    const o1 = (await call<{ order: { orderId: string } }>('POST', '/trade/orders', { key: a.secret, idem: randomUUID(), body: sell() })).body.order.orderId;
    const r2o = await call<{ order: { orderId: string } }>('POST', '/trade/orders', { key: b.secret, idem: randomUUID(), body: sell() });
    if (!r2o.body.order) throw new Error(JSON.stringify([r2.status, r2.body, r2o]));
    const o2 = r2o.body.order.orderId;
    const ref = (await h.order$(o2)).ref;
    expect((await h.order$(o1)).ref).toBe(ref); // the collision is real
    await h.release.release(ref, 'cancelled', 'col_7', PLANET2);
    expect((await h.order$(o2)).state).toBe('CANCELLED');
    expect((await h.order$(o1)).state).toBe('OPEN'); // the other planet's order is untouched
  });
});

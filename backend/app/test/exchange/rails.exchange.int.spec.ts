/* eslint-disable @typescript-eslint/no-explicit-any -- test harness: loosely typed JSON replies */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditPlanet } from './exchange-audit.js';
import { Exchange, ord, sleep, type Actor, type World } from './exchange-harness.js';

let ex: Exchange;
beforeAll(async () => { ex = await Exchange.boot(); });
afterAll(async () => { await ex?.close(); });

const code = (r: { body: any }) => r.body?.error?.code;
const orderCount = (planetId: string) => ex.prisma.marketOrder.count({ where: { planetId } });
const open = (planetId: string) => ex.prisma.marketOrder.count({ where: { planetId, state: { in: ['OPEN', 'PARTIAL'] } } });

describe('allowance rails over REST: stable codes, nothing reserved on a refusal', () => {
  it('kill_switch, pair_not_allowed, max_order_notional, max_open_orders, daily_budget_exceeded', async () => {
    const w = ex.world();
    const a = await w.bot({ allowance: { maxOpenOrders: 2, maxOrderNotional: '6000000', dailyBudget: '11000000', allowedPairs: ['bio.water/USDC'] } });
    expect(code(await a.place(ord('sell', 100, 9_000_000)))).toBe('max_order_notional');
    expect(code(await a.place(ord('sell', 10, 1_000_000, { resource: 'metals.t1' })))).toBe('pair_not_allowed');
    expect((await a.place(ord('sell', 100, 5_000_000))).status).toBe(201);
    expect((await a.place(ord('sell', 100, 5_000_000))).status).toBe(201);
    expect(code(await a.place(ord('sell', 10, 1_000_000)))).toBe('max_open_orders');
    expect(await orderCount(w.planetId)).toBe(2); // refusals created no order
    const b = await w.bot({ allowance: { dailyBudget: '7000000', maxOpenOrders: 10 } });
    expect((await b.place(ord('sell', 100, 5_000_000))).status).toBe(201);
    expect(code(await b.place(ord('sell', 100, 3_000_000)))).toBe('daily_budget_exceeded');
    const k = await w.bot();
    await ex.api('PATCH', `/trade/keys/${k.keyId}/allowance`, { auth: k.secret, body: { killSwitch: true } });
    expect(code(await k.place(ord('sell', 10, 1_000_000)))).toBe('kill_switch');
    const rows = await ex.prisma.tradeApiRequest.findMany({ where: { planetId: w.planetId, state: 'REJECTED' } });
    expect(rows.map((r) => r.errorCode).sort()).toEqual(['daily_budget_exceeded', 'kill_switch', 'max_open_orders', 'max_order_notional', 'pair_not_allowed']);
  });

  it('price_out_of_band passes while no reference exists, and rejects once an organic VWAP exists', async () => {
    const w = ex.world();
    const cheap = await w.bot({ allowance: { priceBandBp: 5000 } });
    expect((await cheap.place(ord('sell', 10, 100_000_000))).status).toBe(201); // absurd price, no reference: the rail cannot apply
    await cheap.cancel((await ex.ordersOf(w.planetId))[0]!.orderId);
    // build an organic reference: 4 trades between 8 different owners, 10 units for 0.1 USDC each => 10000 per unit
    for (let i = 0; i < 4; i++) {
      const [s, b] = [await w.bot(), await w.bot({ fund: { USDC: '5' } })];
      await s.place(ord('sell', 10, 100_000));
      expect((await b.place(ord('buy', 10, 100_000))).body.order.state).toBe('FILLED');
    }
    await ex.settle();
    ex.board.invalidate(w.planetId);
    const book = await ex.api('GET', `/trade/book/${w.planetId}/${encodeURIComponent('bio.water/USDC')}`);
    expect(book.body.reference).toEqual({ num: '10000', den: 1 });
    expect(code(await cheap.place(ord('sell', 10, 300_000)))).toBe('price_out_of_band'); // +200 %
    expect(code(await cheap.place(ord('sell', 10, 40_000)))).toBe('price_out_of_band'); // -60 %
    expect((await cheap.place(ord('sell', 10, 120_000))).status).toBe(201); // +20 %: inside the band
    expect((await cheap.place(ord('sell', 10, 150_000))).status).toBe(201); // exactly +50 %: the edge is inside
    expect(code(await cheap.place(ord('sell', 10, 150_001)))).toBe('price_out_of_band');
  });

  it('kill switch set mid-stream cancels the key\'s resting orders and releases each reservation once', async () => {
    const w = ex.world();
    const a = await w.bot({ allowance: { maxOpenOrders: 10 } });
    for (let i = 0; i < 3; i++) await a.place(ord('sell', 10, 1_000_000 + i));
    expect(await open(w.planetId)).toBe(3);
    const r = await ex.api('PATCH', `/trade/keys/${a.keyId}/allowance`, { auth: a.secret, body: { killSwitch: true } });
    expect(r.status).toBe(200);
    await ex.until(async () => (await open(w.planetId)) === 0, 8000, 'kill switch cancels');
    for (const o of await ex.ordersOf(w.planetId)) {
      expect(o.state).toBe('CANCELLED');
      expect(ex.releasesOf(o.orderId).filter((c) => (c.args as { reason: string }).reason === 'cancelled')).toHaveLength(1);
    }
    expect(code(await a.place(ord('sell', 10, 1_000_000)))).toBe('kill_switch');
    await auditPlanet(ex, w.planetId);
  });
});

describe('keys: revoke, forged, scopes, own data only', () => {
  const ownerKey = async (w: World, p: Actor, scopes?: string[]) => {
    const r = await ex.api('POST', '/trade/keys', { as: p.name, body: { planetId: w.planetId, label: 'k', ...(scopes ? { scopes } : {}) } });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return r.body as { keyId: string; secret: string };
  };

  it('revoke cancels resting orders; the revoked key is refused with key_revoked; forged and missing keys are unauthorized', async () => {
    const w = ex.world();
    const p = await w.player();
    await p.fund('USDC', 100_000_000n);
    const k = await ownerKey(w, p);
    const placed = await ex.api('POST', '/trade/orders', { auth: k.secret, idem: randomUUID(), body: ord('buy', 5, 100_000, { planetId: w.planetId }) });
    expect(placed.status).toBe(201);
    const rv = await ex.api('DELETE', `/trade/keys/${k.keyId}`, { as: p.name });
    expect(rv.body).toMatchObject({ revoked: true, cancelRequested: 1 });
    await ex.until(async () => (await open(w.planetId)) === 0, 8000, 'revoke cancels');
    const after = await ex.api('GET', `/trade/orders?planetId=${w.planetId}`, { auth: k.secret });
    expect([after.status, code(after)]).toEqual([401, 'key_revoked']);
    expect((await ex.api('POST', '/trade/orders', { auth: k.secret, idem: randomUUID(), body: ord('buy', 5, 100_000, { planetId: w.planetId }) })).status).toBe(401);
    const forged = `${k.secret.slice(0, -4)}AAAA`;
    expect(code(await ex.api('GET', `/trade/orders?planetId=${w.planetId}`, { auth: forged }))).toMatch(/unauthorized|key_revoked/);
    const live = await w.bot();
    const forgedLive = `${live.secret!.slice(0, -4)}AAAA`;
    expect(code(await ex.api('GET', `/trade/orders?planetId=${w.planetId}`, { auth: forgedLive }))).toBe('unauthorized');
    expect((await ex.api('GET', '/trade/orders', {})).status).toBe(401);
    expect((await ex.api('GET', '/trade/orders', { auth: 'junk' })).status).toBe(401);
  });

  it('scope violations: read-only cannot trade, trade-only cannot read, a key cannot create keys', async () => {
    const w = ex.world();
    const ro = await w.bot({ scopes: ['read'] });
    const rw = await w.bot({ scopes: ['trade'] });
    const r1 = await ro.place(ord('sell', 10, 1_000_000));
    expect([r1.status, code(r1)]).toEqual([403, 'forbidden_scope']);
    expect((await ro.req('GET', `/trade/orders?planetId=${w.planetId}`)).status).toBe(200);
    const r2 = await rw.req('GET', `/trade/orders?planetId=${w.planetId}`);
    expect([r2.status, code(r2)]).toEqual([403, 'forbidden_scope']);
    expect((await rw.place(ord('sell', 10, 1_000_000))).status).toBe(201);
    const r3 = await rw.req('POST', '/trade/keys', { body: { planetId: w.planetId, label: 'x' } });
    expect([r3.status, code(r3)]).toEqual([403, 'forbidden_scope']);
    const r4 = await ro.req('PATCH', `/trade/keys/${ro.keyId}/allowance`, { body: { killSwitch: true } });
    expect(r4.status).toBe(403); // manage scope needed
  });

  it('a bot reads only ITS OWN orders, fills and balances: no other colony\'s cargo or ids ever appear', async () => {
    const w = ex.world();
    const a = await w.bot({ fund: { 'metals.t1': '777', USDC: '300' } });
    const b = await w.bot({ fund: { 'minerals.t2': '555', 'bio.water': '100' } });
    const c = await w.bot({ fund: { USDC: '100' } });
    await b.place(ord('sell', 10, 1_000_000));
    await c.place(ord('buy', 10, 1_000_000));
    await ex.settle();
    const bal = await a.req('GET', '/trade/balances');
    expect(bal.body.colonyId).toBe(a.colonyId);
    expect(bal.body.inOrbit).toBeDefined();
    const everything = JSON.stringify([bal.body, (await a.req('GET', `/trade/orders?planetId=${w.planetId}`)).body, (await a.req('GET', `/trade/fills?planetId=${w.planetId}`)).body]);
    for (const other of [b, c]) for (const leak of [other.colonyId, other.accountId, other.ownerId, other.keyId!]) expect(everything).not.toContain(leak);
    expect(everything).not.toContain('minerals.t2');
    expect((await b.req('GET', `/trade/fills?planetId=${w.planetId}`)).body.fills).toHaveLength(1);
    expect((await a.req('GET', `/trade/fills?planetId=${w.planetId}`)).body.fills).toHaveLength(0);
    // a planet it does not belong to is refused, and so is reading another planet through the planetId filter
    expect(code(await a.req('GET', '/trade/balances?planetId=other-planet'))).toBe('wrong_planet');
    // a session of another player sees its own colony, never the bot's
    const p = await w.player();
    const pb = await p.req('GET', `/trade/balances?planetId=${w.planetId}`);
    expect(pb.body.colonyId).toBe(p.colonyId);
    expect(JSON.stringify(pb.body)).not.toContain('777');
  });
});

describe('malformed bodies: always a 4xx, never a 500, nothing created', () => {
  const huge = '9'.repeat(120);
  const cases: Array<[string, unknown]> = [
    ['fractional amount', ord('sell', 1.5, 1_000_000)],
    ['string amount', ord('sell', 'abc' as never, 1_000_000)],
    ['negative amount', ord('sell', -5, 1_000_000)],
    ['zero amount', ord('sell', 0, 1_000_000)],
    ['unsafe integer amount', ord('sell', Number.MAX_SAFE_INTEGER + 2, 1_000_000)],
    ['price abc', ord('sell', 10, 'abc')],
    ['price decimal', ord('sell', 10, '1.5')],
    ['price negative', ord('sell', 10, '-5')],
    ['price exponent', ord('sell', 10, '1e6')],
    ['price zero', ord('sell', 10, '0')],
    ['price 120 digits', ord('sell', 10, huge)],
    ['price 78 digits', ord('sell', 10, '9'.repeat(78))],
    ['price 79 digits', ord('sell', 10, '9'.repeat(79))],
    ['unknown quote token', ord('sell', 10, 1_000_000, { price: { token: 'DOGE', amount: '1000000' } })],
    ['unknown resource', ord('sell', 10, 1_000_000, { resource: 'nope' })],
    ['same base and quote', ord('sell', 10, 1_000_000, { resource: 'bio.water', price: { token: 'bio.water', amount: '1000000' } })],
    ['bad side', ord('sell', 10, 1_000_000, { side: 'hold' })],
    ['ttl not allowed', ord('sell', 10, 1_000_000, { ttlS: 5 })],
    ['maxStallFeeBp 2.5', ord('buy', 10, 1_000_000, { maxStallFeeBp: 2.5 })],
    ['maxStallFeeBp 101', ord('buy', 10, 1_000_000, { maxStallFeeBp: 101 })],
    ['maxStallFeeBp -1', ord('buy', 10, 1_000_000, { maxStallFeeBp: -1 })],
    ['unknown field', { ...ord('sell', 10, 1_000_000), evil: true }],
    ['missing price', { side: 'sell', resource: 'bio.water', amount: 10, ttlS: 3600 }],
    ['empty object', {}],
    ['null', null],
    ['array', []],
    ['string body', '"hi"'],
    ['broken json', '{"side":'],
  ];

  it.each(cases)('%s', async (_name, body) => {
    const w = ex.world();
    const a = await w.bot({ allowance: { maxOrderNotional: '1000000000000000000000' } });
    const send = body !== null && typeof body === 'object' && !Array.isArray(body) && Object.keys(body).length > 0 && !('planetId' in body) ? body : body;
    const r = await a.req('POST', '/trade/orders', { body: send === null ? 'null' : send, idem: randomUUID() });
    expect(r.status, JSON.stringify(r.body)).toBeGreaterThanOrEqual(400);
    expect(r.status, JSON.stringify(r.body)).toBeLessThan(500);
    expect(await orderCount(w.planetId)).toBe(0);
    await sleep(0);
  });

  it('bad Idempotency-Key shapes and a malformed order id on cancel are 4xx too', async () => {
    const w = ex.world();
    const a = await w.bot();
    for (const key of ['x'.repeat(81), 'has space', 'ünï']) {
      const r = await a.req('POST', '/trade/orders', { body: ord('sell', 10, 1_000_000), idem: key }).catch(() => ({ status: 400, body: {} }));
      expect(r.status).toBeLessThan(500);
    }
    const missing = await a.req('POST', '/trade/orders', { body: ord('sell', 10, 1_000_000) });
    expect([missing.status, code(missing)]).toEqual([400, 'idempotency_key_required']);
    expect((await a.cancel('%00../etc')).status).toBeLessThan(500);
    expect(await orderCount(w.planetId)).toBe(0);
  });
});

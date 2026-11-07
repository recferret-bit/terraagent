import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditPlanet, expectLedgerDelta } from './exchange-audit.js';
import { Exchange, ord } from './exchange-harness.js';

let ex: Exchange;
beforeAll(async () => { ex = await Exchange.boot(process.env.EX_POOL ? { TA_DB_POOL_SIZE: process.env.EX_POOL } : {}); });
afterAll(async () => { await ex?.close(); });

const snap = async () => { await ex.settle(); return { sup: await ex.supply(), led: await ex.ledger() }; };
/** Waits until every API request of the planet left SUBMITTED/LINKED (a place can answer 202 `pending` under load; it still completes). */
const quiet = (planetId: string) => ex.until(async () => (await ex.prisma.tradeApiRequest.count({ where: { planetId, state: { in: ['PENDING', 'SUBMITTED', 'LINKED'] } } })) === 0, 60_000, 'requests to finish');
const no5xx = (rs: Array<{ status: number }>) => expect(rs.filter((r) => r.status >= 500)).toEqual([]);

describe('races over REST', () => {
  it('parallel sells of one colony race the same reservation: never more than the colony holds', async () => {
    const w = ex.world();
    const a = await w.bot({ fund: { 'bio.water': '100' }, allowance: { maxOpenOrders: 50 } });
    const rs = await Promise.all(Array.from({ length: 10 }, () => a.place(ord('sell', 30, 300_000))));
    no5xx(rs);
    await quiet(w.planetId);
    expect((await ex.ordersOf(w.planetId)).filter((o) => o.state === 'OPEN')).toHaveLength(3); // 3 x 30 <= 100 < 4 x 30
    expect(rs.filter((r) => r.status === 422).every((r) => r.body.error.code === 'insufficient_cargo')).toBe(true);
    const open = (await ex.ordersOf(w.planetId)).filter((o) => o.state === 'OPEN');
    expect(open.reduce((s, o) => s + BigInt(o.reservedPrincipal.toFixed()), 0n)).toBe(90n);
    await auditPlanet(ex, w.planetId);
  });

  it('parallel buys of one colony cannot overspend its USDC (both fees reserved)', async () => {
    const w = ex.world();
    const a = await w.bot({ fund: { USDC: '25' }, allowance: { maxOpenOrders: 50, maxOrderNotional: '100000000' } });
    const rs = await Promise.all(Array.from({ length: 8 }, () => a.place(ord('buy', 10, 10_000_000)))); // 10.2 USDC each
    no5xx(rs);
    await quiet(w.planetId);
    expect((await ex.ordersOf(w.planetId)).filter((o) => o.state === 'OPEN')).toHaveLength(2);
    await auditPlanet(ex, w.planetId);
  });

  it('cancel races a fill: exactly one wins, nothing is released twice, ledger conserved', async () => {
    for (let round = 0; round < 6; round++) {
      const w = ex.world();
      const [s, b] = [await w.bot(), await w.bot({ fund: { USDC: '100' } })];
      const before = await snap();
      const ask = (await s.place(ord('sell', 10, 1_000_000))).body.order.orderId;
      const [c, f] = await Promise.all([s.cancel(ask), b.place(ord('buy', 10, 1_000_000))]);
      no5xx([c, f]);
      const row = await ex.order(ask);
      if (row.state === 'CANCELLED') expect(await ex.tradesOf(w.planetId)).toHaveLength(0);
      else { expect(row.state).toBe('FILLED'); expect(c.status).toBe(409); }
      await ex.settle();
      expect(await ex.supply()).toEqual(before.sup);
      await expectLedgerDelta(ex, w.planetId, before.led);
      await auditPlanet(ex, w.planetId);
    }
  });

  it('many simultaneous crossing orders: all fill, deterministic totals, conservation', async () => {
    const w = ex.world();
    const sellers = await Promise.all(Array.from({ length: 8 }, () => w.bot()));
    const buyers = await Promise.all(Array.from({ length: 8 }, () => w.bot({ fund: { USDC: '100' } })));
    const before = await snap();
    const rs = await Promise.all([...sellers.map((a) => a.place(ord('sell', 10, 1_000_000))), ...buyers.map((a) => a.place(ord('buy', 10, 1_000_000)))]);
    no5xx(rs);
    await quiet(w.planetId);
    await ex.settle();
    expect(await ex.supply()).toEqual(before.sup);
    const orders = await ex.ordersOf(w.planetId);
    expect(orders.map((o) => o.state), 'every order crosses an opposite one').toEqual(Array(16).fill('FILLED'));
    expect(await ex.tradesOf(w.planetId)).toHaveLength(8);
    await expectLedgerDelta(ex, w.planetId, before.led);
    await auditPlanet(ex, w.planetId);
  });

  it('several takers against shared makers concurrently: no maker is over-filled', async () => {
    const w = ex.world();
    const makers = await Promise.all(Array.from({ length: 4 }, () => w.bot()));
    const takers = await Promise.all(Array.from({ length: 3 }, () => w.bot({ fund: { USDC: '200' } })));
    const before = await snap();
    for (const m of makers) await m.place(ord('sell', 10, 1_000_000));
    const rs = await Promise.all(takers.map((t) => t.place(ord('buy', 25, 2_500_000))));
    no5xx(rs);
    await quiet(w.planetId);
    await ex.settle();
    const filled = (await ex.ordersOf(w.planetId)).filter((o) => o.side === 'sell').reduce((s, o) => s + Number(o.filled.toFixed()), 0);
    expect(filled).toBe(40); // 4 makers x 10 fully consumed by 75 wanted
    expect(await ex.supply()).toEqual(before.sup);
    await expectLedgerDelta(ex, w.planetId, before.led);
    await auditPlanet(ex, w.planetId);
  });
});

describe('idempotency and rate limiting', () => {
  it('the same POST with the same Idempotency-Key, sent 6 times in parallel, creates one order', async () => {
    const w = ex.world();
    const a = await w.bot();
    const key = randomUUID();
    const rs = await Promise.all(Array.from({ length: 6 }, () => a.place(ord('sell', 10, 1_000_000), key)));
    no5xx(rs);
    expect(rs.every((r) => [201, 202].includes(r.status))).toBe(true);
    await quiet(w.planetId);
    const replay = await a.place(ord('sell', 10, 1_000_000), key);
    expect(replay.status).toBe(201);
    expect(new Set([...rs, replay].filter((r) => r.status === 201).map((r) => r.body.order.orderId)).size).toBe(1);
    expect(await ex.prisma.marketOrder.count({ where: { planetId: w.planetId } })).toBe(1);
    expect(ex.simCmds.filter((c) => c.commandId === rs[0]!.body.requestId)).toHaveLength(1);
  });

  it('the same key with a different body is 422 idempotency_key_reuse and creates nothing', async () => {
    const w = ex.world();
    const a = await w.bot();
    const key = randomUUID();
    expect((await a.place(ord('sell', 10, 1_000_000), key)).status).toBe(201);
    const r = await a.place(ord('sell', 11, 1_000_000), key);
    expect([r.status, r.body.error.code]).toEqual([422, 'idempotency_key_reuse']);
    expect(await ex.prisma.marketOrder.count({ where: { planetId: w.planetId } })).toBe(1);
  });

  it('a retry after the order already filled returns the first answer, not a second order', async () => {
    const w = ex.world();
    const [s, b] = [await w.bot(), await w.bot({ fund: { USDC: '100' } })];
    await s.place(ord('sell', 10, 1_000_000));
    const key = randomUUID();
    const first = await b.place(ord('buy', 10, 1_000_000), key);
    await ex.settle();
    const again = await b.place(ord('buy', 10, 1_000_000), key);
    expect(again.body.order.orderId).toBe(first.body.order.orderId);
    expect(await ex.tradesOf(w.planetId)).toHaveLength(1);
  });

  it('100 rapid calls: 429s appear, no 5xx, and exactly the non-429 writes left a request row', async () => {
    const w = ex.world();
    const a = await w.bot({ allowance: { maxOpenOrders: 500 } });
    const rs = await Promise.all(Array.from({ length: 100 }, (_, i) => a.place(ord('sell', 1, 100_000 + i))));
    no5xx(rs);
    const limited = rs.filter((r) => r.status === 429);
    expect(limited.length).toBeGreaterThan(0);
    expect(limited.every((r) => r.body.error.code === 'rate_limited')).toBe(true);
    await quiet(w.planetId);
    expect(await ex.prisma.tradeApiRequest.count({ where: { planetId: w.planetId } })).toBe(rs.length - limited.length);
    const created = (await ex.ordersOf(w.planetId)).filter((o) => o.state === 'OPEN').length;
    expect(await ex.prisma.marketOrder.count({ where: { planetId: w.planetId, state: 'OPEN' } })).toBe(created);
    expect(created).toBeLessThanOrEqual(20); // the open-order limit also held under the burst
    await auditPlanet(ex, w.planetId);
  });
});

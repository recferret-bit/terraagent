/* eslint-disable @typescript-eslint/no-explicit-any -- loosely typed JSON replies */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GamePlanets } from '../../src/game/game-planets.service.js';
import { EventBus } from '../../src/bus/event-bus.js';
import { Exchange, ord, sleep } from '../exchange/exchange-harness.js';
import { code, expectConserved, expectSimMirror, grant, snapshotOf } from './real-checks.js';
import { realWorld, simColony } from './real-planet.js';

let ex: Exchange;
beforeAll(async () => { ex = await Exchange.boot({}, { realSim: true }); });
afterAll(async () => { await ex?.close(); });

const openCount = (planetId: string) => ex.prisma.marketOrder.count({ where: { planetId, state: { in: ['OPEN', 'PARTIAL'] } } });
const orderCount = (planetId: string) => ex.prisma.marketOrder.count({ where: { planetId } });

/** The sim learns reservations through the bus (async): wait until its `reservedInOrbit.bio.water` is `n`. */
const simReserved = (planetId: string, idx: number, n: number) =>
  ex.until(async () => ((await simColony(ex, planetId, idx)).reservedInOrbit['bio.water'] ?? 0) === n, 8000, `sim reserved ${n} for ${idx}`);

describe('REAL sim: place, fill and cancel by player and bot', () => {
  it('a bot ask and a player bid trade; both mirrors, ledger and book stay consistent', async () => {
    const w = await realWorld(ex, 2);
    const bot = await w.bot({ idx: 0, fund: { USDC: '1', 'bio.water': '500' } });
    const pl = await w.player({ idx: 1, name: 'realbuyer' });
    await pl.fund('USDC', 50_000_000n);
    const before = await snapshotOf(ex);
    const ask = await bot.place(ord('sell', 20, 2_000_000));
    expect(ask.status, JSON.stringify(ask.body)).toBe(201);
    expect(ask.body.order).toMatchObject({ state: 'OPEN', actorKind: 'bot' });
    const bid = await pl.place(ord('buy', 20, 2_000_000));
    expect(bid.status, JSON.stringify(bid.body)).toBe(201);
    expect(bid.body.order).toMatchObject({ state: 'FILLED', actorKind: 'player' });
    await ex.settle();
    const [t] = await ex.tradesOf(w.planetId);
    expect(t).toMatchObject({ state: 'FINAL' });
    expect(await bot.bal('bio.water')).toBe(480n);
    expect(await pl.bal('bio.water')).toBe(20n);
    await expectConserved(ex, w.planetId, before, [bot, pl]);
    expect((await simColony(ex, w.planetId, 1)).inOrbit['bio.water']).toBe(20);
  });

  it('cancel by bot and by player releases the sim reservation exactly once', async () => {
    const w = await realWorld(ex, 2);
    const bot = await w.bot({ idx: 0 });
    const pl = await w.player({ idx: 1, name: 'realcanceller' });
    await grant(ex, pl, 'bio.water', 100);
    await pl.fund('USDC', 20_000_000n);
    const before = await snapshotOf(ex);
    const a = await bot.place(ord('sell', 30, 3_000_000));
    const b = await pl.place(ord('sell', 40, 9_000_000));
    const c = await pl.place(ord('buy', 5, 100_000));
    expect([a.status, b.status, c.status]).toEqual([201, 201, 201]);
    await simReserved(w.planetId, 0, 30);
    await simReserved(w.planetId, 1, 40);
    expect((await bot.cancel(a.body.order.orderId)).status).toBe(200);
    expect((await pl.cancel(b.body.order.orderId)).status).toBe(200);
    expect((await pl.cancel(c.body.order.orderId)).status).toBe(200);
    // a second cancel answers with the same terminal state and never sends a second release
    const again = await bot.cancel(a.body.order.orderId);
    expect(again.body.order?.state ?? again.body.state).toBe('CANCELLED');
    // a bot cannot cancel the player's order
    const d = await pl.place(ord('sell', 10, 1_000_000));
    expect((await bot.cancel(d.body.order.orderId)).status).toBeGreaterThanOrEqual(400);
    expect((await pl.cancel(d.body.order.orderId)).status).toBe(200);
    for (const o of await ex.ordersOf(w.planetId)) {
      expect(o.state).toBe('CANCELLED');
      expect(ex.releasesOf(o.orderId).filter((m) => (m.args as { reason: string }).reason === 'cancelled')).toHaveLength(1);
    }
    expect(await openCount(w.planetId)).toBe(0);
    await expectConserved(ex, w.planetId, before, [bot, pl]);
    expect((await simColony(ex, w.planetId, 1)).reservedInOrbit['bio.water'] ?? 0).toBe(0);
  });
});

describe('REAL sim: allowance rails', () => {
  it('max_open_orders, daily_budget_exceeded, price_out_of_band, pair_not_allowed, max_order_notional, kill_switch', async () => {
    const w = await realWorld(ex, 10);
    const a = await w.bot({ idx: 0, allowance: { maxOpenOrders: 2, maxOrderNotional: '6000000', dailyBudget: '11000000', allowedPairs: ['bio.water/USDC'] } });
    expect(code(await a.place(ord('sell', 100, 9_000_000)))).toBe('max_order_notional');
    expect(code(await a.place(ord('sell', 10, 1_000_000, { resource: 'metals.t1' })))).toBe('pair_not_allowed');
    expect((await a.place(ord('sell', 100, 5_000_000))).status).toBe(201);
    expect((await a.place(ord('sell', 100, 5_000_000))).status).toBe(201);
    expect(code(await a.place(ord('sell', 10, 1_000_000)))).toBe('max_open_orders');
    expect(await orderCount(w.planetId)).toBe(2);
    await simReserved(w.planetId, 0, 200); // refusals reserved nothing in the sim
    const b = await w.bot({ idx: 1, allowance: { dailyBudget: '7000000' } });
    expect((await b.place(ord('sell', 100, 5_000_000))).status).toBe(201);
    expect(code(await b.place(ord('sell', 100, 3_000_000)))).toBe('daily_budget_exceeded');
    // price band: the organic reference needs 4 trades between 8 different owners
    const banded = await w.bot({ idx: 2, allowance: { priceBandBp: 5000 } });
    const sellers = [banded, ...(await Promise.all([3, 4, 5].map((i) => w.bot({ idx: i }))))];
    const buyers = await Promise.all([6, 7, 8, 9].map((i) => w.bot({ idx: i, fund: { USDC: '20' } })));
    const before = await snapshotOf(ex);
    for (let i = 0; i < 4; i++) {
      await sellers[i]!.place(ord('sell', 10, 100_000));
      expect((await buyers[i]!.place(ord('buy', 10, 100_000))).body.order.state).toBe('FILLED');
    }
    await ex.settle();
    ex.board.invalidate(w.planetId);
    const book = await ex.api('GET', `/trade/book/${w.planetId}/${encodeURIComponent('bio.water/USDC')}`);
    expect(book.body.reference).toEqual({ num: '10000', den: 1 });
    expect(code(await banded.place(ord('sell', 10, 300_000)))).toBe('price_out_of_band');
    expect(code(await banded.place(ord('sell', 10, 40_000)))).toBe('price_out_of_band');
    expect((await banded.place(ord('sell', 10, 120_000))).status).toBe(201);
    // kill switch: refuses new orders and cancels the resting ones, releasing the sim reservation
    const ks = await ex.api('PATCH', `/trade/keys/${a.keyId}/allowance`, { auth: a.secret, body: { killSwitch: true } });
    expect(ks.status).toBe(200);
    await ex.until(async () => (await simColony(ex, w.planetId, 0)).reservedInOrbit['bio.water'] === undefined || (await simColony(ex, w.planetId, 0)).reservedInOrbit['bio.water'] === 0, 8000, 'kill switch releases the sim');
    expect(code(await a.place(ord('sell', 10, 1_000_000)))).toBe('kill_switch');
    const rows = await ex.prisma.tradeApiRequest.findMany({ where: { planetId: w.planetId, state: 'REJECTED', keyId: a.keyId! } });
    expect(rows.map((r) => r.errorCode).sort()).toEqual(['kill_switch', 'max_open_orders', 'max_order_notional', 'pair_not_allowed']);
    await expectConserved(ex, w.planetId, before, [a, b, ...sellers, ...buyers]);
  });

  it('revoking a key cancels its resting orders in the sim as well', async () => {
    const w = await realWorld(ex, 2);
    const p = await w.player({ idx: 0, name: 'realrevoker' });
    await grant(ex, p, 'bio.water', 100);
    const k = await ex.api('POST', '/trade/keys', { as: p.name, body: { planetId: w.planetId, label: 'k' } });
    expect(k.status, JSON.stringify(k.body)).toBe(201);
    const before = await snapshotOf(ex);
    for (let i = 0; i < 2; i++) {
      const r = await ex.api('POST', '/trade/orders', { auth: k.body.secret, idem: randomUUID(), body: ord('sell', 10, 1_000_000 + i, { planetId: w.planetId }) });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
    }
    await simReserved(w.planetId, 0, 20);
    const rv = await ex.api('DELETE', `/trade/keys/${k.body.keyId}`, { as: p.name });
    expect(rv.body).toMatchObject({ revoked: true, cancelRequested: 2 });
    await ex.until(async () => (await openCount(w.planetId)) === 0, 8000, 'revoke cancels');
    expect(code(await ex.api('GET', `/trade/orders?planetId=${w.planetId}`, { auth: k.body.secret }))).toBe('key_revoked');
    await expectConserved(ex, w.planetId, before, [p]);
  });
});

describe('REAL sim: commandId linking (the sim now echoes it)', () => {
  it('the event carries the request id; three identical concurrent asks of one colony each link to their own order', async () => {
    const w = await realWorld(ex, 1);
    const bot = await w.bot({ idx: 0, allowance: { maxOpenOrders: 10 } });
    const echoes: Array<{ commandId?: string; ref: string }> = [];
    const off = ex.get(EventBus).on('planet.event', (e) => {
      if (e.kind === 'marketOrderRequested' && e.planetId === w.planetId) echoes.push(e.data as never);
    }, { module: 'real-test' });
    const rs = await Promise.all([0, 1, 2].map(() => bot.place(ord('sell', 10, 1_000_000))));
    off?.();
    expect(rs.map((r) => r.status)).toEqual([201, 201, 201]);
    const ids = rs.map((r) => r.body.requestId as string);
    expect(new Set(rs.map((r) => r.body.order.orderId)).size).toBe(3);
    expect(echoes.map((e) => e.commandId).sort()).toEqual([...ids].sort());
    for (const r of rs) {
      const row = await ex.prisma.tradeApiRequest.findUniqueOrThrow({ where: { requestId: r.body.requestId } });
      expect(row).toMatchObject({ state: 'ACCEPTED', commandId: r.body.requestId, orderId: r.body.order.orderId });
      const echo = echoes.find((e) => e.commandId === r.body.requestId)!;
      expect((await ex.order(r.body.order.orderId)).ref).toBe(echo.ref); // the order of THAT command, not the oldest identical one
    }
    await expectSimMirror(ex, w.planetId, [bot]);
  });

  it('an idempotent retry of one request creates no second order and no second sim reservation', async () => {
    const w = await realWorld(ex, 1);
    const bot = await w.bot({ idx: 0 });
    const idem = randomUUID();
    const first = await bot.place(ord('sell', 10, 1_000_000), idem);
    const again = await bot.place(ord('sell', 10, 1_000_000), idem);
    expect(again.body.requestId).toBe(first.body.requestId);
    expect(await orderCount(w.planetId)).toBe(1);
    await simReserved(w.planetId, 0, 10);
  });
});

describe('REAL sim: fill policy per account kind, minimums, hub rules, wrong colony', () => {
  const body = (side: 'sell' | 'buy', fillPolicy?: string) => ({ ...ord(side, 10, 1_000_000), ...(fillPolicy ? { fillPolicy } : {}) });

  it('custodial accounts are partial-only, claimed accounts all-or-nothing-only; the refusal places nothing in the sim', async () => {
    const w = await realWorld(ex, 3);
    const a = await w.bot({ idx: 0 });
    const aon = await ex.api('POST', '/trade/orders', { auth: a.secret, idem: randomUUID(), body: body('sell', 'all_or_nothing') });
    expect([aon.status, code(aon)]).toEqual([422, 'fill_policy_not_allowed']);
    expect((await ex.api('POST', '/trade/orders', { auth: a.secret, idem: randomUUID(), body: body('sell', 'partial') })).body.order.fillPolicy).toBe('partial');
    const c = await w.bot({ idx: 1 });
    await ex.prisma.nearColonyAccount.updateMany({ where: { accountId: c.accountId }, data: { claimedAt: new Date() } });
    const part = await ex.api('POST', '/trade/orders', { auth: c.secret, idem: randomUUID(), body: body('sell', 'partial') });
    expect([part.status, code(part)]).toEqual([422, 'fill_policy_not_allowed']);
    const ok = await ex.api('POST', '/trade/orders', { auth: c.secret, idem: randomUUID(), body: body('sell') });
    expect(ok.body.order.fillPolicy).toBe('all_or_nothing');
    await simReserved(w.planetId, 1, 10);
    // an all-or-nothing ask is not partially filled by a smaller bid, and a full-size bid fills it entirely
    const buyer = await w.bot({ idx: 2, fund: { USDC: '10' } });
    await a.cancel((await ex.ordersOf(w.planetId)).find((o) => o.colonyId === a.colonyId)!.orderId); // keep the AON ask the only one
    const before = await snapshotOf(ex);
    const small = await buyer.place(ord('buy', 5, 500_000));
    expect(small.body.order).toMatchObject({ state: 'OPEN', filled: 0 }); // the AON ask (10) refuses a 5-unit bid
    expect(await ex.tradesOf(w.planetId)).toHaveLength(0);
    const full = await buyer.place(ord('buy', 10, 1_000_000));
    expect(full.body.order.state).toBe('FILLED');
    await ex.settle();
    expect((await ex.tradesOf(w.planetId)).map((t) => [t.state, t.amount.toFixed()])).toEqual([['FINAL', '10']]);
    await expectConserved(ex, w.planetId, before, [a, c, buyer]);
  });

  it('minimum notional, TTL option and stall-fee range are refused by the real sim with its own codes; nothing is reserved', async () => {
    const w = await realWorld(ex, 1);
    const a = await w.bot({ idx: 0 });
    const r1 = await a.place(ord('sell', 10, 1));
    const r2 = await a.place(ord('sell', 10, 1_000_000, { ttlS: 7 }));
    const r3 = await a.place(ord('buy', 10, 1_000_000, { maxStallFeeBp: 500 }));
    expect([r1.status, code(r1)]).toEqual([422, 'order_too_small']);
    expect([r2.status, code(r2)]).toEqual([422, 'invalid_args']);
    expect([r3.status, code(r3)]).toEqual([422, 'fee_out_of_range']);
    expect(await orderCount(w.planetId)).toBe(0);
    const view = await simColony(ex, w.planetId, 0);
    expect(view.reservedInOrbit['bio.water'] ?? 0).toBe(0);
    expect(view.openRefs).toHaveLength(0);
    // exactly the minimum notional is accepted; one below is not (sim reads the policy table)
    expect((await a.place(ord('sell', 10, 100_000))).status).toBe(201);
    expect(code(await a.place(ord('sell', 10, 99_999)))).toBe('order_too_small');
    // free cargo is the bound: more than the colony holds
    expect(code(await a.place(ord('sell', 100_000, 1_000_000_000, { ttlS: 3600 })))).toMatch(/insufficient_cargo|max_order_notional/);
  });

  it('no_trade_hub and hub_offline are refused with stable codes; the colony keeps working elsewhere', async () => {
    const w = await realWorld(ex, 3, { noHub: [1] });
    const [ok, nohub, off] = [await w.bot({ idx: 0 }), await w.bot({ idx: 1 }), await w.bot({ idx: 2 })];
    expect((await nohub.place(ord('sell', 10, 1_000_000))).body.error).toMatchObject({ code: 'no_trade_hub' });
    const out = await ex.get(GamePlanets).submit(w.planetId, { colonyIndex: 2, source: 'dev', commandId: `pw-${randomUUID()}`, kind: 'dev.power', args: { colonyIndex: 2, supplyOverride: 0 } } as never);
    expect((out as { ok?: boolean }).ok).toBe(true);
    await ex.until(async () => code(await off.place(ord('sell', 10, 1_000_000))) === 'hub_offline', 8000, 'hub offline');
    expect((await ok.place(ord('sell', 10, 1_000_000))).status).toBe(201);
    const rejected = await ex.prisma.tradeApiRequest.findMany({ where: { planetId: w.planetId, state: 'REJECTED' } });
    expect(rejected.every((r) => ['no_trade_hub', 'hub_offline'].includes(r.errorCode!))).toBe(true);
    expect(await orderCount(w.planetId)).toBe(1);
    for (const idx of [1, 2]) expect((await simColony(ex, w.planetId, idx)).openRefs).toHaveLength(0);
    // offline hub: a resting order stays bookable only through its own cancel (cancel still works)
    await expectSimMirror(ex, w.planetId, [ok]);
  });

  it('a bot bound to a colony index the sim does not have is refused (not_own_colony), no order, no reservation, key stays usable', async () => {
    const w = await realWorld(ex, 2);
    const ghost = await w.bot({ idx: 7, fund: { USDC: '5' } });
    await ex.get((await import('../../src/market/dev/market-faucet.service.js')).MarketFaucetService).fund(ghost.accountId, 'bio.water', 100n); // the server pre-check passes, the sim must refuse
    const r = await ghost.place(ord('sell', 10, 1_000_000));
    expect([r.status, code(r)]).toEqual([422, 'not_own_colony']);
    expect(await orderCount(w.planetId)).toBe(0);
    const row = await ex.prisma.tradeApiRequest.findFirstOrThrow({ where: { planetId: w.planetId } });
    expect(row).toMatchObject({ state: 'REJECTED', errorCode: 'not_own_colony' });
    expect(await ex.prisma.tradeApiKey.count({ where: { keyId: ghost.keyId! } })).toBe(1);
    await sleep(0);
  });
});

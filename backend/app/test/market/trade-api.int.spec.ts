import { randomUUID } from 'node:crypto';
import {
  CancelTradeOrderResponse, CreateTradeKeyResponse, PlaceTradeOrderResponse, TradeBalancesResponse, TradeBookResponse, TradeBoardResponse, TradeFillsResponse,
  TradeKeyListResponse, TradeOrdersResponse, TradePairsResponse, TradePolicyResponse, TradeStreamEvent, AgentQuoteResponse, marketOrderRef, type SimCommandV1,
} from '@terra/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GamePlanets } from '../../src/game/game-planets.service.js';
import type { PlanetEventOf } from '../../src/bus/channels.js';
import { TradeKeysService } from '../../src/market/trade/trade-keys.service.js';
import { TradeSimPort } from '../../src/market/trade/trade-sim.port.js';
import { devPlayerId } from '../../src/ws/session-verifier.js';
import { acct, bootHarness, type Harness } from './market-harness.js';

let h: Harness;
let url: string;
const PLANET = 'ptrade';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const seqs = new Map<string, number>();
const simCmds: SimCommandV1[] = [];

/** A stand-in for the planet sim: accepts the command and emits the event the real sim emits (the module then does the rest). */
function fakeSim(h2: Harness) {
  return async (planetId: string, cmd: SimCommandV1) => {
    simCmds.push(cmd);
    const colonyId = `col_${cmd.colonyIndex}`;
    if (cmd.kind === 'market.placeOrder') {
      const a = cmd.args as { side: string; resource: string; amount: number; price: unknown; ttlS: number; maxStallFeeBp?: number };
      const orderSeq = (seqs.get(`${planetId}${colonyId}`) ?? 0) + 1;
      seqs.set(`${planetId}${colonyId}`, orderSeq);
      h2.bus.emit('planet.event', {
        planetId, tick: 1, kind: 'marketOrderRequested', severity: 'info', colonyIds: [colonyId],
        data: { ref: marketOrderRef(colonyId, orderSeq), orderSeq, colonyId, colonyIndex: cmd.colonyIndex, ...a, stallFeeBp: 100, hubEntityId: 3 },
      } as unknown as PlanetEventOf<'marketOrderRequested'>);
    } else if (cmd.kind === 'market.cancelOrder') {
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

const sell = (over: Record<string, unknown> = {}) => ({ side: 'sell', resource: 'bio.water', amount: 100, price: { token: 'USDC', amount: '5000000' }, ttlS: 3600, ...over });
const buy = (over: Record<string, unknown> = {}) => ({ ...sell(), side: 'buy', maxStallFeeBp: 100, ...over });
async function bot(name: string, index: number, extra: Record<string, unknown> = {}) {
  const r = await call('POST', '/dev/trade/bots', { body: { name, planetId: PLANET, colonyIndex: index, fund: { USDC: '1000', 'bio.water': '500' }, ...extra } });
  expect(r.status).toBe(201);
  return CreateTradeKeyResponse.extend({}).passthrough().parse(r.body) as CreateTradeKeyResponse & { ownerId: string };
}
const orderCount = (colonyId: string) => h.db.prisma.marketOrder.count({ where: { planetId: PLANET, colonyId } });

beforeAll(async () => {
  h = await bootHarness();
  h.app.get(GamePlanets).markScenarioColonyPlanet(PLANET, [0, 1, 2, 3, 4, 5, 6, 7]);
  h.app.get(TradeSimPort).override = fakeSim(h);
  await h.app.listen(0, '127.0.0.1');
  url = (await h.app.getUrl()).replace('[::1]', '127.0.0.1');
});
afterAll(async () => h?.close());

describe('trade API: keys', () => {
  it('shows the secret once, stores only its hash, and the owner session can list and tune the key', async () => {
    const created = await call<CreateTradeKeyResponse>('POST', '/trade/keys', { as: 'alice', body: { planetId: PLANET, label: 'my agent', allowance: { maxOpenOrders: 3 } } });
    expect(created.status).toBe(201);
    const key = CreateTradeKeyResponse.parse(created.body);
    expect(key.allowance.maxOpenOrders).toBe(3);
    expect(key.allowance.allowedPairs).toContain('bio.water/USDC');
    const row = await h.db.prisma.tradeApiKey.findUniqueOrThrow({ where: { keyId: key.keyId } });
    expect(row.secretHash).not.toBe(key.secret);
    expect(JSON.stringify(row)).not.toContain(key.secret);
    const listed = TradeKeyListResponse.parse((await call('GET', '/trade/keys', { as: 'alice' })).body);
    expect(listed.keys.map((k) => k.keyId)).toContain(key.keyId);
    expect(JSON.stringify(listed)).not.toContain(key.secret);
    const patched = (await call<{ allowance: { killSwitch: boolean } }>('PATCH', `/trade/keys/${key.keyId}/allowance`, { as: 'alice', body: { killSwitch: true } })).body;
    expect(patched.allowance.killSwitch).toBe(true);
    expect((await call('GET', '/trade/keys', { as: 'bob' })).body).toEqual({ keys: [] }); // someone else sees nothing
    expect((await call('PATCH', `/trade/keys/${key.keyId}/allowance`, { as: 'bob', body: { killSwitch: false } })).status).toBe(404);
  });

  it('negative: anonymous, bad key, a key creating keys, invalid body', async () => {
    expect((await call('GET', '/trade/orders')).status).toBe(401);
    expect((await call<{ error: { code: string } }>('GET', '/trade/orders', { key: 'ta_bot_key_0123456789abcdef_AAAAAAAAAAAAAAAAAAAAAAAA' })).body.error.code).toBe('unauthorized');
    expect((await call<{ error: { code: string } }>('POST', '/trade/keys', { as: 'alice', body: { planetId: PLANET } })).body.error.code).toBe('invalid_request');
    const b = await bot('keyman', 3);
    expect((await call<{ error: { code: string } }>('POST', '/trade/keys', { key: b.secret, body: { planetId: PLANET, label: 'x' } })).body.error.code).toBe('forbidden_scope');
  });
});

describe('trade API: orders through the sim path', () => {
  it('place needs an Idempotency-Key, is stored as actor bot, replays safely and refuses a reused key', async () => {
    const b = await bot('maker1', 1);
    const noKey = await call<{ error: { code: string } }>('POST', '/trade/orders', { key: b.secret, body: sell() });
    expect(noKey.status).toBe(400);
    expect(noKey.body.error.code).toBe('idempotency_key_required');
    simCmds.length = 0;
    const idem = randomUUID();
    const first = await call('POST', '/trade/orders', { key: b.secret, idem, body: sell() });
    expect(first.status).toBe(201);
    const placed = PlaceTradeOrderResponse.parse(first.body);
    expect(placed).toMatchObject({ status: 'accepted', order: { actorKind: 'bot', state: 'OPEN', side: 'sell', filled: 0, reserved: '100' } });
    expect(simCmds).toHaveLength(1);
    expect(simCmds[0]).toMatchObject({ source: 'bot', kind: 'market.placeOrder', colonyIndex: 1 });
    const row = await h.order$(placed.order!.orderId);
    expect(row.actorKind).toBe('bot');
    expect(row.playerId).toBe('bot:maker1'); // owner carried, for the organic rule

    const again = await call('POST', '/trade/orders', { key: b.secret, idem, body: sell() });
    expect(again.status).toBe(201);
    expect(PlaceTradeOrderResponse.parse(again.body).requestId).toBe(placed.requestId);
    expect(simCmds).toHaveLength(1); // not sent to the sim again
    expect(await orderCount('col_1')).toBe(1); // nothing reserved twice

    const reuse = await call<{ error: { code: string } }>('POST', '/trade/orders', { key: b.secret, idem, body: sell({ amount: 50 }) });
    expect(reuse.status).toBe(422);
    expect(reuse.body.error.code).toBe('idempotency_key_reuse');
  });

  it('malformed order bodies are rejected before the sim (400 invalid_request), never a 500', async () => {
    const b = await bot('sloppy', 2);
    for (const bad of [sell({ amount: 1.5 }), sell({ price: { token: 'USDC', amount: 'abc' } }), sell({ price: { token: 'USDC', amount: '1.5' } }), sell({ unknown: true })]) {
      const r = await call<{ error: { code: string } }>('POST', '/trade/orders', { key: b.secret, idem: randomUUID(), body: bad });
      expect(r.status).toBe(400);
      expect(r.body.error.code).toBe('invalid_request');
    }
  });

  it('a sim or reservation rejection is a 422 with the sim code (insufficient funds)', async () => {
    const poor = await call<CreateTradeKeyResponse & { ownerId: string }>('POST', '/dev/trade/bots', { body: { name: 'poor', planetId: PLANET, colonyIndex: 5 } });
    const r = await call<{ status: string; error: { code: string } }>('POST', '/trade/orders', { key: poor.body.secret, idem: randomUUID(), body: sell() });
    expect(r.status).toBe(422);
    expect(r.body).toMatchObject({ status: 'rejected', error: { code: 'insufficient_cargo' } });
  });

  it('bot sells to a human buyer: settles FINAL on the mock chain, organic, visible in fills and the explorer data', async () => {
    const seller = await bot('seller9', 1, { name: 'seller9' });
    const sold = await call('POST', '/trade/orders', { key: seller.secret, idem: randomUUID(), body: sell({ price: { token: 'USDC', amount: '4000000' } }) });
    expect(sold.status).toBe(201);
    await h.intents.testRegisterSigner(acct('col_0')); // alice's seat colony needs a custodial signer to settle
    await call('POST', '/dev/market/faucet', { body: { planetId: PLANET, colonyIndex: 0, token: 'USDC', amount: '100' } });
    const bought = await call('POST', '/trade/orders', { as: 'alice', idem: randomUUID(), body: buy({ planetId: PLANET, price: { token: 'USDC', amount: '4000000' } }) });
    expect(bought.status).toBe(201);
    const buyOrder = PlaceTradeOrderResponse.parse(bought.body).order!;
    expect(buyOrder.actorKind).toBe('player');
    const trade = (await h.db.prisma.intentTrade.findMany({ where: { planetId: PLANET, buyerColonyId: 'col_0', sellerColonyId: 'col_1' } }))[0]!;
    expect(trade).toMatchObject({ buyerActorKind: 'player', sellerActorKind: 'bot', organic: true });
    await h.relay.pollOnce();
    const settled = await h.db.prisma.intentTrade.findUniqueOrThrow({ where: { tradeId: trade.tradeId } });
    expect(settled.state).toBe('FINAL');
    expect(await h.db.prisma.mockChainReceipt.count({ where: { opId: `trade:${trade.tradeId}`, status: 'success' } })).toBe(1);

    const explorer = await call<Array<{ opId: string; status: string }>>('GET', `/dev/chain/receipts?account=${acct('col_1')}&limit=50`);
    expect(explorer.body.find((r) => r.opId === `trade:${trade.tradeId}`)).toMatchObject({ status: 'success' }); // the bot's fill is on the explorer
    const fills = TradeFillsResponse.parse((await call('GET', `/trade/fills?planetId=${PLANET}`, { key: seller.secret })).body);
    expect(fills.fills.find((f) => f.tradeId === trade.tradeId)).toMatchObject({ side: 'sell', state: 'FINAL', counterpartyKind: 'player', amount: 100 });
    const afterFills = TradeFillsResponse.parse((await call('GET', `/trade/fills?planetId=${PLANETS_ALICE}`, { as: 'alice' })).body);
    expect(afterFills.fills.find((f) => f.tradeId === trade.tradeId)).toMatchObject({ side: 'buy', counterpartyKind: 'bot' });
  });

  it('same owner on both sides is never organic', async () => {
    const a = await bot('twin', 1);
    const sameOwnerKey = await call<CreateTradeKeyResponse>('POST', '/dev/trade/bots', { body: { name: 'twin', planetId: PLANET, colonyIndex: 2, fund: { USDC: '1000' } } });
    const s = await call('POST', '/trade/orders', { key: a.secret, idem: randomUUID(), body: sell({ amount: 20, price: { token: 'USDC', amount: '100000' } }) });
    expect(s.status).toBe(201);
    const b = await call('POST', '/trade/orders', { key: sameOwnerKey.body.secret, idem: randomUUID(), body: buy({ amount: 20, price: { token: 'USDC', amount: '100000' } }) });
    expect(b.status).toBe(201);
    const orders = await h.db.prisma.marketOrder.findMany({ where: { planetId: PLANET, colonyId: { in: ['col_1', 'col_2'] }, amount: '20' }, select: { colonyId: true, playerId: true, actorKind: true } });
    expect(orders).toEqual(expect.arrayContaining([{ colonyId: 'col_1', playerId: 'bot:twin', actorKind: 'bot' }, { colonyId: 'col_2', playerId: 'bot:twin', actorKind: 'bot' }]));
    const t = (await h.db.prisma.intentTrade.findMany({ where: { planetId: PLANET, buyerColonyId: 'col_2', sellerColonyId: 'col_1', amount: '20' } }))[0]!;
    expect(t).toMatchObject({ buyerActorKind: 'bot', sellerActorKind: 'bot', organic: false });
  });
});

const PLANETS_ALICE = PLANET;

describe('trade API: allowance rails and revoke', () => {
  it('max open orders, notional, budget, pair and kill switch return their stable codes and persist the rejection', async () => {
    const b = await bot('rails', 2, { allowance: { maxOpenOrders: 2, maxOrderNotional: '6000000', dailyBudget: '11000000', allowedPairs: ['bio.water/USDC'] } });
    const place = (body: unknown, idem = randomUUID()) => call<{ status: string; error?: { code: string } }>('POST', '/trade/orders', { key: b.secret, idem, body });
    expect((await place(sell({ price: { token: 'USDC', amount: '9000000' } }))).body.error?.code).toBe('max_order_notional');
    expect((await place(sell({ resource: 'metals.t1' }))).body.error?.code).toBe('pair_not_allowed');
    expect((await place(sell({ price: { token: 'USDC', amount: '5000000' } }))).status).toBe(201);
    expect((await place(sell({ price: { token: 'USDC', amount: '5000000' } }))).status).toBe(201);
    expect((await place(sell())).body.error?.code).toBe('max_open_orders');
    const idem = randomUUID();
    const first = await place(sell(), idem);
    expect(first.status).toBe(422);
    expect((await place(sell(), idem)).body.error?.code).toBe('max_open_orders'); // the stored rejection is replayed
    const off = await call<{ allowance: { killSwitch: boolean } }>('PATCH', `/trade/keys/${b.keyId}/allowance`, { key: b.secret, body: { killSwitch: true } });
    expect(off.body.allowance.killSwitch).toBe(true); // a manage key may stop itself
    expect((await place(sell())).body.error?.code).toBe('kill_switch');
    expect((await call('PATCH', `/trade/keys/${b.keyId}/allowance`, { key: b.secret, body: { killSwitch: false } })).status).toBe(403); // never loosen its own rails
  });

  it('daily budget counts outstanding orders before any fill', async () => {
    const b = await bot('budget', 3, { allowance: { dailyBudget: '7000000', maxOpenOrders: 10 } });
    const p1 = await call('POST', '/trade/orders', { key: b.secret, idem: randomUUID(), body: sell({ price: { token: 'USDC', amount: '5000000' } }) });
    expect(p1.status).toBe(201);
    const p2 = await call<{ error: { code: string } }>('POST', '/trade/orders', { key: b.secret, idem: randomUUID(), body: sell({ price: { token: 'USDC', amount: '3000000' } }) });
    expect(p2.body.error.code).toBe('daily_budget_exceeded');
    const order = PlaceTradeOrderResponse.parse(p1.body).order!;
    const cancelled = await call('DELETE', `/trade/orders/${order.orderId}`, { key: b.secret });
    expect(CancelTradeOrderResponse.parse(cancelled.body)).toMatchObject({ status: 'cancelled', order: { state: 'CANCELLED' } });
    const p3 = await call('POST', '/trade/orders', { key: b.secret, idem: randomUUID(), body: sell({ price: { token: 'USDC', amount: '3000000' } }) });
    expect(p3.status).toBe(201); // the cancelled order's unfilled notional no longer counts
  });

  it('cancel: foreign order is 404, repeat is idempotent, terminal order is 409 order_not_open', async () => {
    const a = await bot('canc1', 1);
    const placed = PlaceTradeOrderResponse.parse((await call('POST', '/trade/orders', { key: a.secret, idem: randomUUID(), body: sell({ amount: 7, price: { token: 'USDC', amount: '70000' } }) })).body).order!;
    const stranger = await bot('canc2', 2);
    expect((await call('DELETE', `/trade/orders/${placed.orderId}`, { key: stranger.secret })).status).toBe(404);
    expect((await call('DELETE', '/trade/orders/mo_unknown', { key: a.secret })).status).toBe(404);
    const c1 = await call('DELETE', `/trade/orders/${placed.orderId}`, { key: a.secret, idem: 'cancel-once-1' });
    expect(c1.status).toBe(200);
    const c2 = await call('DELETE', `/trade/orders/${placed.orderId}`, { key: a.secret, idem: 'cancel-once-1' });
    expect(c2.status).toBe(200);
    const c3 = await call<{ error: { code: string } }>('DELETE', `/trade/orders/${placed.orderId}`, { key: a.secret, idem: 'cancel-again-2' });
    expect(c3.status).toBe(200); // already CANCELLED: the same end state
  });

  it('revoke cancels unsubmitted rows, requests cancel of resting orders, and the key stops working', async () => {
    const owner = await call<CreateTradeKeyResponse>('POST', '/trade/keys', { as: 'carol', body: { planetId: PLANET, label: 'rv' } });
    const k = CreateTradeKeyResponse.parse(owner.body);
    // the session owner (colony 0 seat) funds the key's colony and rests an order through the key
    await call('POST', '/dev/market/faucet', { body: { planetId: PLANET, colonyIndex: 0, token: 'USDC', amount: '50' } });
    const order = PlaceTradeOrderResponse.parse((await call('POST', '/trade/orders', { key: k.secret, idem: randomUUID(), body: buy({ amount: 5, price: { token: 'USDC', amount: '100000' } }) })).body);
    expect(order.status).toBe('accepted');
    await h.db.prisma.tradeApiRequest.create({ data: { requestId: 'rq_pending_test', ownerRef: `key:${k.keyId}`, keyId: k.keyId, idemKey: 'p-1', bodyHash: 'x', kind: 'place', planetId: PLANET, colonyId: 'col_0', colonyIndex: 0, ownerId: 'carol', notional: '1', state: 'PENDING' } });
    const rv = await call<{ revoked: boolean; cancelledUnsubmitted: number; cancelRequested: number }>('DELETE', `/trade/keys/${k.keyId}`, { as: 'carol' });
    expect(rv.body).toMatchObject({ revoked: true, cancelledUnsubmitted: 1, cancelRequested: 1 });
    await sleep(400);
    expect((await h.order$(order.order!.orderId)).state).toBe('CANCELLED');
    expect((await h.db.prisma.tradeApiRequest.findUniqueOrThrow({ where: { requestId: 'rq_pending_test' } })).state).toBe('CANCELLED');
    const after = await call<{ error: { code: string } }>('GET', `/trade/orders?planetId=${PLANET}`, { key: k.secret });
    expect(after.status).toBe(401);
    expect(after.body.error.code).toBe('key_revoked');
  });

  it('a request still PENDING at boot (crash between row and submit) is cancelled and stops counting', async () => {
    const b = await bot('crash', 3);
    await h.db.prisma.tradeApiRequest.create({ data: { requestId: 'rq_crash_test', ownerRef: `key:${b.keyId}`, keyId: b.keyId, idemKey: 'c-1', bodyHash: 'x', kind: 'place', planetId: PLANET, colonyId: 'col_3', colonyIndex: 3, ownerId: 'bot:crash', notional: '9', state: 'PENDING' } });
    await h.app.get(TradeKeysService).onModuleInit();
    expect((await h.db.prisma.tradeApiRequest.findUniqueOrThrow({ where: { requestId: 'rq_crash_test' } })).state).toBe('CANCELLED');
  });

  it('per-key rate limit answers 429 rate_limited', async () => {
    const b = await bot('fast', 3, {});
    await h.db.prisma.tradeApiKey.update({ where: { keyId: b.keyId }, data: { ratePerSecond: 1, rateBurst: 2 } });
    const codes: number[] = [];
    for (let i = 0; i < 4; i++) codes.push((await call('GET', '/trade/pairs', { key: b.secret })).status);
    expect(codes.slice(0, 4)).toEqual([200, 200, 200, 200]); // pairs is public and does not authenticate
    const got: number[] = [];
    for (let i = 0; i < 4; i++) got.push((await call('GET', `/trade/orders?planetId=${PLANET}`, { key: b.secret })).status);
    expect(got).toContain(429);
  });
});

describe('trade API: reads', () => {
  it('agent quote: library bid/ask with reason codes; an ask body posts as it is; bad inputs are 400', async () => {
    const b = await bot('quoter', 5, { fund: { USDC: '500', 'bio.water': '400' } });
    const q = AgentQuoteResponse.parse((await call('GET', '/trade/agent/quote?resource=bio.water&ownUnitCost=1000&transportPerUnit=0&keep=100', { key: b.secret })).body);
    expect(q.bid).toBeNull();
    expect(q.bidReasons).toContain('no_reference'); // no organic reference yet: never a made-up price
    expect(q.ask).not.toBeNull();
    expect(q.ask!.order).toMatchObject({ side: 'sell', resource: 'bio.water', planetId: PLANET, price: { token: 'USDC' } });
    expect(q.ask!.order.amount).toBeLessThanOrEqual(300); // keeps 100 of 400
    const posted = await call('POST', '/trade/orders', { key: b.secret, idem: randomUUID(), body: q.ask!.order });
    expect(posted.status).toBe(201);
    const noCost = AgentQuoteResponse.parse((await call('GET', '/trade/agent/quote?resource=bio.water', { key: b.secret })).body);
    expect(noCost.ask).toBeNull();
    expect(noCost.askReasons).toContain('no_unit_cost');
    expect((await call('GET', '/trade/agent/quote?resource=bio.water&ownUnitCost=abc', { key: b.secret })).status).toBe(400);
    expect((await call('GET', '/trade/agent/quote?resource=nope', { key: b.secret })).status).toBe(400);
    expect((await call('GET', '/trade/agent/quote?resource=bio.water')).status).toBe(401);
  });

  it('balances show only the caller colony: quote and in-orbit, reserved vs free', async () => {
    const b = await bot('bal1', 2, { fund: { USDC: '20' } });
    await h.relay.pollOnce();
    const res = await call('GET', '/trade/balances', { key: b.secret });
    const bal = TradeBalancesResponse.parse(res.body);
    expect(bal.colonyId).toBe('col_2');
    expect(bal.quote.USDC).toMatchObject({ reserved: expect.any(String) });
    expect(Object.keys(bal.inOrbit)).not.toContain('metals.t1');
    expect((await call<{ error: { code: string } }>('GET', '/trade/balances', { as: 'alice' })).body.error.code).toBe('invalid_request'); // a session names its planet
    const alice = TradeBalancesResponse.parse((await call('GET', `/trade/balances?planetId=${PLANET}`, { as: 'alice' })).body);
    expect(alice.colonyId).toBe('col_0'); // never col_2: only the caller's own colony
  });

  it('book depth, board, pairs, policy; unknown pair is invalid_request; orders filter by state and pair', async () => {
    const b = await bot('reader', 3);
    await call('POST', '/trade/orders', { key: b.secret, idem: randomUUID(), body: sell({ amount: 11, price: { token: 'USDC', amount: '111000' } }) });
    const book = TradeBookResponse.parse((await call('GET', `/trade/book/${PLANET}/${encodeURIComponent('bio.water/USDC')}?levels=1`)).body);
    expect(book.asks.length).toBeLessThanOrEqual(1);
    expect(book.asks.length + book.bids.length).toBeGreaterThan(0);
    expect(TradeBoardResponse.parse((await call('GET', `/trade/board/${PLANET}`)).body).board.length).toBeGreaterThan(0);
    expect(TradePairsResponse.parse((await call('GET', '/trade/pairs')).body).pairs.some((p) => p.pair === 'bio.water/USDC')).toBe(true);
    expect(TradePolicyResponse.parse((await call('GET', '/trade/policy', { key: b.secret })).body).rateLimit.perSecond).toBe(10);
    expect((await call<{ error: { code: string } }>('GET', `/trade/book/${PLANET}/nope`)).body.error.code).toBe('invalid_request');
    const open = TradeOrdersResponse.parse((await call('GET', `/trade/orders?planetId=${PLANET}&state=open&pair=${encodeURIComponent('bio.water/USDC')}`, { key: b.secret })).body);
    expect(open.orders.length).toBeGreaterThan(0);
    expect(open.orders.every((o) => o.pair === 'bio.water/USDC' && ['OPEN', 'PARTIAL', 'PENDING'].includes(o.state))).toBe(true);
    expect((await call('GET', `/trade/orders?planetId=${PLANET}&state=bogus`, { key: b.secret })).status).toBe(400);
    expect((await call<{ error: { code: string } }>('GET', '/trade/orders?planetId=other', { key: b.secret })).body.error.code).toBe('wrong_planet');
  });

  it('SSE stream pushes the caller\'s own order events and book updates', async () => {
    const b = await bot('streamer', 1);
    const ctrl = new AbortController();
    const res = await fetch(`${url}/v1/trade/stream`, { headers: { authorization: `Bearer ${b.secret}` }, signal: ctrl.signal });
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const events: Array<ReturnType<typeof TradeStreamEvent.parse>> = [];
    void (async () => {
      const dec = new TextDecoder();
      let buf = '';
      try {
        for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
          buf += dec.decode(chunk);
          for (let i = buf.indexOf('\n\n'); i >= 0; i = buf.indexOf('\n\n')) {
            const frame = buf.slice(0, i); buf = buf.slice(i + 2);
            if (frame.startsWith('data: ')) events.push(TradeStreamEvent.parse(JSON.parse(frame.slice(6))));
          }
        }
      } catch { /* aborted */ }
    })();
    await sleep(100);
    const placed = await call('POST', '/trade/orders', { key: b.secret, idem: randomUUID(), body: sell({ amount: 3, price: { token: 'USDC', amount: '33000' } }) });
    expect(placed.status).toBe(201);
    await sleep(1500);
    ctrl.abort();
    expect(events[0]).toMatchObject({ type: 'hello', planetId: PLANET });
    expect(events.some((e) => e.type === 'order' && e.order.actorKind === 'bot' && e.order.state === 'OPEN')).toBe(true);
    expect(events.some((e) => e.type === 'book')).toBe(true);
  });
});

void devPlayerId;

import { randomUUID } from 'node:crypto';
import {
  CreateTradeKeyResponse, MarketSnapshotResponse, TradeBalancesResponse, TradeBookOrdersResponse, TradeKeyListResponse, marketOrderRef, toChainUnits, type SimCommandV1,
} from '@terra/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GamePlanets } from '../../src/game/game-planets.service.js';
import type { PlanetEventOf } from '../../src/bus/channels.js';
import { MarketColonies } from '../../src/market/orders/market-colonies.js';
import { actorStats, type ActorTrade } from '../../src/market/board/board-actors.js';
import { TradeSimPort } from '../../src/market/trade/trade-sim.port.js';
import { devPlayerId } from '../../src/ws/session-verifier.js';
import { defaultBoardLimits } from '@terra/sim/systems/trade/market-board';
import { USDC, WATER, bootHarness, type Harness } from './market-harness.js';

let h: Harness;
let daveKey = '';
let url: string;
const PLANET = 'pgaps';
const PAIR = encodeURIComponent('bio.water/USDC');
const simCmds: SimCommandV1[] = [];
const seqs = new Map<string, number>();

function fakeSim(h2: Harness) {
  return async (planetId: string, cmd: SimCommandV1) => {
    simCmds.push(cmd);
    const colonyId = `col_${cmd.colonyIndex}`;
    if (cmd.kind === 'market.placeOrder') {
      const a = cmd.args as Record<string, unknown>;
      const orderSeq = (seqs.get(`${planetId}${colonyId}`) ?? 0) + 1;
      seqs.set(`${planetId}${colonyId}`, orderSeq);
      h2.bus.emit('planet.event', {
        planetId, tick: 1, kind: 'marketOrderRequested', severity: 'info', colonyIds: [colonyId],
        data: { ref: marketOrderRef(colonyId, orderSeq), orderSeq, colonyId, colonyIndex: cmd.colonyIndex, ...a, stallFeeBp: 100, hubEntityId: 3 },
      } as unknown as PlanetEventOf<'marketOrderRequested'>);
    }
    return { ok: true, commandId: cmd.commandId, appliedAtTick: 1 } as never;
  };
}

async function call<T = unknown>(method: string, path: string, opts: { key?: string; as?: string; body?: unknown; idem?: string } = {}): Promise<{ status: number; body: T }> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.key) headers.authorization = `Bearer ${opts.key}`;
  if (opts.idem) headers['idempotency-key'] = opts.idem;
  const q = opts.as ? `${path.includes('?') ? '&' : '?'}as=${opts.as}` : '';
  const r = await fetch(`${url}/v1${path}${q}`, { method, headers, ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }) });
  return { status: r.status, body: (await r.json().catch(() => ({}))) as T };
}
const sell = (over: Record<string, unknown> = {}) => ({ side: 'sell', resource: 'bio.water', amount: 100, price: { token: 'USDC', amount: '5000000' }, ttlS: 3600, ...over });

async function fund(name: string, water: bigint, usdc: bigint): Promise<void> {
  const colony = (await h.app.get(MarketColonies).ofPlayer(devPlayerId(name), PLANET, true))!;
  await h.intents.testRegisterSigner(colony.accountId);
  if (water) await h.intents.testSeedVerifier(colony.accountId, WATER, toChainUnits('bio.water', water));
  if (usdc) await h.intents.testSeedVerifier(colony.accountId, USDC, usdc);
}

beforeAll(async () => {
  h = await bootHarness();
  h.app.get(GamePlanets).markScenarioColonyPlanet(PLANET, [0, 1, 2, 3]);
  h.app.get(TradeSimPort).override = fakeSim(h);
  await h.app.listen(0, '127.0.0.1');
  url = (await h.app.getUrl()).replace('[::1]', '127.0.0.1');
  await fund('carol', 600n, 50_000_000n);
  // A second colony (seat 2) with its own 50 water, driven by an API key: session players all share seat 0 on a scenario planet.
  const r = await call<CreateTradeKeyResponse>('POST', '/dev/trade/bots', { body: { name: 'dave', planetId: PLANET, colonyIndex: 2, fund: { 'bio.water': '50' } } });
  daveKey = r.body.secret;
});
afterAll(async () => h?.close());

describe('GET /v1/trade/balances equals the market snapshot of the caller', () => {
  it('counts verifier-held cargo as in orbit, caller only, and tracks reservations', async () => {
    const bal = TradeBalancesResponse.parse((await call('GET', `/trade/balances?planetId=${PLANET}`, { as: 'carol' })).body);
    expect(bal.inOrbit['bio.water']).toEqual({ free: '600', reserved: '0', total: '600' });
    expect(bal.quote.USDC).toMatchObject({ free: '50000000', total: '50000000' });
    const dave = TradeBalancesResponse.parse((await call('GET', '/trade/balances', { key: daveKey })).body);
    expect(dave.inOrbit['bio.water']).toEqual({ free: '50', reserved: '0', total: '50' }); // never carol's 600
    expect(dave.quote.USDC).toBeUndefined();
    expect(dave.colonyId).not.toBe(bal.colonyId);

    const placed = await call('POST', '/trade/orders', { as: 'carol', idem: randomUUID(), body: { planetId: PLANET, ...sell() } });
    expect(placed.status).toBe(201);
    const after = TradeBalancesResponse.parse((await call('GET', `/trade/balances?planetId=${PLANET}`, { as: 'carol' })).body);
    expect(after.inOrbit['bio.water']).toEqual({ free: '500', reserved: '100', total: '600' });
    const snap = MarketSnapshotResponse.parse((await call('GET', `/market/${PLANET}`, { as: 'carol' })).body);
    expect(snap.balances?.['bio.water']).toBe(after.inOrbit['bio.water']!.free);
    expect(snap.reserved?.['bio.water']).toBe(after.inOrbit['bio.water']!.reserved);
    expect(snap.balances?.USDC).toBe(after.quote.USDC!.free);
    const daveAfter = TradeBalancesResponse.parse((await call('GET', '/trade/balances', { key: daveKey })).body);
    expect(daveAfter.inOrbit['bio.water']).toEqual({ free: '50', reserved: '0', total: '50' }); // carol's order did not touch it
  });

  it('rejects an anonymous caller', async () => {
    expect((await call('GET', `/trade/balances?planetId=${PLANET}`)).status).toBe(401);
  });
});

describe('market.seed / market.clear dev commands are registered', () => {
  it('route works; seeded orders are fixture, never organic; clear cancels them', async () => {
    const listed = (await call<{ commands: Array<{ name: string }> }>('GET', '/dev/commands')).body.commands.map((c) => c.name);
    expect(listed).toEqual(expect.arrayContaining(['market.seed', 'market.clear']));
    const res = await call<{ bids: number; asks: number; actorKind: string }>('POST', '/dev/commands/market.seed', { body: { planetId: 'pseed', pair: 'bio.water/metals.t1' } });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ bids: 5, asks: 5, actorKind: 'fixture' });
    const rows = await h.db.prisma.marketOrder.findMany({ where: { planetId: 'pseed' } });
    expect(rows).toHaveLength(10);
    expect(rows.every((r) => r.actorKind === 'fixture')).toBe(true);
    expect(rows.some((r) => ['player', 'bot'].includes(r.actorKind))).toBe(false);
    expect(await h.db.prisma.intentTrade.count({ where: { planetId: 'pseed', organic: true } })).toBe(0);
    const listedBook = TradeBookOrdersResponse.parse((await call('GET', `/trade/book/pseed/${encodeURIComponent('bio.water/metals.t1')}/orders`)).body);
    expect(listedBook.orders.every((o) => o.actorKind === 'fixture')).toBe(true);
    // negative: bad pair, bad args
    expect((await call('POST', '/dev/commands/market.seed', { body: { planetId: 'pseed', pair: 'nope' } })).status).toBe(400);
    expect((await call('POST', '/dev/commands/market.seed', { body: { planetId: 'pseed' } })).status).toBeGreaterThanOrEqual(400);
    const cleared = await call<{ cancelled: number }>('POST', '/dev/commands/market.clear', { body: { planetId: 'pseed' } });
    expect(cleared.body.cancelled).toBe(10);
  });
});

describe('GET /v1/trade/book/:planet/:pair/orders', () => {
  it('lists every resting order with policy fields, marks mine only when authenticated, and leaks no ids', async () => {
    await call('POST', '/trade/orders', { key: daveKey, idem: randomUUID(), body: { ...sell({ amount: 20, price: { token: 'USDC', amount: '90000' } }) } });
    const pub = await call<TradeBookOrdersResponse>('GET', `/trade/book/${PLANET}/${PAIR}/orders`);
    expect(pub.status).toBe(200);
    const list = TradeBookOrdersResponse.parse(pub.body);
    expect(list.orders).toHaveLength(2);
    expect(list.truncated).toBe(false);
    expect(list.orders.every((o) => o.mine === undefined)).toBe(true);
    expect(list.orders[0]).toMatchObject({ side: 'sell', fillPolicy: 'partial', actorKind: 'bot', stallFeeBp: 100, remaining: 20, amount: 20, price: { num: '4500', den: 1 } });
    const text = JSON.stringify(pub.body);
    for (const secret of ['accountId', 'playerId', 'ownerId', 'reserved', 'col_0', 'col_2', 'terraagent.mock', 'dev:']) expect(text).not.toContain(secret);
    expect(new Set(list.orders.map((o) => o.colonyRef)).size).toBe(2);

    const mine = TradeBookOrdersResponse.parse((await call('GET', `/trade/book/${PLANET}/${PAIR}/orders`, { as: 'carol' })).body);
    expect(mine.orders.filter((o) => o.mine).map((o) => o.amount)).toEqual([100]);
    expect(mine.orders.filter((o) => o.mine === false)).toHaveLength(1);

    expect(TradeBookOrdersResponse.parse((await call('GET', `/trade/book/${PLANET}/${PAIR}/orders?side=buy`)).body).orders).toHaveLength(0);
    const cut = TradeBookOrdersResponse.parse((await call('GET', `/trade/book/${PLANET}/${PAIR}/orders?limit=1`)).body);
    expect(cut.orders).toHaveLength(1);
    expect(cut.truncated).toBe(true);
  });

  it('negative: unknown pair, bad side, bad limit, bad bearer', async () => {
    expect((await call('GET', `/trade/book/${PLANET}/nope/orders`)).status).toBe(400);
    expect((await call('GET', `/trade/book/${PLANET}/${PAIR}/orders?side=up`)).status).toBe(400);
    expect((await call('GET', `/trade/book/${PLANET}/${PAIR}/orders?limit=0`)).status).toBe(400);
    expect((await call('GET', `/trade/book/${PLANET}/${PAIR}/orders?limit=501`)).status).toBe(400);
    expect((await call('GET', `/trade/book/${PLANET}/${PAIR}/orders`, { key: 'ta_bot_nope_nope' })).status).toBe(401);
  });
});

describe('PlaceTradeOrderRequest.fillPolicy', () => {
  it('partial (explicit) is accepted; all_or_nothing is refused until the sim command carries it; junk is invalid', async () => {
    const before = simCmds.length;
    const aon = await call<{ error: { code: string } }>('POST', '/trade/orders', { key: daveKey, idem: randomUUID(), body: { ...sell({ amount: 1, price: { token: 'USDC', amount: '9000' } }), fillPolicy: 'all_or_nothing' } });
    expect(aon.status).toBe(400);
    expect(aon.body.error.code).toBe('invalid_request');
    expect(simCmds.length).toBe(before); // nothing reached the sim
    expect((await call('POST', '/trade/orders', { key: daveKey, idem: randomUUID(), body: { ...sell(), fillPolicy: 'maybe' } })).status).toBe(400);
    const ok = await call('POST', '/trade/orders', { key: daveKey, idem: randomUUID(), body: { ...sell({ amount: 1, price: { token: 'USDC', amount: '9000' } }), fillPolicy: 'partial' } });
    expect(ok.status).toBe(201);
    expect(JSON.stringify(simCmds.at(-1)?.args)).not.toContain('fillPolicy');
  });
});

describe('TradeKeyView usage', () => {
  it('shows dailySpent / dailyRemaining / openOrders for the owner and moves with orders', async () => {
    const created = CreateTradeKeyResponse.parse((await call('POST', '/trade/keys', { as: 'carol', body: { planetId: PLANET, label: 'u', allowance: { dailyBudget: '12000000' } } })).body);
    expect(created).toMatchObject({ dailySpent: '0', dailyRemaining: '12000000' });
    expect(created.openOrders).toBeGreaterThanOrEqual(1); // carol's earlier resting sell: the colony's open orders
    const base = created.openOrders!;
    const placed = await call('POST', '/trade/orders', { key: created.secret, idem: randomUUID(), body: sell({ amount: 10, price: { token: 'USDC', amount: '5000000' } }) });
    expect(placed.status).toBe(201);
    const key = TradeKeyListResponse.parse((await call('GET', '/trade/keys', { as: 'carol' })).body).keys.find((k) => k.keyId === created.keyId)!;
    expect(key).toMatchObject({ dailySpent: '5000000', dailyRemaining: '7000000', openOrders: base + 1 });
    expect(key.lastUsedAtMs).not.toBeNull();
    const over = await call<{ status: string; error: { code: string } }>('POST', '/trade/orders', { key: created.secret, idem: randomUUID(), body: sell({ amount: 10, price: { token: 'USDC', amount: '8000000' } }) });
    expect(over.body.error.code).toBe('daily_budget_exceeded');
    const after = TradeKeyListResponse.parse((await call('GET', '/trade/keys', { as: 'carol' })).body).keys.find((k) => k.keyId === created.keyId)!;
    expect(after.dailySpent).toBe('5000000'); // a rejected order commits nothing
    expect((await call('GET', '/trade/keys', { as: 'erin' })).body).toEqual({ keys: [] }); // usage is only the owner's
  });
});

describe('board actor mix (pure)', () => {
  const now = 10_000_000;
  const t = (over: Partial<ActorTrade>): ActorTrade => ({ pair: 'p', amount: 10n, notional: 100n, atMs: now - 1000, organic: true, buyerId: 'a', sellerId: 'b', buyerKind: 'player', sellerKind: 'player', ...over });
  it('bot share is bot volume over eligible volume; fixture trades are not eligible', () => {
    const r = actorStats('p', [t({}), t({ sellerKind: 'bot' }), t({ buyerKind: 'bot', sellerKind: 'bot' }), t({ organic: false, buyerKind: 'fixture', sellerKind: 'fixture' })], now, defaultBoardLimits());
    expect(r.botShareBp).toBe(6666);
    expect(r.actorMix).toEqual({ player: 2, bot: 2, fixture: 1 });
  });
  it('is 0 with no trades, ignores other pairs and trades outside the window', () => {
    expect(actorStats('p', [], now, defaultBoardLimits())).toEqual({ botShareBp: 0, actorMix: {} });
    const old = t({ atMs: now - defaultBoardLimits().windowS * 1000 - 1, sellerKind: 'bot' });
    expect(actorStats('p', [old, t({ pair: 'q', sellerKind: 'bot' })], now, defaultBoardLimits())).toEqual({ botShareBp: 0, actorMix: {} });
  });
});

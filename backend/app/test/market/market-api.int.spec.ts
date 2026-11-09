import { MarketBookPayload, MarketSnapshotResponse, MarketTradePayload } from '@terra/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GamePlanets } from '../../src/game/game-planets.service.js';
import { PlaceOrderPrecheck } from '../../src/market/orders/place-order.precheck.js';
import { devPlayerId } from '../../src/ws/session-verifier.js';
import type { MarketBookBusEvent } from '../../src/market/api/market-book-push.service.js';
import { bootHarness, type Harness } from './market-harness.js';

let h: Harness;
let url: string;
const books: MarketBookBusEvent[] = [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const get = (path: string, headers: Record<string, string> = {}) => fetch(`${url}/v1/market/${path}`, { headers });

beforeAll(async () => {
  h = await bootHarness();
  await h.app.listen(0, '127.0.0.1');
  url = (await h.app.getUrl()).replace('[::1]', '127.0.0.1');
  h.bus.on('market.book', (e) => books.push(e), { module: 'test' });
});
afterAll(async () => h?.close());

describe('W13-19 market push + REST', () => {
  it('5 orders placed within 1 s: the first push goes out at once, the next (within 1 s) holds all 5, never more than 2', async () => {
    await h.colony('s50', { water: 500n });
    for (let i = 0; i < 5; i++) await h.place.handle(h.order('p19a', 's50', { side: 'sell', amount: 100, price: { token: 'USDC', amount: String(1_000_000 + i * 100_000) } }));
    await sleep(1300);
    const mine = books.filter((b) => b.planetId === 'p19a');
    expect(mine.length).toBeLessThanOrEqual(2);
    expect(mine.length).toBeGreaterThanOrEqual(1);
    const payload = MarketBookPayload.parse(mine.at(-1)!.payload);
    expect(payload.pair).toBe('bio.water/USDC');
    expect(payload.asks).toHaveLength(5);
    expect(payload.asks.reduce((n, l) => n + l.orders, 0)).toBe(5);
    expect(payload.bids).toEqual([]);
    expect(payload.seq).toBe(mine.length);
  });

  it('GET /v1/market/{planetId}: books, board, trades, policy; the caller identified by ?as= and their colony', async () => {
    const t = await h.matched(51);
    await h.relay.pollOnce();
    const anon = MarketSnapshotResponse.parse(await (await get(t.planetId)).json());
    expect(anon.recentTrades).toHaveLength(1);
    expect(anon.recentTrades[0]).toMatchObject({ tradeId: t.tradeId, state: 'FINAL', amount: 300, notional: '5000000' });
    expect(anon.board.find((r) => r.pair === 'bio.water/USDC')).toMatchObject({ classification: 'insufficient_data', last: { num: '50000', den: 3 } });
    expect(anon.board.find((r) => r.pair === 'metals.t1/USDC')).toMatchObject({ classification: 'insufficient_data', last: null });
    expect(anon.policy).toMatchObject({ platformFeeBp: 100, openOrderLimit: 20 });
    expect(anon.myOrders).toBeUndefined();
  });

  it('dev scenario colony: export cargo, place a sell, no insufficient_cargo; ?as=a lists it under myOrders, balances and reserved', async () => {
    const planetId = 'p19scn';
    h.app.get(GamePlanets).markScenarioColonyPlanet(planetId, [0]);
    // the sim's colony is `col_0` and the player's colony row (if any) has another id; cargo events carry the sim id
    h.bus.emit('planet.event', {
      planetId, tick: 1, kind: 'cargoExported', severity: 'info', colonyIds: ['col_0'],
      data: { colonyId: 'col_0', colonyIndex: 0, playerId: '', ref: 'cargo-export:col_0:1', exportSeq: 1, resource: 'bio.water', amount: 200 },
    } as never);
    await sleep(300);
    await h.relay.pollOnce();

    const precheck = h.app.get(PlaceOrderPrecheck);
    const input = { kind: 'market.placeOrder', playerId: devPlayerId('a'), planetId, colony: { id: 'co_row_of_a', colonyIndex: 0 }, dev: true,
      args: { side: 'sell', resource: 'bio.water', amount: 100, price: { token: 'USDC', amount: '4000000' }, ttlS: 3600 } };
    expect(await precheck.check(input as never)).toBeNull();
    const r = (await h.place.handle(h.order(planetId, 'col_0', { side: 'sell', amount: 100, price: { token: 'USDC', amount: '4000000' }, colonyIndex: 0 })))!;
    expect(r.rejected).toBeUndefined();

    const snap = MarketSnapshotResponse.parse(await (await get(`${planetId}?as=a`)).json());
    expect(snap.myOrders).toHaveLength(1);
    expect(snap.myOrders![0]).toMatchObject({ orderId: r.order.orderId, side: 'sell', amount: 100, state: 'OPEN' });
    expect(snap.reserved?.['bio.water']).toBe('100');
    expect(snap.balances?.['bio.water']).toBe('100'); // 200 exported, 100 reserved
    expect(snap.stall).toMatchObject({ hubFeeBp: 100 });
  });

  it('the market.trade push carries a MarketTradePayload, once per settled trade', async () => {
    const before = h.pushes.length;
    const t = await h.matched(53);
    await h.relay.pollOnce();
    const mine = h.pushes.slice(before).filter((p) => p.payload.trade.tradeId === t.tradeId);
    expect(mine).toHaveLength(1);
    expect(MarketTradePayload.parse(mine[0]!.payload)).toMatchObject({ planetId: t.planetId, trade: { state: 'FINAL', amount: 300 } });
  });
});

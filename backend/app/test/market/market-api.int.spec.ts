import { MarketBookPayload, MarketSnapshotResponse, MarketTradePayload } from '@terra/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { devPlayerId } from '../../src/ws/session-verifier.js';
import type { MarketBookBusEvent } from '../../src/market/api/market-book-push.service.js';
import { acct, bootHarness, type Harness } from './market-harness.js';

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
  it('5 orders placed within 1 s give ONE market.book push with all 5', async () => {
    await h.colony('s50', { water: 500n });
    for (let i = 0; i < 5; i++) await h.place.handle(h.order('p19a', 's50', { side: 'sell', amount: 100, price: { token: 'USDC', amount: String(1_000_000 + i * 100_000) } }));
    await sleep(1300);
    const mine = books.filter((b) => b.planetId === 'p19a');
    expect(mine).toHaveLength(1);
    const payload = MarketBookPayload.parse(mine[0]!.payload);
    expect(payload.pair).toBe('bio.water/USDC');
    expect(payload.asks).toHaveLength(5);
    expect(payload.asks.reduce((n, l) => n + l.orders, 0)).toBe(5);
    expect(payload.bids).toEqual([]);
    expect(payload.seq).toBe(1);
  });

  it('GET /v1/market/{planetId}: books, board, trades, policy; own orders and balances with ?as=', async () => {
    const t = await h.matched(51);
    await h.relay.pollOnce();
    await h.db.prisma.marketOrder.updateMany({ where: { planetId: t.planetId, colonyId: t.seller }, data: { playerId: devPlayerId('alice') } });
    const anon = MarketSnapshotResponse.parse(await (await get(t.planetId)).json());
    expect(anon.recentTrades).toHaveLength(1);
    expect(anon.recentTrades[0]).toMatchObject({ tradeId: t.tradeId, state: 'FINAL', amount: 300, notional: '5000000' });
    expect(anon.board.find((r) => r.pair === 'bio.water/USDC')).toMatchObject({ classification: 'insufficient_data', last: { num: '50000', den: 3 } });
    expect(anon.board.find((r) => r.pair === 'metals.t1/USDC')).toMatchObject({ classification: 'insufficient_data', last: null });
    expect(anon.policy).toMatchObject({ platformFeeBp: 100, openOrderLimit: 20 });
    expect(anon.myOrders).toBeUndefined();

    const mine = MarketSnapshotResponse.parse(await (await get(`${t.planetId}?as=alice`)).json());
    expect(mine.myOrders).toEqual([]); // the only order of the colony is FILLED
    expect(mine.stall).toMatchObject({ hubFeeBp: 100, earned: { USDC: '50000' } });
    expect(mine.balances?.USDC).toBe('5050000');
    expect(acct(t.seller)).toBeTruthy();
  });

  it('a resting order of the caller shows up under myOrders and reserved', async () => {
    await h.colony('s52', { water: 300n });
    const r = (await h.place.handle(h.order('p19c', 's52', { side: 'sell', price: { token: 'USDC', amount: '5000000' } })))!;
    await h.db.prisma.marketOrder.updateMany({ where: { orderId: r.order.orderId }, data: { playerId: devPlayerId('bob') } });
    const snap = MarketSnapshotResponse.parse(await (await get('p19c', { authorization: 'Bearer dev:bob' })).json());
    expect(snap.myOrders).toHaveLength(1);
    expect(snap.myOrders![0]).toMatchObject({ pair: 'bio.water/USDC', side: 'sell', amount: 300, filled: 0, price: { token: 'USDC', amount: '5000000' } });
    expect(snap.reserved?.['bio.water']).toBe('300');
    expect(snap.books).toHaveLength(1);
    expect(snap.books[0]!.asks).toEqual([{ num: '50000', den: 3, amount: 300, orders: 1 }]);
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

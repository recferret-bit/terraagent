import { describe, expect, it } from 'vitest';
import { TradeClient } from './client';

const jsonRes = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('TradeClient reads', () => {
  it('uses /v1/trade/balances for balances (no market snapshot workaround)', async () => {
    const urls: string[] = [];
    const c = new TradeClient('dev:a', async (u) => { urls.push(u); return jsonRes({ planetId: 'p', colonyId: 'c', quote: {}, inOrbit: { 'bio.water': { free: '5', reserved: '1', total: '6' } } }); });
    const b = await c.tradeBalances('p');
    expect(urls).toEqual(['/v1/trade/balances?planetId=p']);
    expect(b.inOrbit['bio.water']?.total).toBe('6');
  });

  it('lists book orders with the side and limit as query', async () => {
    const urls: string[] = [];
    const c = new TradeClient('dev:a', async (u) => { urls.push(u); return jsonRes({ planetId: 'p', pair: 'bio.water/USDC', seq: 1, orders: [], truncated: false }); });
    await c.bookOrders('p', 'bio.water/USDC', 'sell', 50);
    await c.bookOrders('p', 'bio.water/USDC', null);
    expect(urls).toEqual(['/v1/trade/book/p/bio.water%2FUSDC/orders?limit=50&side=sell', '/v1/trade/book/p/bio.water%2FUSDC/orders?limit=200']);
  });

  it('reads the stall from the market snapshot and surfaces errors as TradeApiFailure', async () => {
    const ok = new TradeClient('dev:a', async () => jsonRes({ planetId: 'p', stall: { hubFeeBp: 50, earned: {} } }));
    expect((await ok.stall('p'))?.hubFeeBp).toBe(50);
    const bad = new TradeClient('dev:a', async () => jsonRes({ error: { code: 'no_colony', message: 'x' } }, 404));
    await expect(bad.stall('p')).rejects.toMatchObject({ code: 'no_colony' });
  });
});

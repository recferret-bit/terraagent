import { describe, expect, it } from 'vitest';
import { TradeClient } from './client';
import { probeTradeAuthMode, refreshSession, resolveIdentity, TRADE_TOKEN_KEY } from './identity';

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

  it('reads and sets the stall through /v1/trade/stall and surfaces errors as TradeApiFailure', async () => {
    const calls: Array<[string, string | undefined, string | undefined]> = [];
    const stall = { planetId: 'p', hubFeeBp: 50, minBp: 0, maxBp: 100, defaultBp: 100, earned: {} };
    const ok = new TradeClient('dev:a', async (u, init) => { calls.push([u, init?.method, init?.body as string | undefined]); return jsonRes(stall); });
    expect((await ok.getStall('p')).hubFeeBp).toBe(50);
    expect((await ok.setStall('p', 50)).hubFeeBp).toBe(50);
    expect(calls).toEqual([['/v1/trade/stall?planetId=p', 'GET', undefined], ['/v1/trade/stall', 'PUT', '{"bp":50,"planetId":"p"}']]);
    const bad = new TradeClient('dev:a', async () => jsonRes({ error: { code: 'fee_out_of_range', message: 'x', details: { minBp: 0, maxBp: 100 } } }, 422));
    await expect(bad.setStall('p', 101)).rejects.toMatchObject({ code: 'fee_out_of_range', details: { maxBp: 100 } });
  });

  it('falls back to /v1/me/profile and /v1/planets when /v1/dev/planets is disabled in production and caches the list', async () => {
    const urls: string[] = [];
    const c = new TradeClient('jwt-pilot', async (u) => {
      urls.push(u);
      if (u === '/v1/dev/planets') return jsonRes({ errorCode: 'NOT_FOUND' }, 404);
      if (u === '/v1/me/profile') return jsonRes({ currentColonies: [{ planetId: 'pl_home' }] });
      if (u === '/v1/planets') return jsonRes({ planets: [{ planetId: 'pl_home' }, { planetId: 'pl_dune' }] });
      return jsonRes({}, 404);
    });
    const first = await c.devPlanets();
    const second = await c.devPlanets();
    expect(first).toEqual(['pl_home', 'pl_dune']);
    expect(second).toEqual(['pl_home', 'pl_dune']);
    expect(urls).toEqual(['/v1/dev/planets', '/v1/me/profile', '/v1/planets']);
  });
});

describe('trade identity & NEAR status mode probing', () => {
  it('parses array ports from /v1/near/status in testnet and mock modes', async () => {
    const testnetMode = await probeTradeAuthMode(async () =>
      jsonRes({
        nearMode: 'testnet',
        ports: [{ port: 'Identity', mode: 'testnet', target: 'terraagent.testnet' }],
      }),
    );
    expect(testnetMode).toBe('testnet');

    const mockMode = await probeTradeAuthMode(async () =>
      jsonRes({
        nearMode: 'mock',
        ports: [{ port: 'Identity', mode: 'mock', target: 'in-memory' }],
      }),
    );
    expect(mockMode).toBe('mock');
  });

  it('rejects unlinked guest sessions in refreshSession and resolveIdentity', async () => {
    globalThis.localStorage?.setItem(TRADE_TOKEN_KEY, 'stale-token');
    globalThis.localStorage?.setItem(
      'ta_active_pilot',
      JSON.stringify({ playerId: 'pr_guest', accessToken: 'guest-jwt', updatedAt: 1, isGuest: true }),
    );
    expect(resolveIdentity('', '')).toBeNull();

    const guestRefresh = await refreshSession(async () =>
      jsonRes({ accessToken: 'guest-jwt-2', player: { id: 'pr_guest', handle: 'Colonist-1234', isGuest: true } }),
    );
    expect(guestRefresh).toBeNull();

    const pilotRefresh = await refreshSession(async () =>
      jsonRes({
        accessToken: 'pilot-jwt',
        accountId: 'ferretrecovic.terraagent.testnet',
        player: { id: 'pr_pilot', handle: 'ferretrecovic', isGuest: false },
      }),
    );
    expect(pilotRefresh).toEqual({
      token: 'pilot-jwt',
      label: 'ferretrecovic.terraagent.testnet',
    });
    globalThis.localStorage?.clear();
  });
});

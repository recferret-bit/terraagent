import { KillTradeRequest, KillTradeResponse, TRADE_API_ROUTES, TradeMeResponse } from '@terra/contracts';
import { resolveStrategyArg } from '@terra/sim';
import { describe, expect, it, vi } from 'vitest';
import { runMarketMatchBenchmark } from '../../../../scripts/economy/bench.js';
import { runScriptedTraderStep } from '../../../../scripts/economy/trade-bot.js';
import type { KeyRecord } from '../../src/market/trade/trade-key.repository.js';
import type { TradePrincipal } from '../../src/market/trade/trade-auth.js';
import { defaultAllowance } from '../../src/market/trade/trade-keys.js';
import { TradeKeysService } from '../../src/market/trade/trade-keys.service.js';

const PLANET = 'p_bot';
const PAIR = 'bio.water/USDC';

function makeKeyRecord(over: Partial<KeyRecord> = {}): KeyRecord {
  return {
    keyId: 'key_0123456789abcdef',
    secretHash: 'hash',
    ownerId: 'pr_owner',
    label: 'bot-1',
    planetId: PLANET,
    colonyId: 'col_1',
    colonyIndex: 1,
    accountId: 'col-1.mock',
    scopes: ['read', 'trade'],
    ratePerSecond: 10,
    rateBurst: 20,
    createdAt: new Date(1_000),
    lastUsedAt: null,
    revokedAt: null,
    allowance: defaultAllowance([PAIR]),
    ...over,
  };
}

function makeService(opts: {
  key?: KeyRecord;
  keysList?: KeyRecord[];
  openOrders?: Array<{ orderId: string; state: string; colonyIndex: number }>;
  committedToday?: bigint;
  outstandingOrders?: number;
} = {}) {
  const key = opts.key ?? makeKeyRecord();
  const keysRepo = {
    find: vi.fn(async (id: string) => (id === key.keyId ? key : (opts.keysList ?? []).find((k) => k.keyId === id) ?? null)),
    listByOwner: vi.fn(async () => opts.keysList ?? [key]),
    updateAllowance: vi.fn(async (id: string, patch: { killSwitch?: boolean }) => ({ ...key, keyId: id, allowance: { ...key.allowance, ...patch } })),
    countActive: vi.fn(async () => 1),
    create: vi.fn(),
    revoke: vi.fn(),
  };
  const openOrders = opts.openOrders ?? [{ orderId: 'mo_1', state: 'OPEN', colonyIndex: 1 }];
  const requestsRepo = {
    usage: vi.fn(async () => ({ outstandingOrders: opts.outstandingOrders ?? openOrders.length, committedToday: opts.committedToday ?? 2_000_000n })),
    cancelUnsubmitted: vi.fn(async () => 1),
    accepted: vi.fn(async () => openOrders.map((o) => ({ orderId: o.orderId }))),
  };
  const ordersService = {
    gate: vi.fn(),
    planetOf: vi.fn((p: TradePrincipal, given?: string) => {
      if (p.key && given && given !== p.key.planetId) throw Object.assign(new Error('wrong_planet'), { code: 'wrong_planet' });
      const out = p.key?.planetId ?? given;
      if (!out) throw Object.assign(new Error('invalid_request'), { code: 'invalid_request' });
      return out;
    }),
    colonyOrThrow: vi.fn(async (_p: TradePrincipal, _planetId: string) => ({ colonyId: 'col_1', colonyIndex: 1, accountId: 'col-1.mock' })),
  };
  const sim = { submit: vi.fn(async () => ({ ok: true, appliedAtTick: 1 })) };
  const streams = { closeKey: vi.fn() };
  const prisma = {
    $transaction: async <T>(fn: (tx: unknown) => Promise<T>) => fn(prisma),
    marketOrder: {
      count: vi.fn(async () => openOrders.filter((o) => ['PENDING', 'OPEN', 'PARTIAL'].includes(o.state)).length),
      findUnique: vi.fn(async ({ where }: { where: { orderId: string } }) => openOrders.find((o) => o.orderId === where.orderId) ?? null),
    },
    tradeApiRequest: { updateMany: vi.fn(async () => ({ count: 0 })) },
  };
  const policy = { current: () => ({ pairs: [{ pair: PAIR, quote: 'USDC' }] }) };
  const svc = new TradeKeysService(keysRepo as never, requestsRepo as never, policy as never, ordersService as never, sim as never, streams as never, prisma as never);
  return { svc, keysRepo, requestsRepo, sim };
}

describe('W13-58 & W13-59 bot API: /v1/trade/me, /v1/trade/cargo, /v1/trade/kill', () => {
  it('positive: /v1/trade/me returns bot identity, allowance, daily usage and killSwitch', async () => {
    const key = makeKeyRecord({ allowance: { ...defaultAllowance([PAIR]), dailyBudget: '10000000' } });
    const { svc } = makeService({ key, committedToday: 3_500_000n, outstandingOrders: 2 });
    const p: TradePrincipal = {
      actorKind: 'bot', ownerId: 'pr_owner', ownerRef: `key:${key.keyId}`, key, scopes: ['read', 'trade'],
      colonyFor: async () => ({ colonyId: 'col_1', colonyIndex: 1, accountId: 'col-1.mock' }),
    };
    const res = TradeMeResponse.parse(await svc.me(p));
    expect(res).toMatchObject({
      actorKind: 'bot', keyId: key.keyId, planetId: PLANET, colonyId: 'col_1',
      dailySpent: '3500000', dailyRemaining: '6500000', openOrders: 2, killSwitch: false,
    });
  });

  it('positive: /v1/trade/me for a player session returns null allowance and open order count', async () => {
    const { svc } = makeService();
    const p: TradePrincipal = {
      actorKind: 'player', ownerId: 'pr_owner', ownerRef: 'player:pr_owner', key: null, scopes: ['read', 'trade', 'manage'],
      colonyFor: async () => ({ colonyId: 'col_1', colonyIndex: 1, accountId: 'col-1.mock' }),
    };
    const res = TradeMeResponse.parse(await svc.me(p, PLANET));
    expect(res).toMatchObject({ actorKind: 'player', keyId: null, allowance: null, dailySpent: null, openOrders: 1, killSwitch: false });
  });

  it('positive: /v1/trade/kill lets a bot engage its own kill switch and cancels open orders', async () => {
    const key = makeKeyRecord();
    const { svc, keysRepo, requestsRepo, sim } = makeService({ key });
    const p: TradePrincipal = {
      actorKind: 'bot', ownerId: 'pr_owner', ownerRef: `key:${key.keyId}`, key, scopes: ['read', 'trade'],
      colonyFor: async () => ({ colonyId: 'col_1', colonyIndex: 1, accountId: 'col-1.mock' }),
    };
    const out = KillTradeResponse.parse(await svc.kill(p, KillTradeRequest.parse({})));
    expect(out).toEqual({ keyId: key.keyId, planetId: PLANET, colonyId: 'col_1', killSwitch: true, cancelledUnsubmitted: 1, cancelRequested: 1 });
    expect(keysRepo.updateAllowance).toHaveBeenCalledWith(key.keyId, { killSwitch: true });
    expect(requestsRepo.cancelUnsubmitted).toHaveBeenCalledWith(key.keyId);
    expect(sim.submit).toHaveBeenCalledTimes(1);
  });

  it('positive: /v1/trade/kill by owner session without keyId kills all active keys on the planet', async () => {
    const k1 = makeKeyRecord({ keyId: 'key_0000000000000001' });
    const k2 = makeKeyRecord({ keyId: 'key_0000000000000002' });
    const { svc, keysRepo } = makeService({ keysList: [k1, k2] });
    const p: TradePrincipal = {
      actorKind: 'player', ownerId: 'pr_owner', ownerRef: 'player:pr_owner', key: null, scopes: ['read', 'trade', 'manage'],
      colonyFor: async () => ({ colonyId: 'col_1', colonyIndex: 1, accountId: 'col-1.mock' }),
    };
    const out = KillTradeResponse.parse(await svc.kill(p, { planetId: PLANET }));
    expect(out).toMatchObject({ keyId: null, planetId: PLANET, killSwitch: true, cancelledUnsubmitted: 2, cancelRequested: 2 });
    expect(keysRepo.updateAllowance).toHaveBeenCalledTimes(2);
  });

  it('negative: a bot cannot kill another key or another planet, and me requires read scope', async () => {
    const key = makeKeyRecord();
    const { svc } = makeService({ key });
    const botPrincipal: TradePrincipal = {
      actorKind: 'bot', ownerId: 'pr_owner', ownerRef: `key:${key.keyId}`, key, scopes: ['trade'],
      colonyFor: async () => ({ colonyId: 'col_1', colonyIndex: 1, accountId: 'col-1.mock' }),
    };
    await expect(svc.me(botPrincipal)).rejects.toMatchObject({ code: 'forbidden_scope' });
    await expect(svc.kill(botPrincipal, { keyId: 'key_other' })).rejects.toMatchObject({ code: 'forbidden_scope' });
    await expect(svc.kill(botPrincipal, { planetId: 'other_planet' })).rejects.toMatchObject({ code: 'wrong_planet' });
  });

  it('corner: dailyRemaining floors at 0 when committedToday exceeds dailyBudget, and repeat kill on terminal orders submits 0 cancels', async () => {
    const key = makeKeyRecord({ allowance: { ...defaultAllowance([PAIR]), dailyBudget: '1000000' } });
    const { svc, sim } = makeService({
      key, committedToday: 5_000_000n, outstandingOrders: 0,
      openOrders: [{ orderId: 'mo_done', state: 'CANCELLED', colonyIndex: 1 }],
    });
    const p: TradePrincipal = {
      actorKind: 'bot', ownerId: 'pr_owner', ownerRef: `key:${key.keyId}`, key, scopes: ['read', 'trade'],
      colonyFor: async () => ({ colonyId: 'col_1', colonyIndex: 1, accountId: 'col-1.mock' }),
    };
    const me = await svc.me(p);
    expect(me.dailyRemaining).toBe('0');
    const killed = await svc.kill(p, {});
    expect(killed.cancelRequested).toBe(0);
    expect(sim.submit).not.toHaveBeenCalled();
  });

  it('route table includes me, cargo and kill with strict Zod schemas', () => {
    expect(TRADE_API_ROUTES.me.path).toBe('/v1/trade/me');
    expect(TRADE_API_ROUTES.cargo.path).toBe('/v1/trade/cargo');
    expect(TRADE_API_ROUTES.kill.path).toBe('/v1/trade/kill');
    expect(KillTradeRequest.safeParse({ extraField: 1 }).success).toBe(false);
  });
});

describe('W13-66 scripted trader bot step', () => {
  it('scripted trader step places quoted orders with idempotency keys and halts immediately when killSwitch is on', async () => {
    const calls: Array<{ url: string; method: string; idem?: string }> = [];
    const fakeFetch: typeof fetch = async (input, init) => {
      const u = String(input);
      const method = init?.method ?? 'GET';
      const headers = (init?.headers ?? {}) as Record<string, string>;
      calls.push({ url: u, method, idem: headers['idempotency-key'] });
      if (u.endsWith('/v1/trade/me')) {
        return new Response(JSON.stringify({
          actorKind: 'bot', ownerId: 'bot:1', keyId: 'k1', planetId: 'p1', colonyId: 'col_1', accountId: 'col_1.mock',
          scopes: ['read', 'trade'], allowance: null, dailySpent: '0', dailyRemaining: '1000000', openOrders: 0, killSwitch: false,
        }), { status: 200 });
      }
      if (u.includes('/v1/trade/orders?state=open')) return new Response(JSON.stringify({ orders: [] }), { status: 200 });
      if (u.includes('/v1/trade/agent/quote')) {
        return new Response(JSON.stringify({
          planetId: 'p1', resource: 'bio.water', quote: 'USDC', basis: 'organic', mid: { num: '10000', den: '1' },
          bid: null,
          ask: { order: { planetId: 'p1', side: 'sell', resource: 'bio.water', amount: 50, price: { token: 'USDC', amount: '550000' }, ttlS: 3600 }, maxSpend: '0' },
          bidReasons: ['no_need'], askReasons: [],
          inputs: { freeUnits: '200', inventory: '200', freeQuote: '1000000', budgetLeft: '1000000', referenceAgeS: 10, eligibleVolume: 500 },
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ requestId: 'rq_1', status: 'accepted', order: { orderId: 'mo_1' } }), { status: 201 });
    };

    const step = await runScriptedTraderStep({
      baseUrl: 'http://127.0.0.1:4001',
      apiKey: 'ta_bot_key_0123456789abcdef_secret',
      strategy: resolveStrategyArg('exporter'),
      stepSeq: 7,
      fetchImpl: fakeFetch,
    });
    expect(step.halted).toBe(false);
    expect(step.placed).toEqual([{ resource: 'bio.water', side: 'sell', status: 'accepted', requestId: 'rq_1', orderId: 'mo_1' }]);
    expect(calls.find((c) => c.method === 'POST')?.idem).toBe('bot-7-bio.water-sell');

    const haltedStep = await runScriptedTraderStep({
      baseUrl: 'http://127.0.0.1:4001',
      apiKey: 'ta_bot_key_0123456789abcdef_secret',
      strategy: resolveStrategyArg('exporter'),
      fetchImpl: async () => new Response(JSON.stringify({
        actorKind: 'bot', ownerId: 'bot:1', keyId: 'k1', planetId: 'p1', colonyId: 'col_1', accountId: 'col_1.mock',
        scopes: ['read', 'trade'], allowance: null, dailySpent: '0', dailyRemaining: '0', openOrders: 0, killSwitch: true,
      }), { status: 200 }),
    });
    expect(haltedStep).toMatchObject({ halted: true, haltReason: 'kill_switch', placed: [] });
  });
});

describe('W13-34 market-match benchmark gate', () => {
  it('matches 1,000 resting orders + 100 incoming orders under 5 ms p99 per match', () => {
    const res = runMarketMatchBenchmark(1_000, 100, 5);
    expect(res.ok).toBe(true);
    expect(res.p99Ms).toBeLessThanOrEqual(5);
    expect(res.totalFills).toBeGreaterThan(0);
  });
});

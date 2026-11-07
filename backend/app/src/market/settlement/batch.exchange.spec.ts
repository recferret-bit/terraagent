import { describe, expect, it } from 'vitest';
import { buildTradeBatch } from '@terra/sim/systems/trade/market-batch';
import { matchIncoming } from '@terra/sim/systems/trade/market-matcher';
import { OrderBook } from '@terra/sim/systems/trade/market-book';
import { maxBuyerSpend as simMaxBuyerSpend } from '@terra/sim/systems/trade/market-fees';
import { buildFillBatch } from './batch-builder.js';
import { maxBuyerSpend } from '../orders/max-buyer-spend.js';
import { requirementOf } from '../orders/order-funds.js';
import { PlaceOrderPrecheck } from '../orders/place-order.precheck.js';
import type { MarketOrderRecord } from '../book/market-order.record.js';

let seq = 0n;
function rec(side: 'buy' | 'sell', amount: bigint, priceAmount: bigint, over: Partial<MarketOrderRecord> = {}): MarketOrderRecord {
  seq += 1n;
  const id = `r${seq}`;
  return {
    orderId: id, seq, side, colonyId: `col-${id}`, amount, filled: 0n, priceAmount, ref: `ref-${id}`, planetId: 'p', pair: 'bio.water/USDC',
    base: 'bio.water', quote: 'USDC', colonyIndex: 0, playerId: null, accountId: `acc-${id}`, stallColonyId: `col-${id}`, stallAccountId: `stall-${id}`,
    stallHubEntityId: null, platformAccountId: 'platform', fillPolicy: 'partial', policyVersion: 'v1', policyHash: 'h', platformFeeBp: 100,
    stallFeeBp: 100, maxStallFeeBp: side === 'buy' ? 100 : null, reservedPrincipal: side === 'sell' ? amount : priceAmount,
    reservedFees: side === 'buy' ? priceAmount : 0n, cumNotional: 0n, feeBuckets: {}, actorKind: 'player', state: 'OPEN', ttlS: 3600,
    expiresAt: new Date(0), createdAt: new Date(0), ...over,
  };
}
const off = { enabled: false, shareBp: 2000, accountId: 'treasury' };

describe('exchange backend: buildFillBatch', () => {
  const orders = (...rs: MarketOrderRecord[]) => new Map(rs.map((r) => [r.orderId, r]));
  function fillOf(buyer: MarketOrderRecord, seller: MarketOrderRecord, taker: 'buy' | 'sell') {
    const book = new OrderBook<MarketOrderRecord & { stallFeeBp: number }>('p');
    book.add(taker === 'buy' ? seller : buyer);
    const res = matchIncoming(book as never, (taker === 'buy' ? buyer : seller) as never);
    return res.fills[0]!;
  }
  it('adapts a fill to the shared builder: identical batch, zero-sum, base/quote from the order rows', () => {
    const buyer = rec('buy', 10n, 5_000_000n, { quote: 'USDC' }), seller = rec('sell', 10n, 4_000_000n);
    const fill = fillOf(buyer, seller, 'buy');
    const viaBackend = buildFillBatch({ tradeId: 't9', fill, orders: orders(buyer, seller), treasury: off });
    const viaSim = buildTradeBatch({ tradeId: 't9', base: 'bio.water', quote: 'USDC', fill, buyer, seller, treasury: off });
    expect(viaBackend).toEqual(viaSim);
    expect(viaBackend.notional).toBe(4_000_000n);
    const sums = new Map<string, bigint>();
    for (const l of viaBackend.legs) sums.set(l.token, (sums.get(l.token) ?? 0n) + l.delta);
    for (const v of sums.values()) expect(v).toBe(0n);
  });
  it('throws when either locked order row is missing', () => {
    const buyer = rec('buy', 10n, 5_000_000n), seller = rec('sell', 10n, 4_000_000n);
    const fill = fillOf(buyer, seller, 'buy');
    expect(() => buildFillBatch({ tradeId: 't', fill, orders: orders(buyer), treasury: off })).toThrow(/not locked/);
    expect(() => buildFillBatch({ tradeId: 't', fill, orders: orders(seller), treasury: off })).toThrow(/not locked/);
    expect(() => buildFillBatch({ tradeId: 't', fill, orders: new Map(), treasury: off })).toThrow(/not locked/);
  });
  it('uses the freshly re-read row state: a stale fill larger than the re-read remainder is refused', () => {
    const buyer = rec('buy', 10n, 5_000_000n), seller = rec('sell', 10n, 4_000_000n);
    const fill = fillOf(buyer, seller, 'buy');
    const reread = { ...seller, filled: 7n };
    expect(() => buildFillBatch({ tradeId: 't', fill, orders: orders(buyer, reread), treasury: off })).toThrow(RangeError);
  });
  it('same input, same hash; treasury terms change it', () => {
    const buyer = rec('buy', 10n, 5_000_000n), seller = rec('sell', 10n, 4_000_000n);
    const fill = fillOf(buyer, seller, 'sell');
    const a = buildFillBatch({ tradeId: 't', fill, orders: orders(buyer, seller), treasury: off });
    const b = buildFillBatch({ tradeId: 't', fill, orders: orders(seller, buyer), treasury: off });
    expect(a.batchHash).toBe(b.batchHash);
    expect(buildFillBatch({ tradeId: 't', fill, orders: orders(buyer, seller), treasury: { ...off, enabled: true } }).batchHash).not.toBe(a.batchHash);
  });
  it('a barter quote token is carried through (resource quote)', () => {
    const buyer = rec('buy', 10n, 5_000n, { quote: 'metals.t1' }), seller = rec('sell', 10n, 4_000n, { quote: 'metals.t1' });
    const b = buildFillBatch({ tradeId: 't', fill: fillOf(buyer, seller, 'buy'), orders: orders(buyer, seller), treasury: off });
    expect(b.quote).toBe('metals.t1');
    expect(b.legs.every((l) => l.token === 'metals.t1' || l.token === 'bio.water')).toBe(true);
  });
});

describe('exchange backend: maxBuyerSpend and requirementOf', () => {
  it('floor rounding: principal + floor(1%) + floor(1%), the rule the sim\'s cargo check uses', () => {
    expect(maxBuyerSpend(101n, 100, 100)).toBe(103n);
    expect(maxBuyerSpend(100n, 100, 100)).toBe(102n);
    expect(maxBuyerSpend(1n, 100, 100)).toBe(1n);
    expect(maxBuyerSpend(0n, 100, 100)).toBe(0n);
    expect(maxBuyerSpend(12345n, 0, 0)).toBe(12345n);
  });
  it('is exactly the sim bound for the same terms (the sim never accepts an order the server then refuses for funds)', () => {
    for (let p = 0n; p < 400n; p++) for (const [a, b] of [[100, 100], [100, 0], [50, 70], [0, 100]] as const) {
      expect(maxBuyerSpend(p, a, b)).toBe(simMaxBuyerSpend(p, a, b));
    }
  });
  it('huge amounts stay exact beyond 2^64', () => {
    const p = 2n ** 80n;
    expect(maxBuyerSpend(p, 100, 100)).toBe(p + 2n * ((p * 100n) / 10000n));
  });
  it('requirementOf: sell locks base units, buy locks quote principal + fee headroom', () => {
    const sell = requirementOf({ side: 'sell', base: 'bio.water', quote: 'USDC', amount: 7n, priceAmount: 999n, platformFeeBp: 100, maxStallFeeBp: 100 });
    expect(sell).toEqual({ token: 'bio.water', principal: 7n, fees: 0n });
    const buy = requirementOf({ side: 'buy', base: 'bio.water', quote: 'USDC', amount: 7n, priceAmount: 101n, platformFeeBp: 100, maxStallFeeBp: 100 });
    expect(buy).toEqual({ token: 'USDC', principal: 101n, fees: 2n });
  });
});

describe('exchange backend: PlaceOrderPrecheck', () => {
  interface Cfg { openOrderLimit: number; platformFeeBp: number; stallFeeMaxBp: number }
  function make(over: { open?: number; free?: bigint; cfg?: Partial<Cfg>; env?: Record<string, string | undefined> } = {}) {
    const calls: { token?: string } = {};
    const registered: Record<string, unknown> = {};
    const prechecks = { register: (k: string, fn: unknown) => { registered[k] = fn; return () => { delete registered[k]; }; } };
    const funds = { view: async (_a: string, token: string) => { calls.token = token; return { free: over.free ?? 10_000_000n }; } };
    const repo = { listOpenByColony: async () => Array.from({ length: over.open ?? 0 }) };
    const policy = { current: () => ({ openOrderLimit: 20, platformFeeBp: 100, stallFeeMaxBp: 100, ...over.cfg }) };
    const colonies = { resolve: async () => ({ colonyId: 'c1', accountId: 'a1' }) };
    const env = { NODE_ENV: 'development', ...over.env };
    const p = new PlaceOrderPrecheck(prechecks as never, funds as never, repo as never, policy as never, colonies as never, {} as never, env as never);
    return { p, calls, registered };
  }
  const input = (args: Record<string, unknown>, colony: unknown = { colonyIndex: 0, id: 'c1' }) =>
    ({ planetId: 'pl', playerId: 'pr', colony, args }) as never;
  const sell = { side: 'sell', resource: 'bio.water', amount: 10, price: { token: 'USDC', amount: '1000000' }, ttlS: 3600 };
  const buy = { side: 'buy', resource: 'bio.water', amount: 10, price: { token: 'USDC', amount: '1000000' }, ttlS: 3600 };

  it('registers on init and unregisters on destroy; init is idempotent', () => {
    const { p, registered } = make();
    p.onModuleInit(); p.onModuleInit();
    expect(Object.keys(registered)).toEqual(['market.placeOrder']);
    p.onModuleDestroy();
    expect(registered).toEqual({});
    expect(() => p.onModuleDestroy()).not.toThrow();
  });
  it('passes through (null) without a colony, without a database in test env, and for malformed args', async () => {
    const { p } = make({ free: 0n });
    expect(await p.check(input(buy, null))).toBeNull();
    expect(await make({ free: 0n, env: { NODE_ENV: 'test', DATABASE_URL: undefined } }).p.check(input(buy))).toBeNull();
    for (const bad of [{}, { ...buy, price: undefined }, { ...buy, amount: '10' }, { ...buy, resource: undefined }, { ...buy, side: undefined }]) {
      expect(await p.check(input(bad))).toBeNull();
    }
  });
  it('order_limit at the limit, not below it', async () => {
    expect(await make({ open: 20 }).p.check(input(sell))).toMatchObject({ code: 'order_limit' });
    expect(await make({ open: 19 }).p.check(input(sell))).toBeNull();
    expect(await make({ open: 3, cfg: { openOrderLimit: 3 } }).p.check(input(sell))).toMatchObject({ code: 'order_limit' });
  });
  it('sell checks base units: free == amount passes, one short rejects, and the token queried is the base', async () => {
    const ok = make({ free: 10n });
    expect(await ok.p.check(input(sell))).toBeNull();
    expect(ok.calls.token).toBe('bio.water');
    expect(await make({ free: 9n }).p.check(input(sell))).toMatchObject({ code: 'insufficient_cargo' });
  });
  it('buy checks quote principal plus max fees: boundary total / total-1', async () => {
    const need = 1_000_000n + 10_000n + 10_000n;
    const ok = make({ free: need });
    expect(await ok.p.check(input(buy))).toBeNull();
    expect(ok.calls.token).toBe('USDC');
    expect(await make({ free: need - 1n }).p.check(input(buy))).toMatchObject({ code: 'insufficient_cargo' });
  });
  it('buy reservation honours an explicit maxStallFeeBp and falls back to the policy maximum', async () => {
    expect(await make({ free: 1_010_000n }).p.check(input({ ...buy, maxStallFeeBp: 0 }))).toBeNull();
    expect(await make({ free: 1_009_999n }).p.check(input({ ...buy, maxStallFeeBp: 0 }))).toMatchObject({ code: 'insufficient_cargo' });
    expect(await make({ free: 1_010_000n }).p.check(input(buy))).toMatchObject({ code: 'insufficient_cargo' });
  });
  it('order_limit is reported before funds', async () => {
    expect(await make({ open: 20, free: 0n }).p.check(input(buy))).toMatchObject({ code: 'order_limit' });
  });
  // Regression (fixed; was `it.fails`): the precheck used to throw on BigInt('1.5') / BigInt('abc') before the sim validated the args.
  it('a fractional / garbage price string from a crafted client does not crash the precheck into a non-reject', async () => {
    // BigInt('1.5') throws; the sim reports bad args, so the precheck must not surface an exception.
    await expect(make().p.check(input({ ...buy, price: { token: 'USDC', amount: '1.5' } }))).resolves.toBeNull();
  });
});

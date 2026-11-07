import { MarketColonies } from '../../src/market/orders/market-colonies.js';
import { marketDepositOpId, marketOrderRef } from '@terra/contracts';
import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PlanetEventOf } from '../../src/bus/channels.js';
import { EventBus } from '../../src/bus/event-bus.js';
import { CommandPrechecks } from '../../src/core/command-prechecks.js';
import { MarketBooks } from '../../src/market/book/market-books.js';
import { MarketOrderRepository } from '../../src/market/book/market-order.repository.js';
import { MarketMatcher } from '../../src/market/matching/market-matcher.service.js';
import { LoggingMarketFillsHook } from '../../src/market/orders/market-fills.hook.js';
import { MarketPolicyProvider } from '../../src/market/orders/market-policy.provider.js';
import { MarketSimGateway, type NearMarketCommandBusEvent } from '../../src/market/orders/market-sim-gateway.js';
import { IntentTradeRepository } from '../../src/market/settlement/intent-trade.repository.js';
import { OrderFunds } from '../../src/market/orders/order-funds.js';
import { PlaceOrderPrecheck } from '../../src/market/orders/place-order.precheck.js';
import { PlaceOrderService } from '../../src/market/orders/place-order.service.js';
import { ChainOutboxRepository } from '../../src/near/application/outbox/chain-outbox.repository.js';
import { CARGO_BASE_UNIT, type CargoTokenPort } from '../../src/near/application/ports/cargo-token.port.js';
import type { IntentsBalanceReadPort } from '../../src/near/application/ports/intents-balance-read.port.js';

let db: TestDatabase;
beforeAll(async () => { db = await createTestDatabase(); });
afterAll(async () => { await db?.drop(); });

/** In-memory ledgers behind the two read ports (cargo account in chain units, verifier in market atomic units). */
interface Rig { service: PlaceOrderService; precheck: PlaceOrderPrecheck; repo: MarketOrderRepository; cmds: NearMarketCommandBusEvent[];
  cargo: Map<string, bigint>; verifier: Map<string, bigint>; outbox: ChainOutboxRepository }

function rig(colony: string): Rig {
  const cargo = new Map<string, bigint>();
  const verifier = new Map<string, bigint>();
  const cargoPort = { balanceOf: ({ accountId, tokenId }) => Promise.resolve(String(cargo.get(`${accountId}|${tokenId}`) ?? 0n)) } as CargoTokenPort;
  const verifierPort = { verifierBalance: (a: string, t: string) => Promise.resolve(verifier.get(`${a}|${t}`) ?? 0n) } as IntentsBalanceReadPort;
  const bus = new EventBus();
  const cmds: NearMarketCommandBusEvent[] = [];
  bus.on('near.market.command', (c) => cmds.push(c), { module: 'test' });
  const repo = new MarketOrderRepository(db.prisma);
  const books = new MarketBooks(repo);
  const funds = new OrderFunds(repo, cargoPort, verifierPort, new IntentTradeRepository(db.prisma));
  const policy = new MarketPolicyProvider();
  const outbox = new ChainOutboxRepository(db.prisma);
  const env = { NODE_ENV: 'test', DATABASE_URL: 'x' } as never;
  const service = new PlaceOrderService(bus, repo, books, new MarketMatcher(db.prisma, repo, books), funds, outbox, policy,
    new MarketSimGateway(bus), new LoggingMarketFillsHook(), db.prisma, env);
  const precheck = new PlaceOrderPrecheck(new CommandPrechecks(), funds, repo, policy, new MarketColonies(db.prisma, { isScenarioColonyPlanet: () => false } as never), db.prisma, env);
  void colony;
  return { service, precheck, repo, cmds, cargo, verifier, outbox };
}

const account = (colony: string) => `${colony}.terraagent.mock`;
let seq = 0;
const requested = (colony: string, over: Record<string, unknown> = {}): PlanetEventOf<'marketOrderRequested'> => {
  const orderSeq = ++seq;
  return {
    planetId: 'p1', tick: 1, kind: 'marketOrderRequested', severity: 'info', colonyIds: [colony],
    data: {
      ref: marketOrderRef(colony, orderSeq), orderSeq, colonyId: colony, colonyIndex: 0, side: 'sell', resource: 'bio.water', amount: 300,
      price: { token: 'USDC', amount: '5000000' }, ttlS: 3600, stallFeeBp: 100, hubEntityId: 7, stallName: 'Port', ...over,
    },
  } as PlanetEventOf<'marketOrderRequested'>;
};

describe('W13-09 place order: reservations', () => {
  it('a seller reserves base, enqueues one deposit, and the sim is told market.reserve', async () => {
    const r = rig('col_s1');
    r.cargo.set(`${account('col_s1')}|bio.water`, 400n * CARGO_BASE_UNIT);
    const ev = requested('col_s1');
    const res = (await r.service.handle(ev))!;
    expect(res.order).toMatchObject({ state: 'OPEN', reservedPrincipal: 300n, reservedFees: 0n, fillPolicy: 'partial', platformFeeBp: 100, stallFeeBp: 100, policyVersion: 'bootstrap-1' });
    expect(res.order.policyHash).toMatch(/^sha256:/);
    expect(res.depositChain).toBe(300n * CARGO_BASE_UNIT);
    const row = await r.outbox.find(marketDepositOpId(ev.data.ref));
    expect(row).toMatchObject({ port: 'Intents', method: 'deposit' });
    expect(r.cmds.map((c) => c.kind)).toEqual(['market.reserve']);
    expect(r.cmds[0].args).toMatchObject({ ref: ev.data.ref, orderId: res.order.orderId, deltas: { 'bio.water': 300 } });
  });

  it('idempotent replay: one order, one deposit row, no second reservation', async () => {
    const r = rig('col_s2');
    r.cargo.set(`${account('col_s2')}|bio.water`, 300n * CARGO_BASE_UNIT);
    const ev = requested('col_s2');
    await r.service.handle(ev);
    const again = (await r.service.handle(ev))!;
    expect(again.created).toBe(false);
    expect(await db.prisma.marketOrder.count({ where: { colonyId: 'col_s2' } })).toBe(1);
    expect(await db.prisma.chainOutbox.count({ where: { opId: marketDepositOpId(ev.data.ref) } })).toBe(1);
    expect((await r.repo.find(again.order.orderId))!.reservedPrincipal).toBe(300n);
  });

  it('two concurrent orders cannot reserve the same funds: one OPEN, one REJECTED', async () => {
    const r = rig('col_s3');
    r.cargo.set(`${account('col_s3')}|bio.water`, 300n * CARGO_BASE_UNIT);
    const [a, b] = await Promise.all([r.service.handle(requested('col_s3')), r.service.handle(requested('col_s3'))]);
    const states = [a!.order.state, b!.order.state].sort();
    expect(states).toEqual(['OPEN', 'REJECTED']);
    const loser = a!.rejected ? a! : b!;
    expect(loser.rejected!.code).toBe('insufficient_cargo');
    expect(r.cmds.filter((c) => c.kind === 'market.release')[0].args).toMatchObject({ reason: 'rejected', code: 'insufficient_cargo' });
    const reserved = (await r.repo.listOpenByColony('p1', 'col_s3')).reduce((s, o) => s + o.reservedPrincipal, 0n);
    expect(reserved).toBe(300n);
  });

  it('uses verifier funds first and skips the deposit when they cover the lock', async () => {
    const r = rig('col_s4');
    r.verifier.set(`${account('col_s4')}|bio.water`, 300n);
    const res = (await r.service.handle(requested('col_s4')))!;
    expect(res.order.state).toBe('OPEN');
    expect(res.depositChain).toBe(0n);
  });
});

describe('W13-09 place order: buyer maximum spend', () => {
  const buy = (colony: string, amount: string) => requested(colony, { side: 'buy', price: { token: 'USDC', amount }, maxStallFeeBp: 100, amount: 10 });

  it('a buyer with 10 USDC cannot submit a 10.20 total order: precheck and event path both reject', async () => {
    const r = rig('col_b1');
    r.verifier.set(`${account('col_b1')}|USDC`, 10_000_000n);
    // 10.00 principal + 1% platform + 1% max stall = 10.20 total
    const ev = buy('col_b1', '10000000');
    const pre = await r.precheck.check({ kind: 'market.placeOrder', args: { ...ev.data, colonyId: undefined, resource: ev.data.resource }, playerId: 'pr_b1', planetId: 'p1', colony: { id: 'col_b1', colonyIndex: 0 }, dev: false });
    expect(pre).toMatchObject({ code: 'insufficient_cargo' });
    const res = (await r.service.handle(ev))!;
    expect(res.order.state).toBe('REJECTED');
    expect(res.rejected!.code).toBe('insufficient_cargo');
  });

  it('the same buyer can place a 9.80 order (reserves 9.80 + fees = 9.99 USDC)', async () => {
    const r = rig('col_b2');
    r.verifier.set(`${account('col_b2')}|USDC`, 10_000_000n);
    const ev = buy('col_b2', '9800000');
    const pre = await r.precheck.check({ kind: 'market.placeOrder', args: ev.data, playerId: 'pr_b2', planetId: 'p1', colony: { id: 'col_b2', colonyIndex: 0 }, dev: false });
    expect(pre).toBeNull();
    const res = (await r.service.handle(ev))!;
    expect(res.order).toMatchObject({ state: 'OPEN', reservedPrincipal: 9_800_000n, reservedFees: 196_000n, maxStallFeeBp: 100 });
    expect(r.cmds[0].args).toMatchObject({ deltas: {} }); // USDC lives only at the verifier
  });

  it('open-order limit: precheck and event path reject order_limit', async () => {
    const r = rig('col_b3');
    r.verifier.set(`${account('col_b3')}|USDC`, 1_000_000_000n);
    for (let i = 0; i < 20; i++) expect((await r.service.handle(buy('col_b3', '200000')))!.order.state).toBe('OPEN');
    const ev = buy('col_b3', '200000');
    const pre = await r.precheck.check({ kind: 'market.placeOrder', args: ev.data, playerId: 'pr_b3', planetId: 'p1', colony: { id: 'col_b3', colonyIndex: 0 }, dev: false });
    expect(pre).toMatchObject({ code: 'order_limit' });
    expect((await r.service.handle(ev))!.rejected!.code).toBe('order_limit');
  });
});

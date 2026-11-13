import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { MARKET_TOKENS, marketOrderRef, marketTradeOpId, toChainUnits } from '@terra/contracts';
import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app.js';
import type { PlanetEventOf } from '../../src/bus/channels.js';
import { EventBus } from '../../src/bus/event-bus.js';
import { PlaceOrderService } from '../../src/market/orders/place-order.service.js';
import { IntentTradeRepository } from '../../src/market/settlement/intent-trade.repository.js';
import { TradeSettlement, type MarketTradeBusEvent } from '../../src/market/settlement/trade-settlement.service.js';
import { OutboxRelayService } from '../../src/near/application/outbox/outbox.module.js';
import { IntentsPort } from '../../src/near/application/ports/intents.port.js';
import type { NearMarketCommandBusEvent } from '../../src/market/orders/market-sim-gateway.js';
import type { MockIntentsAdapter } from '../../src/near/infrastructure/adapters/mock/intents.adapter.js';
import { mockChainControls } from '../../src/near/infrastructure/mock/mock-controls.js';

let db: TestDatabase;
let app: INestApplication;
let place: PlaceOrderService;
let relay: OutboxRelayService;
let settlement: TradeSettlement;
let intents: MockIntentsAdapter;
let trades: IntentTradeRepository;
let bus: EventBus;
const cmds: NearMarketCommandBusEvent[] = [];
const pushes: MarketTradeBusEvent[] = [];

const WATER = MARKET_TOKENS['bio.water'].verifierId;
const USDC = MARKET_TOKENS.USDC.verifierId;
const acct = (c: string) => `${c}.terraagent.mock`;
let planetN = 0;
let seq = 0;

beforeAll(async () => {
  db = await createTestDatabase();
  const created = await createApp({
    source: { NODE_ENV: 'test', LOG_LEVEL: 'silent', SIM_THREADS: '1', SNAPSHOTS: 'off', DATABASE_URL: db.url, OUTBOX_RELAY_ENABLED: 'false', MOCK_LATENCY_MIN_MS: '0', MOCK_LATENCY_MAX_MS: '0' },
  });
  app = created.app;
  await app.init();
  place = app.get(PlaceOrderService);
  relay = app.get(OutboxRelayService);
  settlement = app.get(TradeSettlement);
  intents = app.get(IntentsPort, { strict: false }) as unknown as MockIntentsAdapter;
  trades = app.get(IntentTradeRepository);
  bus = app.get(EventBus);
  bus.on('near.market.command', (c) => cmds.push(c), { module: 'test' });
  bus.on('market.trade', (p) => pushes.push(p), { module: 'test' });
  await intents.testRegisterSigner('protocol.terraagent.mock');
});
afterEach(() => mockChainControls.reset());
afterAll(async () => {
  await app?.close();
  await db?.drop();
});

const verifier = async (a: string, id: string) => (await db.prisma.mockChainIntentsBalance.findUnique({ where: { accountId_tokenId: { accountId: a, tokenId: id } } }))?.amount.toFixed() ?? '0';

const requested = (planetId: string, colony: string, over: Record<string, unknown>): PlanetEventOf<'marketOrderRequested'> => {
  const orderSeq = ++seq;
  return {
    planetId, tick: 1, kind: 'marketOrderRequested', severity: 'info', colonyIds: [colony],
    data: { ref: marketOrderRef(colony, orderSeq), orderSeq, colonyId: colony, colonyIndex: colony.startsWith('s') ? 0 : 1, resource: 'bio.water', amount: 300, ttlS: 3600, stallFeeBp: 100, hubEntityId: 3, ...over },
  } as unknown as PlanetEventOf<'marketOrderRequested'>;
};

/** Seller (col_0) offers 300 water for 5 USDC; buyer (col_1) bids 300 water for 5 USDC with 10 USDC at the verifier. Returns the PENDING trade. */
async function matchedTrade() {
  const n = ++planetN;
  const planetId = `pw${n}`;
  const [seller, buyer] = [`s${n}`, `b${n}`];
  for (const c of [seller, buyer]) await intents.testRegisterSigner(acct(c));
  await intents.testSeedVerifier(acct(seller), WATER, toChainUnits('bio.water', 300n));
  await intents.testSeedVerifier(acct(buyer), USDC, 10_000_000n);
  const ask = (await place.handle(requested(planetId, seller, { side: 'sell', price: { token: 'USDC', amount: '5000000' } })))!;
  const bid = (await place.handle(requested(planetId, buyer, { side: 'buy', price: { token: 'USDC', amount: '5000000' }, maxStallFeeBp: 100 })))!;
  const states = await Promise.all([ask, bid].map(async (r) => (await db.prisma.marketOrder.findUnique({ where: { orderId: r.order.orderId } }))!.state));
  expect(states).toEqual(['FILLED', 'FILLED']);
  const row = (await db.prisma.intentTrade.findMany({ where: { planetId } }))[0]!;
  return { planetId, ask, bid, tradeId: row.tradeId, seller, buyer };
}

describe('W13-13 settlement: from fill to FINAL', () => {
  it('a fill writes the order updates, a PENDING trade and one execute outbox row (nothing moves yet)', async () => {
    const t = await matchedTrade();
    const trade = (await trades.find(t.tradeId))!;
    expect(trade).toMatchObject({ state: 'PENDING', organic: true, makerSide: 'sell', buyerColonyId: t.buyer, sellerColonyId: t.seller });
    expect(trade.notional.toFixed()).toBe('5000000');
    expect(trade.platformFee.toFixed()).toBe('50000');
    expect(trade.stallFee.toFixed()).toBe('50000');
    const outbox = await db.prisma.chainOutbox.findUnique({ where: { opId: marketTradeOpId(t.tradeId) } });
    expect(outbox).toMatchObject({ port: 'Intents', method: 'execute', status: 'PENDING' });
    expect(await verifier(acct(t.buyer), USDC)).toBe('10000000');
  });

  it('relay executes, FINAL once, market.settled to buyer/seller/stall, one market.trade push', async () => {
    cmds.length = 0; pushes.length = 0;
    const t = await matchedTrade();
    expect(await relay.pollOnce()).toBeGreaterThan(0);
    const trade = (await trades.find(t.tradeId))!;
    expect(trade.state).toBe('FINAL');
    expect(trade.txHash).toMatch(/^mock:/);
    expect(await verifier(acct(t.buyer), USDC)).toBe((10_000_000n - 5_100_000n).toString());
    expect(await verifier(acct(t.seller), USDC)).toBe('5050000'); // notional + the stall fee (the seller is the maker stall)
    expect(await verifier('protocol.terraagent.mock', USDC)).not.toBe('0');
    const mine = cmds.filter((c) => c.kind === 'market.settled' && (c.args as { tradeId: string }).tradeId === t.tradeId);
    expect(mine.map((c) => `${c.colonyId}:${(c.args as { role: string }).role}`).sort()).toEqual([`${t.buyer}:buyer`, `${t.seller}:seller`, `${t.seller}:stall`].sort());
    const seller = mine.find((c) => (c.args as { role: string }).role === 'seller')!.args as { deltas: Record<string, number>; released: Record<string, number> };
    expect(seller.deltas).toEqual({ 'bio.water': -300 });
    expect(seller.released).toEqual({ 'bio.water': 300 });
    expect(pushes.filter((p) => p.payload.trade.tradeId === t.tradeId)).toHaveLength(1);
    expect(pushes.at(-1)!.payload.trade).toMatchObject({ state: 'FINAL', amount: 300, notional: '5000000' });
  });
});

describe('W13-13 settlement: crash safety', () => {
  it('killed after execute, before FINAL: restart records the trade once and never executes a second time', async () => {
    cmds.length = 0; pushes.length = 0;
    const t = await matchedTrade();
    const exec = vi.spyOn(intents, 'execute');
    settlement.onModuleDestroy(); // the process "dies" before the FINAL step can run
    await relay.pollOnce(); // execute ran and the relay stored DONE; the trade is still PENDING
    expect(exec).toHaveBeenCalledTimes(1);
    expect((await trades.find(t.tradeId))!.state).toBe('PENDING');
    const usdcAfterExecute = await verifier(acct(t.buyer), USDC);
    expect(cmds.filter((c) => c.kind === 'market.settled' && (c.args as { tradeId: string }).tradeId === t.tradeId)).toHaveLength(0);

    expect(await settlement.recover()).toBeGreaterThanOrEqual(1); // restart: boot recovery finishes the PENDING trade
    expect(await settlement.recover()).toBe(0);
    settlement.onModuleInit();
    await relay.pollOnce();
    expect(exec).toHaveBeenCalledTimes(1);
    expect((await trades.find(t.tradeId))!.state).toBe('FINAL');
    expect(await verifier(acct(t.buyer), USDC)).toBe(usdcAfterExecute);
    expect(usdcAfterExecute).toBe((10_000_000n - 5_100_000n).toString());
    expect(await db.prisma.intentTrade.count({ where: { tradeId: t.tradeId } })).toBe(1);
    const settled = cmds.filter((c) => c.kind === 'market.settled' && (c.args as { tradeId: string }).tradeId === t.tradeId);
    expect(settled).toHaveLength(3);
    expect(pushes.filter((p) => p.payload.trade.tradeId === t.tradeId)).toHaveLength(1);
    exec.mockRestore();
  });

  it('killed after the chain applied the batch but before the outbox stored DONE: the re-claimed row gets the stored receipt, no second ledger change', async () => {
    const t = await matchedTrade();
    const row = (await db.prisma.chainOutbox.findUnique({ where: { opId: marketTradeOpId(t.tradeId) } }))!;
    const payload = row.payload as { intents: never[] };
    const first = await intents.execute({ opId: row.opId, intents: payload.intents });
    const usdc = await verifier(acct(t.buyer), USDC);
    const intentRows = await db.prisma.mockChainIntent.count();
    await relay.pollOnce(); // relay claims the still-PENDING row and calls execute again with the same opId
    const done = (await db.prisma.chainOutbox.findUnique({ where: { opId: row.opId } }))!;
    expect(done.status).toBe('DONE');
    expect(done.txHash).toBe(first.txHash);
    expect(await verifier(acct(t.buyer), USDC)).toBe(usdc);
    expect(await db.prisma.mockChainIntent.count()).toBe(intentRows);
    expect((await trades.find(t.tradeId))!.state).toBe('FINAL');
  });
});

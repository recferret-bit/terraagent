import 'reflect-metadata';
import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import type { ModuleRef } from '@nestjs/core';
import { pairId, type TradeOverviewResponse } from '@terra/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decimalToBigint } from '../../src/market/book/decimal.js';
import { EventBus } from '../../src/bus/event-bus.js';
import type { AppEnv } from '../../src/core/tokens.js';
import type { FlagsService } from '../../src/flags/flags.service.js';
import { MarketBooks } from '../../src/market/book/market-books.js';
import { MarketOrderRepository } from '../../src/market/book/market-order.repository.js';
import { GuildFundingRepository } from '../../src/market/guild/funding/funding.repository.js';
import { GuildFundingService } from '../../src/market/guild/funding/guild-funding.service.js';
import { GuildNpcRepository } from '../../src/market/guild/guild-npc.repository.js';
import type { InventoryCache } from '../../src/market/guild/guild-plan.js';
import { stockOf } from '../../src/market/guild/inventory.js';
import { GuildProvisionService } from '../../src/market/guild/guild-provision.service.js';
import { GuildTradeKeyBinder } from '../../src/market/guild/guild-trade-key.binder.js';
import { GuildWalletBinder } from '../../src/market/guild/guild-wallet.binder.js';
import { GuildMakerService } from '../../src/market/guild/maker/guild-maker.service.js';
import { GuildOrderBook } from '../../src/market/guild/maker/order-book.js';
import { tier1BarterPairs, TIER1_RESOURCES } from '../../src/market/guild/maker/pairs.js';
import { departOf } from '../../src/market/guild/maker/plan.js';
import type { GuildFillNotice } from '../../src/market/guild/maker/requote.js';
import { judgeOffer, type OfferQuote } from '../../src/market/guild/offers/curate.js';
import { guildOfferId } from '../../src/market/guild/offers/offer-id.js';
import { quoteSeqOf } from '../../src/market/guild/offers/quote-row.js';
import { OrderRelease } from '../../src/market/orders/cancel-order.service.js';
import { MarketSimGateway } from '../../src/market/orders/market-sim-gateway.js';
import { TradeKeyRepository } from '../../src/market/trade/trade-key.repository.js';
import { MockAgentWalletAdapter } from '../../src/near/infrastructure/adapters/mock/agent-wallet.adapter.js';

const PLANET = 'pl_guild_requote';
const DEPART = 1_700_000_720_000;
const on = { has: (wave: string) => wave === 'W15' || wave === 'W13', flags: { has: (wave: string) => wave === 'W15' || wave === 'W13' } } as unknown as FlagsService;
const off = { has: () => false, flags: { has: () => false } } as unknown as FlagsService;

let db: TestDatabase;
let maker: GuildMakerService;
let quiet: GuildMakerService;
let funding: GuildFundingService;

beforeAll(async () => {
  db = await createTestDatabase();
  const env = { NODE_ENV: 'test', DATABASE_URL: db.url } as AppEnv;
  const wallet = new MockAgentWalletAdapter(db.prisma, { latencyMinMs: 0, latencyMaxMs: 0, failRate: 0, seed: 7 }, { sleep: async () => undefined });
  const npcs = new GuildNpcRepository(db.prisma);
  const keys = new TradeKeyRepository(db.prisma);
  const provision = new GuildProvisionService(on, npcs, new GuildWalletBinder(wallet), new GuildTradeKeyBinder(db.prisma, keys), env);
  await provision.provision();
  for (const resource of TIER1_RESOURCES) await provision.allocateFixtureCargo('kestrel', resource, 2500);
  funding = new GuildFundingService(new GuildFundingRepository(db.prisma), on, env);
  const bus = new EventBus();
  const repo = new MarketOrderRepository(db.prisma);
  const book = new GuildOrderBook(db.prisma, repo, new OrderRelease(repo, new MarketBooks(repo, env), new MarketSimGateway(bus), db.prisma));
  const unused = { get() { throw new Error('unused'); } } as unknown as ModuleRef;
  const discovery = { overview: (planetId: string) => Promise.resolve(board(planetId)) };
  maker = new GuildMakerService(on, funding, npcs, keys, unused, bus, env, db.prisma, book, discovery);
  quiet = new GuildMakerService(off, funding, npcs, keys, unused, new EventBus(), env, db.prisma, book, discovery);
});

afterAll(async () => {
  await db?.drop();
});

describe('guild re-quote on Postgres (W15-07)', () => {
  it('negative: W15 off does not re-quote', async () => {
    const before = await db.prisma.marketOrder.count();
    expect(await quiet.onGuildFill(stub(600))).toBeNull();
    expect(await db.prisma.marketOrder.count()).toBe(before);
    expect(await metalsStock()).toBe(2500);
  });

  it('positive: one bid, fill 600, the next metals bid is strictly lower', async () => {
    await maker.onArrived(dock(DEPART));
    const before = await metalsBid();
    const beforePrice = decimalToBigint(before.priceAmount);
    const beforeSeq = quoteSeqOf(before.signedTerms);
    const started = performance.now();
    const report = await maker.onGuildFill(noticeOf(before, 600));
    expect(performance.now() - started).toBeLessThan(1_000);
    expect(report?.requoted).toBe(true);

    const after = await metalsBid();
    const afterPrice = decimalToBigint(after.priceAmount);
    expect(after.orderId).not.toBe(before.orderId);
    expect(afterPrice).toBeLessThan(beforePrice);
    expect(quoteSeqOf(after.signedTerms)).toBe(beforeSeq + 1);
    expect(await metalsStock()).toBe(3_100);
    expect((await funding.read('kestrel')).npc.inventory.spent).toBeGreaterThan(0n);
    const judged = judgeOffer(guildOfferId(before.orderId, beforeSeq), await offers(), true);
    expect(judged).toEqual({ ok: false, code: 'offer_expired' });
    expect(before.state).toBe('OPEN');
    expect((await db.prisma.marketOrder.findUnique({ where: { orderId: before.orderId } }))?.state).toBe('CANCELLED');
  });

  it('corner: a fill of 0 does not re-quote', async () => {
    const before = await metalsBid();
    const price = decimalToBigint(before.priceAmount);
    const stock = await metalsStock();
    const count = await db.prisma.marketOrder.count();
    expect(await maker.onGuildFill(noticeOf(before, 0))).toEqual({ requoted: false, reason: 'zero' });
    const after = await metalsBid();
    expect(after.orderId).toBe(before.orderId);
    expect(decimalToBigint(after.priceAmount)).toBe(price);
    expect(await metalsStock()).toBe(stock);
    expect(await db.prisma.marketOrder.count()).toBe(count);
  });

  it('negative: W15 off leaves the live bid where it is', async () => {
    const before = await metalsBid();
    const price = decimalToBigint(before.priceAmount);
    expect(await quiet.onGuildFill(noticeOf(before, 600))).toBeNull();
    const after = await metalsBid();
    expect(after.orderId).toBe(before.orderId);
    expect(decimalToBigint(after.priceAmount)).toBe(price);
    expect(await metalsStock()).toBe(3_100);
  });
});

function dock(departAt: number) {
  return { shipId: 'kestrel', planetId: PLANET, npcId: 'kestrel', name: 'Kestrel', departAt, offers: [] as [] };
}

function stub(amount: number): GuildFillNotice {
  return {
    npcId: 'kestrel', planetId: PLANET, base: 'metals.t1', quote: 'minerals.t1', side: 'buy', amount,
    orderId: 'mo_missing', reserve: 0n, orderAmount: 100n, departAt: DEPART, quoteSeq: 0,
  };
}

type BidRow = NonNullable<Awaited<ReturnType<TestDatabase['prisma']['marketOrder']['findFirst']>>>;

function noticeOf(row: BidRow, amount: number): GuildFillNotice {
  const parsed = departOf(row.ref);
  return {
    npcId: 'kestrel', planetId: PLANET, base: row.base, quote: row.quote, side: 'buy', amount,
    orderId: row.orderId, reserve: 0n, orderAmount: decimalToBigint(row.amount),
    departAt: parsed?.departAt ?? DEPART, quoteSeq: quoteSeqOf(row.signedTerms),
  };
}

function metalsBid(): Promise<BidRow> {
  return db.prisma.marketOrder.findFirstOrThrow({
    where: { planetId: PLANET, colonyId: 'kestrel', base: 'metals.t1', quote: 'minerals.t1', side: 'buy', state: { in: ['OPEN', 'PARTIAL'] } },
  });
}

async function metalsStock(): Promise<number> {
  const row = await db.prisma.guildNpc.findUniqueOrThrow({ where: { id: 'kestrel' } });
  return stockOf(row.inventoryCache as unknown as InventoryCache, 'metals.t1');
}

async function offers(): Promise<OfferQuote[]> {
  const rows = await db.prisma.marketOrder.findMany({
    where: { planetId: PLANET, colonyId: 'kestrel', state: { in: ['OPEN', 'PARTIAL'] } },
  });
  return rows.map((row) => ({
    orderId: row.orderId,
    shipId: 'kestrel',
    npcId: row.colonyId,
    npcAccountId: row.accountId,
    base: row.base as OfferQuote['base'],
    quote: row.quote as OfferQuote['quote'],
    side: row.side === 'buy' ? 'buy' : 'sell',
    amount: decimalToBigint(row.amount),
    filled: decimalToBigint(row.filled),
    priceAmount: decimalToBigint(row.priceAmount),
    quoteSeq: quoteSeqOf(row.signedTerms),
  }));
}

function board(planetId: string): TradeOverviewResponse {
  return {
    planetId,
    overview: tier1BarterPairs().map((pair) => ({
      pair: pairId(pair.base, pair.quote), bestBid: null, bestAsk: null, last: { num: '2', den: 1 }, volume24h: 100,
    })),
  };
}

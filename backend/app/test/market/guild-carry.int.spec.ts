import 'reflect-metadata';
import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import type { ModuleRef } from '@nestjs/core';
import { pairId, type TradeOverviewResponse } from '@terra/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EventBus } from '../../src/bus/event-bus.js';
import type { AppEnv } from '../../src/core/tokens.js';
import type { FlagsService } from '../../src/flags/flags.service.js';
import { GuildFundingRepository } from '../../src/market/guild/funding/funding.repository.js';
import { GuildFundingService } from '../../src/market/guild/funding/guild-funding.service.js';
import { GuildNpcRepository } from '../../src/market/guild/guild-npc.repository.js';
import { GuildProvisionService } from '../../src/market/guild/guild-provision.service.js';
import { GuildTradeKeyBinder } from '../../src/market/guild/guild-trade-key.binder.js';
import { GuildWalletBinder } from '../../src/market/guild/guild-wallet.binder.js';
import { stockOf } from '../../src/market/guild/inventory.js';
import { GuildMakerService } from '../../src/market/guild/maker/guild-maker.service.js';
import { GuildOrderBook } from '../../src/market/guild/maker/order-book.js';
import { tier1BarterPairs } from '../../src/market/guild/maker/pairs.js';
import { OrderRelease } from '../../src/market/orders/cancel-order.service.js';
import { MarketBooks } from '../../src/market/book/market-books.js';
import { MarketOrderRepository } from '../../src/market/book/market-order.repository.js';
import { MarketSimGateway } from '../../src/market/orders/market-sim-gateway.js';
import { TradeKeyRepository } from '../../src/market/trade/trade-key.repository.js';
import { MockAgentWalletAdapter } from '../../src/near/infrastructure/adapters/mock/agent-wallet.adapter.js';

const A = 'pl_guild_a';
const B = 'pl_guild_b';
const START = 80;
const SOLD = 30;
const LEFT = START - SOLD;
const on = { has: (wave: string) => wave === 'W15' || wave === 'W13', flags: { has: (wave: string) => wave === 'W15' || wave === 'W13' } } as unknown as FlagsService;
const off = { has: () => false, flags: { has: () => false } } as unknown as FlagsService;

let db: TestDatabase;
let npcs: GuildNpcRepository;
let maker: GuildMakerService;
let quiet: GuildMakerService;

beforeAll(async () => {
  db = await createTestDatabase();
  const env = { NODE_ENV: 'test', DATABASE_URL: db.url } as AppEnv;
  const wallet = new MockAgentWalletAdapter(db.prisma, { latencyMinMs: 0, latencyMaxMs: 0, failRate: 0, seed: 15 }, { sleep: async () => undefined });
  npcs = new GuildNpcRepository(db.prisma);
  const keys = new TradeKeyRepository(db.prisma);
  const provision = new GuildProvisionService(on, npcs, new GuildWalletBinder(wallet), new GuildTradeKeyBinder(db.prisma, keys), env);
  await provision.provision();
  await provision.allocateFixtureCargo('kestrel', 'metals.t1', START);
  // Seeded 5000 bp rejects a thin ask this far below target. This test checks size, so the band is opened.
  await db.prisma.tradeApiAllowance.updateMany({ data: { priceBandBp: 10_000 } });
  const funding = new GuildFundingService(new GuildFundingRepository(db.prisma), on, env);
  const bus = new EventBus();
  const repo = new MarketOrderRepository(db.prisma);
  const release = new OrderRelease(repo, new MarketBooks(repo, env), new MarketSimGateway(bus), db.prisma);
  const book = new GuildOrderBook(db.prisma, repo, release);
  const discovery = { overview: (planetId: string) => Promise.resolve(board(planetId)) };
  const unused = { get() { throw new Error('unused'); } } as unknown as ModuleRef;
  maker = new GuildMakerService(on, funding, npcs, keys, unused, bus, env, db.prisma, book, discovery);
  quiet = new GuildMakerService(off, funding, npcs, keys, unused, new EventBus(), env, db.prisma, book, discovery);
});

afterAll(async () => {
  await db?.drop();
});

describe('guild cargo carry on Postgres (W15-10)', () => {
  it('negative: W15 off does not write the cache', async () => {
    const before = await stored();
    expect(await quiet.recordFill('kestrel', { resource: 'metals.t1', side: 'sell', amount: 1, planetId: A })).toBeNull();
    expect(await stored()).toEqual(before);
  });

  it('one fill, depart, next dock: the ask equals the cache on B and on the loop back to A', async () => {
    expect(await metals()).toBe(START);
    const first = await maker.onArrived(dock(A, 1_700_000_720_000));
    expect(first.skipped).not.toContain('price_out_of_band');
    expect(await askOf(A)).toBe(String(START));

    const filled = await maker.recordFill('kestrel', { resource: 'metals.t1', side: 'sell', amount: SOLD, planetId: A });
    expect(filled).toMatchObject({ ok: true, planetId: A, stock: LEFT });
    const carried = await stored();
    expect(JSON.stringify(carried)).not.toContain(A);

    await maker.onDeparted({ shipId: 'kestrel', planetId: A, npcId: 'kestrel' });
    expect(await stored()).toEqual(carried);
    expect(await metals()).toBe(LEFT);

    await maker.onArrived(dock(B, 1_700_002_520_000));
    expect(await askOf(B)).toBe(String(LEFT));
    expect(await metals()).toBe(LEFT);

    await maker.onDeparted({ shipId: 'kestrel', planetId: B, npcId: 'kestrel' });
    await maker.onArrived(dock(A, 1_700_004_320_000));
    expect(await askOf(A)).toBe(String(LEFT));
    expect(await metals()).toBe(LEFT);
    expect(await db.prisma.guildNpc.count()).toBe(2);
  });
});

function dock(planetId: string, departAt: number) {
  return { shipId: 'kestrel', planetId, npcId: 'kestrel', name: 'Kestrel', departAt, offers: [] as [] };
}

function board(planetId: string): TradeOverviewResponse {
  return {
    planetId,
    overview: tier1BarterPairs().map((pair) => ({
      pair: pairId(pair.base, pair.quote), bestBid: null, bestAsk: null, last: { num: '2', den: 1 }, volume24h: 100,
    })),
  };
}

async function metals(): Promise<number> {
  const row = await npcs.find('kestrel');
  return stockOf(row!.inventory, 'metals.t1');
}

function stored() {
  return db.prisma.guildNpc.findUnique({ where: { id: 'kestrel' }, select: { inventoryCache: true } }).then((row) => row?.inventoryCache);
}

async function askOf(planetId: string): Promise<string | null> {
  const row = await db.prisma.marketOrder.findFirst({
    where: { planetId, colonyId: 'kestrel', base: 'metals.t1', side: 'sell', state: { in: ['OPEN', 'PARTIAL'] } },
  });
  return row ? row.amount.toFixed(0) : null;
}

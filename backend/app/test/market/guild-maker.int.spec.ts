import 'reflect-metadata';
import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import type { ModuleRef } from '@nestjs/core';
import { pairId, type TradeOverviewResponse } from '@terra/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EventBus } from '../../src/bus/event-bus.js';
import type { AppEnv } from '../../src/core/tokens.js';
import type { FlagsService } from '../../src/flags/flags.service.js';
import { MarketBooks } from '../../src/market/book/market-books.js';
import { MarketOrderRepository } from '../../src/market/book/market-order.repository.js';
import { GuildFundingRepository } from '../../src/market/guild/funding/funding.repository.js';
import { GuildFundingService } from '../../src/market/guild/funding/guild-funding.service.js';
import { GuildNpcRepository } from '../../src/market/guild/guild-npc.repository.js';
import { GuildProvisionService } from '../../src/market/guild/guild-provision.service.js';
import { GuildTradeKeyBinder } from '../../src/market/guild/guild-trade-key.binder.js';
import { GuildWalletBinder } from '../../src/market/guild/guild-wallet.binder.js';
import { GuildMakerService } from '../../src/market/guild/maker/guild-maker.service.js';
import { GuildOrderBook } from '../../src/market/guild/maker/order-book.js';
import { barterPairIds, TIER1_RESOURCES, tier1BarterPairs } from '../../src/market/guild/maker/pairs.js';
import { OrderRelease } from '../../src/market/orders/cancel-order.service.js';
import { MarketSimGateway } from '../../src/market/orders/market-sim-gateway.js';
import { TradeKeyRepository } from '../../src/market/trade/trade-key.repository.js';
import { MockAgentWalletAdapter } from '../../src/near/infrastructure/adapters/mock/agent-wallet.adapter.js';

const PLANET = 'pl_guild_maker';
const DEPART = 1_700_000_720_000;
const on = { has: (wave: string) => wave === 'W15' || wave === 'W13', flags: { has: (wave: string) => wave === 'W15' || wave === 'W13' } } as unknown as FlagsService;
const off = { has: () => false, flags: { has: () => false } } as unknown as FlagsService;

let db: TestDatabase;
let env: AppEnv;
let maker: GuildMakerService;
let quiet: GuildMakerService;
let funding: GuildFundingService;
let calls = 0;

beforeAll(async () => {
  db = await createTestDatabase();
  env = { NODE_ENV: 'test', DATABASE_URL: db.url } as AppEnv;
  const wallet = new MockAgentWalletAdapter(db.prisma, { latencyMinMs: 0, latencyMaxMs: 0, failRate: 0, seed: 15 }, { sleep: async () => undefined });
  const npcs = new GuildNpcRepository(db.prisma);
  const keys = new TradeKeyRepository(db.prisma);
  const provision = new GuildProvisionService(on, npcs, new GuildWalletBinder(wallet), new GuildTradeKeyBinder(db.prisma, keys), env);
  await provision.provision();
  for (const resource of TIER1_RESOURCES) await provision.allocateFixtureCargo('kestrel', resource, 2500);
  funding = new GuildFundingService(new GuildFundingRepository(db.prisma), on, env);
  const bus = new EventBus();
  const repo = new MarketOrderRepository(db.prisma);
  const release = new OrderRelease(repo, new MarketBooks(repo, env), new MarketSimGateway(bus), db.prisma);
  const book = new GuildOrderBook(db.prisma, repo, release);
  const discovery = { overview: (planetId: string) => { calls += 1; return Promise.resolve(board(planetId)); } };
  const unused = { get() { throw new Error('unused'); } } as unknown as ModuleRef;
  maker = new GuildMakerService(on, funding, npcs, keys, unused, bus, env, db.prisma, book, discovery);
  quiet = new GuildMakerService(off, funding, npcs, keys, unused, new EventBus(), env, db.prisma, book, discovery);
});

afterAll(async () => {
  await db?.drop();
});

describe('guild maker on Postgres (W15-08)', () => {
  it('negative: W15 off places nothing', async () => {
    const before = await db.prisma.marketOrder.count();
    const seen = calls;
    expect(await quiet.onArrived(dock(DEPART))).toEqual({ placed: [], skipped: ['wave_disabled'] });
    expect(await db.prisma.marketOrder.count()).toBe(before);
    expect(calls).toBe(seen);
  });

  it('positive: a dock rests npc bids and asks; a second dock does not add another resting set', async () => {
    const first = await maker.onArrived(dock(DEPART));
    expect(calls).toBe(1);
    const open = await resting();
    expect(open.map((row) => row.orderId).sort()).toEqual([...first.placed].sort());
    expect(open.every((row) => row.actorKind === 'npc')).toBe(true);
    expect(open.every((row) => terms(row.signedTerms).source === 'bot' && terms(row.signedTerms).actorKind === 'npc')).toBe(true);
    expect(sides(open)).toEqual(barterPairIds().map((pair) => [pair, ['buy', 'sell']]));
    const held = (await funding.read('kestrel')).npc.inventory.reserved;
    expect(held).toBeGreaterThan(0n);

    const second = await maker.onArrived(dock(DEPART));
    expect(second.placed).toEqual([]);
    expect(second.skipped).toContain('duplicate');
    expect(calls).toBe(2);
    expect((await resting()).map((row) => row.orderId).sort()).toEqual([...first.placed].sort());
    expect((await funding.read('kestrel')).npc.inventory.reserved).toBe(held);
  });

  it('depart cancels those orders, and the next dock rests one new set', async () => {
    const ids = (await resting()).map((row) => row.orderId);
    expect(ids.length).toBeGreaterThan(0);
    expect(await maker.onDeparted({ shipId: 'kestrel', planetId: PLANET, npcId: 'kestrel' })).toEqual(ids);
    const cancelled = await db.prisma.marketOrder.findMany({ where: { orderId: { in: ids } } });
    expect(cancelled.every((row) => row.state === 'CANCELLED')).toBe(true);
    expect((await funding.read('kestrel')).npc.inventory.reserved).toBe(0n);

    const next = await maker.onArrived(dock(DEPART + 60_000));
    const open = await resting();
    expect(open.map((row) => row.orderId).sort()).toEqual([...next.placed].sort());
    expect(open).toHaveLength(ids.length);
    expect(open.every((row) => !ids.includes(row.orderId))).toBe(true);
    expect(sides(open)).toEqual(barterPairIds().map((pair) => [pair, ['buy', 'sell']]));
  });
});

function dock(departAt: number) {
  return { shipId: 'kestrel', planetId: PLANET, npcId: 'kestrel', name: 'Kestrel', departAt, offers: [] as [] };
}

function board(planetId: string): TradeOverviewResponse {
  return {
    planetId,
    overview: tier1BarterPairs().map((pair) => ({
      pair: pairId(pair.base, pair.quote),
      bestBid: null,
      bestAsk: null,
      last: { num: '2', den: 1 },
      volume24h: 100,
    })),
  };
}

function resting() {
  return db.prisma.marketOrder.findMany({ where: { planetId: PLANET, colonyId: 'kestrel', state: { in: ['OPEN', 'PARTIAL'] } } });
}

function sides(rows: readonly { pair: string; side: string }[]): Array<[string, string[]]> {
  return barterPairIds().map((pair) => [pair, rows.filter((row) => row.pair === pair).map((row) => row.side).sort()]);
}

function terms(value: unknown): { source?: string; actorKind?: string } {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as { source?: string; actorKind?: string } : {};
}

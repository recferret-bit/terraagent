import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import type { ModuleRef } from '@nestjs/core';
import { pairId, parseWaves, type TradeOverviewResponse } from '@terra/contracts';
import {
  compileData, guildColonyInput, guildPolicy, marketConfigFromData, quoteColony, quoteGuild, ratio, readMinNotionalAtomic,
  type GuildQuoteFixture,
} from '@terra/sim';
import type { Fill } from '@terra/sim/systems/trade/market-matcher';
import type { AppEnv } from '../../src/core/tokens.js';
import { EventBus } from '../../src/bus/event-bus.js';
import type { FlagsService } from '../../src/flags/flags.service.js';
import type { MarketOrderRecord } from '../../src/market/book/market-order.record.js';
import type { GuildFundingService } from '../../src/market/guild/funding/guild-funding.service.js';
import type { GuildNpcRepository } from '../../src/market/guild/guild-npc.repository.js';
import type { InventoryCache } from '../../src/market/guild/guild-plan.js';
import { stockOf } from '../../src/market/guild/inventory.js';
import { GuildMakerService, type GuildBookDiscovery } from '../../src/market/guild/maker/guild-maker.service.js';
import type { GuildOrderPort, RestingGuildOrder } from '../../src/market/guild/maker/order-book.js';
import { barterPairIds, tier1BarterPairs, TIER1_RESOURCES } from '../../src/market/guild/maker/pairs.js';
import type { GuildOrderIntent } from '../../src/market/guild/maker/plan.js';
import { noticeFromFill, type GuildFillNotice } from '../../src/market/guild/maker/requote.js';
import { judgeOffer } from '../../src/market/guild/offers/curate.js';
import { guildOfferId } from '../../src/market/guild/offers/offer-id.js';
import type { KeyRecord, TradeKeyRepository } from '../../src/market/trade/trade-key.repository.js';

const PLANET = 'pl_requote';
const DEPART = 1_700_000_720_000;
const on = { has: (wave: string) => wave === 'W15' || wave === 'W13', flags: parseWaves('..15') } as unknown as FlagsService;
const off = { has: () => false, flags: parseWaves('..14') } as unknown as FlagsService;
const env = { NODE_ENV: 'test', DATABASE_URL: 'postgres://requote' } as AppEnv;
const data = compileData(parseWaves('..15'));

describe('guild re-quote after a fill (W15-07)', () => {
  it('positive: inventory +600 lowers the next metals bid through quoteGuild', async () => {
    const harness = loop();
    await harness.maker.onArrived(arrived());
    const before = bid(harness.orders);
    const priced = quoteGuild(data, barter(3100n)).bid!;
    const libraryAt = quoteColony(guildColonyInput(guildPolicy(data), barter(2500n)), guildPolicy(data).params).bid!;
    const libraryUp = quoteColony(guildColonyInput(guildPolicy(data), barter(3100n)), guildPolicy(data).params).bid!;
    expect(libraryUp.priceAmount).toBeLessThan(libraryAt.priceAmount);
    expect(priced.priceAmount).toBeLessThan(quoteGuild(data, barter(2500n)).bid!.priceAmount);

    const started = performance.now();
    const report = await harness.maker.onGuildFill(notice(before, 600));
    expect(performance.now() - started).toBeLessThan(1_000);
    expect(report).toMatchObject({ requoted: true, quoteSeq: before.quoteSeq + 1, previousOrderId: before.orderId });
    expect(report!.bid).toBe(priced.priceAmount);
    expect(report!.bid!).toBeLessThan(before.notional);

    const next = bid(harness.orders);
    expect(next.orderId).not.toBe(before.orderId);
    expect(next.quoteSeq).toBe(before.quoteSeq + 1);
    expect(next.notional).toBeLessThan(before.notional);
    expect(next.amount).toBe(before.amount);
    expect(stockOf(harness.npc.inventory, 'metals.t1')).toBe(3_100);
    expect(harness.funding.consumed[0]).toBeGreaterThan(0n);
    const open = harness.orders.rows.filter((row) => row.base === 'metals.t1' && row.side === 'buy');
    expect(judgeOffer(guildOfferId(before.orderId, before.quoteSeq), open.map(offerOf), true)).toEqual({ ok: false, code: 'offer_expired' });
  });
});

describe('guild re-quote ordering and refusals (W15-07)', () => {
  it('positive: a second fill reads the inventory the first fill wrote', async () => {
    const harness = loop();
    await harness.maker.onArrived(arrived());
    const first = bid(harness.orders);
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let finds = 0;
    const read = harness.npc.find;
    harness.npc.find = async () => {
      finds += 1;
      if (finds === 1) await gate;
      return read();
    };
    const seen = harness.npc.seen;
    seen.length = 0;
    const a = harness.maker.onGuildFill(notice(first, 600));
    const b = harness.maker.onGuildFill(notice(first, 600));
    for (let i = 0; i < 20 && finds < 1; i++) await Promise.resolve();
    expect(finds).toBe(1);
    release();
    const [left, right] = await Promise.all([a, b]);
    expect(left?.requoted).toBe(true);
    expect(right?.requoted).toBe(true);
    expect(seen.filter((n) => n === 2_500)).toHaveLength(1);
    expect(stockOf(harness.npc.inventory, 'metals.t1')).toBe(2_500 + 1_200);
    expect(right!.bid!).toBeLessThan(left!.bid!);
  });

  it('corner: a fill of 0 does not re-quote', async () => {
    const harness = loop();
    await harness.maker.onArrived(arrived());
    const before = bid(harness.orders);
    const ids = harness.orders.rows.map((row) => row.orderId);
    expect(await harness.maker.onGuildFill(notice(before, 0))).toEqual({ requoted: false, reason: 'zero' });
    expect(harness.orders.rows.map((row) => row.orderId)).toEqual(ids);
    expect(bid(harness.orders).notional).toBe(before.notional);
    expect(stockOf(harness.npc.inventory, 'metals.t1')).toBe(2_500);
    expect(harness.funding.consumed).toEqual([]);
  });

  it('corner: loss at the ceiling updates cargo and does not rest a new bid', async () => {
    const harness = loop();
    await harness.maker.onArrived(arrived());
    const before = bid(harness.orders);
    harness.npc.lossAtomic = guildPolicy(data).dailyLossAtomic;
    const report = await harness.maker.onGuildFill(notice(before, 600));
    expect(report).toMatchObject({ requoted: false, reason: 'loss' });
    expect(harness.orders.rows.some((row) => row.base === 'metals.t1' && row.side === 'buy')).toBe(false);
    expect(stockOf(harness.npc.inventory, 'metals.t1')).toBe(3_100);
  });

  it('negative: W15 off does not re-quote', async () => {
    const harness = loop();
    await harness.maker.onArrived(arrived());
    const before = bid(harness.orders);
    const quiet = makerOf(harness, off);
    expect(await quiet.onGuildFill(notice(before, 600))).toBeNull();
    expect(bid(harness.orders).orderId).toBe(before.orderId);
    expect(bid(harness.orders).notional).toBe(before.notional);
    expect(stockOf(harness.npc.inventory, 'metals.t1')).toBe(2_500);
  });

  it('the matcher notice is the npc leg, and a player fill is ignored', () => {
    const order = {
      orderId: 'mo_bid', actorKind: 'npc', side: 'buy' as const, colonyId: 'kestrel', planetId: PLANET,
      base: 'metals.t1', quote: 'minerals.t1', amount: 100n, ref: `gqm:kestrel:${PLANET}:metals.t1:buy:${DEPART}`,
    } as MarketOrderRecord;
    const fill = { makerOrderId: 'mo_bid', takerOrderId: 'mo_player', qty: 600n } as Fill;
    expect(noticeFromFill(fill, [order, null])).toMatchObject({ npcId: 'kestrel', side: 'buy', amount: 600, departAt: DEPART, quoteSeq: 0 });
    expect(noticeFromFill(fill, [{ ...order, actorKind: 'player' }, null])).toBeNull();
    expect(noticeFromFill({ ...fill, qty: 0n }, [order, null])).toBeNull();
  });
});

function bid(orders: MemoryOrders): RestingGuildOrder {
  const row = orders.rows.find((item) => item.base === 'metals.t1' && item.quote === 'minerals.t1' && item.side === 'buy');
  if (!row) throw new Error('no metals bid');
  return row;
}

function notice(row: RestingGuildOrder, amount: number): GuildFillNotice {
  return {
    npcId: 'kestrel', planetId: PLANET, base: row.base, quote: row.quote, side: row.side, amount,
    orderId: row.orderId, reserve: row.reserve, orderAmount: row.amount, departAt: row.departAt, quoteSeq: row.quoteSeq,
  };
}

function offerOf(row: RestingGuildOrder) {
  return {
    orderId: row.orderId, shipId: 'kestrel', npcId: row.colonyId, npcAccountId: 'guild-1.npc.terraagent.mock',
    base: 'metals.t1' as const, quote: 'minerals.t1' as const, side: row.side, amount: row.amount, filled: 0n,
    priceAmount: row.notional, quoteSeq: row.quoteSeq,
  };
}

function barter(inventory: bigint): GuildQuoteFixture {
  const cfg = marketConfigFromData(data);
  const price = ratio(2n);
  return {
    npcId: 'kestrel', resource: 'metals.t1', quote: 'minerals.t1', inventory, freeUnits: inventory, cash: 2500n,
    referencePrice: price, referenceAgeS: 0, eligibleVolume: 100, platformFeeBp: cfg.platformFeeBp, maxStallFeeBp: cfg.stallFeeMaxBp,
    transportPerUnit: ratio(0n), ownUnitCost: price,
    walkAway: { localUnitCost: price, localMinutesPerUnit: null, minuteValue: null, needValue: null },
    lotUnits: cfg.baseLotUnits, minNotionalAtomic: readMinNotionalAtomic(data, 'minerals.t1'),
  };
}

function arrived() {
  return { shipId: 'kestrel', planetId: PLANET, npcId: 'kestrel', name: 'Kestrel', departAt: DEPART, offers: [] };
}

class MemoryNpc {
  inventory: InventoryCache = {
    label: 'fixture', organic: false,
    lines: TIER1_RESOURCES.map((resource) => ({ resource, amount: 2500, label: 'fixture' as const, organic: false as const, source: 'mock-grant' as const })),
  };
  lossAtomic = '0';
  seen: number[] = [];

  find = async (): Promise<{ actorKind: 'npc'; npcId: string; accountId: string; tradeKeyId: string; inventory: InventoryCache; lossAtomic: string }> => {
    this.seen.push(stockOf(this.inventory, 'metals.t1'));
    return {
      actorKind: 'npc', npcId: 'kestrel', accountId: 'guild-1.npc.terraagent.mock', tradeKeyId: 'key_kestrel',
      inventory: this.inventory, lossAtomic: this.lossAtomic,
    };
  };

  withLock = async <T>(_id: string, fn: (db: unknown) => Promise<T>): Promise<T> => fn({});

  saveInventory = async (_id: string, inventory: InventoryCache): Promise<void> => {
    this.inventory = inventory;
  };
}

class MemoryOrders implements GuildOrderPort {
  readonly rows: RestingGuildOrder[] = [];
  private n = 0;

  resting(npcId: string, planetId?: string): Promise<RestingGuildOrder[]> {
    return Promise.resolve(this.rows.filter((row) => row.colonyId === npcId && (!planetId || row.planetId === planetId)));
  }

  place(intent: GuildOrderIntent): Promise<{ orderId: string; created: boolean }> {
    const orderId = `mo_${this.n}`;
    this.n += 1;
    this.rows.push({
      orderId, planetId: intent.planetId, colonyId: intent.npcId, base: intent.base, quote: intent.quote, side: intent.side,
      actorKind: 'npc', bucket: intent.bucket, reserve: intent.reserve, notional: intent.priceAmount, amount: intent.amount,
      ref: intent.ref, departAt: intent.departAt, quoteSeq: intent.quoteSeq,
    });
    return Promise.resolve({ orderId, created: true });
  }

  cancel(order: RestingGuildOrder): Promise<void> {
    const i = this.rows.findIndex((row) => row.orderId === order.orderId);
    if (i >= 0) this.rows.splice(i, 1);
    return Promise.resolve();
  }
}

class CapFunding {
  left = 10n ** 12n;
  consumed: bigint[] = [];

  allowQuote(): Promise<{ ok: true }> {
    return Promise.resolve({ ok: true });
  }

  reserve(_npc: string, _bucket: string, amount: bigint): Promise<{ ok: true } | { ok: false; reason: 'funding_cap' }> {
    if (amount > this.left) return Promise.resolve({ ok: false, reason: 'funding_cap' });
    this.left -= amount;
    return Promise.resolve({ ok: true });
  }

  release(_npc: string, _bucket: string, amount: bigint): Promise<void> {
    this.left += amount;
    return Promise.resolve();
  }

  consume(_npc: string, _bucket: string, amount: bigint): Promise<void> {
    this.consumed.push(amount);
    return Promise.resolve();
  }
}

function loop(wave: FlagsService = on): { maker: GuildMakerService; orders: MemoryOrders; funding: CapFunding; npc: MemoryNpc } {
  const orders = new MemoryOrders();
  const funding = new CapFunding();
  const npc = new MemoryNpc();
  const discovery: GuildBookDiscovery = { overview: (planetId) => Promise.resolve(board(planetId)) };
  const maker = makerOf({ orders, funding, npc }, wave, discovery);
  return { maker, orders, funding, npc };
}

function makerOf(
  harness: { orders: MemoryOrders; funding: CapFunding; npc: MemoryNpc },
  wave: FlagsService,
  discovery: GuildBookDiscovery = { overview: (planetId) => Promise.resolve(board(planetId)) },
): GuildMakerService {
  return new GuildMakerService(
    wave,
    harness.funding as unknown as GuildFundingService,
    harness.npc as unknown as GuildNpcRepository,
    { find: async () => key() } as unknown as TradeKeyRepository,
    { get() { throw new Error('unused'); } } as unknown as ModuleRef,
    new EventBus(),
    env,
    undefined,
    harness.orders,
    discovery,
  );
}

function board(planetId: string): TradeOverviewResponse {
  return {
    planetId,
    overview: tier1BarterPairs().map((pair) => ({
      pair: pairId(pair.base, pair.quote), bestBid: null, bestAsk: null, last: { num: '2', den: 1 }, volume24h: 100,
    })),
  };
}

function key(): KeyRecord {
  return {
    keyId: 'key_kestrel', secretHash: 'h', ownerId: 'guild:kestrel', label: 'guild-npc', planetId: 'loop-local',
    colonyId: 'kestrel', colonyIndex: 1, accountId: 'guild-1.npc.terraagent.mock', scopes: ['read', 'trade'],
    ratePerSecond: null, rateBurst: null, createdAt: new Date(0), lastUsedAt: null, revokedAt: null,
    allowance: {
      maxOpenOrders: 10, maxOrderNotional: '1000000000000', dailyBudget: '1000000000000',
      allowedPairs: barterPairIds(), priceBandBp: 5000, killSwitch: false,
    },
  };
}

import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import type { ModuleRef } from '@nestjs/core';
import { pairId, parseWaves, type TradeOverviewResponse } from '@terra/contracts';
import { compileData, quoteGuild, ratio, sameGuild, type GuildQuoteFixture } from '@terra/sim';
import { OrderBook } from '@terra/sim/systems/trade/market-book';
import { matchIncoming, type MatchableOrder } from '@terra/sim/systems/trade/market-matcher';
import type { AppEnv } from '../../src/core/tokens.js';
import { EventBus } from '../../src/bus/event-bus.js';
import type { FlagsService } from '../../src/flags/flags.service.js';
import type { GuildFundingService } from '../../src/market/guild/funding/guild-funding.service.js';
import type { GuildNpcRepository } from '../../src/market/guild/guild-npc.repository.js';
import type { InventoryCache } from '../../src/market/guild/guild-plan.js';
import { GuildMakerService, type GuildBookDiscovery } from '../../src/market/guild/maker/guild-maker.service.js';
import type { GuildOrderPort, RestingGuildOrder } from '../../src/market/guild/maker/order-book.js';
import { barterPairIds, tier1BarterPairs, TIER1_RESOURCES } from '../../src/market/guild/maker/pairs.js';
import { cancelIds, intentsOf, planQuotes, type GuildOrderIntent, type MakerNpc, type QuoteContext } from '../../src/market/guild/maker/plan.js';
import type { KeyRecord, TradeKeyRepository } from '../../src/market/trade/trade-key.repository.js';

const PLANET = 'pl_maker';
const DEPART = 1_700_000_720_000;
const flags = { has: (wave: string) => wave === 'W15' || wave === 'W13', flags: parseWaves('..15') } as unknown as FlagsService;
const off = { has: () => false, flags: parseWaves('..14') } as unknown as FlagsService;
const env = { NODE_ENV: 'test', DATABASE_URL: 'postgres://maker' } as AppEnv;

const fix = (over: Partial<GuildQuoteFixture> = {}): GuildQuoteFixture => ({
  resource: 'metals.t1',
  quote: 'USDC',
  inventory: 2500n,
  cash: 10n ** 12n,
  referencePrice: ratio(2n),
  referenceAgeS: 0,
  eligibleVolume: 100,
  platformFeeBp: 100,
  maxStallFeeBp: 100,
  transportPerUnit: ratio(0n),
  ownUnitCost: ratio(2n),
  walkAway: { localUnitCost: ratio(2n), localMinutesPerUnit: null, minuteValue: null, needValue: null },
  ...over,
});

describe('guild maker intents (W15-08)', () => {
  it('positive: two priced barter sides become two npc order intents from the bot source', () => {
    const data = compileData(parseWaves('..15'));
    const quotes = quoteGuild(data, fix({ quote: 'minerals.t1', cash: 2500n }));
    expect(quotes.bid).not.toBeNull();
    expect(quotes.ask).not.toBeNull();
    const intents = intentsOf(context(), quotes.bid, quotes.ask, terms());
    expect(intents).toHaveLength(2);
    expect(intents.map((row) => row.side).sort()).toEqual(['buy', 'sell']);
    expect(intents.every((row) => row.actorKind === 'npc' && row.source === 'bot' && row.tradeKeyId === 'key_kestrel')).toBe(true);
  });

  it('negative: a paused cash bid produces no buy intent and does not invent a price', () => {
    const quotes = quoteGuild(compileData(parseWaves('..15')), fix());
    expect(quotes.bid).toBeNull();
    expect(quotes.bidReasons).toEqual(['no_cash']);
    const intents = intentsOf(context(), quotes.bid, quotes.ask, terms());
    expect(intents.filter((row) => row.side === 'buy')).toEqual([]);
    expect(intents.every((row) => row.side === 'sell' && row.actorKind === 'npc')).toBe(true);
  });

  it('kill lists guild orders and leaves a player order out', () => {
    expect(cancelIds([
      { orderId: 'a', actorKind: 'npc' },
      { orderId: 'p', actorKind: 'player' },
      { orderId: 'g', actorKind: 'guild' },
    ])).toEqual(['a', 'g']);
  });

  it('guild versus guild does not match; a player still crosses a guild ask', () => {
    const book = new OrderBook<MatchableOrder>('metals.t1/minerals.t1');
    book.add(leg('ask', 'sell', 'npc', 'kestrel', 20n));
    const guildBid = leg('bid', 'buy', 'npc', 'vanguard', 30n);
    expect(sameGuild(book.get('ask')!, guildBid)).toBe(true);
    expect(matchIncoming(book, guildBid).fills).toEqual([]);
    expect(matchIncoming(book, leg('player', 'buy', 'player', 'col-player', 30n)).fills).toHaveLength(1);
  });
});

describe('guild maker loop (W15-08)', () => {
  it('positive: one overview, both sides, actor npc; a second dock does not add a resting order', async () => {
    const harness = loop();
    const first = await harness.maker.onArrived(arrived());
    expect(harness.calls).toBe(1);
    expect(first.placed.length).toBeGreaterThan(0);
    expect(harness.orders.placed.every((row) => row.actorKind === 'npc' && row.source === 'bot')).toBe(true);
    const both = new Set(harness.orders.placed.filter((row) => row.pair === barterPairIds()[0]).map((row) => row.side));
    expect([...both].sort()).toEqual(['buy', 'sell']);
    const second = await harness.maker.onArrived(arrived());
    expect(second.placed).toEqual([]);
    expect(second.skipped).toContain('duplicate');
    expect(harness.orders.rows).toHaveLength(first.placed.length);
  });

  it('negative: W15 off places nothing', async () => {
    const harness = loop(off);
    expect(await harness.maker.onArrived(arrived())).toEqual({ placed: [], skipped: ['wave_disabled'] });
    expect(harness.orders.placed).toEqual([]);
    expect(harness.calls).toBe(0);
  });

  it('corner: the exact funding remainder places one quote and the next returns funding_cap', async () => {
    const harness = loop();
    const planned = planQuotes(compileData(flags.flags), npc(), { planetId: PLANET, departAt: DEPART }, overview().overview);
    expect(planned.length).toBeGreaterThan(1);
    harness.funding.left = planned[0]!.reserve;
    const report = await harness.maker.onArrived(arrived());
    expect(report.placed).toHaveLength(1);
    expect(report.skipped).toContain('funding_cap');
    expect(harness.orders.placed).toHaveLength(1);
    expect(harness.funding.topped).toBe(false);
  });

  it('kill cancels the resting guild quotes', async () => {
    const harness = loop();
    await harness.maker.onArrived(arrived());
    expect(harness.orders.rows.length).toBeGreaterThan(0);
    const ids = harness.orders.rows.map((row) => row.orderId);
    expect(await harness.maker.onKilled('kestrel')).toEqual(ids);
    expect(harness.orders.rows).toEqual([]);
    harness.funding.killed = true;
    const again = await harness.maker.onArrived(arrived());
    expect(again.placed).toEqual([]);
    expect(again.skipped).toContain('killed');
  });
});

function context(): QuoteContext {
  return {
    npc: npc(),
    dock: { planetId: PLANET, departAt: DEPART },
    base: 'metals.t1',
    quote: 'minerals.t1',
    baseStock: 2500n,
    quoteStock: 2500n,
    reference: { num: 2n, den: 1n },
  };
}

function terms() {
  const cfg = compileData(parseWaves('..15'));
  const row = planQuotes(cfg, npc(), { planetId: PLANET, departAt: DEPART }, overview().overview)[0];
  return {
    ttlS: row?.ttlS ?? 900,
    platformFeeBp: row?.platformFeeBp ?? 100,
    stallFeeBp: row?.stallFeeBp ?? 100,
    maxStallFeeBp: row?.maxStallFeeBp ?? 100,
    policyVersion: row?.policyVersion ?? 'bootstrap-1',
    policyHash: row?.policyHash ?? 'sha256:x',
  };
}

function npc(): MakerNpc {
  return {
    npcId: 'kestrel',
    accountId: 'guild-1.npc.terraagent.mock',
    tradeKeyId: 'key_kestrel',
    inventory: cargo(),
  };
}

function cargo(): InventoryCache {
  return {
    label: 'fixture',
    organic: false,
    lines: TIER1_RESOURCES.map((resource) => ({ resource, amount: 2500, label: 'fixture' as const, organic: false as const, source: 'mock-grant' as const })),
  };
}

function overview(): TradeOverviewResponse {
  return {
    planetId: PLANET,
    overview: tier1BarterPairs().map((pair) => ({
      pair: pairId(pair.base, pair.quote),
      bestBid: null,
      bestAsk: null,
      last: { num: '2', den: 1 },
      volume24h: 100,
    })),
  };
}

function arrived() {
  return { shipId: 'kestrel', planetId: PLANET, npcId: 'kestrel', name: 'Kestrel', departAt: DEPART, offers: [] };
}

class MemoryOrders implements GuildOrderPort {
  readonly rows: RestingGuildOrder[] = [];
  readonly placed: GuildOrderIntent[] = [];

  resting(npcId: string, planetId?: string): Promise<RestingGuildOrder[]> {
    return Promise.resolve(this.rows.filter((row) => row.colonyId === npcId && (!planetId || row.planetId === planetId)));
  }

  place(intent: GuildOrderIntent): Promise<{ orderId: string; created: boolean }> {
    const orderId = `mo_${this.placed.length}`;
    this.placed.push(intent);
    this.rows.push({
      orderId,
      planetId: intent.planetId,
      colonyId: intent.npcId,
      base: intent.base,
      side: intent.side,
      actorKind: 'npc',
      bucket: intent.bucket,
      reserve: intent.reserve,
      notional: intent.priceAmount,
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
  left = 10n ** 9n;
  killed = false;
  topped = false;

  allowQuote(input: { size: bigint }): Promise<{ ok: true } | { ok: false; reason: 'funding_cap' | 'killed' }> {
    if (this.killed) return Promise.resolve({ ok: false, reason: 'killed' });
    if (input.size > this.left) return Promise.resolve({ ok: false, reason: 'funding_cap' });
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

  topUp(): never {
    this.topped = true;
    throw new Error('topUp');
  }
}

function loop(wave: FlagsService = flags): { maker: GuildMakerService; orders: MemoryOrders; funding: CapFunding; calls: number } {
  const orders = new MemoryOrders();
  const funding = new CapFunding();
  let calls = 0;
  const discovery: GuildBookDiscovery = {
    overview: (planetId) => {
      calls += 1;
      return Promise.resolve({ ...overview(), planetId });
    },
  };
  const maker = new GuildMakerService(
    wave,
    funding as unknown as GuildFundingService,
    { find: async () => ({ ...npc(), actorKind: 'npc' as const, allocationId: 'a', quoteBudgetAtomic: '1', spendAtomic: '0', lossAtomic: '0', publicKey: 'ed25519:guild-kestrel', cargoLabel: 'fixture' as const, quoteLabel: 'subsidy' as const, cashEnabled: 0 as const, policyVersion: 'guild-mock-1' }) } as unknown as GuildNpcRepository,
    { find: async () => key() } as unknown as TradeKeyRepository,
    { get() { throw new Error('unused'); } } as unknown as ModuleRef,
    new EventBus(),
    env,
    undefined,
    orders,
    discovery,
  );
  return { maker, orders, funding, get calls() { return calls; } };
}

function key(): KeyRecord {
  return {
    keyId: 'key_kestrel',
    secretHash: 'h',
    ownerId: 'guild:kestrel',
    label: 'guild-npc',
    planetId: 'loop-local',
    colonyId: 'kestrel',
    colonyIndex: 1,
    accountId: 'guild-1.npc.terraagent.mock',
    scopes: ['read', 'trade'],
    ratePerSecond: null,
    rateBurst: null,
    createdAt: new Date(0),
    lastUsedAt: null,
    revokedAt: null,
    allowance: {
      maxOpenOrders: 10,
      maxOrderNotional: '1000000000000',
      dailyBudget: '1000000000000',
      allowedPairs: barterPairIds(),
      priceBandBp: 5000,
      killSwitch: false,
    },
  };
}

function leg(id: string, side: 'buy' | 'sell', actorKind: string, colonyId: string, price: bigint): MatchableOrder {
  return {
    orderId: id,
    seq: 1n,
    side,
    colonyId,
    amount: 10n,
    filled: 0n,
    priceAmount: price,
    fillPolicy: 'partial',
    policyVersion: 'v1',
    platformFeeBp: 100,
    stallFeeBp: 0,
    maxStallFeeBp: side === 'buy' ? 100 : null,
    actorKind,
  };
}

import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import type { ModuleRef } from '@nestjs/core';
import type { AutoTradeLimit } from '@terra/contracts';
import { pairId, parseWaves, type TradeOverviewResponse } from '@terra/contracts';
import { compileData, guildPolicy, quoteGuild, ratio, type GuildQuoteFixture } from '@terra/sim';
import { EventBus } from '../../src/bus/event-bus.js';
import type { AppEnv } from '../../src/core/tokens.js';
import { FlagsService } from '../../src/flags/flags.service.js';
import type { GuildFundingService } from '../../src/market/guild/funding/guild-funding.service.js';
import type { GuildNpcRepository } from '../../src/market/guild/guild-npc.repository.js';
import type { InventoryCache } from '../../src/market/guild/guild-plan.js';
import { loadPolicy } from '../../src/market/guild/guild-plan.js';
import { GuildMakerService, type GuildBookDiscovery } from '../../src/market/guild/maker/guild-maker.service.js';
import type { GuildOrderPort, RestingGuildOrder } from '../../src/market/guild/maker/order-book.js';
import { planQuotes, type GuildOrderIntent, type MakerNpc } from '../../src/market/guild/maker/plan.js';
import { barterPairIds, tier1BarterPairs, TIER1_RESOURCES } from '../../src/market/guild/maker/pairs.js';
import { priceGuildPair, routeAfterStrategy, stockpileTargets } from '../../src/market/guild/strategy/apply.js';
import { DeterministicGuildStrategy, guildRouteToken } from '../../src/market/guild/strategy/deterministic.js';
import {
  GuildStrategyPort,
  type GuildStrategyChoice,
  type GuildStrategyClock,
  type GuildStrategyNpc,
} from '../../src/market/guild/strategy/port.js';
import { GuildVisitPublisher } from '../../src/market/guild/visit/guild-visit.publisher.js';
import type { GuildVisitRepository } from '../../src/market/guild/visit/guild-visit.repository.js';
import { GuildVisitService } from '../../src/market/guild/visit/guild-visit.service.js';
import { scheduleAt } from '../../src/market/guild/visit/schedule.js';
import { DirectorLoopService } from '../../src/market/director/director-loop.service.js';
import { DirectorColonySource, type DirectorColonyView } from '../../src/market/director/director-source.js';
import {
  DirectorMarketPort,
  type DirectorFill,
  type DirectorPlace,
} from '../../src/market/director/director-market.js';
import type { DirectorKeyRepository, DirectorKeyRow } from '../../src/near/director-key/director-key.repository.js';
import { InMemoryAgentWallet } from '../../src/near/testing/in-memory-agent-wallet.js';
import type { KeyRecord, TradeKeyRepository } from '../../src/market/trade/trade-key.repository.js';

const WAVES = parseWaves('..15');
const DATA = compileData(WAVES);
const PLANET = 'pl_strategy';
const DEPART = 1_700_000_720_000;
const PRICE = ratio(2n);
const on = { has: (wave: string) => wave === 'W15' } as unknown as FlagsService;

const SAMPLE: GuildStrategyChoice = {
  route: 'loop-local',
  stockpile: [
    { resource: 'metals.t1', target: 2499 },
    { resource: 'minerals.t1', target: 2500 },
    { resource: 'bio.water', target: 2500 },
    { resource: 'bio.biomass', target: 2500 },
  ],
  specialisation: 'balanced',
  risk: 'conservative',
};

function fixture(over: Partial<GuildQuoteFixture> = {}): GuildQuoteFixture {
  return {
    npcId: 'kestrel',
    resource: 'metals.t1',
    quote: 'minerals.t1',
    inventory: 2500n,
    cash: 2500n,
    referencePrice: PRICE,
    referenceAgeS: 0,
    eligibleVolume: 100,
    platformFeeBp: 100,
    maxStallFeeBp: 100,
    transportPerUnit: ratio(0n),
    ownUnitCost: PRICE,
    walkAway: { localUnitCost: PRICE, localMinutesPerUnit: null, minuteValue: null, needValue: null },
    ...over,
  };
}

function metalsBuy(rows: readonly { base: string; side: string; priceAmount: bigint }[]): bigint {
  const row = rows.find((item) => item.base === 'metals.t1' && item.side === 'buy');
  if (!row) throw new Error('missing metals buy');
  return row.priceAmount;
}

class CountingStrategy extends DeterministicGuildStrategy {
  calls = 0;
  async choose(npc: GuildStrategyNpc, clock: GuildStrategyClock): Promise<GuildStrategyChoice> {
    this.calls += 1;
    return super.choose(npc, clock);
  }
}

class RawStrategy extends GuildStrategyPort {
  calls = 0;
  constructor(private readonly raw: unknown) {
    super();
  }
  choose(): Promise<GuildStrategyChoice> {
    this.calls += 1;
    return Promise.resolve(this.raw as GuildStrategyChoice);
  }
}

describe('Guild visit strategy (W15-35)', () => {
  it('positive: W16 off uses the deterministic route and quoteGuild prices the pair', async () => {
    expect(WAVES.has('W16')).toBe(false);
    expect(on.has('W16')).toBe(false);
    const npc = guildPolicy(DATA).roster.find((row) => row.id === 'kestrel');
    if (!npc) throw new Error('missing kestrel');
    const strategy = new CountingStrategy();
    const choice = await strategy.choose({ id: 'kestrel' }, { nowMs: 1 });
    expect(choice.route).toBe(guildRouteToken(npc.id, npc.route));
    expect(choice.route).toBe('loop-local');
    expect(choice).not.toHaveProperty('price');
    expect(choice).not.toHaveProperty('free_price');
    expect(routeAfterStrategy(npc.route, choice)).toEqual([...npc.route]);

    const table = quoteGuild(DATA, fixture());
    const priced = priceGuildPair(DATA, fixture(), choice);
    expect(priced.rejected).toBeNull();
    expect(priced.route).toBe('loop-local');
    expect(priced.quotes).toEqual(table);
    expect(priced.quotes).toEqual(quoteGuild(DATA, { ...fixture(), stockpileTarget: 2500n }));
    const shifted = priceGuildPair(DATA, fixture(), SAMPLE);
    expect(shifted.quotes).toEqual(quoteGuild(DATA, { ...fixture(), stockpileTarget: 2499n }));
    expect(shifted.quotes).not.toEqual(table);

    const visit = await planVisit(strategy);
    expect(strategy.calls).toBe(2);
    expect(visit).toMatchObject({ shipId: 'kestrel', npcId: 'kestrel' });
    const booked = await dock(new RawStrategy(SAMPLE));
    expect(booked.calls).toBe(1);
    expect(metalsBuy(booked.orders.placed)).toBe(
      metalsBuy(planQuotes(DATA, makerNpc(), dockOf(), overview().overview, stockpileTargets(SAMPLE))),
    );
    expect(metalsBuy(booked.orders.placed)).not.toBe(
      metalsBuy(planQuotes(DATA, makerNpc(), dockOf(), overview().overview)),
    );
  });

  it('negative: a strategy with free_price is rejected and does not change the quote', async () => {
    const dirty = { ...SAMPLE, free_price: 9 };
    const nested = { ...SAMPLE, stockpile: [{ resource: 'metals.t1', target: 1, free_price: 3 }] };
    const table = quoteGuild(DATA, fixture());
    const top = priceGuildPair(DATA, fixture(), dirty);
    const inner = priceGuildPair(DATA, fixture(), nested);
    expect(top).toMatchObject({ rejected: 'free_price', route: null });
    expect(top.quotes).toEqual(table);
    expect(top.quotes).not.toEqual(quoteGuild(DATA, { ...fixture(), stockpileTarget: 2499n }));
    expect(inner.rejected).toBe('free_price');
    expect(inner.quotes).toEqual(table);
    expect(routeAfterStrategy(['loop-local'], dirty)).toEqual(['loop-local']);
    expect(stockpileTargets(dirty)).toBeUndefined();

    const booked = await dock(new RawStrategy(dirty));
    expect(booked.calls).toBe(1);
    expect(metalsBuy(booked.orders.placed)).toBe(
      metalsBuy(planQuotes(DATA, makerNpc(), dockOf(), overview().overview)),
    );
  });

  it('corner: an empty stockpile is rejected and does not change the quote', () => {
    const empty = { route: 'other-stop', stockpile: [], specialisation: 'balanced', risk: 'conservative' };
    const missing = { route: 'loop-local', specialisation: 'balanced', risk: 'conservative' };
    const table = quoteGuild(DATA, fixture());
    expect(priceGuildPair(DATA, fixture(), empty)).toMatchObject({
      rejected: 'empty_stockpile',
      route: null,
      quotes: table,
    });
    expect(priceGuildPair(DATA, fixture(), missing).rejected).toBe('empty_stockpile');
    expect(priceGuildPair(DATA, fixture(), missing).quotes).toEqual(table);
    expect(routeAfterStrategy(['loop-local'], empty)).toEqual(['loop-local']);
    expect(stockpileTargets(empty)).toBeUndefined();
    expect(stockpileTargets(missing)).toBeUndefined();
  });
});

describe('director autoTrade gate (W15-35)', () => {
  it('negative: a revoked director key skips director_key_revoked and does not place', async () => {
    const flags = new FlagsService({ TA_WAVES: '..15' } as never);
    expect(flags.has('W15')).toBe(true);
    expect(flags.has('W16')).toBe(false);
    const opened = await openKey('rev35');
    await opened.wallet.revokeKey({
      opId: `rev:${opened.publicKey}`,
      accountId: opened.accountId,
      publicKey: opened.publicKey,
    });
    const market = new MemMarket();
    const keys = new MemKeys({
      colonyId: 'co_rev',
      accountId: opened.accountId,
      publicKey: opened.publicKey,
      revokedAt: null,
    });
    const service = new DirectorLoopService(
      flags,
      opened.wallet,
      keys as unknown as DirectorKeyRepository,
      new EventBus(),
      new MemSource(directorView()),
      market,
    );
    expect(await service.runDirectorOnce('co_rev')).toEqual({ ok: false, skip: 'director_key_revoked' });
    expect(market.placed).toHaveLength(0);
    expect(await service.runDirectorOnce('co_rev')).toEqual({ ok: false, skip: 'director_key_revoked' });
    expect(market.placed).toHaveLength(0);
  });
});

function makerNpc(): MakerNpc {
  return {
    npcId: 'kestrel',
    accountId: 'guild-1.npc.terraagent.mock',
    tradeKeyId: 'key_kestrel',
    inventory: cargo(),
  };
}

function dockOf() {
  return { planetId: PLANET, departAt: DEPART };
}

function cargo(): InventoryCache {
  return {
    label: 'fixture',
    organic: false,
    lines: TIER1_RESOURCES.map((resource) => ({
      resource,
      amount: 2500,
      label: 'fixture' as const,
      organic: false as const,
      source: 'mock-grant' as const,
    })),
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

async function planVisit(strategy: GuildStrategyPort): Promise<{ shipId: string; npcId: string }> {
  const seen: { shipId: string; npcId: string }[] = [];
  const bus = new EventBus();
  bus.on('guild.arrived', (event) => seen.push({ shipId: event.payload.shipId, npcId: event.payload.npcId }), {
    module: 'test',
  });
  const policy = loadPolicy((wave) => wave === 'W15');
  const spec = {
    seed: policy.policyVersion,
    npcId: 'kestrel',
    planetId: PLANET,
    route: ['loop-local'] as const,
    dockWindowMs: policy.dockWindowS * 1000,
    visitGapMs: policy.visitGapS * 1000,
    enabled: true,
  };
  const arrive = scheduleAt(spec, 1_700_000_000_000);
  if (!arrive) throw new Error('no visit');
  const repo = {
    latestCadence: async () => null,
    openDue: async () => [],
    insertCadence: async () => ({ created: true, row: {} }),
    saveOffers: async () => undefined,
    markDeparted: async () => false,
  } as unknown as GuildVisitRepository;
  const svc = new GuildVisitService(on, repo, new GuildVisitPublisher(bus), undefined, undefined, strategy);
  await svc.advance(PLANET, arrive.arriveAt, 'kestrel');
  const push = seen[0];
  if (!push) throw new Error('visit did not arrive');
  return push;
}

async function dock(strategy: RawStrategy): Promise<{ calls: number; orders: MemoryOrders }> {
  const orders = new MemoryOrders();
  const discovery: GuildBookDiscovery = { overview: () => Promise.resolve(overview()) };
  const maker = new GuildMakerService(
    { has: (wave: string) => wave === 'W15' || wave === 'W13', flags: WAVES } as unknown as FlagsService,
    new OpenFunding() as unknown as GuildFundingService,
    { find: async () => ({ ...makerNpc(), actorKind: 'npc' as const }) } as unknown as GuildNpcRepository,
    { find: async () => makerKey() } as unknown as TradeKeyRepository,
    {
      get() {
        throw new Error('unused');
      },
    } as unknown as ModuleRef,
    new EventBus(),
    { NODE_ENV: 'test', DATABASE_URL: 'postgres://strategy' } as AppEnv,
    undefined,
    orders,
    discovery,
    undefined,
    strategy,
  );
  const report = await maker.onArrived({
    shipId: 'kestrel',
    planetId: PLANET,
    npcId: 'kestrel',
    name: 'Kestrel',
    departAt: DEPART,
    offers: [],
  });
  if (report.placed.length === 0) throw new Error(`nothing placed: ${report.skipped.join(',')}`);
  return { calls: strategy.calls, orders };
}

class MemoryOrders implements GuildOrderPort {
  readonly placed: GuildOrderIntent[] = [];
  private readonly rows: RestingGuildOrder[] = [];

  resting(): Promise<RestingGuildOrder[]> {
    return Promise.resolve(this.rows);
  }

  place(intent: GuildOrderIntent): Promise<{ orderId: string; created: boolean }> {
    const orderId = `mo_${this.placed.length}`;
    this.placed.push(intent);
    this.rows.push({
      orderId,
      planetId: intent.planetId,
      colonyId: intent.npcId,
      base: intent.base,
      quote: intent.quote,
      side: intent.side,
      actorKind: 'npc',
      bucket: intent.bucket,
      reserve: intent.reserve,
      notional: intent.priceAmount,
      amount: intent.amount,
      ref: intent.ref,
      departAt: intent.departAt,
      quoteSeq: intent.quoteSeq,
    });
    return Promise.resolve({ orderId, created: true });
  }

  cancel(): Promise<void> {
    return Promise.resolve();
  }
}

class OpenFunding {
  allowQuote(): Promise<{ ok: true }> {
    return Promise.resolve({ ok: true });
  }
  reserve(): Promise<{ ok: true }> {
    return Promise.resolve({ ok: true });
  }
  release(): Promise<void> {
    return Promise.resolve();
  }
}

function makerKey(): KeyRecord {
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
      maxOpenOrders: 20,
      maxOrderNotional: '1000000000000',
      dailyBudget: '1000000000000',
      allowedPairs: barterPairIds(),
      priceBandBp: 5000,
      killSwitch: false,
    },
  };
}

const limit: AutoTradeLimit = {
  maxPerTrade: 300,
  maxPerSession: 600,
  minStock: 200,
  partners: 'guild',
  sellAboveStoragePct: 80,
};

function directorView(): DirectorColonyView {
  return {
    colonyId: 'co_rev',
    colonyIndex: 0,
    planetId: 'pl_dir',
    playerId: 'player-1',
    away: true,
    tick: 12,
    rows: [
      {
        forecast: {
          resource: 'metals.t1',
          stock: 1400,
          storageCap: 1500,
          queued: 0,
          reserved: 0,
          serviceWindow: 0,
          reserveFloor: 200,
          reserveHorizon: 0,
          sessionSpent: 0,
          partner: 'guild',
          limit,
        },
        reference: { num: 1_000_000n, den: 1n },
        ownUnitCost: { num: 800_000n, den: 1n },
        target: 750,
      },
    ],
  };
}

class MemSource extends DirectorColonySource {
  constructor(private readonly row: DirectorColonyView) {
    super();
  }
  load(): Promise<DirectorColonyView | null> {
    return Promise.resolve(this.row);
  }
  listAway(): Promise<readonly string[]> {
    return Promise.resolve([this.row.colonyId]);
  }
}

class MemMarket extends DirectorMarketPort {
  readonly placed: DirectorPlace[] = [];
  place(order: DirectorPlace): Promise<DirectorFill> {
    this.placed.push(order);
    return Promise.resolve({ status: 'filled', tradeId: 'trade-300', counterparty: 'Guild' });
  }
}

class MemKeys {
  constructor(private readonly row: DirectorKeyRow) {}
  find(): Promise<DirectorKeyRow | null> {
    return Promise.resolve(this.row);
  }
  save(): Promise<void> {
    return Promise.resolve();
  }
}

async function openKey(tag: string) {
  const wallet = new InMemoryAgentWallet();
  const name = `${tag}${Math.random().toString(36).slice(2, 8)}`;
  const created = await wallet.createSubAccount({ opId: `acct:${name}`, parent: 'npc.terraagent.mock', name });
  const publicKey = `ed25519:${name}`;
  await wallet.addLimitedKey({
    opId: `key:${name}`,
    accountId: created.accountId,
    publicKey,
    allowance: '0',
    receiverId: 'intents.near',
    methodNames: ['execute_intents'],
    tokens: [{ token: 'metals.t1', allowance: '600' }],
  });
  return { wallet, accountId: created.accountId, publicKey };
}

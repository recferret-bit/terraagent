import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import type { ModuleRef } from '@nestjs/core';
import { pairId, parseWaves, type TradeOverviewResponse } from '@terra/contracts';
import { compileData, guildPolicy, quoteGuild, ratio } from '@terra/sim';
import type { AppEnv } from '../../src/core/tokens.js';
import { EventBus } from '../../src/bus/event-bus.js';
import type { FlagsService } from '../../src/flags/flags.service.js';
import { allowQuote } from '../../src/market/guild/funding/quote-gate.js';
import type { GuildFundingService } from '../../src/market/guild/funding/guild-funding.service.js';
import type { GuildNpcRepository } from '../../src/market/guild/guild-npc.repository.js';
import type { InventoryCache } from '../../src/market/guild/guild-plan.js';
import { applyFill, stockOf } from '../../src/market/guild/inventory.js';
import { GuildMakerService } from '../../src/market/guild/maker/guild-maker.service.js';
import { tier1BarterPairs } from '../../src/market/guild/maker/pairs.js';
import { planQuotes, type MakerNpc } from '../../src/market/guild/maker/plan.js';
import type { TradeKeyRepository } from '../../src/market/trade/trade-key.repository.js';

const A = 'pl_a';
const B = 'pl_b';
const env = { NODE_ENV: 'test', DATABASE_URL: 'postgres://carry' } as AppEnv;
const on = { has: (wave: string) => wave === 'W15' } as unknown as FlagsService;
const off = { has: () => false } as unknown as FlagsService;
const data = compileData(parseWaves('..15'));
const orderCap = guildPolicy(data).params.maxOrderUnits;

describe('guild cargo carry (W15-10)', () => {
  it('positive: buying 200 metals on A leaves the remainder, and the ask on B cannot exceed it', async () => {
    const cargo = new MemoryCargo(250);
    const maker = makerOf(cargo, on);
    const bought = await maker.recordFill('kestrel', { resource: 'metals.t1', side: 'sell', amount: 200, planetId: A });
    expect(bought).toMatchObject({ ok: true, planetId: A, stock: 50 });
    expect(cargo.saves).toBe(1);
    expect(stockOf(cargo.inventory, 'metals.t1')).toBe(50);
    expect(JSON.stringify(cargo.inventory)).not.toContain(A);
    expect(50).toBeLessThanOrEqual(orderCap);
    expect(metalsAsk(cargo.inventory, B)).toBe(50n);
  });

  it('positive: a guild buy increases the same cache the next planet asks from', async () => {
    const cargo = new MemoryCargo(40);
    const bought = await makerOf(cargo, on).recordFill('kestrel', { resource: 'metals.t1', side: 'buy', amount: 10, planetId: A });
    expect(bought).toMatchObject({ ok: true, stock: 50 });
    expect(metalsAsk(cargo.inventory, B)).toBe(50n);
  });

  it('negative: zero stock pauses the ask', async () => {
    const cargo = new MemoryCargo(50);
    const gone = await makerOf(cargo, on).recordFill('kestrel', { resource: 'metals.t1', side: 'sell', amount: 50, planetId: A });
    expect(gone).toMatchObject({ ok: true, stock: 0 });
    expect(metalsAsk(cargo.inventory, B)).toBeNull();
    const quotes = quoteGuild(data, {
      npcId: 'kestrel', resource: 'metals.t1', quote: 'minerals.t1', inventory: 0n, freeUnits: 0n, cash: 2500n,
      referencePrice: ratio(2n), referenceAgeS: 0, eligibleVolume: 100, platformFeeBp: 100, maxStallFeeBp: 100,
      transportPerUnit: ratio(0n), ownUnitCost: ratio(2n),
      walkAway: { localUnitCost: ratio(2n), localMinutesPerUnit: null, minuteValue: null, needValue: null },
    });
    expect(quotes.ask).toBeNull();
    expect(quotes.askReasons).toContain('no_surplus');
    const book = { reserved: 0n, spent: 0n, cap: 5000n };
    expect(allowQuote({ killed: false, bucket: 'inventory', size: 1n, stock: 0n, cashBid: false, book: { npc: book, global: book } })).toEqual({ ok: false, reason: 'inventory_short' });
  });

  it('negative: W15 off does not write the cache', async () => {
    const cargo = new MemoryCargo(80);
    expect(await makerOf(cargo, off).recordFill('kestrel', { resource: 'metals.t1', side: 'sell', amount: 10, planetId: A })).toBeNull();
    expect(cargo.saves).toBe(0);
    expect(stockOf(cargo.inventory, 'metals.t1')).toBe(80);
  });

  it('corner: a sell larger than stock is refused and the lines stay', async () => {
    const cargo = new MemoryCargo(0);
    cargo.inventory = {
      label: 'fixture', organic: false,
      lines: [line('metals.t1', 30), line('metals.t1', 20), line('minerals.t1', 7)],
    };
    const refused = await makerOf(cargo, on).recordFill('kestrel', { resource: 'metals.t1', side: 'sell', amount: 51, planetId: A });
    expect(refused).toMatchObject({ ok: false, reason: 'over_stock', planetId: A });
    expect(cargo.saves).toBe(0);
    expect(cargo.inventory.lines.map((row) => row.amount)).toEqual([30, 20, 7]);
    const sold = applyFill(cargo, { resource: 'metals.t1', side: 'sell', amount: 40, planetId: B });
    expect(sold).toMatchObject({ ok: true, planetId: B, stock: 10 });
    if (!sold.ok) return;
    expect(sold.inventory.lines).toEqual([line('minerals.t1', 7), line('metals.t1', 10)]);
    expect(applyFill(cargo, { resource: 'metals.t1', side: 'sell', amount: 0, planetId: A }).ok).toBe(false);
  });
});

function metalsAsk(inventory: InventoryCache, planetId: string): bigint | null {
  const ask = planQuotes(data, npc(inventory), { planetId, departAt: 1 }, board(planetId).overview)
    .find((row) => row.base === 'metals.t1' && row.side === 'sell');
  return ask ? ask.amount : null;
}

function npc(inventory: InventoryCache): MakerNpc {
  return { npcId: 'kestrel', accountId: 'guild-1.npc.terraagent.mock', tradeKeyId: 'key_kestrel', inventory };
}

function line(resource: string, amount: number): InventoryCache['lines'][number] {
  return { resource, amount, label: 'fixture', organic: false, source: 'mock-grant' };
}

function cache(amount: number): InventoryCache {
  return { label: 'fixture', organic: false, lines: amount > 0 ? [line('metals.t1', amount)] : [] };
}

class MemoryCargo {
  inventory: InventoryCache;
  saves = 0;

  constructor(amount: number) {
    this.inventory = cache(amount);
  }

  find = async (): Promise<{ actorKind: 'npc'; inventory: InventoryCache }> => ({ actorKind: 'npc', inventory: this.inventory });

  withLock = async <T>(_id: string, fn: (db: unknown) => Promise<T>): Promise<T> => fn({});

  saveInventory = async (_id: string, inventory: InventoryCache): Promise<void> => {
    this.saves += 1;
    this.inventory = inventory;
  };
}

function makerOf(cargo: MemoryCargo, wave: FlagsService): GuildMakerService {
  return new GuildMakerService(
    wave,
    {} as GuildFundingService,
    cargo as unknown as GuildNpcRepository,
    {} as TradeKeyRepository,
    { get() { throw new Error('unused'); } } as unknown as ModuleRef,
    new EventBus(),
    env,
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

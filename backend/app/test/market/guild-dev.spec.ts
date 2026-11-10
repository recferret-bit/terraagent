import 'reflect-metadata';
import type { DbClient } from '@terra/db';
import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import type { AppEnv } from '../../src/core/tokens.js';
import { DevCommandRegistry } from '../../src/dev/dev-command.registry.js';
import type { FlagsService } from '../../src/flags/flags.service.js';
import type { DevPresence } from '../../src/game/presence/dev-presence.js';
import { GuildDevCommand } from '../../src/market/guild/dev/guild-dev.command.js';
import { GuildDevService } from '../../src/market/guild/dev/guild-dev.service.js';
import { GuildKillSwitch } from '../../src/market/guild/funding/guild-kill.js';
import type { GuildFundingRepository } from '../../src/market/guild/funding/funding.repository.js';
import { GuildProvisionError } from '../../src/market/guild/guild-error.js';
import type { GuildNpcRepository } from '../../src/market/guild/guild-npc.repository.js';
import { emptyInventory, type InventoryCache } from '../../src/market/guild/guild-plan.js';
import { setAbsoluteStock, stockOf } from '../../src/market/guild/inventory.js';
import { GuildMakerService } from '../../src/market/guild/maker/guild-maker.service.js';
import type { GuildVisitPublisher } from '../../src/market/guild/visit/guild-visit.publisher.js';
import type { GuildVisitInsert, GuildVisitRepository, GuildVisitRow } from '../../src/market/guild/visit/guild-visit.repository.js';
import { GuildVisitService } from '../../src/market/guild/visit/guild-visit.service.js';
import type { DirectorKeyService } from '../../src/near/director-key/director-key.service.js';
import { TradeKeysService } from '../../src/market/trade/trade-keys.service.js';
import type { ModuleRef } from '@nestjs/core';

const PLANET = 'pl_dev';
const on = { has: (wave: string) => wave === 'W15' } as unknown as FlagsService;
const off = { has: () => false } as unknown as FlagsService;

describe('guild and director dev commands (W15-28)', () => {
  it('summon docks, the maker runs, and depart clears the row', async () => {
    const harness = world(on);
    const summoned = await harness.dev.summon(PLANET, 'kestrel');
    expect(summoned.status).toBe('docked');
    expect(harness.visits.rows.map((row) => row.status)).toEqual(['docked']);
    expect(harness.quoted).toEqual(['kestrel']);
    await harness.dev.summon(PLANET, 'kestrel');
    expect(harness.visits.rows).toHaveLength(1);
    const left = await harness.dev.depart(PLANET, 'kestrel');
    expect(left.cleared).toBe(1);
    expect(harness.visits.rows[0]?.status).toBe('departed');
    expect(harness.departed).toEqual(['kestrel']);
    expect((await harness.dev.depart(PLANET, 'kestrel')).cleared).toBe(0);
  });

  it('setInventory 600 stores 600 and does not go negative', async () => {
    const harness = world(on);
    expect((await harness.dev.setInventory('kestrel', 'metals.t1', 600)).stock).toBe(600);
    expect(stockOf(harness.npcs.rows.get('kestrel')!.inventory, 'metals.t1')).toBe(600);
    expect(stockOf(harness.npcs.rows.get('kestrel')!.inventory, 'minerals.t1')).toBe(4);
    await expect(harness.dev.setInventory('kestrel', 'metals.t1', -1)).rejects.toBeInstanceOf(GuildProvisionError);
    expect(stockOf(harness.npcs.rows.get('kestrel')!.inventory, 'metals.t1')).toBe(600);
  });

  it('disable sets killed, an unknown npc does not dock, and W15 off is wave_disabled', async () => {
    const harness = world(on);
    expect((await harness.dev.disable('vanguard')).killed).toBe(true);
    expect(harness.killed).toEqual(['vanguard']);
    await expect(harness.dev.summon(PLANET, 'osprey')).rejects.toMatchObject({ errorCode: 'unknown_npc' });
    expect(harness.visits.rows).toHaveLength(0);
    const silent = world(off, harness.visits);
    await expect(silent.dev.summon(PLANET, 'kestrel')).rejects.toMatchObject({ errorCode: 'wave_disabled' });
    expect(harness.visits.rows).toHaveLength(0);
    await expect(silent.dev.setAllowance({ colonyId: 'co', amount: 10 })).rejects.toMatchObject({ errorCode: 'wave_disabled' });
  });

  it('the registry rejects a missing body, maybe, and amount -1', async () => {
    const harness = world(on);
    const registry = new DevCommandRegistry({ NODE_ENV: 'test' } as AppEnv);
    new GuildDevCommand(registry, harness.dev).onModuleInit();
    expect((await registry.run('guild.summon', { planetId: PLANET, npc: 'kestrel' }))).toMatchObject({ status: 'docked' });
    await expect(registry.run('away.simulate', { planetId: PLANET, on: 'maybe' })).rejects.toBeInstanceOf(ZodError);
    await expect(registry.run('guild.setInventory', { npc: 'kestrel', resource: 'metals.t1', amount: -1 })).rejects.toBeInstanceOf(ZodError);
    await expect(registry.run('director.allowance', { colonyId: 'co', amount: -1 })).rejects.toBeInstanceOf(ZodError);
  });

  it('setAbsoluteStock writes 600 and refuses a negative amount', () => {
    const npc = { inventory: emptyInventory() };
    const set = setAbsoluteStock(npc, 'metals.t1', 600, PLANET);
    expect(set).toMatchObject({ ok: true, stock: 600 });
    if (!set.ok) return;
    expect(setAbsoluteStock({ inventory: set.inventory }, 'metals.t1', -1).ok).toBe(false);
    expect(stockOf(set.inventory, 'metals.t1')).toBe(600);
  });
});

class MemVisits {
  rows: GuildVisitRow[] = [];

  openDocked(npcId: string, planetId: string): Promise<GuildVisitRow[]> {
    return Promise.resolve(this.rows.filter((row) => row.npcId === npcId && row.planetId === planetId && row.status === 'docked'));
  }

  insertExtra(draft: GuildVisitInsert): Promise<GuildVisitRow> {
    const row: GuildVisitRow = { ...draft, status: 'docked' };
    this.rows.push(row);
    return Promise.resolve(row);
  }

  markDeparted(id: string): Promise<boolean> {
    const row = this.rows.find((item) => item.id === id && item.status === 'docked');
    if (!row) return Promise.resolve(false);
    this.rows[this.rows.indexOf(row)] = { ...row, status: 'departed' };
    return Promise.resolve(true);
  }

  saveOffers(): Promise<void> {
    return Promise.resolve();
  }
}

class MemNpcs {
  readonly rows = new Map<string, { tradeKeyId: string; inventory: InventoryCache }>();

  constructor() {
    this.rows.set('kestrel', { tradeKeyId: 'tk_kestrel', inventory: withLine(emptyInventory(), 'minerals.t1', 4) });
    this.rows.set('vanguard', { tradeKeyId: 'tk_vanguard', inventory: emptyInventory() });
  }

  find(id: string): Promise<unknown> {
    const row = this.rows.get(id);
    return Promise.resolve(row ? { npcId: id, actorKind: 'npc', tradeKeyId: row.tradeKeyId, inventory: row.inventory } : null);
  }

  saveInventory(id: string, inventory: InventoryCache): Promise<unknown> {
    const row = this.rows.get(id);
    if (!row) throw new Error('missing');
    row.inventory = inventory;
    return this.find(id);
  }

  withLock<T>(_id: string, fn: (db: DbClient) => Promise<T>): Promise<T> {
    return fn(this as unknown as DbClient);
  }
}

function withLine(cache: InventoryCache, resource: string, amount: number): InventoryCache {
  return { ...cache, lines: [...cache.lines, { resource, amount, label: 'fixture', organic: false, source: 'mock-grant' }] };
}

function world(flags: FlagsService, visits = new MemVisits()) {
  const npcs = new MemNpcs();
  const quoted: string[] = [];
  const departed: string[] = [];
  const killed: string[] = [];
  const maker = {
    onArrived: async (payload: { npcId: string }) => {
      quoted.push(payload.npcId);
      return { placed: ['q1'], skipped: [] };
    },
    onDeparted: async (payload: { npcId: string }) => {
      departed.push(payload.npcId);
      return [];
    },
  };
  const publisher = {
    arrived: async (input: { name: string }) => ({ t: 'guild.arrived' as const, d: { ...input, offers: [] as [] } }),
    departed: (input: { npcId: string }) => ({ t: 'guild.departed' as const, d: input }),
  };
  const funding = { markKilled: async (npcId: string) => { killed.push(npcId); } };
  const moduleRef = {
    get(token: unknown) {
      if (token === GuildMakerService) return { onKilled: async () => [] };
      if (token === TradeKeysService) return { kill: async () => ({ killSwitch: true }) };
      return null;
    },
  };
  const kill = new GuildKillSwitch(
    moduleRef as ModuleRef,
    npcs as unknown as GuildNpcRepository,
    funding as unknown as GuildFundingRepository,
    flags,
  );
  const presence = { setAway: async (input: { away: boolean }) => ({ posted: true, away: input.away, tick: 1 }) };
  const director = {
    setDevAllowance: async (colonyId: string, resource: string, amount: number) => ({
      colonyId, resource, allowance: String(amount), spent: '0', publicKey: 'ed25519:next', replaced: true as const,
    }),
  };
  const visitSvc = new GuildVisitService(
    flags,
    visits as unknown as GuildVisitRepository,
    publisher as unknown as GuildVisitPublisher,
  );
  const dev = new GuildDevService(
    flags,
    visitSvc,
    maker as unknown as GuildMakerService,
    kill,
    npcs as unknown as GuildNpcRepository,
    presence as unknown as DevPresence,
    director as unknown as DirectorKeyService,
  );
  return { dev, visits, npcs, quoted, departed, killed };
}

import 'reflect-metadata';
import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import type { ModuleRef } from '@nestjs/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EventBus } from '../../src/bus/event-bus.js';
import type { AppEnv } from '../../src/core/tokens.js';
import type { FlagsService } from '../../src/flags/flags.service.js';
import type { DevPresence } from '../../src/game/presence/dev-presence.js';
import { GuildDevService } from '../../src/market/guild/dev/guild-dev.service.js';
import { GuildFundingRepository } from '../../src/market/guild/funding/funding.repository.js';
import { GuildKillSwitch } from '../../src/market/guild/funding/guild-kill.js';
import { GuildNpcRepository } from '../../src/market/guild/guild-npc.repository.js';
import { GuildProvisionService } from '../../src/market/guild/guild-provision.service.js';
import { stockOf } from '../../src/market/guild/inventory.js';
import type { GuildMakerService } from '../../src/market/guild/maker/guild-maker.service.js';
import { GuildTradeKeyBinder } from '../../src/market/guild/guild-trade-key.binder.js';
import { GuildWalletBinder } from '../../src/market/guild/guild-wallet.binder.js';
import { GuildVisitPublisher } from '../../src/market/guild/visit/guild-visit.publisher.js';
import { GuildVisitRepository } from '../../src/market/guild/visit/guild-visit.repository.js';
import { GuildVisitService } from '../../src/market/guild/visit/guild-visit.service.js';
import { TradeKeyRepository } from '../../src/market/trade/trade-key.repository.js';
import { TradeKeysService } from '../../src/market/trade/trade-keys.service.js';
import { TradeRequestRepository } from '../../src/market/trade/trade-request.repository.js';
import type { DirectorKeyService } from '../../src/near/director-key/director-key.service.js';
import { MockAgentWalletAdapter } from '../../src/near/infrastructure/adapters/mock/agent-wallet.adapter.js';

const PLANET = 'pl_guilddev';
const on = { has: (wave: string) => wave === 'W15' } as unknown as FlagsService;
const off = { has: () => false } as unknown as FlagsService;

let db: TestDatabase;
let env: AppEnv;
let dev: GuildDevService;
let silent: GuildDevService;
let quoted: string[];
let departed: string[];

beforeAll(async () => {
  db = await createTestDatabase();
  env = { NODE_ENV: 'test', DATABASE_URL: db.url } as AppEnv;
  const wallet = new MockAgentWalletAdapter(db.prisma, { latencyMinMs: 0, latencyMaxMs: 0, failRate: 0, seed: 28 }, { sleep: async () => undefined });
  const npcs = new GuildNpcRepository(db.prisma);
  await new GuildProvisionService(
    on,
    npcs,
    new GuildWalletBinder(wallet),
    new GuildTradeKeyBinder(db.prisma, new TradeKeyRepository(db.prisma)),
    env,
  ).provision();
  quoted = [];
  departed = [];
  const maker = makerFake();
  const visits = new GuildVisitService(on, new GuildVisitRepository(db.prisma), new GuildVisitPublisher(new EventBus()), env);
  const kill = new GuildKillSwitch(moduleRef(), npcs, new GuildFundingRepository(db.prisma), on, env);
  dev = service(on, visits, maker, kill, npcs);
  silent = service(off, new GuildVisitService(off, new GuildVisitRepository(db.prisma), new GuildVisitPublisher(new EventBus()), env), maker, kill, npcs);
});

afterAll(async () => {
  await db?.drop();
});

describe('guild dev commands on Postgres (W15-28)', () => {
  it('summon docks the visit row and calls the maker; depart clears it', async () => {
    quoted.length = 0;
    departed.length = 0;
    const summoned = await dev.summon(PLANET, 'kestrel');
    expect(summoned).toMatchObject({ status: 'docked', npcId: 'kestrel' });
    expect(quoted).toEqual(['kestrel']);
    const row = await db.prisma.guildVisit.findFirstOrThrow({ where: { npcId: 'kestrel', planetId: PLANET } });
    expect(row.status).toBe('docked');
    expect((await dev.depart(PLANET, 'kestrel')).cleared).toBe(1);
    expect(departed).toEqual(['kestrel']);
    expect((await db.prisma.guildVisit.findFirstOrThrow({ where: { id: row.id } })).status).toBe('departed');
  });

  it('setInventory 600 stores 600 and disable sets killed', async () => {
    expect((await dev.setInventory('kestrel', 'metals.t1', 600)).stock).toBe(600);
    const npc = await new GuildNpcRepository(db.prisma).find('kestrel');
    expect(stockOf(npc!.inventory, 'metals.t1')).toBe(600);
    expect((await dev.disable('vanguard')).killed).toBe(true);
    expect((await db.prisma.guildFunding.findUniqueOrThrow({ where: { scope: 'vanguard' } })).killed).toBe(true);
  });

  it('an unknown npc does not dock, and W15 off rejects wave_disabled', async () => {
    const before = await db.prisma.guildVisit.count();
    await expect(dev.summon(PLANET, 'osprey')).rejects.toMatchObject({ errorCode: 'unknown_npc' });
    await expect(silent.summon(PLANET, 'kestrel')).rejects.toMatchObject({ errorCode: 'wave_disabled' });
    await expect(silent.setInventory('kestrel', 'metals.t1', 1)).rejects.toMatchObject({ errorCode: 'wave_disabled' });
    await expect(silent.disable('kestrel')).rejects.toMatchObject({ errorCode: 'wave_disabled' });
    expect(await db.prisma.guildVisit.count()).toBe(before);
  });
});

function makerFake(): GuildMakerService {
  return {
    onArrived: async (payload: { npcId: string }) => {
      quoted.push(payload.npcId);
      return { placed: ['q1'], skipped: [] };
    },
    onDeparted: async (payload: { npcId: string }) => {
      departed.push(payload.npcId);
      return [];
    },
  } as unknown as GuildMakerService;
}

function service(
  flags: FlagsService,
  visits: GuildVisitService,
  maker: GuildMakerService,
  kill: GuildKillSwitch,
  npcs: GuildNpcRepository,
): GuildDevService {
  const presence = { setAway: async () => ({ posted: true, away: true, tick: 1 }) } as unknown as DevPresence;
  const director = { setDevAllowance: async () => { throw new Error('unused'); } } as unknown as DirectorKeyService;
  return new GuildDevService(flags, visits, maker, kill, npcs, presence, director, db.prisma);
}

function moduleRef(): ModuleRef {
  const keys = new TradeKeysService(
    new TradeKeyRepository(db.prisma),
    new TradeRequestRepository(db.prisma),
    { current: () => ({ pairs: [] }) } as never,
    { gate: () => undefined } as never,
    { submit: async () => ({ ok: true, appliedAtTick: 1 }) } as never,
    { closeKey: () => undefined } as never,
    db.prisma,
  );
  return { get: () => keys } as unknown as ModuleRef;
}

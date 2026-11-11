import 'reflect-metadata';
import { ACHIEVEMENT_FAMILY_IDS } from '@terra/contracts';
import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PlanetEventV1 } from '../bus/channels.js';
import { EventBus } from '../bus/event-bus.js';
import { FactsStore } from './facts.store.js';
import { FactsUpdaterService, planetEventToProgressEvents } from './facts-updater.service.js';
import type { FamilyAvailabilityService } from './family-availability.js';
import { ProgressionEngine } from './progression-engine.js';

let db: TestDatabase;
const availability = {
  availableFamilies: () => new Set(ACHIEVEMENT_FAMILY_IDS),
} as FamilyAvailabilityService;

beforeAll(async () => {
  db = await createTestDatabase();
});

afterAll(async () => {
  await db?.drop();
});

function makeEvent(
  kind: string,
  data: Record<string, unknown>,
  colonyIds: string[] = ['col_0'],
  tick = 100,
): PlanetEventV1 {
  return {
    planetId: 'pl_w18',
    tick,
    kind,
    severity: 'info',
    colonyIds,
    data,
  } as unknown as PlanetEventV1;
}

describe('W18-18 Progression integration: warlord unlocks', () => {
  it('increments warlord for killer and unlocks warlord Tier 1 at threshold', async () => {
    const bus = new EventBus();
    const engine = new ProgressionEngine(db.prisma, availability);
    const store = new FactsStore();
    const homeRepo = {
      findCachedColonyById: (cid: string) =>
        cid === 'col_killer' ? { playerId: 'pr_killer' } : { playerId: 'pr_victim' },
    };
    const updater = new FactsUpdaterService(store, bus, homeRepo as never, engine);
    updater.onModuleInit();

    const ev1 = makeEvent('unitDestroyed', {
      colonyId: 'col_victim',
      killerColonyId: 'col_killer',
      entityId: 1,
      count: 9,
    });
    bus.emit('planet.event', ev1);
    await new Promise((r) => setTimeout(r, 60));

    const fact9 = await db.prisma.playerFact.findUnique({
      where: { playerId_family: { playerId: 'pr_killer', family: 'warlord' } },
    });
    expect(fact9?.value).toBe(9);
    const unlocksBefore = await db.prisma.achievementUnlock.findMany({
      where: { playerId: 'pr_killer', family: 'warlord' },
    });
    expect(unlocksBefore).toHaveLength(0);

    const ev2 = makeEvent('unitDestroyed', {
      colonyId: 'col_victim',
      killerColonyId: 'col_killer',
      entityId: 2,
      count: 1,
    }, ['col_victim'], 101);
    bus.emit('planet.event', ev2);
    await new Promise((r) => setTimeout(r, 60));

    const fact10 = await db.prisma.playerFact.findUnique({
      where: { playerId_family: { playerId: 'pr_killer', family: 'warlord' } },
    });
    expect(fact10?.value).toBe(10);
    const unlocksAfter = await db.prisma.achievementUnlock.findMany({
      where: { playerId: 'pr_killer', family: 'warlord' },
    });
    expect(unlocksAfter).toHaveLength(1);
    expect(unlocksAfter[0]?.tier).toBe(1);

    updater.onModuleDestroy();
  });
});

describe('W18-18 Progression integration: diplomat unlocks', () => {
  it('increments diplomat for both bilateral colonies and unlocks diplomat Tier 1 on expiry', async () => {
    const bus = new EventBus();
    const engine = new ProgressionEngine(db.prisma, availability);
    const store = new FactsStore();
    const homeRepo = {
      findCachedColonyById: (cid: string) =>
        cid === 'col_dip_a' ? { playerId: 'pr_dip_a' } : cid === 'col_dip_b' ? { playerId: 'pr_dip_b' } : undefined,
    };
    const updater = new FactsUpdaterService(store, bus, homeRepo as never, engine);
    updater.onModuleInit();

    const ev = makeEvent(
      'truceEnded',
      { truceId: 'tr_bilateral', reason: 'expired' },
      ['col_dip_a', 'col_dip_b'],
      200,
    );
    bus.emit('planet.event', ev);
    await new Promise((r) => setTimeout(r, 80));

    const factA = await db.prisma.playerFact.findUnique({
      where: { playerId_family: { playerId: 'pr_dip_a', family: 'diplomat' } },
    });
    const factB = await db.prisma.playerFact.findUnique({
      where: { playerId_family: { playerId: 'pr_dip_b', family: 'diplomat' } },
    });
    expect(factA?.value).toBe(1);
    expect(factB?.value).toBe(1);

    const unlockA = await db.prisma.achievementUnlock.findMany({
      where: { playerId: 'pr_dip_a', family: 'diplomat' },
    });
    const unlockB = await db.prisma.achievementUnlock.findMany({
      where: { playerId: 'pr_dip_b', family: 'diplomat' },
    });
    expect(unlockA).toHaveLength(1);
    expect(unlockA[0]?.tier).toBe(1);
    expect(unlockB).toHaveLength(1);
    expect(unlockB[0]?.tier).toBe(1);

    updater.onModuleDestroy();
  });
});

describe('W18-18 Progression integration: negative & corner cases', () => {
  it('ignores negative cases: fauna kill, self-destruct, and cancelled/eliminated truce', async () => {
    const bus = new EventBus();
    const engine = new ProgressionEngine(db.prisma, availability);
    const store = new FactsStore();
    const homeRepo = {
      findCachedColonyById: (cid: string) => ({ playerId: `pr_${cid}` }),
    };
    const updater = new FactsUpdaterService(store, bus, homeRepo as never, engine);
    updater.onModuleInit();

    bus.emit(
      'planet.event',
      makeEvent('unitDestroyed', { colonyId: 'col_neg', pvp: false, entityId: 99 }),
    );
    bus.emit(
      'planet.event',
      makeEvent('unitDestroyed', { colonyId: 'col_self', killerColonyId: 'col_self', entityId: 100 }),
    );
    bus.emit(
      'planet.event',
      makeEvent('truceEnded', { truceId: 'tr_cancel', reason: 'cancelled' }, ['col_c1', 'col_c2']),
    );
    bus.emit(
      'planet.event',
      makeEvent('truceEnded', { truceId: 'tr_elim', reason: 'eliminated' }, ['col_e1', 'col_e2']),
    );
    await new Promise((r) => setTimeout(r, 60));

    expect(await db.prisma.playerFact.findFirst({ where: { playerId: 'pr_col_neg' } })).toBeNull();
    expect(await db.prisma.playerFact.findFirst({ where: { playerId: 'pr_col_self' } })).toBeNull();
    expect(await db.prisma.playerFact.findFirst({ where: { playerId: 'pr_col_c1' } })).toBeNull();
    expect(await db.prisma.playerFact.findFirst({ where: { playerId: 'pr_col_e1' } })).toBeNull();

    updater.onModuleDestroy();
  });

  it('corner cases: multi-kill count: 3 and duplicate event replay idempotency', async () => {
    const engine = new ProgressionEngine(db.prisma, availability);
    const multiKillEv = makeEvent('unitDestroyed', {
      colonyId: 'col_v3',
      killerColonyId: 'col_k3',
      killerPlayerId: 'pr_k3',
      count: 3,
      entityId: 300,
    });
    const progs = planetEventToProgressEvents(multiKillEv);
    expect(progs).toHaveLength(1);
    expect(progs[0]?.value).toBe(3);

    const firstResult = await engine.apply(progs[0]!);
    expect(firstResult.unlocked).toEqual([]);
    const factAfterFirst = await db.prisma.playerFact.findUnique({
      where: { playerId_family: { playerId: 'pr_k3', family: 'warlord' } },
    });
    expect(factAfterFirst?.value).toBe(3);

    const replayResult = await engine.apply(progs[0]!);
    expect(replayResult.unlocked).toEqual([]);
    const factAfterReplay = await db.prisma.playerFact.findUnique({
      where: { playerId_family: { playerId: 'pr_k3', family: 'warlord' } },
    });
    expect(factAfterReplay?.value).toBe(3);

    const alteredPayload = { ...progs[0]!, value: 10 };
    await expect(engine.apply(alteredPayload)).rejects.toThrow('reused');
  });
});

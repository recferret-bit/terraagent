import 'reflect-metadata';
import { ACHIEVEMENT_FAMILY_IDS } from '@terra/contracts';
import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FlagsService } from '../../src/flags/flags.service.js';
import { GuildContactProducer } from '../../src/market/progression/guild-contact.producer.js';
import { guildContactEventId, type GuildContactFill } from '../../src/market/progression/guild-contact-events.js';
import { FactsUpdaterService } from '../../src/progression/facts-updater.service.js';
import { FactsStore } from '../../src/progression/facts.store.js';
import { FamilyAvailabilityService } from '../../src/progression/family-availability.js';
import { ProgressionEngine } from '../../src/progression/progression-engine.js';

let db: TestDatabase;
const availability = { availableFamilies: () => new Set(ACHIEVEMENT_FAMILY_IDS) } as FamilyAvailabilityService;
let n = 0;

beforeAll(async () => {
  db = await createTestDatabase();
});
afterAll(async () => {
  await db?.drop();
});

function harness(waves = 'all') {
  const player = `p${++n}`;
  const engine = new ProgressionEngine(db.prisma, availability);
  const facts = new FactsUpdaterService(new FactsStore(db.prisma), undefined, undefined, engine);
  const flags = new FlagsService({ TA_WAVES: waves } as never);
  const producer = new GuildContactProducer(facts, flags, undefined, db.prisma);
  const fill = (tradeId: string, amount = 3, over: Partial<GuildContactFill> = {}): GuildContactFill => ({
    tradeId,
    planetId: 'pl',
    amount,
    buyer: { actorKind: 'player', colonyId: `c-${player}`, playerId: player },
    seller: { actorKind: 'npc', colonyId: 'kestrel', playerId: null },
    ...over,
  });
  const fact = async () =>
    (
      await db.prisma.playerFact.findUnique({
        where: { playerId_family: { playerId: player, family: 'guild-contact' } },
      })
    )?.value ?? 0;
  const receipts = () => db.prisma.progressionReceipt.count({ where: { playerId: player } });
  const unlocks = () => db.prisma.achievementUnlock.count({ where: { playerId: player, family: 'guild-contact' } });
  return { player, facts, flags, producer, fill, fact, receipts, unlocks };
}

describe('W15-25 guild contact fact (Postgres)', () => {
  it('one settled npc fill is +1 and a second trade id is 2, without minting a tier', async () => {
    const s = harness();
    await s.producer.note(s.fill('tr_1'));
    expect(await s.fact()).toBe(1);
    await s.producer.note(s.fill('tr_2'));
    expect(await s.fact()).toBe(2);
    expect(await s.receipts()).toBe(2);
    expect(await s.unlocks()).toBe(0);
  });

  it('a player fill, a zero fill, a same-owner fill and W15 off do not increment', async () => {
    const s = harness();
    await s.producer.note(s.fill('pp', 3, { seller: { actorKind: 'player', colonyId: 'c2', playerId: 'p2' } }));
    await s.producer.note(s.fill('zero', 0));
    await s.producer.note(s.fill('own', 3, { seller: { actorKind: 'npc', colonyId: 'kestrel', playerId: s.player } }));
    expect(await s.fact()).toBe(0);
    expect(await s.receipts()).toBe(0);

    const off = harness('..14');
    await off.producer.note(off.fill('off'));
    expect(await off.fact()).toBe(0);
    expect(await off.receipts()).toBe(0);
  });

  it('replay of the same trade id, including a new producer, does not increment twice', async () => {
    const s = harness();
    await s.producer.note(s.fill('tr_replay'));
    await s.producer.note(s.fill('tr_replay'));
    const restarted = new GuildContactProducer(s.facts, s.flags, undefined, db.prisma);
    await restarted.note(s.fill('tr_replay'));
    expect(await s.fact()).toBe(1);
    expect(await s.receipts()).toBe(1);
    expect(
      await db.prisma.progressionReceipt.findUnique({ where: { id: guildContactEventId('tr_replay', s.player) } }),
    ).not.toBeNull();
  });

  it('applies two different trade ids concurrently without a lost update', async () => {
    const s = harness();
    await Promise.all([s.producer.note(s.fill('c1')), s.producer.note(s.fill('c2'))]);
    expect(await s.fact()).toBe(2);
    expect(await s.receipts()).toBe(2);
    expect(await s.unlocks()).toBe(0);
  });
});

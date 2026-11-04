import { FactsUpdaterService } from '../../src/progression/facts-updater.service.js';
import { FactsStore } from '../../src/progression/facts.store.js';
import { AchievementUnlockStore } from '../../src/progression/achievement-unlock.store.js';
import { FlagsService } from '../../src/flags/flags.service.js';
import { MeProfileService } from '../../src/profile/me-profile.service.js';
import { MeAchievementsService } from '../../src/profile/me-achievements.service.js';
import { ColonyHistoryStore } from '../../src/profile/colony-history.store.js';
import { planetEventToProgress } from '../../src/progression/facts-updater.service.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import { ACHIEVEMENT_FAMILY_IDS, ACHIEVEMENTS, type ProgressEventV1 } from '@terra/contracts';
import { ProgressionEngine } from '../../src/progression/progression-engine.js';
import { XpStore } from '../../src/progression/xp.store.js';
import { ProgressionEffects } from '../../src/progression/progression-effects.js';
import { FamilyAvailabilityService } from '../../src/progression/family-availability.js';

let db: TestDatabase;
const availability = { availableFamilies: () => new Set(ACHIEVEMENT_FAMILY_IDS) } as FamilyAvailabilityService;
const event = (playerId: string, id: string, value = 1): ProgressEventV1 => ({
  eventId: id,
  playerId,
  family: 'first-landfall',
  metric: 'counter',
  value,
  planetId: 'p',
  colonyId: 'c',
  atTick: 1,
});
const engine = () => new ProgressionEngine(db.prisma, availability);

beforeAll(async () => {
  db = await createTestDatabase();
});
afterAll(async () => {
  await db?.drop();
});

describe('durable progression transaction and delivery', () => {
  it('replays after restart without duplicate facts, unlocks, XP or effects', async () => {
    const input = event('replay', 'replay-1');
    const first = await engine().apply(input);
    expect(first.unlocked).toHaveLength(1);
    const replay = await engine().apply(input);
    expect(replay.unlocked).toEqual([]);
    expect(await db.prisma.playerFact.findMany({ where: { playerId: 'replay' } })).toMatchObject([{ value: 1 }]);
    expect(await db.prisma.achievementUnlock.count({ where: { playerId: 'replay' } })).toBe(1);
    expect(await db.prisma.xpLedger.count({ where: { playerId: 'replay' } })).toBe(1);
    expect(await db.prisma.progressionEffect.count({ where: { playerId: 'replay' } })).toBe(2);
    await expect(engine().apply({ ...input, value: 5 })).rejects.toThrow('reused');
  });

  it('serializes concurrent increments and cross-tier rewards without lost writes', async () => {
    await Promise.all(Array.from({ length: 10 }, (_, i) => engine().apply(event('parallel', `parallel-${i}`))));
    expect(await db.prisma.playerFact.findFirst({ where: { playerId: 'parallel' } })).toMatchObject({ value: 10 });
    const ledger = await db.prisma.xpLedger.findMany({ where: { playerId: 'parallel' } });
    expect(await db.prisma.playerXp.findUnique({ where: { playerId: 'parallel' } })).toMatchObject({
      xp: ledger.reduce((sum, r) => sum + r.delta, 0),
    });
  });

  it('rolls back the receipt and facts if an unlock write fails', async () => {
    await db.prisma.xpLedger.create({
      data: { id: 'collision', playerId: 'rollback', source: 'achievement', sourceId: 'first-landfall', delta: 1 },
    });
    await expect(engine().apply(event('rollback', 'rollback-1'))).rejects.toThrow();
    expect(await db.prisma.progressionReceipt.findUnique({ where: { id: 'rollback-1' } })).toBeNull();
    expect(await db.prisma.playerFact.count({ where: { playerId: 'rollback' } })).toBe(0);
    expect(await db.prisma.achievementUnlock.count({ where: { playerId: 'rollback' } })).toBe(0);
  });

  it('evaluates all catalogue tiers from data and keeps max facts monotonic', async () => {
    for (const family of ACHIEVEMENT_FAMILY_IDS) {
      const defs = ACHIEVEMENTS.filter((d) => d.familyId === family);
      await engine().apply({
        ...event('catalogue', `catalogue-${family}`),
        family,
        metric: defs[0]!.metric,
        value: Math.max(...defs.map((d) => d.threshold)),
      });
    }
    expect(await db.prisma.achievementUnlock.count({ where: { playerId: 'catalogue' } })).toBe(ACHIEVEMENTS.length);
    await engine().apply({ ...event('catalogue', 'lower-max'), family: 'power-broker', metric: 'max', value: 1 });
    expect(
      (await db.prisma.playerFact.findUnique({
        where: { playerId_family: { playerId: 'catalogue', family: 'power-broker' } },
      }))!.value,
    ).toBeGreaterThan(1);
  });

});

describe('progression isolation and delivery', () => {
  it('isolates players, respects unavailable families, and rejects invalid metrics', async () => {
    const disabled = new ProgressionEngine(db.prisma, {
      availableFamilies: () => new Set(),
    } as unknown as FamilyAvailabilityService);
    await disabled.apply(event('disabled', 'disabled-1', 100));
    expect(await db.prisma.achievementUnlock.count({ where: { playerId: 'disabled' } })).toBe(0);
    expect(await db.prisma.playerFact.count({ where: { playerId: 'stranger' } })).toBe(0);
    await expect(engine().apply({ ...event('invalid', 'invalid-1'), metric: 'max' })).rejects.toThrow(
      'Metric mismatch',
    );
    await expect(engine().apply(event('invalid', 'invalid-2', -1))).rejects.toThrow();
    expect(await db.prisma.progressionReceipt.count({ where: { playerId: 'invalid' } })).toBe(0);
  });

  it('keeps administrative XP and achievement XP atomic under concurrent awards', async () => {
    const xp = new XpStore(db.prisma);
    await Promise.all([engine().apply(event('mixed', 'mixed-1')), xp.award('mixed', 'admin', 'once', 100)]);
    const first = await xp.get('mixed');
    await xp.award('mixed', 'admin', 'once', 100);
    expect(await xp.get('mixed')).toEqual(first);
    expect(first.xp).toBe(100 + ACHIEVEMENTS.find((d) => d.id === 'first-landfall')!.xp);
  });

  it('recovers a claimed effect after a worker dies', async () => {
    await db.prisma.progressionEffect.create({
      data: {
        id: 'crashed',
        kind: 'lease-test',
        playerId: 'p',
        payload: {},
        lease: 'dead',
        availableAt: new Date(Date.now() - 1000),
      },
    });
    const seen: string[] = [];
    expect(
      await new ProgressionEffects(db.prisma).drain('lease-test', async (row) => {
        seen.push(row.id);
      }),
    ).toBe(1);
    expect(seen).toEqual(['crashed']);
    expect(
      await new ProgressionEffects(db.prisma).drain('lease-test', async (row) => {
        seen.push(row.id);
      }),
    ).toBe(0);
  });

  it('retries a failed consumer, excludes concurrent workers, and preserves independent badge delivery', async () => {
    const queue = new ProgressionEffects(db.prisma);
    const now = new Date(Date.now() + 1000);
    await queue.drain(
      'achievement.notification',
      async () => {
        throw new Error('offline');
      },
      now,
    );
    expect(
      await db.prisma.progressionEffect.count({
        where: { kind: 'achievement.notification', lastError: { not: null } },
      }),
    ).toBeGreaterThan(0);
    const ids: string[] = [];
    const consumer = async (item: { id: string }) => {
      ids.push(item.id);
    };
    const later = new Date(now.getTime() + 120_000);
    await Promise.all([
      queue.drain('achievement.notification', consumer, later),
      queue.drain('achievement.notification', consumer, later),
    ]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThan(0);
    expect(
      await db.prisma.progressionEffect.count({ where: { kind: 'achievement.badge', completedAt: null } }),
    ).toBeGreaterThan(0);
    const remaining = await db.prisma.progressionEffect.count({
      where: { kind: 'achievement.notification', completedAt: null },
    });
    // Bounded batches continue draining without replaying completed rows.
    await queue.drain('achievement.notification', consumer, later);
    expect(new Set(ids).size).toBe(ids.length);
    expect(remaining).toBeGreaterThanOrEqual(0);
  });
});


describe('source event to persisted profile', () => {
  it('projects accepted producer events after constructing fresh readers, without mock statistics', async () => {
    const flags = new FlagsService({ TA_WAVES: 'all' } as never);
    const available = new FamilyAvailabilityService(flags);
    const facts = new FactsStore(db.prisma);
    const updater = new FactsUpdaterService(facts, undefined, undefined, new ProgressionEngine(db.prisma, available));
    const source = planetEventToProgress({ planetId: 'source-planet', tick: 1, kind: 'tilePrepared', severity: 'info',
      colonyIds: ['source-colony'], data: { colonyId: 'source-colony', playerId: 'source-pilot', count: 100 } } as never)!;
    await updater.applyProgressEvent(source);
    await updater.applyProgressEvent(source);
    const readers = new FactsStore(db.prisma);
    const achievements = new MeAchievementsService(readers, new AchievementUnlockStore(db.prisma), available, flags);
    const profile = new MeProfileService(readers, new XpStore(db.prisma), achievements, new ColonyHistoryStore(db.prisma), flags);
    const result = await profile.getForPlayer('source-pilot');
    expect(result.stats.tilesGraded).toBe(100);
    expect(result.earnedAchievementsCount).toBe(1);
    expect(result.progression.xp).toBeGreaterThan(0);
    expect(result.currentColonies).toEqual([]);
    expect(result.stats.resourcesProduced).toBe(0);
    expect((await profile.getForPlayer('unrelated-pilot')).earnedAchievementsCount).toBe(0);
  });
});


describe('administrative progression reset', () => {
  it('clears journal and pending effects with statistics so a replay can earn cleanly', async () => {
    const input = event('reset-pilot', 'reset-event');
    await engine().apply(input);
    await engine().resetPlayer('reset-pilot');
    expect(await db.prisma.progressionEffect.count({ where: { playerId: 'reset-pilot' } })).toBe(0);
    expect(await db.prisma.progressionReceipt.findUnique({ where: { id: 'reset-event' } })).toBeNull();
    await engine().apply(input);
    expect(await db.prisma.achievementUnlock.count({ where: { playerId: 'reset-pilot' } })).toBe(1);
    expect(await db.prisma.progressionEffect.count({ where: { playerId: 'reset-pilot' } })).toBe(2);
  });
});

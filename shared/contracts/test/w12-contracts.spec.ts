import { describe, expect, it } from 'vitest';
import {
  ACHIEVEMENTS,
  ACHIEVEMENT_BY_ID,
  ACHIEVEMENT_FAMILIES,
  EVENT_KINDS,
  MAX_PLAYER_LEVEL,
  MeAchievementsResponseSchema,
  MeProfileResponseSchema,
  PROFILE_STAT_DEFINITIONS,
  ProgressEventV1Schema,
  evaluateNewUnlocks,
  eventDef,
  levelForXp,
  parseWaves,
  progressOf,
  titleForLevel,
  xpRequiredForLevel,
  type EventKind,
} from '../src';

describe('W12-01 catalogue & level curve', () => {
  it('defines 20 families x 3 tiers = 60 tiers, unique ids matching family/family-2/family-3, and sum of XP = 13 800', () => {
    expect(ACHIEVEMENT_FAMILIES).toHaveLength(20);
    expect(ACHIEVEMENTS).toHaveLength(60);

    const ids = new Set(ACHIEVEMENTS.map((a) => a.id));
    expect(ids.size).toBe(60);

    for (const family of ACHIEVEMENT_FAMILIES) {
      const tiers = ACHIEVEMENTS.filter((a) => a.familyId === family.familyId);
      expect(tiers).toHaveLength(3);
      expect(tiers[0]?.id).toBe(family.familyId);
      expect(tiers[1]?.id).toBe(`${family.familyId}-2`);
      expect(tiers[2]?.id).toBe(`${family.familyId}-3`);
      expect(tiers[0]?.tierName).toBe('Bronze');
      expect(tiers[1]?.tierName).toBe('Silver');
      expect(tiers[2]?.tierName).toBe('Gold');
    }

    const totalXp = ACHIEVEMENTS.reduce((sum, a) => sum + a.xp, 0);
    expect(totalXp).toBe(13_800);
  });

  it('computes progressOf and evaluateNewUnlocks against facts', () => {
    const gb1 = ACHIEVEMENT_BY_ID.get('groundbreaker')!;
    const gb2 = ACHIEVEMENT_BY_ID.get('groundbreaker-2')!;
    expect(progressOf(gb1, { groundbreaker: 100 })).toEqual({ value: 100, target: 100 });
    expect(progressOf(gb2, { groundbreaker: 100 })).toEqual({ value: 100, target: 1000 });
    expect(progressOf(gb2, { groundbreaker: 2500 })).toEqual({ value: 1000, target: 1000 });

    const unlocked = evaluateNewUnlocks({ groundbreaker: 1000 }, new Set(['groundbreaker']));
    expect(unlocked.map((u) => u.id)).toEqual(['groundbreaker-2']);
  });

  it('computes level curve 50*L*(L+1) with cap 30 (46 500 XP) and scenario pilot 1 120 XP -> Level 4 Surveyor', () => {
    expect(xpRequiredForLevel(0)).toBe(0);
    expect(xpRequiredForLevel(1)).toBe(100);
    expect(xpRequiredForLevel(4)).toBe(1000);
    expect(xpRequiredForLevel(5)).toBe(1500);
    expect(xpRequiredForLevel(MAX_PLAYER_LEVEL)).toBe(46_500);

    const p4 = levelForXp(1120);
    expect(p4).toEqual({ level: 4, xp: 1120, currentLevelXp: 1000, nextLevelXp: 1500 });
    expect(titleForLevel(p4.level)).toBe('Surveyor');

    const pCap = levelForXp(99_999);
    expect(pCap.level).toBe(30);
    expect(pCap.currentLevelXp).toBe(46_500);
  });
});

describe('W12-01 DTO schemas, events, and wave flag', () => {
  it('validates ProgressEventV1, MeAchievementsResponse, and MeProfileResponse schemas', () => {
    const ev = ProgressEventV1Schema.parse({
      playerId: 'pr_01ARZ3NDEKTSV4RRFFQ69G5FAV',
      colonyId: 'co_01ARZ3NDEKTSV4RRFFQ69G5FAV',
      planetId: 'pl_01ARZ3NDEKTSV4RRFFQ69G5FAV',
      family: 'groundbreaker',
      metric: 'counter',
      value: 25,
      atTick: 120,
    });
    expect(ev.family).toBe('groundbreaker');

    const entry = {
      id: 'groundbreaker',
      familyId: 'groundbreaker' as const,
      familyName: 'Groundbreaker',
      tier: 1 as const,
      tierName: 'Bronze' as const,
      name: 'Groundbreaker',
      description: 'Grade 100 tiles to Prepared.',
      threshold: 100,
      xp: 50,
      star: false,
      metric: 'counter' as const,
      producerWave: 'W01',
      glyph: 'shovel',
      status: 'earned' as const,
      progress: { value: 100, target: 100 },
      earnedAt: '2026-11-03T12:00:00.000Z',
      nft: { status: 'none' as const },
    };

    const achRes = MeAchievementsResponseSchema.parse({
      earnedCount: 1,
      totalCount: 60,
      achievements: [entry],
    });
    expect(achRes.achievements[0]?.tierName).toBe('Bronze');

    expect(PROFILE_STAT_DEFINITIONS).toHaveLength(16);
    const stats = Object.fromEntries(PROFILE_STAT_DEFINITIONS.map((d) => [d.key, 0]));
    const profRes = MeProfileResponseSchema.parse({
      identity: {
        playerId: 'pr_01ARZ3NDEKTSV4RRFFQ69G5FAV',
        handle: 'Vanguard',
        accountId: 'vanguard.terraagent.mock',
        isGuest: false,
        pilotSince: '2026-10-01T00:00:00.000Z',
        avatarSeed: 'vanguard',
        frame: 'surveyor',
      },
      progression: {
        level: 4,
        xp: 1120,
        currentLevelXp: 1000,
        nextLevelXp: 1500,
        title: 'Surveyor',
        titles: ['Cadet', 'Pioneer', 'Surveyor'],
        frames: ['default', 'surveyor'],
        unlockStage: 4,
        nextStageCondition: 'Construct Research Uplink and reach 100 E/s peak power',
      },
      stats,
      currentColonies: [],
      pastColonies: [],
      nextAchievements: [entry],
      earnedAchievementsCount: 9,
      totalAchievementsCount: 60,
    });
    expect(profRes.progression.level).toBe(4);
  });

  it('registers achievement.earned and xp.levelUp on wave W12, and toggles flag W12', () => {
    const kinds: EventKind[] = ['achievement.earned', 'xp.levelUp'];
    for (const k of kinds) {
      expect(EVENT_KINDS).toContain(k);
      expect(eventDef(k).wave).toBe('W12');
    }
    expect(parseWaves('all').has('W12')).toBe(true);
    expect(parseWaves('..12').has('W12')).toBe(true);
    expect(parseWaves('..11').has('W12')).toBe(false);
  });
});

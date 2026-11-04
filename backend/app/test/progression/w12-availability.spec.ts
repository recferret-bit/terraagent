import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import {
  ACHIEVEMENTS,
  ACHIEVEMENT_FAMILY_BY_ID,
  parseWaves,
  type AchievementDef,
  type AchievementFamilyId,
} from '@terra/contracts';
import { FlagsService } from '../../src/flags/flags.service.js';
import {
  availableFamilyIds,
  familyAvailabilityStatus,
  FamilyAvailabilityService,
  isFamilyAvailable,
  resolveAchievementStatus,
} from '../../src/progression/family-availability.js';

const COMING_SOON_FAMILIES: readonly AchievementFamilyId[] = [
  'warlord',
  'diplomat',
  'merchant',
  'settler',
  'great-wall',
  'port-authority',
  'guild-contact',
];

const AVAILABLE_FAMILIES: readonly AchievementFamilyId[] = [
  'first-landfall',
  'groundbreaker',
  'stone-mason',
  'architect',
  'night-shift',
  'stockpile',
  'power-broker',
  'hydro-engineer',
  'green-thumb',
  'exterminator',
  'nest-breaker',
  'unbreached',
  'tech-ascendant',
];

describe('pure helpers with parseWaves(..12)', () => {
  const flags = parseWaves('..12');
  const hasWave = (w: string) => flags.has(w);

  it('reports coming_soon families as unavailable with status coming_soon', () => {
    for (const familyId of COMING_SOON_FAMILIES) {
      expect(isFamilyAvailable(familyId, hasWave)).toBe(false);
      expect(familyAvailabilityStatus(familyId, hasWave)).toBe('coming_soon');
    }
  });

  it('reports available families as available', () => {
    for (const familyId of AVAILABLE_FAMILIES) {
      expect(isFamilyAvailable(familyId, hasWave)).toBe(true);
      expect(familyAvailabilityStatus(familyId, hasWave)).toBe('available');
    }
  });

  it('collects exactly the active family IDs', () => {
    const active = availableFamilyIds(hasWave);
    expect(active.size).toBe(AVAILABLE_FAMILIES.length);
    expect(active).toEqual(new Set(AVAILABLE_FAMILIES));
    for (const soon of COMING_SOON_FAMILIES) {
      expect(active.has(soon)).toBe(false);
    }
  });
});

describe('resolveAchievementStatus with parseWaves(..12)', () => {
  const flags = parseWaves('..12');
  const hasWave = (w: string) => flags.has(w);

  it('resolves locked when unearned, earned when in earnedIds for available tiers', () => {
    for (const familyId of AVAILABLE_FAMILIES) {
      const def = ACHIEVEMENTS.find((a) => a.familyId === familyId)!;
      expect(resolveAchievementStatus(def, new Set(), hasWave)).toBe('locked');
      expect(resolveAchievementStatus(def, new Set([def.id]), hasWave)).toBe('earned');
    }
  });

  it('resolves coming_soon when unearned for future tiers, earned when in earnedIds', () => {
    for (const familyId of COMING_SOON_FAMILIES) {
      const def = ACHIEVEMENTS.find((a) => a.familyId === familyId)!;
      expect(resolveAchievementStatus(def, new Set(), hasWave)).toBe('coming_soon');
      expect(resolveAchievementStatus(def, new Set([def.id]), hasWave)).toBe('earned');
    }
  });

  it('checks expected producer wave metadata from catalogue', () => {
    expect(ACHIEVEMENT_FAMILY_BY_ID.get('warlord')?.producerWave).toBe('W18');
    expect(ACHIEVEMENT_FAMILY_BY_ID.get('settler')?.producerWave).toBe('W21');
    expect(ACHIEVEMENT_FAMILY_BY_ID.get('merchant')?.producerWave).toBe('W13');
    expect(ACHIEVEMENT_FAMILY_BY_ID.get('first-landfall')?.producerWave).toBe('W01');
  });
});

describe('FamilyAvailabilityService with TA_WAVES=..12', () => {
  const flags = new FlagsService({ TA_WAVES: '..12' } as never);
  const service = new FamilyAvailabilityService(flags);

  it('returns expected family availability flags and status', () => {
    for (const soon of COMING_SOON_FAMILIES) {
      expect(service.isAvailable(soon)).toBe(false);
      expect(service.familyStatus(soon)).toBe('coming_soon');
    }
    for (const ready of AVAILABLE_FAMILIES) {
      expect(service.isAvailable(ready)).toBe(true);
      expect(service.familyStatus(ready)).toBe('available');
    }
  });

  it('returns the active families set matching available families', () => {
    expect(service.availableFamilies()).toEqual(new Set(AVAILABLE_FAMILIES));
  });

  it('resolves tier status via FlagsService', () => {
    const unearned = new Set<string>();
    const earnedDef = ACHIEVEMENTS.find((a) => a.familyId === 'first-landfall') as AchievementDef;
    const soonDef = ACHIEVEMENTS.find((a) => a.familyId === 'diplomat') as AchievementDef;

    expect(service.tierStatus(earnedDef, unearned)).toBe('locked');
    expect(service.tierStatus(earnedDef, new Set([earnedDef.id]))).toBe('earned');
    expect(service.tierStatus(soonDef, unearned)).toBe('coming_soon');
    expect(service.tierStatus(soonDef, new Set([soonDef.id]))).toBe('earned');
  });
});

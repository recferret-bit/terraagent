import { Injectable } from '@nestjs/common';
import {
  ACHIEVEMENT_FAMILIES,
  ACHIEVEMENT_FAMILY_BY_ID,
  ACHIEVEMENTS,
  type AchievementDef,
  type AchievementFamilyId,
  type AchievementStatus,
} from '@terra/contracts';
import { FlagsService } from '../flags/flags.service.js';

export { ACHIEVEMENTS };

/** Returns true if the achievement family is recognized and its producer wave is active. */
export function isFamilyAvailable(
  familyId: AchievementFamilyId,
  hasWave: (wave: string) => boolean,
): boolean {
  const spec = ACHIEVEMENT_FAMILY_BY_ID.get(familyId);
  return Boolean(spec && hasWave(spec.producerWave));
}

/** Returns 'available' when the family's wave is enabled, otherwise 'coming_soon'. */
export function familyAvailabilityStatus(
  familyId: AchievementFamilyId,
  hasWave: (wave: string) => boolean,
): 'available' | 'coming_soon' {
  return isFamilyAvailable(familyId, hasWave) ? 'available' : 'coming_soon';
}

/** Resolves tier status against earned set and wave availability. Earned takes precedence. */
export function resolveAchievementStatus(
  def: Pick<AchievementDef, 'id' | 'familyId' | 'producerWave'>,
  earnedIds: ReadonlySet<string>,
  hasWave: (wave: string) => boolean,
): AchievementStatus {
  if (earnedIds.has(def.id)) {
    return 'earned';
  }
  if (!hasWave(def.producerWave)) {
    return 'coming_soon';
  }
  return 'locked';
}

/** Returns the set of family IDs whose producer wave is currently active. */
export function availableFamilyIds(hasWave: (wave: string) => boolean): Set<AchievementFamilyId> {
  const available = new Set<AchievementFamilyId>();
  for (const family of ACHIEVEMENT_FAMILIES) {
    if (hasWave(family.producerWave)) {
      available.add(family.familyId);
    }
  }
  return available;
}

/** NestJS service delegating family and tier availability to server-wide FlagsService. */
@Injectable()
export class FamilyAvailabilityService {
  constructor(private readonly flags: FlagsService) {}

  isAvailable(familyId: AchievementFamilyId): boolean {
    return isFamilyAvailable(familyId, (wave) => this.flags.has(wave));
  }

  familyStatus(familyId: AchievementFamilyId): 'available' | 'coming_soon' {
    return familyAvailabilityStatus(familyId, (wave) => this.flags.has(wave));
  }

  tierStatus(
    def: Pick<AchievementDef, 'id' | 'familyId' | 'producerWave'>,
    earnedIds: ReadonlySet<string>,
  ): AchievementStatus {
    return resolveAchievementStatus(def, earnedIds, (wave) => this.flags.has(wave));
  }

  availableFamilies(): Set<AchievementFamilyId> {
    return availableFamilyIds((wave) => this.flags.has(wave));
  }
}

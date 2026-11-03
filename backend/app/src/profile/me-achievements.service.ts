import { Injectable } from '@nestjs/common';
import {
  ACHIEVEMENTS,
  parseWaves,
  progressOf,
  type AchievementNftStatus,
  type MeAchievementsResponse,
  type PlayerAchievementEntry,
} from '@terra/contracts';
import { CoreException } from '../core/errors/index.js';
import { FlagsService } from '../flags/flags.service.js';
import { AchievementUnlockStore } from '../progression/achievement-unlock.store.js';
import { FactsStore } from '../progression/facts.store.js';
import { FamilyAvailabilityService, resolveAchievementStatus } from '../progression/family-availability.js';

/**
 * Filters entries to locked tiers, taking only the lowest unearned tier of each family,
 * sorted by highest completion ratio descending (tie-breaking by catalogue order).
 */
export function nextAchievements(
  entries: readonly PlayerAchievementEntry[],
  count = 3,
): PlayerAchievementEntry[] {
  if (count <= 0) return [];

  const seenFamilies = new Set<string>();
  const candidates: { entry: PlayerAchievementEntry; order: number; ratio: number }[] = [];

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    if (entry.status !== 'locked') continue;
    if (seenFamilies.has(entry.familyId)) continue;
    seenFamilies.add(entry.familyId);
    const ratio = entry.progress.target > 0 ? entry.progress.value / entry.progress.target : 0;
    candidates.push({ entry, order: i, ratio });
  }

  candidates.sort((a, b) => {
    if (b.ratio !== a.ratio) {
      return b.ratio - a.ratio;
    }
    return a.order - b.order;
  });

  return candidates.slice(0, count).map((c) => c.entry);
}

@Injectable()
export class MeAchievementsService {
  constructor(
    private readonly facts: FactsStore,
    private readonly unlocks: AchievementUnlockStore,
    private readonly availability: FamilyAvailabilityService,
    private readonly flags: FlagsService,
  ) {}

  async getForPlayer(playerId: string, wavesOverride?: string): Promise<MeAchievementsResponse> {
    if (!this.flags.has('W12')) {
      throw new CoreException('wave_disabled', {
        status: 403,
        message: 'Player page is off',
        details: { code: 'wave_disabled' },
      });
    }

    let narrowedHas: ((w: string) => boolean) | null = null;
    if (wavesOverride) {
      try {
        const parsed = parseWaves(wavesOverride);
        narrowedHas = (w: string) => this.flags.has(w) && parsed.has(w);
      } catch {
        // Ignore invalid override
      }
    }

    const facts = await this.facts.getAll(playerId);
    const earnedMap = await this.unlocks.getEarnedMap(playerId);
    const earnedIds = new Set(earnedMap.keys());

    const achievements: PlayerAchievementEntry[] = ACHIEVEMENTS.map((def) => {
      const status = narrowedHas
        ? resolveAchievementStatus(def, earnedIds, narrowedHas)
        : this.availability.tierStatus(def, earnedIds);
      const earnedRecord = earnedMap.get(def.id);
      const progress =
        status === 'earned'
          ? { value: def.threshold, target: def.threshold }
          : status === 'coming_soon'
            ? { value: 0, target: def.threshold }
            : progressOf(def, facts);
      const earnedAt = earnedRecord ? earnedRecord.earnedAt.toISOString() : null;
      const nft: AchievementNftStatus = earnedRecord
        ? {
            status: earnedRecord.nftStatus,
            ...(earnedRecord.nftTokenId ? { tokenId: earnedRecord.nftTokenId } : {}),
            ...(earnedRecord.nftTxHash ? { txHash: earnedRecord.nftTxHash } : {}),
          }
        : { status: 'none' as const };

      return {
        id: def.id,
        familyId: def.familyId,
        familyName: def.familyName,
        tier: def.tier,
        tierName: def.tierName,
        name: def.name,
        description: def.description,
        threshold: def.threshold,
        xp: def.xp,
        star: def.star,
        metric: def.metric,
        producerWave: def.producerWave,
        glyph: def.glyph,
        status,
        progress,
        earnedAt,
        nft,
      };
    });

    return {
      earnedCount: earnedMap.size,
      totalCount: ACHIEVEMENTS.length,
      achievements,
    };
  }

  nextAchievements(entries: readonly PlayerAchievementEntry[], count = 3): PlayerAchievementEntry[] {
    return nextAchievements(entries, count);
  }
}

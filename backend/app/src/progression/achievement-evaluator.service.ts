import { Injectable, Optional, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import {
  evaluateNewUnlocks,
  progressOf,
  type AchievementDef,
  type AchievementFamilyId,
  type AchievementTier,
  type AchievementTierName,
} from '@terra/contracts';
import { EventBus } from '../bus/event-bus.js';
import { AchievementUnlockStore, type UnlockedAchievementRecord } from './achievement-unlock.store.js';
import { FactsUpdaterService } from './facts-updater.service.js';

export { progressOf } from '@terra/contracts';

export interface AchievementUnlockedEventV1 {
  readonly playerId: string;
  readonly achievementId: string;
  readonly familyId: AchievementFamilyId;
  readonly familyName: string;
  readonly tier: AchievementTier;
  readonly tierName: AchievementTierName;
  readonly xp: number;
  readonly earnedAt: string;
}

declare module '../bus/channels.js' {
  interface BusChannels {
    'progression.achievementUnlocked': AchievementUnlockedEventV1;
  }
}

export type AchievementUnlockedListener = (
  unlocked: AchievementUnlockedEventV1,
  def: AchievementDef,
  record: UnlockedAchievementRecord,
) => void | Promise<void>;

/**
 * Evaluates a player's facts against the 60-tier achievement catalogue on every fact update, appends newly met tiers to
 * `AchievementUnlockStore` (idempotently: once per `(playerId, achievementId)`), and emits `progression.achievementUnlocked` (W12-03).
 */
@Injectable()
export class AchievementEvaluatorService implements OnModuleInit, OnModuleDestroy {
  private unsubFacts: (() => void) | undefined;
  private readonly listeners = new Set<AchievementUnlockedListener>();
  private allowedFamiliesProvider?: () => ReadonlySet<string>;

  constructor(
    private readonly unlocks: AchievementUnlockStore,
    @Optional() private readonly factsUpdater?: FactsUpdaterService,
    @Optional() private readonly bus?: EventBus,
  ) {}

  onModuleInit(): void {
    if (!this.factsUpdater) return;
    this.unsubFacts = this.factsUpdater.onFactUpdated(async (res, allFacts) => {
      await this.evaluate(res.playerId, allFacts);
    });
  }

  onModuleDestroy(): void {
    this.unsubFacts?.();
    this.unsubFacts = undefined;
  }

  setAllowedFamiliesProvider(fn: () => ReadonlySet<string>): void {
    this.allowedFamiliesProvider = fn;
  }

  onUnlocked(fn: AchievementUnlockedListener): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  progressOf(
    def: Pick<AchievementDef, 'familyId' | 'threshold'>,
    facts: Readonly<Record<string, number>>,
  ): { value: number; target: number } {
    return progressOf(def, facts);
  }

  async evaluate(
    playerId: string,
    facts: Readonly<Record<string, number>>,
    allowedFamilies: ReadonlySet<string> | undefined = this.allowedFamiliesProvider?.(),
  ): Promise<AchievementUnlockedEventV1[]> {
    const earnedMap = await this.unlocks.getEarnedMap(playerId);
    const earnedIds = new Set(earnedMap.keys());
    const candidates = evaluateNewUnlocks(facts, earnedIds, allowedFamilies);
    const newlyUnlocked: AchievementUnlockedEventV1[] = [];

    for (const def of candidates) {
      const { created, record } = await this.unlocks.recordUnlock(playerId, def);
      if (!created) continue;
      const ev: AchievementUnlockedEventV1 = {
        playerId,
        achievementId: def.id,
        familyId: def.familyId,
        familyName: def.familyName,
        tier: def.tier,
        tierName: def.tierName,
        xp: def.xp,
        earnedAt: record.earnedAt.toISOString(),
      };
      newlyUnlocked.push(ev);
      this.bus?.emit('progression.achievementUnlocked', ev);
      for (const fn of this.listeners) {
        await fn(ev, def, record);
      }
    }
    return newlyUnlocked;
  }
}

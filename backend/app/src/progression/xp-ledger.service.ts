import { Injectable, Optional, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { levelForXp, xpRequiredForLevel } from '@terra/contracts';
import { EventBus, type Unsubscribe } from '../bus/event-bus.js';
import { AchievementEvaluatorService } from './achievement-evaluator.service.js';
import { XpStore, type PlayerXpState, type XpAwardOutcome } from './xp.store.js';

export { levelForXp, xpRequiredForLevel };

export interface XpLevelUpEventV1 {
  readonly playerId: string;
  readonly previousLevel: number;
  readonly level: number;
  readonly xp: number;
  readonly title: string;
}

declare module '../bus/channels.js' {
  interface BusChannels {
    'progression.levelUp': XpLevelUpEventV1;
  }
}

export type LevelUpListener = (event: XpLevelUpEventV1, state: PlayerXpState) => void | Promise<void>;

/**
 * Awards XP idempotently via `XpStore` (`(playerId, source, sourceId)` unique), subscribes to
 * `progression.achievementUnlocked` to grant achievement XP once, and emits `progression.levelUp` when a threshold is crossed (W12-05).
 */
@Injectable()
export class XpLedgerService implements OnModuleInit, OnModuleDestroy {
  private readonly unsubs: Unsubscribe[] = [];
  private readonly listeners = new Set<LevelUpListener>();

  constructor(
    private readonly store: XpStore,
    @Optional() private readonly evaluator?: AchievementEvaluatorService,
    @Optional() private readonly bus?: EventBus,
  ) {}

  onModuleInit(): void {
    if (this.evaluator) {
      this.unsubs.push(
        this.evaluator.onUnlocked(async (unlocked) => {
          await this.awardAchievementXp(unlocked.playerId, unlocked.achievementId, unlocked.xp);
        }),
      );
    } else if (this.bus) {
      this.unsubs.push(
        this.bus.on(
          'progression.achievementUnlocked',
          (unlocked) => {
            void this.awardAchievementXp(unlocked.playerId, unlocked.achievementId, unlocked.xp);
          },
          { module: 'progression' },
        ),
      );
    }
  }

  onModuleDestroy(): void {
    for (const u of this.unsubs.splice(0)) u();
  }

  onLevelUp(fn: LevelUpListener): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  async getPlayerXp(playerId: string): Promise<PlayerXpState> {
    return this.store.get(playerId);
  }

  async awardAchievementXp(playerId: string, achievementId: string, xp: number): Promise<XpAwardOutcome> {
    return this.award(playerId, 'achievement', achievementId, xp);
  }

  async award(playerId: string, source: string, sourceId: string, delta: number): Promise<XpAwardOutcome> {
    const out = await this.store.award(playerId, source, sourceId, delta);
    if (out.applied && out.state.level > out.previousLevel) {
      const ev: XpLevelUpEventV1 = {
        playerId,
        previousLevel: out.previousLevel,
        level: out.state.level,
        xp: out.state.xp,
        title: out.state.title,
      };
      this.bus?.emit('progression.levelUp', ev);
      for (const fn of this.listeners) {
        await fn(ev, out.state);
      }
    }
    return out;
  }
}

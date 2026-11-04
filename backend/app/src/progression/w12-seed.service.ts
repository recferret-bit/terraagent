import { ProgressionEngine } from './progression-engine.js';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { ACHIEVEMENT_BY_ID, type AchievementFamilyId } from '@terra/contracts';
import { AchievementUnlockStore, type SeedUnlockEntry } from './achievement-unlock.store.js';
import { FactsStore } from './facts.store.js';
import { XpStore } from './xp.store.js';

export const W12_SEED_FACTS: Readonly<Record<AchievementFamilyId, number>> = {
  'first-landfall': 3,
  groundbreaker: 800,
  'stone-mason': 350,
  'hydro-engineer': 4,
  'green-thumb': 20,
  architect: 150,
  'power-broker': 140,
  'night-shift': 12,
  stockpile: 24500,
  'tech-ascendant': 4,
  exterminator: 18,
  'nest-breaker': 0,
  'great-wall': 0,
  unbreached: 2,
  warlord: 0,
  merchant: 0,
  'port-authority': 0,
  'guild-contact': 0,
  diplomat: 0,
  settler: 0,
};

export const W12_SEED_UNLOCK_IDS: readonly string[] = [
  'first-landfall',
  'first-landfall-2',
  'groundbreaker',
  'stone-mason',
  'architect',
  'power-broker',
  'night-shift',
  'night-shift-2',
  'stockpile',
];

export const W12_SEED_XP = {
  xp: 1120,
  level: 4,
  title: 'Surveyor',
  frame: 'surveyor',
  unlockStage: 4,
} as const;

/**
 * Seeds or resets the W12 scenario pilot progression baseline (9 earned badges, Level 4 `1 120 / 1 500` XP,
 * title `Surveyor`, `unlockStage = 4`) and tracks the most recently active dev pilot (W12-09, W12-31).
 */
@Injectable()
export class W12SeedService {
  private readonly seeding = new Map<string, Promise<boolean>>();
  private readonly seededPlayers = new Set<string>();
  private readonly resetPlayers = new Set<string>();
  private readonly resetListeners = new Set<(playerId: string) => void | Promise<void>>();
  lastActivePlayerId = 'pr_dev_w12';

  constructor(
    @Inject(FactsStore) private readonly facts: FactsStore,
    @Inject(AchievementUnlockStore) private readonly unlocks: AchievementUnlockStore,
    @Inject(XpStore) private readonly xp: XpStore,
    @Optional() @Inject(ProgressionEngine) private readonly engine?: ProgressionEngine,
  ) {}

  onReset(fn: (playerId: string) => void | Promise<void>): () => void {
    this.resetListeners.add(fn);
    return () => {
      this.resetListeners.delete(fn);
    };
  }

  noteActivePlayer(playerId: string): void {
    if (playerId) this.lastActivePlayerId = playerId;
  }

  isReset(playerId: string): boolean {
    return this.resetPlayers.has(playerId);
  }

  ensureSeeded(playerId: string): Promise<boolean> {
    const pending = this.seeding.get(playerId);
    if (pending) return pending;
    const task = this.ensureSeededOnce(playerId).finally(() => this.seeding.delete(playerId));
    this.seeding.set(playerId, task);
    return task;
  }

  private async ensureSeededOnce(playerId: string): Promise<boolean> {
    this.noteActivePlayer(playerId);
    if (this.resetPlayers.has(playerId) || this.seededPlayers.has(playerId)) return false;
    const [existingFacts, existingUnlocks, existingXp] = await Promise.all([
      this.facts.getAll(playerId),
      this.unlocks.getEarned(playerId),
      this.xp.get(playerId),
    ]);
    if (Object.keys(existingFacts).length > 0 || existingUnlocks.length > 0 || existingXp.xp > 0) {
      this.seededPlayers.add(playerId);
      return false;
    }
    await this.seedPilot(playerId);
    return true;
  }

  async seedPilot(playerId: string): Promise<void> {
    this.noteActivePlayer(playerId);
    await this.seedSinglePilot(playerId);
    if (playerId !== 'pr_dev_w12') {
      await this.seedSinglePilot('pr_dev_w12');
    }
  }

  private async seedSinglePilot(playerId: string): Promise<void> {
    this.resetPlayers.delete(playerId);
    this.seededPlayers.add(playerId);

    const baseTime = Date.parse('2026-10-15T12:00:00.000Z');
    const entries: SeedUnlockEntry[] = W12_SEED_UNLOCK_IDS.map((achievementId, idx) => ({
      achievementId,
      earnedAt: new Date(baseTime + idx * 86_400_000),
      nftStatus: 'minted',
      nftTokenId: `badge:${playerId}:${achievementId}`,
      nftTxHash: `mock:badge_${achievementId}`,
    }));

    await this.facts.setAll(playerId, W12_SEED_FACTS);
    await this.unlocks.seedEarned(playerId, entries);
    await this.xp.reset(playerId);
    for (const id of W12_SEED_UNLOCK_IDS) {
      const def = ACHIEVEMENT_BY_ID.get(id);
      if (def) await this.xp.award(playerId, 'achievement', def.id, def.xp);
    }
    await this.xp.seed(playerId, W12_SEED_XP);
  }

  async resetPilot(playerId: string): Promise<void> {
    this.noteActivePlayer(playerId);
    await this.resetSinglePilot(playerId);
    if (playerId !== 'pr_dev_w12') {
      await this.resetSinglePilot('pr_dev_w12');
    }
  }

  private async resetSinglePilot(playerId: string): Promise<void> {
    this.seededPlayers.delete(playerId);
    this.resetPlayers.add(playerId);
    if (this.engine?.enabled) await this.engine.resetPlayer(playerId);
    else await Promise.all([
      this.facts.reset(playerId),
      this.unlocks.reset(playerId),
      this.xp.reset(playerId),
    ]);
    for (const fn of this.resetListeners) {
      await fn(playerId);
    }
  }
}

import { ACHIEVEMENT_BY_ID } from '@terra/contracts';
import { describe, expect, it } from 'vitest';
import { EventBus } from '../../src/bus/event-bus.js';
import {
  AchievementEvaluatorService,
  type AchievementUnlockedEventV1,
} from '../../src/progression/achievement-evaluator.service.js';
import { AchievementUnlockStore } from '../../src/progression/achievement-unlock.store.js';
import { FactsStore } from '../../src/progression/facts.store.js';
import { FactsUpdaterService } from '../../src/progression/facts-updater.service.js';

describe('W12-03 AchievementUnlock append-only + progressOf + evaluate', () => {
  it('unlocks Bronze once when fact reaches 100 and does not duplicate unlock on second event at 120', async () => {
    const factsStore = new FactsStore();
    const unlockStore = new AchievementUnlockStore();
    const bus = new EventBus();
    const updater = new FactsUpdaterService(factsStore, bus);
    const evaluator = new AchievementEvaluatorService(unlockStore, updater, bus);
    updater.onModuleInit();
    evaluator.onModuleInit();

    const emitted: AchievementUnlockedEventV1[] = [];
    bus.on('progression.achievementUnlocked', (ev) => emitted.push(ev), { module: 'test' });

    const playerId = 'pr_eval_1';
    const gbBronze = ACHIEVEMENT_BY_ID.get('groundbreaker')!;
    const gbSilver = ACHIEVEMENT_BY_ID.get('groundbreaker-2')!;

    await updater.recordFact(playerId, 'groundbreaker', 60);
    expect(emitted).toHaveLength(0);
    expect(evaluator.progressOf(gbBronze, await factsStore.getAll(playerId))).toEqual({
      value: 60,
      target: 100,
    });

    await updater.recordFact(playerId, 'groundbreaker', 40);
    expect(emitted).toHaveLength(1);
    expect(emitted[0]?.achievementId).toBe('groundbreaker');
    expect(emitted[0]?.tierName).toBe('Bronze');
    expect(emitted[0]?.xp).toBe(50);

    await updater.recordFact(playerId, 'groundbreaker', 20);
    expect(await factsStore.get(playerId, 'groundbreaker')).toBe(120);
    expect(emitted).toHaveLength(1);
    expect(await unlockStore.getEarned(playerId)).toHaveLength(1);
    expect(evaluator.progressOf(gbSilver, await factsStore.getAll(playerId))).toEqual({
      value: 120,
      target: 1000,
    });

    evaluator.onModuleDestroy();
    updater.onModuleDestroy();
  });
});

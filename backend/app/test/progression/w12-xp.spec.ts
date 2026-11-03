import { describe, expect, it } from 'vitest';
import { EventBus } from '../../src/bus/event-bus.js';
import { AchievementEvaluatorService } from '../../src/progression/achievement-evaluator.service.js';
import { AchievementUnlockStore } from '../../src/progression/achievement-unlock.store.js';
import { FactsStore } from '../../src/progression/facts.store.js';
import { FactsUpdaterService } from '../../src/progression/facts-updater.service.js';
import { XpLedgerService, type XpLevelUpEventV1 } from '../../src/progression/xp-ledger.service.js';
import { XpStore } from '../../src/progression/xp.store.js';

describe('W12-05 XpLedger unique award + PlayerXp level curve + level-up event', () => {
  it('awards +XP once on achievement unlock, +0 on replay, and emits level-up on threshold crossing', async () => {
    const factsStore = new FactsStore();
    const unlockStore = new AchievementUnlockStore();
    const xpStore = new XpStore();
    const bus = new EventBus();
    const updater = new FactsUpdaterService(factsStore, bus);
    const evaluator = new AchievementEvaluatorService(unlockStore, updater, bus);
    const xpService = new XpLedgerService(xpStore, evaluator, bus);

    updater.onModuleInit();
    evaluator.onModuleInit();
    xpService.onModuleInit();

    const levelUps: XpLevelUpEventV1[] = [];
    bus.on('progression.levelUp', (ev) => levelUps.push(ev), { module: 'test' });

    const playerId = 'pr_xp_1';

    await updater.recordFact(playerId, 'groundbreaker', 100);
    const s1 = await xpService.getPlayerXp(playerId);
    expect(s1.xp).toBe(50);
    expect(s1.level).toBe(0);
    expect(levelUps).toHaveLength(0);

    const replay = await xpService.awardAchievementXp(playerId, 'groundbreaker', 50);
    expect(replay.applied).toBe(false);
    expect(replay.delta).toBe(0);
    expect((await xpService.getPlayerXp(playerId)).xp).toBe(50);

    await updater.recordFact(playerId, 'stone-mason', 50);
    const s2 = await xpService.getPlayerXp(playerId);
    expect(s2.xp).toBe(100);
    expect(s2.level).toBe(1);
    expect(levelUps).toHaveLength(1);
    expect(levelUps[0]).toMatchObject({
      playerId,
      previousLevel: 0,
      level: 1,
      xp: 100,
    });

    xpService.onModuleDestroy();
    evaluator.onModuleDestroy();
    updater.onModuleDestroy();
  });

  it('caps player level at 30 (46 500 XP)', async () => {
    const xpStore = new XpStore();
    const xpService = new XpLedgerService(xpStore);
    const out = await xpService.award('pr_cap', 'dev', 'cap_1', 60_000);
    expect(out.state.level).toBe(30);
    expect(out.state.xp).toBe(60_000);
    expect(out.state.title).toBe('Ascendant');
  });
});

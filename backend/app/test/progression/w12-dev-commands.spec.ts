import { describe, expect, it } from 'vitest';
import { DevCommandRegistry } from '../../src/dev/dev-command.registry.js';
import { AchievementEvaluatorService } from '../../src/progression/achievement-evaluator.service.js';
import { AchievementUnlockStore } from '../../src/progression/achievement-unlock.store.js';
import { FactsUpdaterService } from '../../src/progression/facts-updater.service.js';
import { FactsStore } from '../../src/progression/facts.store.js';
import { ProgressionDevCommand } from '../../src/progression/progression-dev.command.js';
import { W12SeedService } from '../../src/progression/w12-seed.service.js';
import { XpLedgerService } from '../../src/progression/xp-ledger.service.js';
import { XpStore } from '../../src/progression/xp.store.js';

function createStack(nodeEnv: 'development' | 'production' = 'development') {
  const registry = new DevCommandRegistry({ NODE_ENV: nodeEnv } as never);
  const facts = new FactsStore();
  const unlocks = new AchievementUnlockStore();
  const xpStore = new XpStore();
  const factsUpdater = new FactsUpdaterService(facts);
  const evaluator = new AchievementEvaluatorService(unlocks, factsUpdater);
  const xpLedger = new XpLedgerService(xpStore, evaluator);
  factsUpdater.onModuleInit();
  evaluator.onModuleInit();
  xpLedger.onModuleInit();
  const seed = new W12SeedService(facts, unlocks, xpStore);
  const devCmd = new ProgressionDevCommand(registry, factsUpdater, evaluator, xpLedger, seed);
  devCmd.onModuleInit();
  return { registry, facts, unlocks, xpStore, seed, devCmd };
}

describe('W12-31 server dev commands: fact.add, xp.add, profile.reset', () => {
  it('fact.add groundbreaker 100 unlocks Groundbreaker Bronze (+50 XP) and xp.add 5500 reaches level 10', async () => {
    const { registry, unlocks, xpStore } = createStack('development');

    const r1 = (await registry.run('fact.add', {
      playerId: 'pr_dev_test',
      family: 'groundbreaker',
      delta: 100,
    })) as {
      value: number;
      unlocked: Array<{ achievementId: string; xp: number }>;
      xp: number;
    };
    expect(r1.value).toBe(100);
    expect(r1.unlocked).toHaveLength(1);
    expect(r1.unlocked[0]?.achievementId).toBe('groundbreaker');
    expect(r1.xp).toBe(50);

    const r2 = (await registry.run('xp.add', {
      playerId: 'pr_dev_test',
      delta: 5500,
    })) as { xp: number; level: number; leveledUp: boolean };
    expect(r2.xp).toBe(5550);
    expect(r2.level).toBe(10);
    expect(r2.leveledUp).toBe(true);

    await registry.run('profile.reset', { playerId: 'pr_dev_test' });
    expect(await unlocks.getEarned('pr_dev_test')).toHaveLength(0);
    expect((await xpStore.get('pr_dev_test')).xp).toBe(0);
  });

  it('refuses registration in production mode', async () => {
    const { registry } = createStack('production');
    expect(registry.list()).toHaveLength(0);
    await expect(
      registry.run('fact.add', { playerId: 'pr_1', family: 'groundbreaker', delta: 100 }),
    ).rejects.toThrow();
  });
});

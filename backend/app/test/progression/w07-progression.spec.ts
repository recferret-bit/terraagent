import { ACHIEVEMENT_BY_ID } from '@terra/contracts';
import { describe, expect, it } from 'vitest';
import { EventBus } from '../../src/bus/event-bus.js';
import {
  AchievementEvaluatorService,
  type AchievementUnlockedEventV1,
} from '../../src/progression/achievement-evaluator.service.js';
import { AchievementUnlockStore } from '../../src/progression/achievement-unlock.store.js';
import { FactsStore } from '../../src/progression/facts.store.js';
import { FactsUpdaterService, planetEventToProgress } from '../../src/progression/facts-updater.service.js';

describe('W07-27 Progression event rules (planetEventToProgress)', () => {
  const baseEvent = {
    planetId: 'pl_terra',
    tick: 100,
    severity: 'info' as const,
    colonyIds: ['co_alpha'],
  };

  it('maps faunaKilled to exterminator fact with fallback 1 or specified count', () => {
    const single = planetEventToProgress({
      ...baseEvent,
      kind: 'faunaKilled',
      data: { colonyId: 'co_alpha', playerId: 'pr_colonist', entityId: 1, q: 2, r: 3 },
    } as never);
    expect(single).toMatchObject({
      playerId: 'pr_colonist',
      colonyId: 'co_alpha',
      planetId: 'pl_terra',
      family: 'exterminator',
      metric: 'counter',
      value: 1,
    });

    const multi = planetEventToProgress({
      ...baseEvent,
      kind: 'faunaKilled',
      data: { colonyId: 'co_alpha', playerId: 'pr_colonist', entityId: 1, q: 2, r: 3, count: 7 },
    } as never);
    expect(multi?.value).toBe(7);
  });

  it('maps nestDestroyed to nest-breaker fact with fallback 1 or specified count', () => {
    const single = planetEventToProgress({
      ...baseEvent,
      kind: 'nestDestroyed',
      data: { colonyId: 'co_alpha', playerId: 'pr_colonist', hiveId: 10, q: 4, r: 5 },
    } as never);
    expect(single).toMatchObject({
      playerId: 'pr_colonist',
      colonyId: 'co_alpha',
      planetId: 'pl_terra',
      family: 'nest-breaker',
      metric: 'counter',
      value: 1,
    });

    const multi = planetEventToProgress({
      ...baseEvent,
      kind: 'nestDestroyed',
      data: { colonyId: 'co_alpha', playerId: 'pr_colonist', hiveId: 10, q: 4, r: 5, count: 3 },
    } as never);
    expect(multi?.value).toBe(3);
  });

  it('maps raidRepelled with unbreached: true to unbreached fact', () => {
    const unbreached = planetEventToProgress({
      ...baseEvent,
      kind: 'raidRepelled',
      data: { colonyId: 'co_alpha', playerId: 'pr_colonist', unbreached: true },
    } as never);
    expect(unbreached).toMatchObject({
      playerId: 'pr_colonist',
      colonyId: 'co_alpha',
      planetId: 'pl_terra',
      family: 'unbreached',
      metric: 'counter',
      value: 1,
    });

    const multi = planetEventToProgress({
      ...baseEvent,
      kind: 'raidRepelled',
      data: { colonyId: 'co_alpha', playerId: 'pr_colonist', unbreached: true, count: 2 },
    } as never);
    expect(multi?.value).toBe(2);
  });

  it('returns null for raidRepelled when unbreached is false or missing', () => {
    const breached = planetEventToProgress({
      ...baseEvent,
      kind: 'raidRepelled',
      data: { colonyId: 'co_alpha', playerId: 'pr_colonist', unbreached: false },
    } as never);
    expect(breached).toBeNull();

    const missing = planetEventToProgress({
      ...baseEvent,
      kind: 'raidRepelled',
      data: { colonyId: 'co_alpha', playerId: 'pr_colonist' },
    } as never);
    expect(missing).toBeNull();
  });
});

describe('W07-27 FactsUpdaterService with EventBus for W07 combat events', () => {
  it('increments exterminator by 1 on faunaKilled', async () => {
    const store = new FactsStore();
    const bus = new EventBus();
    const updater = new FactsUpdaterService(store, bus);
    updater.onModuleInit();

    bus.emit('planet.event', {
      planetId: 'pl_terra',
      tick: 10,
      kind: 'faunaKilled',
      severity: 'info',
      colonyIds: ['co_1'],
      data: { colonyId: 'co_1', playerId: 'pr_hunter', entityId: 101, q: 1, r: 2 },
    } as never);

    await new Promise((r) => setTimeout(r, 10));
    expect(await store.get('pr_hunter', 'exterminator')).toBe(1);

    bus.emit('planet.event', {
      planetId: 'pl_terra',
      tick: 11,
      kind: 'faunaKilled',
      severity: 'info',
      colonyIds: ['co_1'],
      data: { colonyId: 'co_1', playerId: 'pr_hunter', entityId: 102, q: 1, r: 2, count: 4 },
    } as never);

    await new Promise((r) => setTimeout(r, 10));
    expect(await store.get('pr_hunter', 'exterminator')).toBe(5);

    updater.onModuleDestroy();
  });

  it('increments unbreached on unbreached: true and ignores unbreached: false', async () => {
    const store = new FactsStore();
    const bus = new EventBus();
    const updater = new FactsUpdaterService(store, bus);
    updater.onModuleInit();

    // Breached raid -> does NOT increment
    bus.emit('planet.event', {
      planetId: 'pl_terra',
      tick: 20,
      kind: 'raidRepelled',
      severity: 'info',
      colonyIds: ['co_1'],
      data: { colonyId: 'co_1', playerId: 'pr_defender', unbreached: false },
    } as never);

    await new Promise((r) => setTimeout(r, 10));
    expect(await store.get('pr_defender', 'unbreached')).toBe(0);

    // Unbreached raid -> increments by 1
    bus.emit('planet.event', {
      planetId: 'pl_terra',
      tick: 21,
      kind: 'raidRepelled',
      severity: 'info',
      colonyIds: ['co_1'],
      data: { colonyId: 'co_1', playerId: 'pr_defender', unbreached: true },
    } as never);

    await new Promise((r) => setTimeout(r, 10));
    expect(await store.get('pr_defender', 'unbreached')).toBe(1);

    updater.onModuleDestroy();
  });
});

describe('W07-27 Acceptance: killing a nest increments Nest Breaker when W12 is active', () => {
  it('increments nest-breaker fact and unlocks Nest Breaker badge', async () => {
    const store = new FactsStore();
    const unlocks = new AchievementUnlockStore();
    const bus = new EventBus();
    const updater = new FactsUpdaterService(store, bus);
    const evaluator = new AchievementEvaluatorService(unlocks, updater, bus);

    updater.onModuleInit();
    evaluator.onModuleInit();

    const unlocked: AchievementUnlockedEventV1[] = [];
    bus.on('progression.achievementUnlocked', (ev) => unlocked.push(ev), { module: 'test' });

    const playerId = 'pr_nest_breaker';
    expect(await store.get(playerId, 'nest-breaker')).toBe(0);

    bus.emit('planet.event', {
      planetId: 'pl_terra',
      tick: 30,
      kind: 'nestDestroyed',
      severity: 'info',
      colonyIds: ['co_hive'],
      data: { colonyId: 'co_hive', playerId, hiveId: 42, q: 3, r: 4 },
    } as never);

    await new Promise((r) => setTimeout(r, 20));

    expect(await store.get(playerId, 'nest-breaker')).toBe(1);
    expect(unlocked).toHaveLength(1);
    expect(unlocked[0]?.achievementId).toBe('nest-breaker');
    expect(unlocked[0]?.familyId).toBe('nest-breaker');
    expect(unlocked[0]?.tierName).toBe('Bronze');

    const nestBreakerDef = ACHIEVEMENT_BY_ID.get('nest-breaker')!;
    expect(evaluator.progressOf(nestBreakerDef, await store.getAll(playerId))).toEqual({
      value: 1,
      target: 1,
    });

    evaluator.onModuleDestroy();
    updater.onModuleDestroy();
  });
});

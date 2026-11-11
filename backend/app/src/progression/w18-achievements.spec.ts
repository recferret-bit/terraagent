import { ACHIEVEMENT_BY_ID } from '@terra/contracts';
import { describe, expect, it } from 'vitest';
import type { PlanetEventV1 } from '../bus/channels.js';
import { EventBus } from '../bus/event-bus.js';
import {
  AchievementEvaluatorService,
  type AchievementUnlockedEventV1,
} from './achievement-evaluator.service.js';
import { AchievementUnlockStore } from './achievement-unlock.store.js';
import { FactsStore } from './facts.store.js';
import {
  FactsUpdaterService,
  planetEventToProgress,
  planetEventToProgressEvents,
} from './facts-updater.service.js';

function makeEvent(
  kind: string,
  data: Record<string, unknown>,
  colonyIds: string[] = ['col_0'],
  tick = 10,
): PlanetEventV1 {
  return {
    planetId: 'pl_terra',
    tick,
    kind,
    severity: 'info',
    colonyIds,
    data,
  } as unknown as PlanetEventV1;
}

describe('W18-18 unitDestroyed positive mapping (warlord family)', () => {
  it('maps unitDestroyed with killerColonyId to killer colony and player with fallback value 1', () => {
    const ev = makeEvent('unitDestroyed', {
      colonyId: 'col_victim',
      killerColonyId: 'col_killer',
      entityId: 42,
      q: 1,
      r: 2,
    });
    const resolver = (cid: string) => (cid === 'col_killer' ? 'pr_killer' : 'pr_victim');
    const events = planetEventToProgressEvents(ev, resolver);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      playerId: 'pr_killer',
      colonyId: 'col_killer',
      planetId: 'pl_terra',
      family: 'warlord',
      metric: 'counter',
      value: 1,
    });
    expect(planetEventToProgress(ev, resolver)).toEqual(events[0]);
  });

  it('respects killerPlayerId in data when provided', () => {
    const ev = makeEvent('unitDestroyed', {
      colonyId: 'col_victim',
      killerColonyId: 'col_killer',
      killerPlayerId: 'pr_direct_killer',
      entityId: 10,
      q: 0,
      r: 0,
    });
    const prog = planetEventToProgress(ev);
    expect(prog).toMatchObject({
      playerId: 'pr_direct_killer',
      colonyId: 'col_killer',
      family: 'warlord',
      value: 1,
    });
  });

  it('respects count property for multi-kills (corner case: count = 3)', () => {
    const ev = makeEvent('unitDestroyed', {
      colonyId: 'col_victim',
      killerColonyId: 'col_killer',
      killerPlayerId: 'pr_killer',
      count: 3,
      entityId: 11,
      q: 0,
      r: 0,
    });
    const prog = planetEventToProgress(ev);
    expect(prog?.value).toBe(3);
  });
});

describe('W18-18 unitDestroyed negative cases', () => {
  it('returns empty/null for fauna kills without killerColonyId or with pvp: false', () => {
    const faunaKill = makeEvent('unitDestroyed', {
      colonyId: 'col_victim',
      playerId: 'pr_victim',
      entityId: 1,
      q: 0,
      r: 0,
    });
    expect(planetEventToProgressEvents(faunaKill)).toEqual([]);
    expect(planetEventToProgress(faunaKill)).toBeNull();

    const explicitNonPvp = makeEvent('unitDestroyed', {
      colonyId: 'col_victim',
      killerColonyId: 'col_other',
      pvp: false,
      entityId: 2,
      q: 0,
      r: 0,
    });
    expect(planetEventToProgressEvents(explicitNonPvp)).toEqual([]);
  });

  it('returns empty/null for self-destruction (killerColonyId === colonyId)', () => {
    const selfDestruct = makeEvent('unitDestroyed', {
      colonyId: 'col_same',
      killerColonyId: 'col_same',
      killerPlayerId: 'pr_suicide',
      entityId: 3,
      q: 0,
      r: 0,
    });
    expect(planetEventToProgressEvents(selfDestruct)).toEqual([]);
    expect(planetEventToProgress(selfDestruct)).toBeNull();
  });

  it('returns empty/null when killer player ID cannot be resolved without throwing', () => {
    const ev = makeEvent('unitDestroyed', {
      colonyId: 'col_victim',
      killerColonyId: 'col_unknown',
      entityId: 4,
      q: 0,
      r: 0,
    });
    expect(() => planetEventToProgressEvents(ev, () => undefined)).not.toThrow();
    expect(planetEventToProgressEvents(ev, () => undefined)).toEqual([]);
    expect(planetEventToProgress(ev, () => undefined)).toBeNull();
  });
});

describe('W18-18 truceEnded mapping (diplomat family)', () => {
  it('maps truceEnded with reason: expired to both bilateral colonies with distinct eventIds', () => {
    const ev = makeEvent(
      'truceEnded',
      { truceId: 'tr_peace', reason: 'expired' },
      ['col_a', 'col_b'],
      100,
    );
    const resolver = (cid: string) => (cid === 'col_a' ? 'pr_a' : cid === 'col_b' ? 'pr_b' : undefined);
    const events = planetEventToProgressEvents(ev, resolver);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      playerId: 'pr_a',
      colonyId: 'col_a',
      family: 'diplomat',
      metric: 'counter',
      value: 1,
    });
    expect(events[1]).toMatchObject({
      playerId: 'pr_b',
      colonyId: 'col_b',
      family: 'diplomat',
      metric: 'counter',
      value: 1,
    });
    expect(events[0]?.eventId).not.toBe(events[1]?.eventId);
  });

  it('resolves bilateral parties from data colonyA and colonyB when colonyIds is empty', () => {
    const ev = makeEvent(
      'truceEnded',
      { truceId: 'tr_peace_2', reason: 'expired', colonyA: 'col_1', colonyB: 'col_2' },
      [],
    );
    const resolver = (cid: string) => (cid === 'col_1' ? 'pr_1' : cid === 'col_2' ? 'pr_2' : undefined);
    const events = planetEventToProgressEvents(ev, resolver);
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.playerId).sort()).toEqual(['pr_1', 'pr_2']);
  });

  it('negative: returns empty/null when reason is cancelled or eliminated', () => {
    const cancelled = makeEvent('truceEnded', { truceId: 'tr_c', reason: 'cancelled' }, ['col_a', 'col_b']);
    expect(planetEventToProgressEvents(cancelled)).toEqual([]);
    expect(planetEventToProgress(cancelled)).toBeNull();

    const eliminated = makeEvent('truceEnded', { truceId: 'tr_e', reason: 'eliminated' }, ['col_a', 'col_b']);
    expect(planetEventToProgressEvents(eliminated)).toEqual([]);
    expect(planetEventToProgress(eliminated)).toBeNull();
  });

  it('negative: drops parties whose player ID cannot be resolved without throwing', () => {
    const ev = makeEvent('truceEnded', { truceId: 'tr_half', reason: 'expired' }, ['col_a', 'col_b']);
    const partialResolver = (cid: string) => (cid === 'col_a' ? 'pr_a' : undefined);
    expect(() => planetEventToProgressEvents(ev, partialResolver)).not.toThrow();
    const events = planetEventToProgressEvents(ev, partialResolver);
    expect(events).toHaveLength(1);
    expect(events[0]?.playerId).toBe('pr_a');
  });
});

describe('W18-18 FactsUpdaterService event listener & warlord unlocks', () => {
  it('increments warlord fact on unitDestroyed and unlocks Warlord Tier I at threshold 10', async () => {
    const store = new FactsStore();
    const unlocks = new AchievementUnlockStore();
    const bus = new EventBus();
    const homeRepo = {
      findCachedColonyById: (cid: string) =>
        cid === 'col_warrior' ? { playerId: 'pr_warlord' } : { playerId: 'pr_victim' },
    };
    const updater = new FactsUpdaterService(store, bus, homeRepo as never);
    const evaluator = new AchievementEvaluatorService(unlocks, updater, bus);
    updater.onModuleInit();
    evaluator.onModuleInit();

    const unlocked: AchievementUnlockedEventV1[] = [];
    bus.on('progression.achievementUnlocked', (ev) => unlocked.push(ev), { module: 'test' });

    bus.emit(
      'planet.event',
      makeEvent('unitDestroyed', {
        colonyId: 'col_victim',
        killerColonyId: 'col_warrior',
        entityId: 1,
        count: 9,
      }),
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(await store.get('pr_warlord', 'warlord')).toBe(9);
    expect(unlocked).toHaveLength(0);

    bus.emit(
      'planet.event',
      makeEvent('unitDestroyed', {
        colonyId: 'col_victim',
        killerColonyId: 'col_warrior',
        entityId: 2,
        count: 1,
      }),
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(await store.get('pr_warlord', 'warlord')).toBe(10);
    expect(unlocked).toHaveLength(1);
    expect(unlocked[0]?.achievementId).toBe('warlord');
    expect(unlocked[0]?.tier).toBe(1);
    expect(unlocked[0]?.tierName).toBe('Bronze');

    evaluator.onModuleDestroy();
    updater.onModuleDestroy();
  });
});

describe('W18-18 FactsUpdaterService event listener & diplomat unlocks', () => {
  it('increments diplomat fact for BOTH truce partners and unlocks Diplomat Tier I at threshold 1', async () => {
    const store = new FactsStore();
    const unlocks = new AchievementUnlockStore();
    const bus = new EventBus();
    const homeRepo = {
      findCachedColonyById: (cid: string) =>
        cid === 'col_peace_a' ? { playerId: 'pr_peace_a' } : cid === 'col_peace_b' ? { playerId: 'pr_peace_b' } : undefined,
    };
    const updater = new FactsUpdaterService(store, bus, homeRepo as never);
    const evaluator = new AchievementEvaluatorService(unlocks, updater, bus);
    updater.onModuleInit();
    evaluator.onModuleInit();

    const unlocked: AchievementUnlockedEventV1[] = [];
    bus.on('progression.achievementUnlocked', (ev) => unlocked.push(ev), { module: 'test' });

    bus.emit(
      'planet.event',
      makeEvent(
        'truceEnded',
        { truceId: 'tr_summit', reason: 'expired' },
        ['col_peace_a', 'col_peace_b'],
      ),
    );
    await new Promise((r) => setTimeout(r, 30));

    expect(await store.get('pr_peace_a', 'diplomat')).toBe(1);
    expect(await store.get('pr_peace_b', 'diplomat')).toBe(1);
    expect(unlocked).toHaveLength(2);
    expect(unlocked.map((u) => u.playerId).sort()).toEqual(['pr_peace_a', 'pr_peace_b']);
    for (const u of unlocked) {
      expect(u.achievementId).toBe('diplomat');
      expect(u.tier).toBe(1);
      expect(u.tierName).toBe('Bronze');
    }

    const diplomatDef = ACHIEVEMENT_BY_ID.get('diplomat')!;
    expect(evaluator.progressOf(diplomatDef, await store.getAll('pr_peace_a'))).toEqual({
      value: 1,
      target: 1,
    });

    evaluator.onModuleDestroy();
    updater.onModuleDestroy();
  });
});

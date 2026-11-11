import { describe, expect, it } from 'vitest';
import type { PlanetEventV1 } from '../bus/channels.js';
import { EventBus } from '../bus/event-bus.js';
import { NotifierPort, type Notification, type NotificationResult } from '../ports/notifier.port.js';
import { AlertRouter } from './alert-router.js';
import { MockNotifier } from './mock-notifier.js';
import { InMemoryMockNotifyStore } from './mock-notify.store.js';
import { ColonyPresenceRegistry } from './presence.js';

const DEFENDER = 'co_01ARZ3NDEKTSV4RRFFQ69G5FAV';
const ATTACKER = 'co_01ARZ3NDEKTSV4RRFFQ69G5FBV';
const PROPOSER = 'co_01ARZ3NDEKTSV4RRFFQ69G5FCV';
const PLANET = 'pl_w18_int';

class StoreNotifierPort extends NotifierPort {
  constructor(private readonly inner: MockNotifier) {
    super();
  }
  send(n: Notification): Promise<NotificationResult> {
    return this.inner.send(n);
  }
}

function wireBusHarness() {
  const bus = new EventBus();
  const store = new InMemoryMockNotifyStore();
  const presence = new ColonyPresenceRegistry();
  const mockNotifier = new MockNotifier(store, presence);
  const router = new AlertRouter(new StoreNotifierPort(mockNotifier), bus);
  router.onModuleInit();
  return { bus, store, presence, router };
}

function planetEvent(
  kind: string,
  tick: number,
  colonyIds: readonly string[],
  data: Record<string, unknown>,
): PlanetEventV1 {
  return {
    planetId: PLANET,
    tick,
    kind,
    severity: 'warn',
    colonyIds: [...colonyIds],
    data,
  } as unknown as PlanetEventV1;
}

describe('W18-17 EventBus -> AlertRouter -> MockNotifier -> MockNotifyStore positive flow', () => {
  it('routes raidStarted, colonyCritical, colonyEliminated, and truceOffered from EventBus to MockNotifyStore in order', async () => {
    const { bus, store, presence, router } = wireBusHarness();
    expect(presence.isAway(DEFENDER)).toBe(true);

    bus.emit(
      'planet.event',
      planetEvent('raidStarted', 10, [ATTACKER, DEFENDER], {
        attackerColonyId: ATTACKER,
        targetColonyId: DEFENDER,
        raidId: 'raid_10',
        q: 2,
        r: -1,
      }),
    );
    bus.emit(
      'planet.event',
      planetEvent('colonyCritical', 25, [DEFENDER], {
        colonyId: DEFENDER,
        cause: 'raid',
        atTick: 25,
        deadlineTick: 625,
        timerS: 600,
      }),
    );
    bus.emit(
      'planet.event',
      planetEvent('colonyEliminated', 625, [DEFENDER], {
        colonyId: DEFENDER,
        cause: 'raid',
        atTick: 625,
      }),
    );
    bus.emit(
      'planet.event',
      planetEvent('truceOffered', 700, [PROPOSER, DEFENDER], {
        offerId: 'truce_700',
        fromColonyId: PROPOSER,
        toColonyId: DEFENDER,
        hours: 24,
        offeredAtTick: 700,
        expiresAtTick: 1000,
      }),
    );

    await new Promise((resolve) => setImmediate(resolve));

    const defenderNotes = store.list(DEFENDER);
    expect(defenderNotes.map((n) => n.kind)).toEqual([
      'under_attack',
      'colony_critical',
      'colony_eliminated',
      'truce_offered',
    ]);
    expect(defenderNotes[0]?.data).toMatchObject({
      sourceKind: 'raidStarted',
      planetId: PLANET,
      tick: 10,
      attackerColonyId: ATTACKER,
      targetColonyId: DEFENDER,
      raidId: 'raid_10',
    });
    expect(defenderNotes[1]?.data).toMatchObject({
      sourceKind: 'colonyCritical',
      planetId: PLANET,
      tick: 25,
      cause: 'raid',
      deadlineTick: 625,
      timerS: 600,
    });
    expect(defenderNotes[2]?.data).toMatchObject({
      sourceKind: 'colonyEliminated',
      planetId: PLANET,
      tick: 625,
      cause: 'raid',
    });
    expect(defenderNotes[3]?.data).toMatchObject({
      sourceKind: 'truceOffered',
      planetId: PLANET,
      tick: 700,
      offerId: 'truce_700',
      fromColonyId: PROPOSER,
      toColonyId: DEFENDER,
      durationHours: 24,
      hours: 24,
      expiresAtTick: 1000,
    });

    expect(store.list(ATTACKER)).toHaveLength(0);
    expect(store.list(PROPOSER)).toHaveLength(0);
    router.onModuleDestroy();
  });
});

describe('W18-17 EventBus suppression and fast-run collapse', () => {
  it('suppresses bus events when target colony is connected or unrouted, and collapses fast-run holds', async () => {
    const { bus, store, presence, router } = wireBusHarness();

    presence.connect(DEFENDER);
    bus.emit(
      'planet.event',
      planetEvent('raidStarted', 1, [ATTACKER, DEFENDER], {
        attackerColonyId: ATTACKER,
        targetColonyId: DEFENDER,
        q: 0,
        r: 0,
      }),
    );
    bus.emit(
      'planet.event',
      planetEvent('raidRepelled', 2, [DEFENDER], {
        colonyId: DEFENDER,
        unbreached: true,
        q: 0,
        r: 0,
      }),
    );
    await new Promise((resolve) => setImmediate(resolve));
    expect(store.list(DEFENDER)).toHaveLength(0);

    presence.disconnect(DEFENDER);
    router.beginFastRun(PLANET);
    bus.emit(
      'planet.event',
      planetEvent('raidStarted', 10, [ATTACKER, DEFENDER], {
        attackerColonyId: ATTACKER,
        targetColonyId: DEFENDER,
        q: 1,
        r: 1,
      }),
    );
    bus.emit(
      'planet.event',
      planetEvent('raidStarted', 20, [ATTACKER, DEFENDER], {
        attackerColonyId: ATTACKER,
        targetColonyId: DEFENDER,
        q: 1,
        r: 1,
      }),
    );
    bus.emit(
      'planet.event',
      planetEvent('truceOffered', 30, [PROPOSER, DEFENDER], {
        offerId: 'tr_fast',
        fromColonyId: PROPOSER,
        toColonyId: DEFENDER,
        hours: 6,
      }),
    );
    await new Promise((resolve) => setImmediate(resolve));
    expect(store.list(DEFENDER)).toHaveLength(0);

    const flushed = await router.flushFastRun(PLANET, 5_000);
    expect(flushed).toEqual({ sent: 2 });
    expect(store.list(DEFENDER).map((n) => n.kind)).toEqual(['under_attack', 'truce_offered']);
    router.onModuleDestroy();
  });
});

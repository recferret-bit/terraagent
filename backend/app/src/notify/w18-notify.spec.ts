import {
  NotificationPayloadSchema,
  UNDER_ATTACK_DEBOUNCE_S,
  type NotificationPayload,
} from '@terra/contracts';
import { describe, expect, it } from 'vitest';
import { NotifierPort, type Notification, type NotificationResult } from '../ports/notifier.port.js';
import { alertNotification, colonyTargets, notificationKindOf } from './alert-map.js';
import { AlertRouter } from './alert-router.js';
import { MockNotifier } from './mock-notifier.js';
import { InMemoryMockNotifyStore } from './mock-notify.store.js';
import { ColonyPresenceRegistry } from './presence.js';

const DEFENDER = 'co_01ARZ3NDEKTSV4RRFFQ69G5FAV';
const ATTACKER = 'co_01ARZ3NDEKTSV4RRFFQ69G5FBV';
const PROPOSER = 'co_01ARZ3NDEKTSV4RRFFQ69G5FCV';
const RECIPIENT = 'co_01ARZ3NDEKTSV4RRFFQ69G5FDV';
const WINDOW_MS = UNDER_ATTACK_DEBOUNCE_S * 1000;

class StoreNotifierPort extends NotifierPort {
  constructor(private readonly inner: MockNotifier) {
    super();
  }
  send(n: Notification): Promise<NotificationResult> {
    return this.inner.send(n);
  }
}

function createHarness() {
  const store = new InMemoryMockNotifyStore();
  const presence = new ColonyPresenceRegistry();
  const mockNotifier = new MockNotifier(store, presence);
  const router = new AlertRouter(new StoreNotifierPort(mockNotifier));
  return { store, presence, mockNotifier, router };
}

describe('W18-17 alert-map payload construction', () => {
  it('maps W18 PvP and diplomacy event kinds and builds schema-valid NotificationPayloads', () => {
    expect(notificationKindOf('raidStarted')).toBe('under_attack');
    expect(notificationKindOf('underAttack')).toBe('under_attack');
    expect(notificationKindOf('colonyCritical')).toBe('colony_critical');
    expect(notificationKindOf('colonyEliminated')).toBe('colony_eliminated');
    expect(notificationKindOf('truceOffered')).toBe('truce_offered');

    const raidNote = alertNotification(
      'under_attack',
      DEFENDER,
      {
        kind: 'raidStarted',
        planetId: 'pl_w18',
        tick: 42,
        data: { attackerColonyId: ATTACKER, targetColonyId: DEFENDER, byColony: 'Crimson Host', raidId: 'raid_1' },
      },
      1_000,
    );
    expect(NotificationPayloadSchema.safeParse(raidNote).success).toBe(true);
    expect(raidNote?.body).toContain('Crimson Host');
    expect(raidNote?.data).toMatchObject({
      sourceKind: 'raidStarted',
      planetId: 'pl_w18',
      tick: 42,
      attackerColonyId: ATTACKER,
      targetColonyId: DEFENDER,
      byColony: 'Crimson Host',
      raidId: 'raid_1',
    });

    const critNote = alertNotification(
      'colony_critical',
      DEFENDER,
      {
        kind: 'colonyCritical',
        planetId: 'pl_w18',
        tick: 100,
        data: { cause: 'raid', deadlineTick: 700, timerS: 600, hubEntityId: 19 },
      },
      2_000,
    );
    expect(NotificationPayloadSchema.safeParse(critNote).success).toBe(true);
    expect(critNote?.data).toMatchObject({ cause: 'raid', deadlineTick: 700, timerS: 600, hubEntityId: 19 });

    const elimNote = alertNotification(
      'colony_eliminated',
      DEFENDER,
      {
        kind: 'colonyEliminated',
        planetId: 'pl_w18',
        tick: 700,
        data: { cause: 'raid', killerColonyId: ATTACKER },
      },
      3_000,
    );
    expect(NotificationPayloadSchema.safeParse(elimNote).success).toBe(true);
    expect(elimNote?.data).toMatchObject({ cause: 'raid', killerColonyId: ATTACKER });

    const truceNote = alertNotification(
      'truce_offered',
      RECIPIENT,
      {
        kind: 'truceOffered',
        planetId: 'pl_w18',
        tick: 800,
        data: { offerId: 'tr_9', fromColonyId: PROPOSER, toColonyId: RECIPIENT, hours: 24 },
      },
      4_000,
    );
    expect(NotificationPayloadSchema.safeParse(truceNote).success).toBe(true);
    expect(truceNote?.data).toMatchObject({
      offerId: 'tr_9',
      fromColonyId: PROPOSER,
      toColonyId: RECIPIENT,
      durationHours: 24,
      hours: 24,
    });
  });
});

describe('W18-17 AlertRouter routing and recipient targeting', () => {
  it('records all four W18 notification kinds in MockNotifyStore when target colony is away', async () => {
    const { store, presence, router } = createHarness();
    expect(presence.isAway(DEFENDER)).toBe(true);

    expect(
      await router.route({
        kind: 'raidStarted',
        colonyId: DEFENDER,
        planetId: 'pl_w18',
        tick: 10,
        nowMs: 1_000,
        data: { attackerColonyId: ATTACKER, targetColonyId: DEFENDER },
      }),
    ).toEqual({ sent: 1 });
    expect(
      await router.route({
        kind: 'colonyCritical',
        colonyId: DEFENDER,
        planetId: 'pl_w18',
        tick: 20,
        nowMs: 2_000,
        data: { cause: 'raid', deadlineTick: 620 },
      }),
    ).toEqual({ sent: 1 });
    expect(
      await router.route({
        kind: 'colonyEliminated',
        colonyId: DEFENDER,
        planetId: 'pl_w18',
        tick: 30,
        nowMs: 3_000,
        data: { cause: 'raid', killerColonyId: ATTACKER },
      }),
    ).toEqual({ sent: 1 });
    expect(
      await router.route({
        kind: 'truceOffered',
        colonyId: DEFENDER,
        planetId: 'pl_w18',
        tick: 40,
        nowMs: 4_000,
        data: { offerId: 'of_1', fromColonyId: PROPOSER, toColonyId: DEFENDER, hours: 6 },
      }),
    ).toEqual({ sent: 1 });

    const recorded: NotificationPayload[] = store.list(DEFENDER);
    expect(recorded.map((n) => n.kind)).toEqual([
      'under_attack',
      'colony_critical',
      'colony_eliminated',
      'truce_offered',
    ]);
  });

  it('routes raidStarted only to targetColonyId and truceOffered only to toColonyId', async () => {
    const { store, router } = createHarness();

    expect(
      colonyTargets({
        kind: 'raidStarted',
        colonyIds: [ATTACKER, DEFENDER],
        data: { attackerColonyId: ATTACKER, targetColonyId: DEFENDER },
      }),
    ).toEqual([DEFENDER]);

    expect(
      colonyTargets({
        kind: 'truceOffered',
        colonyIds: [PROPOSER, RECIPIENT],
        data: { fromColonyId: PROPOSER, toColonyId: RECIPIENT, offerId: 'of_1', hours: 24 },
      }),
    ).toEqual([RECIPIENT]);

    await router.route({
      kind: 'raidStarted',
      colonyIds: [ATTACKER, DEFENDER],
      planetId: 'pl_w18',
      tick: 15,
      nowMs: 1_000,
      data: { attackerColonyId: ATTACKER, targetColonyId: DEFENDER },
    });
    expect(store.list(DEFENDER)).toHaveLength(1);
    expect(store.list(ATTACKER)).toHaveLength(0);

    await router.route({
      kind: 'truceOffered',
      colonyIds: [PROPOSER, RECIPIENT],
      planetId: 'pl_w18',
      tick: 16,
      nowMs: 2_000,
      data: { offerId: 'of_2', fromColonyId: PROPOSER, toColonyId: RECIPIENT, durationHours: 24 },
    });
    expect(store.list(RECIPIENT)).toHaveLength(1);
    expect(store.list(PROPOSER)).toHaveLength(0);
  });
});

describe('W18-17 suppression and debounce rules', () => {
  it('suppresses notifications when colony is online, toggle is off, or event/colony is invalid', async () => {
    const { store, presence, router } = createHarness();

    presence.setAway(DEFENDER, false);
    expect(presence.isAway(DEFENDER)).toBe(false);
    expect(
      await router.route({
        kind: 'raidStarted',
        colonyId: DEFENDER,
        planetId: 'pl_w18',
        tick: 1,
        nowMs: 1_000,
      }),
    ).toEqual({ sent: 0 });
    expect(store.list(DEFENDER)).toHaveLength(0);

    presence.setAway(DEFENDER, true);
    router.setKind(DEFENDER, 'truce_offered', false);
    expect(
      await router.route({
        kind: 'truceOffered',
        colonyId: DEFENDER,
        planetId: 'pl_w18',
        tick: 2,
        nowMs: 2_000,
        data: { offerId: 'of_3', fromColonyId: PROPOSER, toColonyId: DEFENDER, hours: 6 },
      }),
    ).toEqual({ sent: 0 });
    expect(store.list(DEFENDER)).toHaveLength(0);

    expect(await router.route({ kind: 'truceSigned', colonyId: DEFENDER, nowMs: 3_000 })).toEqual({ sent: 0 });
    expect(await router.route({ kind: 'raidRepelled', colonyId: DEFENDER, nowMs: 3_000 })).toEqual({ sent: 0 });
    expect(await router.route({ kind: 'raidStarted', colonyId: 'nope', nowMs: 3_000 })).toEqual({ sent: 0 });
    expect(await router.route({ kind: 'raidStarted', colonyIds: [0], nowMs: 3_000 })).toEqual({ sent: 0 });
    expect(store.rows).toHaveLength(0);
  });

  it('debounces repeated raidStarted within the window while allowing colonyCritical and colonyEliminated immediately', async () => {
    const { store, router } = createHarness();

    expect(await router.route({ kind: 'raidStarted', colonyId: DEFENDER, tick: 1, nowMs: 1_000 })).toEqual({ sent: 1 });
    expect(await router.route({ kind: 'raidStarted', colonyId: DEFENDER, tick: 2, nowMs: 60_000 })).toEqual({
      sent: 0,
    });
    expect(await router.route({ kind: 'colonyCritical', colonyId: DEFENDER, tick: 3, nowMs: 61_000 })).toEqual({
      sent: 1,
    });
    expect(await router.route({ kind: 'colonyEliminated', colonyId: DEFENDER, tick: 4, nowMs: 62_000 })).toEqual({
      sent: 1,
    });
    expect(
      await router.route({ kind: 'raidStarted', colonyId: DEFENDER, tick: 5, nowMs: 1_000 + WINDOW_MS }),
    ).toEqual({ sent: 1 });

    expect(store.list(DEFENDER).map((n) => n.kind)).toEqual([
      'under_attack',
      'colony_critical',
      'colony_eliminated',
      'under_attack',
    ]);
  });
});

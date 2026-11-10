import {
  UNDER_ATTACK_DEBOUNCE_S,
  type AutoTradeLimit,
  type AutoTradeOrder,
  type NotificationPayload,
} from '@terra/contracts';
import { describe, expect, it } from 'vitest';
import { EventBus } from '../../src/bus/event-bus';
import type { PlanetEventV1 } from '../../src/bus/channels';
import { FlagsService } from '../../src/flags/flags.service';
import { AlertRouter, type AlertRouteInput } from '../../src/notify/alert-router';
import { MockNotifier } from '../../src/notify/mock-notifier';
import type { MockNotifyPut, MockNotifyRow, MockNotifyStore } from '../../src/notify/mock-notify.store';
import { MemoryPresence } from '../../src/notify/presence';
import { NotifierPort, type Notification, type NotificationResult } from '../../src/ports/notifier.port';

const COLONY = 'co_01ARZ3NDEKTSV4RRFFQ69G5FAV';
const OTHER = 'co_01ARZ3NDEKTSV4RRFFQ69G5FBV';
const WINDOW_MS = UNDER_ATTACK_DEBOUNCE_S * 1000;

const LIMIT: AutoTradeLimit = { maxPerTrade: 100, maxPerSession: 200, minStock: 10, partners: 'anyone' };
const ORDER: AutoTradeOrder = { resource: 'metals.t1', give: 50, stock: 100, sessionSpent: 0, partner: 'anyone' };

class RecordingNotifier extends NotifierPort {
  readonly sent: Notification[] = [];
  send(n: Notification): Promise<NotificationResult> {
    this.sent.push(n);
    return Promise.resolve({ id: String(this.sent.length), status: 'sent' });
  }
}

class MemoryStore implements MockNotifyStore {
  readonly rows: MockNotifyRow[] = [];
  async put(payload: NotificationPayload): Promise<MockNotifyPut> {
    const hit = this.rows.find(
      (r) => r.colonyId === payload.colonyId && r.eventId === payload.eventId && r.channel === payload.channel,
    );
    if (hit) return { row: hit, inserted: false };
    const row = {
      id: String(this.rows.length + 1),
      colonyId: payload.colonyId,
      eventId: payload.eventId,
      channel: payload.channel,
    };
    this.rows.push(row);
    return { row, inserted: true };
  }
}

class StorePort extends NotifierPort {
  constructor(private readonly inner: MockNotifier) {
    super();
  }
  send(n: Notification): Promise<NotificationResult> {
    return this.inner.send(n);
  }
}

function attack(router: AlertRouter, at: number, colonyId = COLONY, kind = 'underAttack'): Promise<{ sent: number }> {
  return router.route({ colonyId, kind, nowMs: at, eventId: `${kind}-${colonyId}-${at}` });
}

function trade(router: AlertRouter, over: Partial<AlertRouteInput> = {}): Promise<{ sent: number }> {
  return router.route({
    colonyId: COLONY,
    kind: 'trade_offer',
    withinAutoTrade: false,
    eventId: 'offer',
    nowMs: 0,
    ...over,
  });
}

describe('under_attack debounce', () => {
  it('sends one notification for three attacks in five minutes', async () => {
    const port = new RecordingNotifier();
    const router = new AlertRouter(port);
    for (const at of [0, 60_000, 5 * 60_000]) await attack(router, at);
    expect(port.sent).toHaveLength(1);
    expect(port.sent[0]).toMatchObject({
      colonyId: COLONY,
      kind: 'under_attack',
      channel: 'webpush',
      to: COLONY,
      deepLink: `/c/${COLONY}`,
      eventId: `underAttack-${COLONY}-0`,
    });
  });

  it('sends again at exactly ten minutes after the previous attack', async () => {
    const port = new RecordingNotifier();
    const router = new AlertRouter(port);
    await attack(router, 0);
    await attack(router, WINDOW_MS);
    expect(port.sent.map((n) => n.eventId)).toEqual([`underAttack-${COLONY}-0`, `underAttack-${COLONY}-${WINDOW_MS}`]);
  });

  it('does not send one second before the ten minute mark', async () => {
    const port = new RecordingNotifier();
    const router = new AlertRouter(port);
    await attack(router, 0);
    expect(await attack(router, WINDOW_MS - 1000)).toEqual({ sent: 0 });
    expect(port.sent).toHaveLength(1);
  });

  it('does not let a suppressed attack push the window out', async () => {
    const port = new RecordingNotifier();
    const router = new AlertRouter(port);
    await attack(router, 0);
    await attack(router, WINDOW_MS - 1000);
    await attack(router, WINDOW_MS);
    expect(port.sent).toHaveLength(2);
  });

  it('keeps a separate window per colony and shares it across raidStarted', async () => {
    const port = new RecordingNotifier();
    const router = new AlertRouter(port);
    await attack(router, 0, COLONY, 'raidStarted');
    await attack(router, 1_000, COLONY, 'underAttack');
    await attack(router, 1_000, OTHER, 'underAttack');
    expect(port.sent.map((n) => [n.colonyId, n.kind])).toEqual([
      [COLONY, 'under_attack'],
      [OTHER, 'under_attack'],
    ]);
  });
});

describe('per-kind toggles and trade_offer', () => {
  it('sends no trade_offer when that kind is off', async () => {
    const port = new RecordingNotifier();
    const router = new AlertRouter(port);
    router.setKind(COLONY, 'trade_offer', false);
    expect(await trade(router)).toEqual({ sent: 0 });
    expect(await attack(router, 0)).toEqual({ sent: 1 });
    expect(port.sent.map((n) => n.kind)).toEqual(['under_attack']);
  });

  it('sends trade_offer only when withinAutoTrade is false', async () => {
    const port = new RecordingNotifier();
    const router = new AlertRouter(port);
    expect(await trade(router, { withinAutoTrade: true, eventId: 'in' })).toEqual({ sent: 0 });
    expect(await trade(router, { withinAutoTrade: undefined, eventId: 'missing' })).toEqual({ sent: 0 });
    expect(await trade(router, { eventId: 'out' })).toEqual({ sent: 1 });
    expect(port.sent.map((n) => n.kind)).toEqual(['trade_offer']);
  });

  it('uses withinAutoTrade(limit, order) when an order is passed', async () => {
    const port = new RecordingNotifier();
    const router = new AlertRouter(port);
    expect(await trade(router, { limit: LIMIT, order: ORDER, withinAutoTrade: undefined, eventId: 'inside' })).toEqual({
      sent: 0,
    });
    const outside = { ...ORDER, give: 150 };
    expect(await trade(router, { limit: LIMIT, order: outside, withinAutoTrade: true, eventId: 'outside' })).toEqual({
      sent: 1,
    });
  });

  it('writes one mock row for three attacks and none when trade_offer is off', async () => {
    const store = new MemoryStore();
    const router = new AlertRouter(new StorePort(new MockNotifier(store, new MemoryPresence())));
    for (const at of [0, 60_000, 5 * 60_000]) await attack(router, at);
    router.setKind(COLONY, 'trade_offer', false);
    await trade(router, { eventId: 'offer-1' });
    expect(store.rows.map((r) => r.eventId)).toEqual([`underAttack-${COLONY}-0`]);
  });
});

describe('kind map', () => {
  const routed = [
    ['underAttack', 'under_attack'],
    ['raidStarted', 'under_attack'],
    ['colonyCritical', 'colony_critical'],
    ['colonyEliminated', 'colony_eliminated'],
    ['energyCollapse', 'energy_collapse'],
    ['rocketReady', 'rocket_ready'],
    ['rocket_ready', 'rocket_ready'],
    ['truceOffered', 'truce_offered'],
    ['truce_offered', 'truce_offered'],
    ['awayBudgetExhausted', 'away_budget_exhausted'],
  ] as const;

  it('maps each routed name onto one of the eight kinds', async () => {
    for (const [source, kind] of routed) {
      const port = new RecordingNotifier();
      await new AlertRouter(port).route({
        colonyId: COLONY,
        kind: source,
        withinAutoTrade: false,
        nowMs: 0,
        eventId: source,
      });
      expect(port.sent.map((n) => n.kind)).toEqual([kind]);
    }
  });

  it('ignores a kind that is not one of the eight, and a colony id that is not addressable', async () => {
    const port = new RecordingNotifier();
    const router = new AlertRouter(port);
    expect(await router.route({ colonyId: COLONY, kind: 'brownout', nowMs: 0 })).toEqual({ sent: 0 });
    expect(await router.route({ colonyId: COLONY, kind: 'not-a-kind', nowMs: 0 })).toEqual({ sent: 0 });
    expect(await router.route({ colonyId: 'nope', kind: 'energyCollapse', nowMs: 0 })).toEqual({ sent: 0 });
    expect(await router.route({ kind: 'energyCollapse', colonyIds: [0], nowMs: 0 })).toEqual({ sent: 0 });
    router.setKind(COLONY, 'not-a-kind', false);
    expect(port.sent).toHaveLength(0);
  });

  it('routes underAttack from the bus and ignores brownout', async () => {
    const port = new RecordingNotifier();
    const bus = new EventBus();
    const router = new AlertRouter(port, bus);
    router.onModuleInit();
    bus.emit('planet.event', planet('brownout', 4, { group: 1, colonyId: COLONY }));
    bus.emit('planet.event', planet('underAttack', 5, { colonyId: COLONY, q: 1, r: 2 }));
    await new Promise((resolve) => setImmediate(resolve));
    expect(port.sent.map((n) => n.kind)).toEqual(['under_attack']);
    expect(port.sent[0]?.eventId).toBe(`underAttack:pl_dev:5`);
    router.onModuleDestroy();
  });

  it('notifies a spent director allowance as away_budget_exhausted only while W09 is on', async () => {
    const data = {
      colonyId: COLONY,
      resource: 'metals.t1',
      spent: 300,
      allowance: 300,
      reason: 'allowance_exhausted' as const,
    };
    const on = new RecordingNotifier();
    const flags = new FlagsService({ TA_WAVES: 'all' } as never);
    expect(
      await new AlertRouter(on, undefined, flags).route({
        colonyId: COLONY,
        kind: 'directorAllowanceExhausted',
        data,
        nowMs: 0,
        eventId: 'spent',
      }),
    ).toEqual({ sent: 1 });
    expect(on.sent[0]).toMatchObject({ kind: 'away_budget_exhausted', colonyId: COLONY });

    const off = new RecordingNotifier();
    expect(
      await new AlertRouter(off, undefined, new FlagsService({ TA_WAVES: '..08' } as never)).route({
        colonyId: COLONY,
        kind: 'directorAllowanceExhausted',
        data,
        nowMs: 0,
        eventId: 'off',
      }),
    ).toEqual({ sent: 0 });
    const revoked = new RecordingNotifier();
    expect(
      await new AlertRouter(revoked, undefined, flags).route({
        colonyId: COLONY,
        kind: 'directorAllowanceExhausted',
        data: { ...data, reason: 'director_key_revoked' },
        nowMs: 0,
        eventId: 'revoked',
      }),
    ).toEqual({ sent: 0 });
    expect(off.sent).toHaveLength(0);
    expect(revoked.sent).toHaveLength(0);
  });
});

function planet(kind: 'brownout' | 'underAttack', tick: number, data: Record<string, unknown>): PlanetEventV1 {
  return { planetId: 'pl_dev', tick, kind, severity: 'warn', colonyIds: [COLONY], data } as unknown as PlanetEventV1;
}

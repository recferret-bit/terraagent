import { describe, expect, it } from 'vitest';
import { EventBus } from '../../src/bus/event-bus';
import type { PlanetEventV1 } from '../../src/bus/channels';
import { GamePlanets } from '../../src/game/game-planets.service';
import { installFastRunAlertHold, type FastRunAlertSource } from '../../src/game/restart/notify-hold';
import type { FromThread } from '../../src/game/thread/protocol';
import type { SimThreadPool } from '../../src/game/sim-thread-pool';
import { AlertRouter } from '../../src/notify/alert-router';
import { NotifierPort, type Notification, type NotificationResult } from '../../src/ports/notifier.port';

const COLONY = 'co_01ARZ3NDEKTSV4RRFFQ69G5FAV';
const PLANET = 'pl_fast';
const HOUR = 3_600_000;

class RecordingNotifier extends NotifierPort {
  readonly sent: Notification[] = [];
  send(n: Notification): Promise<NotificationResult> {
    this.sent.push(n);
    return Promise.resolve({ id: String(this.sent.length), status: 'sent' });
  }
}

function router(): { router: AlertRouter; port: RecordingNotifier } {
  const port = new RecordingNotifier();
  return { router: new AlertRouter(port), port };
}

function attack(alerts: AlertRouter, at: number, planetId = PLANET): Promise<{ sent: number }> {
  return alerts.route({
    colonyId: COLONY,
    kind: 'underAttack',
    nowMs: at,
    eventId: `underAttack-${at}`,
    planetId,
  });
}

describe('fast-run notification hold', () => {
  it('sends one under_attack after five attacks whose ticks span hours, and none during the run', async () => {
    const { router: alerts, port } = router();
    alerts.beginFastRun(PLANET);
    for (let i = 0; i < 5; i++) expect(await attack(alerts, i * HOUR)).toEqual({ sent: 0 });
    expect(port.sent).toHaveLength(0);
    expect(await alerts.flushFastRun(PLANET, 0)).toEqual({ sent: 1 });
    expect(port.sent.map((n) => n.eventId)).toEqual(['underAttack-0']);
    expect(port.sent[0]).toMatchObject({ colonyId: COLONY, kind: 'under_attack' });
  });

  it('still debounces five attacks to one send immediately when no fast-run is marked', async () => {
    const { router: alerts, port } = router();
    for (const at of [0, 60_000, 120_000, 180_000, 240_000]) await attack(alerts, at);
    expect(port.sent).toHaveLength(1);
    expect(port.sent[0]?.eventId).toBe('underAttack-0');
  });

  it('sends nothing when the buffer is empty', async () => {
    const { router: alerts, port } = router();
    alerts.beginFastRun(PLANET);
    expect(await alerts.flushFastRun(PLANET, 0)).toEqual({ sent: 0 });
    expect(port.sent).toHaveLength(0);
  });

  it('sends one colony_critical and one under_attack after the run', async () => {
    const { router: alerts, port } = router();
    alerts.beginFastRun(PLANET);
    await alerts.route({ colonyId: COLONY, kind: 'colonyCritical', planetId: PLANET, eventId: 'crit', nowMs: 0 });
    for (let i = 0; i < 5; i++) await attack(alerts, i * HOUR);
    expect(port.sent).toHaveLength(0);
    expect(await alerts.flushFastRun(PLANET, 0)).toEqual({ sent: 2 });
    expect(port.sent.map((n) => n.kind).sort()).toEqual(['colony_critical', 'under_attack']);
  });

  it('drops a stopped run and does not delay the next live attack', async () => {
    const { router: alerts, port } = router();
    alerts.beginFastRun(PLANET);
    await attack(alerts, 0);
    alerts.dropFastRun(PLANET);
    expect(await alerts.flushFastRun(PLANET, 0)).toEqual({ sent: 0 });
    expect(await attack(alerts, 0)).toEqual({ sent: 1 });
    expect(port.sent).toHaveLength(1);
  });

  it('holds five bus underAttack events until flush', async () => {
    const port = new RecordingNotifier();
    const bus = new EventBus();
    const alerts = new AlertRouter(port, bus);
    alerts.onModuleInit();
    alerts.beginFastRun(PLANET);
    for (let tick = 1; tick <= 5; tick++) bus.emit('planet.event', underAttack(tick));
    await new Promise((resolve) => setImmediate(resolve));
    expect(port.sent).toHaveLength(0);
    expect(await alerts.flushFastRun(PLANET, 0)).toEqual({ sent: 1 });
    expect(port.sent.map((n) => n.kind)).toEqual(['under_attack']);
    alerts.onModuleDestroy();
  });
});

describe('fast-run alert wiring', () => {
  it('flushes when the run finishes and does not mark a gap of 0', async () => {
    const { router: alerts, port } = router();
    const source = fakeSource();
    installFastRunAlertHold(source.api, alerts);
    source.start(PLANET);
    await attack(alerts, 0);
    expect(port.sent).toHaveLength(0);
    source.finish(PLANET, 0.2, 5);
    await new Promise((resolve) => setImmediate(resolve));
    expect(port.sent).toHaveLength(1);

    const gap = listenPlanets();
    const started: string[] = [];
    gap.planets.onFastRunStart((id) => started.push(id));
    const pending = gap.planets.load('pl_gap', { catchUpTicks: 0 });
    expect(started).toEqual([]);
    gap.emit({ t: 'loaded', planetId: 'pl_gap', tick: 1 });
    await pending;
  });
});

function underAttack(tick: number): PlanetEventV1 {
  return {
    planetId: PLANET,
    tick,
    kind: 'underAttack',
    severity: 'warn',
    colonyIds: [COLONY],
    data: { colonyId: COLONY, q: 1, r: 2 },
  } as unknown as PlanetEventV1;
}

function fakeSource(): { api: FastRunAlertSource; start: (id: string) => void; finish: (id: string, seconds: number, ticks: number) => void } {
  let onStart: (planetId: string) => void = () => undefined;
  let onFinish: (planetId: string, seconds: number, ticks: number) => void = () => undefined;
  const api: FastRunAlertSource = {
    onFastRunStart(fn) { onStart = fn; },
    onFastRun(fn) { onFinish = fn; },
    onFastRunAbort() { /* unused */ },
  };
  return { api, start: (id) => onStart(id), finish: (id, seconds, ticks) => onFinish(id, seconds, ticks) };
}

function listenPlanets(): { planets: GamePlanets; emit: (msg: FromThread) => void } {
  let onMsg: ((thread: number, msg: FromThread) => void) | undefined;
  const pool = {
    listen(fn: (thread: number, msg: FromThread) => void) {
      onMsg = fn;
      return () => undefined;
    },
    sendToPlanet() { return true; },
    threadOf() { return 0; },
    shutdown: async () => undefined,
  } as unknown as SimThreadPool;
  return { planets: new GamePlanets(pool), emit: (msg) => onMsg?.(0, msg) };
}

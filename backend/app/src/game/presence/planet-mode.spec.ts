import { COARSE_DT, PlanetScheduler } from '@terra/sim';
import { Registry } from 'prom-client';
import { describe, expect, it } from 'vitest';
import { installPlanetModeGauge } from '../planet-mode-metric';
import { PlanetHost } from '../thread/planet-host';
import { ManualPresenceClock } from './clock';
import { presenceClosed, presenceJoined, type PlanetModePort } from './planet-mode';
import { PresenceTracker } from './tracker';

/**
 * Presence crossings drive `ctl mode` into the host, which calls the scheduler.
 * One manual clock: no wall-clock sleep. The away timer (60s) is armed on close and must not fire here.
 */
function harness() {
  const clock = new ManualPresenceClock();
  const tracker = new PresenceTracker({
    clock,
    commands: { submit: async () => ({ ok: true }) },
    lastSeen: { touch: async (input) => ({ colonyIndex: input.colonyIndex }) },
  });
  const steps: { id: string; dt: number }[] = [];
  const sched = new PlanetScheduler({
    now: () => clock.now(),
    schedule: (fn, delayMs) => clock.delay(delayMs, fn),
    step: (id, dt) => steps.push({ id, dt }),
  });
  const host = new PlanetHost(0, [], () => undefined, {
    info: (id) => sched.info(id),
    setMode: (id, mode) => sched.setMode(id, mode),
    get maxLag() { return sched.maxLag; },
    recentPasses: () => [],
  });
  const modes: PlanetModePort = {
    setMode: (planetId, mode) => host.handle({ t: 'ctl', op: 'mode', planetId, mode }),
  };
  const join = (socketId: string, planetId = 'pl') => {
    const session = { socketId, planetId, colonyId: `${planetId}:${socketId}`, playerId: 'pr' };
    presenceJoined(tracker, modes, socketId, planetId, () => tracker.join(session));
  };
  const close = (socketId: string) => presenceClosed(tracker, modes, socketId, () => tracker.close(socketId));
  /** Add, start, and take the due-now step so the next due sits one active interval ahead. */
  const prime = (...ids: string[]) => {
    for (const id of ids.length > 0 ? ids : ['pl']) sched.add(id);
    sched.start();
    clock.advance(0);
    steps.length = 0;
  };
  return { clock, sched, steps, join, close, prime, now: () => clock.now(), advance: (ms: number) => clock.advance(ms) };
}

describe('planet step mode follows sockets (CT-14)', () => {
  it('last close switches to coarse and the next step uses dt 5, then one step per second', () => {
    const h = harness();
    h.prime();
    h.join('a');
    h.close('a');
    expect(h.sched.info('pl')?.mode).toBe('coarse');
    const due = h.sched.info('pl')!.nextDueMs;
    h.advance(due - h.now());
    expect(h.steps).toEqual([{ id: 'pl', dt: COARSE_DT }]);
    expect(COARSE_DT).toBe(5);
    h.steps.length = 0;
    h.advance(3000);
    expect(h.steps).toEqual([
      { id: 'pl', dt: COARSE_DT },
      { id: 'pl', dt: COARSE_DT },
      { id: 'pl', dt: COARSE_DT },
    ]);
  });

  it('one of two sockets closing stays active at dt 1', () => {
    const h = harness();
    h.prime();
    h.join('a');
    h.join('b');
    h.close('a');
    expect(h.sched.info('pl')?.mode).toBe('active');
    expect(h.steps).toEqual([]);
    h.advance(1000);
    expect(h.steps).toEqual([
      { id: 'pl', dt: 1 },
      { id: 'pl', dt: 1 },
      { id: 'pl', dt: 1 },
      { id: 'pl', dt: 1 },
      { id: 'pl', dt: 1 },
    ]);
  });

  it('a join while already active does not move the due time or burst steps', () => {
    const h = harness();
    h.prime();
    h.join('a');
    const due = h.sched.info('pl')!.nextDueMs;
    h.join('b');
    expect(h.sched.info('pl')?.mode).toBe('active');
    expect(h.sched.info('pl')?.nextDueMs).toBe(due);
    h.advance(due - h.now() - 1);
    expect(h.steps).toEqual([]);
    h.advance(1);
    expect(h.steps).toEqual([{ id: 'pl', dt: 1 }]);
  });

  it('the first socket on an empty planet is active before the next step, which uses dt 1', () => {
    const h = harness();
    h.prime();
    h.join('a');
    h.close('a');
    const coarseDue = h.sched.info('pl')!.nextDueMs;
    h.advance(coarseDue - h.now());
    expect(h.steps).toEqual([{ id: 'pl', dt: COARSE_DT }]);
    h.steps.length = 0;
    const due = h.sched.info('pl')!.nextDueMs;
    expect(due - h.now()).toBeGreaterThan(0);
    h.join('b');
    expect(h.sched.info('pl')?.mode).toBe('active');
    expect(h.sched.info('pl')?.nextDueMs).toBe(due);
    expect(h.steps).toEqual([]);
    h.advance(due - h.now());
    expect(h.steps).toEqual([{ id: 'pl', dt: 1 }]);
  });

  it('moving the last socket makes the planet it left coarse before that planet steps again', () => {
    const h = harness();
    h.prime('left', 'right');
    h.join('s', 'left');
    h.join('s', 'right');
    expect(h.sched.info('left')?.mode).toBe('coarse');
    expect(h.sched.info('right')?.mode).toBe('active');
    const due = h.sched.info('left')!.nextDueMs;
    h.advance(due - h.now());
    expect(h.steps.filter((s) => s.id === 'left')).toEqual([{ id: 'left', dt: COARSE_DT }]);
    expect(h.steps.filter((s) => s.id === 'right').every((s) => s.dt === 1)).toBe(true);
  });
});

describe('ta_game_planet_mode', () => {
  it('counts active and coarse from planet stats', async () => {
    const reg = new Registry();
    const threads = [{ planets: [{ mode: 'active' as const }, { mode: 'coarse' as const }, { mode: 'coarse' as const }] }];
    installPlanetModeGauge(reg, async () => threads);
    const text = await reg.metrics();
    expect(text).toContain('ta_game_planet_mode{mode="active"} 1');
    expect(text).toContain('ta_game_planet_mode{mode="coarse"} 2');
  });
});

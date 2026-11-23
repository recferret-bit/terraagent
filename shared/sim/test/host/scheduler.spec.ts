import { COARSE_DT, TICK_MS } from '../../src/kernel/constants';
import { describe, expect, it } from 'vitest';
import { COARSE_STEP_MS, MAX_CATCHUP, MAX_DEBT_SLOTS, PlanetScheduler, SINGLE_PLANET_SCHEDULE } from '../../src/host/scheduler';

/** Fake clock + timer: `advance(ms)` jumps time, firing due timers in order; `jump(ms)` models a blocked thread. */
function rig() {
  let now = 0;
  let timer: { at: number; fn: () => void } | undefined;
  const steps: { id: string; dt: number }[] = [];
  const s = new PlanetScheduler({
    now: () => now,
    schedule: (fn, delay) => { const t = { at: now + delay, fn }; timer = t; return () => { if (timer === t) timer = undefined; }; },
    step: (id, dt) => { steps.push({ id, dt }); },
  });
  const advance = (ms: number) => {
    const end = now + ms;
    for (;;) {
      if (!timer || timer.at > end) break;
      const t = timer;
      timer = undefined;
      now = Math.max(now, t.at);
      t.fn();
      if (t.at === now && !timer) break;
    }
    now = end;
  };
  const jump = (ms: number) => { now += ms; };
  return { s, steps, advance, jump, get now() { return now; } };
}

/**
 * Fake clock where every engine step of a planet costs `cost[id]` ms of thread time (a step blocks the thread), and the
 * timer fires as soon as it is due (a yield is free). `log` keeps, per step, when it started and which slot it served.
 */
function costRig(cost: Record<string, number>, opts: { demoteAfterSlowSteps?: number } = {}) {
  let now = 0;
  let timer: { at: number; fn: () => void } | undefined;
  const log: { id: string; dt: number; startMs: number; dueMs: number }[] = [];
  const s: PlanetScheduler = new PlanetScheduler({
    now: () => now,
    schedule: (fn, delay) => { const t = { at: now + delay, fn }; timer = t; return () => { if (timer === t) timer = undefined; }; },
    step: (id, dt) => { log.push({ id, dt, startMs: now, dueMs: s.info(id)!.nextDueMs }); now += cost[id] ?? 0; },
    ...opts,
  });
  const runUntil = (end: number) => {
    while (timer && timer.at <= end) {
      const t = timer;
      timer = undefined;
      now = Math.max(now, t.at);
      t.fn();
    }
    now = Math.max(now, end);
  };
  return { s, log, runUntil, get now() { return now; } };
}

/** Runs turns until nothing is due (what the timer loop does between two due times). */
const drain = (s: PlanetScheduler) => { for (let i = 0; i < 200 && s.runPass().steps > 0;) i++; };

describe('PlanetScheduler', () => {
  it('5 TPS gives 5 steps per simulated second', () => {
    const r = rig();
    r.s.add('a');
    r.s.start();
    r.advance(1000 - 1);
    expect(r.steps.length).toBe(5);
    expect(r.steps.every((x) => x.dt === 1)).toBe(true);
  });

  it('does not drift over 10 000 simulated seconds, even with late timers', () => {
    const r = rig();
    r.s.add('a');
    r.s.start();
    // late-firing timer: advance in 7 ms chunks so turns run up to 6 ms late
    const end = 10_000_000 - 1; // first step is due at t=0, so [0, 10 000 s) holds exactly 50 000 slots
    let t = 0;
    for (; t + 7 <= end; t += 7) r.advance(7);
    r.advance(end - t);
    expect(r.steps.length).toBe(10_000 * 5);
  });

  it('after a 2 s block steps one slot per planet per turn, lag rises then falls to 0', () => {
    const r = rig();
    r.s.add('a');
    r.s.add('b');
    r.s.start();
    r.advance(1000);
    r.jump(2000);
    const lag: number[] = [];
    const per: number[] = [];
    for (let i = 0; i < 14; i++) {
      const before = r.steps.length;
      const rep = r.s.runPass();
      per.push(r.steps.length - before);
      lag.push(rep.maxLag);
      expect(rep.maxPlanetSteps).toBeLessThanOrEqual(MAX_CATCHUP);
    }
    expect(lag[0]).toBeGreaterThanOrEqual(5);
    expect(lag[0]).toBeGreaterThan(lag[1]!);
    expect(lag.at(-1)).toBe(0);
    expect(Math.max(...per)).toBeLessThanOrEqual(2); // one slot each for two planets
  });

  it('coarse mode steps dt=COARSE_DT once per second', () => {
    const r = rig();
    r.s.add('a');
    r.s.setMode('a', 'coarse');
    r.s.start();
    r.advance(3000);
    expect(r.steps.length).toBe(4); // due at 0, 1000, 2000, 3000
    expect(r.steps.every((x) => x.dt === COARSE_DT)).toBe(true);
    expect(COARSE_STEP_MS).toBe(1000);
    expect(r.s.info('a')?.mode).toBe('coarse');
  });

  it('warp x10 gives 50 ticks per second', () => {
    const r = rig();
    r.s.add('a');
    r.s.setWarp('a', 10);
    r.s.start();
    r.advance(1000 - 1);
    expect(r.steps.length).toBe(50);
    r.s.setWarp('a', 1000);
    expect(r.s.info('a')?.warp).toBe(100);
    expect(TICK_MS).toBe(200);
  });

  it('warp x1 restores 5 ticks per second and reports the change', () => {
    const r = rig();
    const seen: number[] = [];
    r.s.onWarp = (_id, k) => seen.push(k);
    r.s.add('a');
    r.s.start();
    r.s.setWarp('a', 10);
    r.advance(1000 - 1);
    expect(r.steps.length).toBe(50);
    r.steps.length = 0;
    r.s.setWarp('a', 1);
    r.advance(1000);
    expect(r.steps.length).toBe(5);
    expect(seen).toEqual([10, 1]);
  });

  it('reports every slot through onStep before the next planet steps', () => {
    const r = rig();
    const order: string[] = [];
    r.s.onStep = (id, rep) => { order.push(`${id}:${rep.steps}`); expect(r.steps.at(-1)?.id).toBe(id); };
    r.s.add('a');
    r.s.add('b');
    r.s.runPass();
    expect(order.sort()).toEqual(['a:1', 'b:1']);
  });
});

describe('fairness: a slow planet never stalls a fast one', () => {
  const SLOW = 300;
  const FAST = 2;

  it('a 300 ms planet delays a 2 ms planet by at most one slow step, and the fast one keeps 5 TPS', () => {
    const r = costRig({ slow: SLOW, fast: FAST }, { demoteAfterSlowSteps: 0 }); // no demotion: the worst case
    r.s.add('slow');
    r.s.add('fast');
    r.s.setPlayers('fast', true);
    r.s.start();
    r.runUntil(20_000);
    const fast = r.log.filter((x) => x.id === 'fast' && x.startMs >= 2000);
    const lateness = fast.map((x) => x.startMs - x.dueMs);
    expect(Math.max(...lateness)).toBeLessThanOrEqual(SLOW + FAST);
    // no slot lost: 5 per second over [2 s, 20 s)
    expect(fast.length).toBeGreaterThanOrEqual(18 * 5 - 1);
    expect(r.s.info('fast')).toMatchObject({ droppedSlots: 0 });
    expect(r.s.info('slow')!.droppedSlots).toBeGreaterThan(0); // the slow one cannot keep up: its debt is capped
  });

  it('a command for the fast planet is answered within one tick plus the slow step in flight', () => {
    const r = costRig({ slow: SLOW, fast: FAST }, { demoteAfterSlowSteps: 0 });
    r.s.add('slow');
    r.s.add('fast');
    r.s.start();
    r.runUntil(20_000);
    const fastStarts = r.log.filter((x) => x.id === 'fast').map((x) => x.startMs);
    // a command arriving at time t is applied (and acked) by the first fast step starting after t
    let worst = 0;
    for (let t = 1000; t < 19_000; t += 37) {
      const applied = fastStarts.find((s) => s >= t)!;
      worst = Math.max(worst, applied + FAST - t);
    }
    expect(worst).toBeLessThanOrEqual(TICK_MS + SLOW + FAST);
  });

  it('two slow planets with players share the thread; a player-less fast planet still gets every slot', () => {
    const r = costRig({ p1: SLOW, p2: SLOW, bg: FAST }, { demoteAfterSlowSteps: 0 });
    for (const id of ['p1', 'p2', 'bg']) r.s.add(id);
    r.s.setPlayers('p1', true);
    r.s.setPlayers('p2', true);
    r.s.start();
    r.runUntil(30_000);
    const count = (id: string) => r.log.filter((x) => x.id === id && x.startMs >= 5000).length;
    expect(Math.abs(count('p1') - count('p2'))).toBeLessThanOrEqual(2);
    expect(count('bg')).toBeGreaterThanOrEqual(25 * 5 - 2);
  });
});

describe('debt cap and demotion', () => {
  it('a planet that owes more than the cap skips the oldest slots, keeps its phase, and counts them', () => {
    const r = rig();
    r.s.add('a');
    r.s.start();
    r.advance(1000 - 1);
    const phase = r.s.info('a')!.nextDueMs % TICK_MS;
    r.jump(60_000); // 300 slots owed
    r.s.runPass();
    const info = r.s.info('a')!;
    expect(info.lagSteps).toBeLessThanOrEqual(MAX_DEBT_SLOTS);
    expect(info.droppedSlots).toBeGreaterThanOrEqual(300 - MAX_DEBT_SLOTS - 1);
    expect(r.s.droppedSlots).toBe(info.droppedSlots);
    expect(info.nextDueMs % TICK_MS).toBe(phase);
    drain(r.s);
    expect(r.s.info('a')!.lagSteps).toBe(0);
  });

  it('demotes a slow planet nobody watches to coarse and reports it; never one with players', () => {
    const r = costRig({ slow: 300, watched: 300 });
    const demoted: string[] = [];
    r.s.onDemote = (id) => demoted.push(id);
    r.s.add('slow');
    r.s.add('watched');
    r.s.setPlayers('watched', true);
    r.s.start();
    r.runUntil(10_000);
    expect(demoted).toEqual(['slow']);
    expect(r.s.info('slow')).toMatchObject({ mode: 'coarse', demoted: true });
    expect(r.s.info('watched')).toMatchObject({ mode: 'active', demoted: false });
    expect(r.log.filter((x) => x.id === 'slow').at(-1)!.dt).toBe(COARSE_DT);
  });

  it('a player joining (or presence switching to active) lifts a demotion', () => {
    const r = costRig({ slow: 300 });
    r.s.add('slow');
    r.s.start();
    r.runUntil(5000);
    expect(r.s.info('slow')!.demoted).toBe(true);
    r.s.setPlayers('slow', true);
    expect(r.s.info('slow')).toMatchObject({ mode: 'active', demoted: false });
    r.s.setPlayers('slow', false);
    r.s.setMode('slow', 'coarse');
    expect(r.s.info('slow')!.demoted).toBe(false); // a presence switch is not a demotion
  });

  it('a fast planet is never demoted', () => {
    const r = costRig({ a: 20 });
    r.s.add('a');
    r.s.start();
    r.runUntil(10_000);
    expect(r.s.info('a')).toMatchObject({ mode: 'active', demoted: false, droppedSlots: 0 });
    expect(r.s.info('a')!.avgStepMs).toBeCloseTo(20, 5);
  });
});

describe('single-planet host preset (browser ?host=local)', () => {
  it('a throttled timer (one turn per second) still keeps 5 TPS, and a long freeze is caught up, not dropped', () => {
    let now = 0;
    let steps = 0;
    const s = new PlanetScheduler({ now: () => now, schedule: () => () => undefined, step: () => { steps++; }, ...SINGLE_PLANET_SCHEDULE });
    s.add('local');
    for (let i = 0; i < 10; i++) { s.runPass(); now += 1000; }
    expect(steps).toBe(1 + 9 * 5); // slots 0..9000, all on time
    expect(s.info('local')!.lagSteps).toBeLessThanOrEqual(1);
    now += 60_000;
    const rep = s.runPass();
    expect(rep.maxPlanetSteps).toBe(5);
    expect(s.info('local')!.droppedSlots).toBe(0);
  });
});

describe('time warp thread budget cap', () => {
  /** A scheduler whose every engine step costs `costMs` of clock time (a thread that cannot keep up). */
  function slow(costMs: number) {
    let now = 0;
    const s = new PlanetScheduler({ now: () => now, schedule: () => () => undefined, step: () => { now += costMs; } });
    return { s, tick: (ms: number) => { now += ms; s.runPass(); }, catchUp: (ms: number) => { now += ms; drain(s); } };
  }

  it('halves the effective warp while the planet stays behind, and reports it; the request stays', () => {
    const r = slow(50); // 10 steps = 500 ms per 200 ms slot
    const seen: number[] = [];
    r.s.add('a');
    r.s.onWarp = (_id, k) => seen.push(k);
    r.s.setWarp('a', 10);
    for (let i = 0; i < 60 && (r.s.info('a')?.warp ?? 0) > 4; i++) r.tick(0);
    expect(r.s.info('a')).toMatchObject({ warp: 2, warpRequested: 10 });
    expect(seen.slice(0, 3)).toEqual([10, 5, 2]);
  });

  it('never reduces a planet that keeps up', () => {
    const r = slow(1);
    r.s.add('a');
    r.s.setWarp('a', 10);
    for (let i = 0; i < 50; i++) r.catchUp(200);
    expect(r.s.info('a')).toMatchObject({ warp: 10, warpRequested: 10 });
  });
});

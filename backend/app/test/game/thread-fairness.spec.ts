import 'reflect-metadata';
import { TICK_MS } from '@terra/sim';
import pino from 'pino';
import { Registry } from 'prom-client';
import { afterEach, describe, expect, it } from 'vitest';
import { GamePlanets } from '../../src/game/game-planets.service';
import { installThreadMetrics } from '../../src/game/metrics/thread-metrics';
import { SimThreadPool } from '../../src/game/sim-thread-pool';

/** One slow planet (`pl_slow*`, 300 ms per step) and normal ones, on real sim threads. */
const SLOW = new URL('./fixtures/slow-module.ts', import.meta.url).href;
const SLOW_MS = 300;
/** Scheduling noise of a loaded CI machine on top of the bound. */
const SLACK_MS = 150;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const cmd = (commandId: string) => ({ colonyIndex: null, source: 'dev' as const, commandId, kind: 'test.nop', args: {} });

let games: GamePlanets | undefined;
let dispose: (() => void) | undefined;
afterEach(async () => { dispose?.(); dispose = undefined; await games?.shutdown(); games = undefined; });

async function boot(opts: Partial<ConstructorParameters<typeof SimThreadPool>[0]> = {}) {
  const pool = new SimThreadPool({ threads: 1, flags: ['W00'], simModules: [SLOW], rebalance: false, ...opts });
  await pool.start();
  return (games = new GamePlanets(pool));
}

/** Submits 16 commands to `planetId` ~100 ms apart and watches its deltas: ack latencies, delta gaps, ticks per second. */
async function probe(g: GamePlanets, planetId: string) {
  const deltaAt: number[] = [];
  let firstTick = -1;
  let lastTick = -1;
  g.subscribe(planetId, { onDelta: (d) => { deltaAt.push(performance.now()); if (firstTick < 0) firstTick = d.fromTick; lastTick = d.toTick; } });
  await sleep(2000); // the slow planet is measured (and demoted when nobody watches it)
  deltaAt.length = 0;
  firstTick = -1;
  const t0 = performance.now();
  const acks: number[] = [];
  for (let i = 0; i < 16; i++) {
    const sent = performance.now();
    const out = await g.submit(planetId, cmd(`c${i}`));
    expect(out.commandId).toBe(`c${i}`);
    acks.push(performance.now() - sent);
    await sleep(97);
  }
  const wall = (performance.now() - t0) / 1000;
  return { maxAck: Math.max(...acks), maxGap: Math.max(...deltaAt.slice(1).map((t, i) => t - deltaAt[i]!)), tps: (lastTick - firstTick) / wall };
}

describe('scheduler fairness on a real sim thread (1.1-1.3)', () => {
  it('a watched 300 ms planet delays a normal planet\'s steps by less than one tick (commands, deltas)', async () => {
    const g = await boot();
    await g.load('pl_fast_fair');
    await g.load('pl_slow_fair');
    g.subscribe('pl_slow_fair', {}); // players on it: it stays active at 300 ms per step
    const r = await probe(g, 'pl_fast_fair');
    // idle thread: an ack waits for the next slot (< 1 tick) and deltas come every tick; the slow planet adds < 1 tick
    expect(r.maxAck).toBeLessThanOrEqual(2 * TICK_MS + SLACK_MS);
    expect(r.maxGap).toBeLessThanOrEqual(2 * TICK_MS + SLACK_MS);
    expect(r.tps).toBeGreaterThan(4.2); // ~5 (the delta window and the wall window differ by up to a tick)
    const [s] = await g.pool.stats();
    const fast = s!.planets.find((p) => p.planetId === 'pl_fast_fair')!;
    expect(fast).toMatchObject({ droppedSlots: 0, demoted: false, mode: 'active' });
    expect(fast.avgStepMs).toBeLessThan(50);
    expect(s!.planets.find((p) => p.planetId === 'pl_slow_fair')).toMatchObject({ demoted: false, mode: 'active' });
    expect(s!.busyRatio).toBeGreaterThan(0.5);
  }, 30_000);

  it('a slow planet nobody watches is demoted to coarse; its neighbour keeps 5 TPS and no slot is dropped', async () => {
    const g = await boot();
    await g.load('pl_fast_bg');
    await g.load('pl_slow_bg');
    const r = await probe(g, 'pl_fast_bg');
    // a coarse slot (dt 5) is one longer block (600 ms in this fixture): it delays the neighbour by up to that, once a second
    expect(r.maxAck).toBeLessThanOrEqual(TICK_MS + 2 * SLOW_MS + SLACK_MS);
    expect(r.tps).toBeGreaterThan(4.2); // ~5 (the delta window and the wall window differ by up to a tick)
    const [s] = await g.pool.stats();
    const slow = s!.planets.find((p) => p.planetId === 'pl_slow_bg')!;
    expect(slow).toMatchObject({ demoted: true, mode: 'coarse' });
    expect(slow.avgStepMs).toBeGreaterThan(TICK_MS);
    expect(s!.planets.find((p) => p.planetId === 'pl_fast_bg')).toMatchObject({ droppedSlots: 0, demoted: false, mode: 'active' });
  }, 30_000);
});

describe('metrics never block on a busy thread (0.6)', () => {
  it('a scrape answers from the cached push at once and flags the silent thread unresponsive', async () => {
    const g = await boot({ statsEveryMs: 200 });
    await g.load('pl_fast_metrics');
    const reg = new Registry();
    const warns: string[] = [];
    const log = pino({ level: 'warn' }, { write: (s: string) => { warns.push(s); } });
    dispose = installThreadMetrics(g.pool, reg, log);
    await sleep(600);
    const value = async (name: string) => (await reg.getSingleMetric(name)!.get()).values.find((v) => v.labels.thread === '0')?.value;
    expect(await value('ta_game_planets')).toBe(1);
    expect(await value('ta_game_thread_unresponsive')).toBe(0);
    const hist = await reg.getSingleMetricAsString('ta_game_planet_step_ms');
    expect(hist).toContain('planet="pl_fast_metrics"');

    g.pool.send(0, { t: 'ctl', op: 'block', ms: 4500 });
    await sleep(3800);
    const t0 = performance.now();
    const text = await reg.metrics();
    expect(performance.now() - t0).toBeLessThan(100);
    expect(text).toMatch(/ta_game_thread_unresponsive\{thread="0"\} 1/);
    expect(text).toMatch(/ta_game_planets\{thread="0"\} 1/); // the cached table, not a silent 0
    await sleep(1200);
    expect(await value('ta_game_thread_unresponsive')).toBe(0);
  }, 30_000);
});

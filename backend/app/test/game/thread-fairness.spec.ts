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

describe('scheduler fairness on a real sim thread (1.1-1.3)', () => {
  it('a 300 ms planet does not delay a normal planet\'s commands or deltas beyond one tick plus the slow step', async () => {
    const g = await boot();
    await g.load('pl_fast_fair');
    await g.load('pl_slow_fair');
    const deltaAt: number[] = [];
    let firstTick = -1;
    let lastTick = -1;
    g.subscribe('pl_fast_fair', { onDelta: (d) => { deltaAt.push(performance.now()); if (firstTick < 0) firstTick = d.fromTick; lastTick = d.toTick; } });
    await sleep(1500);
    deltaAt.length = 0;
    firstTick = -1;
    const t0 = performance.now();
    const acks: number[] = [];
    for (let i = 0; i < 16; i++) {
      const sent = performance.now();
      const out = await g.submit('pl_fast_fair', cmd(`c${i}`));
      expect(out.commandId).toBe(`c${i}`);
      acks.push(performance.now() - sent);
      await sleep(97);
    }
    const wall = (performance.now() - t0) / 1000;
    const gaps = deltaAt.slice(1).map((t, i) => t - deltaAt[i]!);
    expect(Math.max(...acks)).toBeLessThanOrEqual(TICK_MS + SLOW_MS + SLACK_MS);
    expect(Math.max(...gaps)).toBeLessThanOrEqual(TICK_MS + SLOW_MS + SLACK_MS);
    expect((lastTick - firstTick) / wall).toBeGreaterThan(4); // keeps ~5 TPS
    const [s] = await g.pool.stats();
    const fast = s!.planets.find((p) => p.planetId === 'pl_fast_fair')!;
    const slow = s!.planets.find((p) => p.planetId === 'pl_slow_fair')!;
    expect(fast).toMatchObject({ droppedSlots: 0, demoted: false, mode: 'active' });
    expect(slow).toMatchObject({ demoted: true, mode: 'coarse' }); // nobody watches it and it cannot keep a tick
    expect(slow.avgStepMs).toBeGreaterThan(TICK_MS);
    expect(fast.avgStepMs).toBeLessThan(50);
    expect(s!.busyRatio).toBeGreaterThan(0);
  }, 30_000);

  it('a watched slow planet is not demoted and still shares the thread', async () => {
    const g = await boot();
    await g.load('pl_fast_w');
    await g.load('pl_slow_w');
    g.subscribe('pl_slow_w', {});
    await sleep(3000);
    const sent = performance.now();
    await g.submit('pl_fast_w', cmd('w1'));
    expect(performance.now() - sent).toBeLessThanOrEqual(TICK_MS + SLOW_MS + SLACK_MS);
    const [s] = await g.pool.stats();
    expect(s!.planets.find((p) => p.planetId === 'pl_slow_w')).toMatchObject({ demoted: false, mode: 'active' });
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

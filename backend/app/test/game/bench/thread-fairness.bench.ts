/**
 * Local bench (not a vitest spec): one sim thread with one slow fake planet (`pl_slow*`, 300 ms per step) and one
 * normal planet. Reports command -> ack latency and the delta cadence of the normal (subscribed) planet.
 *
 *   SWC_NODE_PROJECT=shared/tsconfig.base.json node --import @swc-node/register/esm-register \
 *     backend/app/test/game/bench/thread-fairness.bench.ts [seconds] [watched]
 *
 * `watched` also subscribes to the slow planet (players on it: never demoted, the worst case for its neighbour).
 */
import 'reflect-metadata';
import { GamePlanets } from '../../../src/game/game-planets.service';
import { SimThreadPool } from '../../../src/game/sim-thread-pool';

const SLOW = new URL('../fixtures/slow-module.ts', import.meta.url).href;
const seconds = Number(process.argv[2] ?? 10);
const watched = process.argv[3] === 'watched';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function pct(xs: number[], p: number): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]!);
}
const summary = (xs: number[]) => ({ n: xs.length, p50: pct(xs, 50), p95: pct(xs, 95), max: pct(xs, 100) });

async function main(): Promise<void> {
  const pool = new SimThreadPool({ threads: 1, flags: ['W00'], simModules: [SLOW] });
  await pool.start();
  const g = new GamePlanets(pool);
  await g.load('pl_fast_bench');
  await g.load('pl_slow_bench');
  const deltaAt: number[] = [];
  let firstTick = -1;
  let lastTick = -1;
  g.subscribe('pl_fast_bench', { onDelta: (d) => { deltaAt.push(performance.now()); if (firstTick < 0) firstTick = d.fromTick; lastTick = d.toTick; } });
  if (watched) g.subscribe('pl_slow_bench', {});
  await sleep(1500); // settle
  deltaAt.length = 0;
  firstTick = -1;
  const acks: number[] = [];
  const t0 = performance.now();
  let n = 0;
  while (performance.now() - t0 < seconds * 1000) {
    const sent = performance.now();
    void g.submit('pl_fast_bench', { colonyIndex: null, source: 'dev', commandId: `c${n++}`, kind: 'bench.nop', args: {} }).then(() => acks.push(performance.now() - sent));
    await sleep(250);
  }
  await sleep(3000); // let the last answers arrive
  const wall = (performance.now() - t0) / 1000;
  const gaps = deltaAt.slice(1).map((t, i) => t - deltaAt[i]!);
  console.log(JSON.stringify({
    seconds: Math.round(wall * 10) / 10,
    slowPlanetWatched: watched,
    ackMs: summary(acks),
    unanswered: n - acks.length,
    deltaGapMs: summary(gaps),
    fastTicksPerSecond: Math.round(((lastTick - firstTick) / wall) * 10) / 10,
  }, null, 2));
  await g.shutdown();
}

await main();

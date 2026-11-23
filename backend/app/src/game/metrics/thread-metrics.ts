import type { Logger } from 'pino';
import { Counter, Gauge, Histogram, type Registry } from 'prom-client';
import { installPlanetModeGauge } from '../planet-mode-metric';
import type { SimThreadPool } from '../sim-thread-pool';
import type { FromThread } from '../thread/protocol';
import { UNRESPONSIVE_AFTER_MS } from './stats-cache';

/** Buckets of `ta_game_planet_step_ms` (one tick is 200 ms). */
export const STEP_MS_BUCKETS = [0.5, 1, 2, 5, 10, 20, 50, 100, 200, 300, 500, 1000, 2000];
/** How often the main thread checks for unresponsive threads (log only; the gauge is computed on scrape). */
const UNRESPONSIVE_CHECK_MS = 5_000;

type Pool = Pick<SimThreadPool, 'cachedStats' | 'unresponsive' | 'listen' | 'size' | 'live'>;

/**
 * Sim thread metrics (0.6). Every gauge reads the pool's cached stats (the threads push them each second), so a scrape
 * answers at once even while a thread is busy; a thread that stopped pushing shows in `ta_game_thread_unresponsive`
 * instead of as silent zeros. Step durations come with each push and feed `ta_game_planet_step_ms`. Slow steps
 * (rate-limited by the thread), demotions and unresponsive threads are logged. Returns a disposer.
 */
export function installThreadMetrics(pool: Pool, reg: Registry, log: Logger): () => void {
  const stats = () => pool.cachedStats();
  installGauges(pool, reg, stats);
  const stepMs = new Histogram({
    name: 'ta_game_planet_step_ms', help: 'Wall ms of one due scheduler slot, per planet', labelNames: ['thread', 'planet'],
    buckets: STEP_MS_BUCKETS, registers: [reg],
  });
  const moves = new Counter({ name: 'ta_game_planet_moves_total', help: 'Planets moved between sim threads by the rebalancer', registers: [reg] });
  const offMessages = pool.listen((thread, msg) => onThreadMessage(thread, msg, stepMs, moves, log));
  const flagged = new Set<number>();
  const timer = setInterval(() => {
    for (let t = 0; t < pool.size; t++) {
      const down = pool.unresponsive(t);
      if (down && !flagged.has(t)) log.warn({ thread: t, ageMs: Math.round(pool.cachedStats()[t]?.ageMs ?? Infinity) }, 'sim thread unresponsive');
      if (!down && flagged.has(t)) log.info({ thread: t }, 'sim thread responsive again');
      if (down) flagged.add(t); else flagged.delete(t);
    }
  }, UNRESPONSIVE_CHECK_MS);
  timer.unref();
  return () => { clearInterval(timer); offMessages(); };
}

function onThreadMessage(thread: number, msg: FromThread, stepMs: Histogram, moves: Counter, log: Logger): void {
  if (msg.t === 'stats') {
    for (const s of msg.stepSamples ?? []) for (const ms of s.ms) stepMs.observe({ thread: String(thread), planet: s.planetId }, ms);
  } else if (msg.t === 'slowStep') {
    log.warn({ thread, planetId: msg.planetId, ms: msg.ms, mode: msg.mode, suppressed: msg.suppressed }, 'slow sim step (over one tick)');
  } else if (msg.t === 'demoted') {
    log.warn({ thread, planetId: msg.planetId, avgStepMs: msg.avgStepMs }, 'slow planet without players demoted to coarse');
  } else if (msg.t === 'moved') {
    moves.inc();
    log.info({ planetId: msg.planetId, from: msg.from, to: msg.to, tick: msg.tick }, 'planet moved to a less loaded sim thread');
  }
}

function perThreadGauge(reg: Registry, name: string, help: string, value: (t: number) => number, threads: () => number): void {
  new Gauge({
    name, help, labelNames: ['thread'], registers: [reg],
    collect() {
      this.reset();
      for (let t = 0; t < threads(); t++) this.set({ thread: String(t) }, value(t));
    },
  });
}

function installGauges(pool: Pool, reg: Registry, stats: Pool['cachedStats']): void {
  const at = (t: number) => stats()[t];
  const n = () => pool.size;
  new Gauge({ name: 'ta_game_threads', help: 'Live sim threads', registers: [reg], collect() { this.set(pool.live); } });
  perThreadGauge(reg, 'ta_game_planets', 'Planets loaded per sim thread', (t) => at(t)?.planets.length ?? 0, n);
  installPlanetModeGauge(reg, async () => stats());
  perThreadGauge(reg, 'ta_game_tick_lag_steps', 'Max steps a planet is behind its due time, per sim thread', (t) => at(t)?.maxLag ?? 0, n);
  perThreadGauge(reg, 'ta_game_thread_unresponsive', `1 when the sim thread is dead or posted no stats for ${UNRESPONSIVE_AFTER_MS / 1000}s`, (t) => (pool.unresponsive(t) ? 1 : 0), n);
  perThreadGauge(reg, 'ta_game_thread_stats_age_seconds', 'Age of the cached stats of the sim thread', (t) => Math.min(1e6, (at(t)?.ageMs ?? Infinity) / 1000), n);
  perThreadGauge(reg, 'ta_game_thread_busy_ratio', 'Share of wall time the sim thread spent stepping planets (smoothed)', (t) => at(t)?.busyRatio ?? 0, n);
  perThreadGauge(reg, 'ta_game_planets_demoted', 'Planets the scheduler demoted to coarse (slow, nobody watching)', (t) => at(t)?.planets.filter((p) => p.demoted).length ?? 0, n);
  new Gauge({
    name: 'ta_game_planet_step_ms_avg', help: 'Smoothed wall ms of one due slot, per planet', labelNames: ['planet'], registers: [reg],
    collect() {
      this.reset();
      for (const s of stats()) for (const p of s.planets) this.set({ planet: p.planetId }, p.avgStepMs);
    },
  });
  for (const [name, help, value] of [
    ['ta_game_steps_total', 'Engine steps executed per sim thread', (t: number) => at(t)?.steps ?? 0],
    ['ta_game_dropped_slots_total', 'Due slots skipped over the catch-up debt cap, per sim thread', (t: number) => at(t)?.droppedSlots ?? 0],
  ] as const) {
    new Counter({
      name, help, labelNames: ['thread'], registers: [reg],
      collect() {
        this.reset();
        for (let t = 0; t < n(); t++) this.inc({ thread: String(t) }, value(t));
      },
    });
  }
}

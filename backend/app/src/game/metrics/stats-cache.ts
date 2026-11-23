import type { FromThread, PassStat, PlanetStats } from '../thread/protocol';

export interface ThreadStats {
  readonly thread: number;
  readonly planets: PlanetStats[];
  readonly steps: number;
  /** Max scheduler lag (steps behind) over the thread's planets. */
  readonly maxLag: number;
  readonly recentPasses: PassStat[];
  /** Smoothed share of wall time the thread spent stepping (0..1). */
  readonly busyRatio: number;
  /** Due slots skipped over the debt cap since the thread started. */
  readonly droppedSlots: number;
  /** Age of these figures (ms since the thread posted them); `Infinity` = never heard from (or dead). */
  readonly ageMs: number;
}

/** A thread that has not posted stats for this long is unresponsive (`ta_game_thread_unresponsive`). */
export const UNRESPONSIVE_AFTER_MS = 3_000;

type StatsMsg = Extract<FromThread, { t: 'stats' }>;

export const emptyThreadStats = (thread: number): ThreadStats => ({
  thread, planets: [], steps: 0, maxLag: 0, recentPasses: [], busyRatio: 0, droppedSlots: 0, ageMs: Infinity,
});

/**
 * Last `stats` message of every thread (the periodic push or a `ctl stats` reply), with when it arrived. Metrics and
 * placement read it synchronously, so a scrape never waits on a busy thread (0.6).
 */
export class ThreadStatsCache {
  private readonly last = new Map<number, { msg?: StatsMsg; atMs: number }>();

  constructor(private readonly now: () => number = () => performance.now()) {}

  /** A thread (re)started: its age counts from now until its first push. */
  spawned(thread: number): void {
    this.last.set(thread, { atMs: this.now() });
  }

  put(msg: StatsMsg): void {
    this.last.set(msg.thread, { msg, atMs: this.now() });
  }

  drop(thread: number): void {
    this.last.delete(thread);
  }

  /** The thread's last figures with their age (since its last push, or its start); age `Infinity` = unknown thread. */
  get(thread: number): ThreadStats {
    const e = this.last.get(thread);
    if (!e) return emptyThreadStats(thread);
    if (!e.msg) return { ...emptyThreadStats(thread), ageMs: this.now() - e.atMs };
    const m = e.msg;
    return {
      thread, planets: m.planets, steps: m.steps, maxLag: m.maxLag, recentPasses: m.recentPasses,
      busyRatio: m.busyRatio ?? 0, droppedSlots: m.droppedSlots ?? 0, ageMs: this.now() - e.atMs,
    };
  }
}

/** Turns a `stats` reply into `ThreadStats` (fresh: age 0). */
export function threadStatsOf(msg: StatsMsg): ThreadStats {
  return {
    thread: msg.thread, planets: msg.planets, steps: msg.steps, maxLag: msg.maxLag, recentPasses: msg.recentPasses,
    busyRatio: msg.busyRatio ?? 0, droppedSlots: msg.droppedSlots ?? 0, ageMs: 0,
  };
}

import { Worker } from 'node:worker_threads';
import { resolve } from 'node:path';
import type { BalanceOverrides } from '@terra/sim';
import { emptyThreadStats, ThreadStatsCache, threadStatsOf, UNRESPONSIVE_AFTER_MS, type ThreadStats } from './metrics/stats-cache';
import { PlacementTable } from './placement/placement-table';
import { PlanetMover } from './placement/planet-mover';
import { Rebalancer, type RebalanceOptions } from './placement/rebalancer';
import type { FromThread, ThreadInit, ToThread } from './thread/protocol';

export type { ThreadStats };

export interface SimThreadPoolOptions {
  readonly threads: number;
  readonly flags: readonly string[];
  /** Run the scheduler loop inside each thread (default true). */
  readonly autoStep?: boolean;
  /** Deltas per second per subscribed planet (default 5). */
  readonly deltaHz?: number;
  /** Test/dev hook: file URLs of extra `SimModule`s (default export) loaded into every thread. */
  readonly simModules?: readonly string[];
  /** Balance overrides from `TA_BALANCE_OVERRIDES` (D-35), applied to every planet. */
  readonly overrides?: BalanceOverrides;
  /** Thread entry; default `./thread/sim-thread.ts` next to this file. */
  readonly entry?: URL;
  /** Thread stats push interval (default 1000 ms; 0 = off). */
  readonly statsEveryMs?: number;
  /** Load rebalancing between threads (3.2); `false` = off. Default on with `REBALANCE_DEFAULTS`. */
  readonly rebalance?: RebalanceOptions | false;
}

type Listener = (thread: number, msg: FromThread) => void;

const SWC_LOADER = '@swc-node/register/esm-register';

/**
 * N worker threads running planets. Planet -> thread through the placement table (lowest measured load at load time,
 * moved by the rebalancer when a thread stays hot). The pool only routes messages; it never holds planet state.
 */
export class SimThreadPool {
  private readonly workers: (Worker | undefined)[] = [];
  private readonly listeners = new Set<Listener>();
  private readonly statWaiters = new Map<number, (s: ThreadStats) => void>();
  private nextReq = 1;
  private started = false;
  private stopping = false;
  private entry: URL | undefined;
  private execArgv: string[] | undefined;
  readonly placement: PlacementTable;
  readonly mover: PlanetMover;
  private readonly rebalancer: Rebalancer | undefined;
  private readonly cache = new ThreadStatsCache();

  /** Thread base for threads (re)spawned later; follows every economy profile swap. */
  private baseOverrides: BalanceOverrides | undefined;

  constructor(private readonly opts: SimThreadPoolOptions) {
    this.baseOverrides = opts.overrides;
    if (!Number.isInteger(opts.threads) || opts.threads < 1) throw new Error(`SIM_THREADS must be a positive integer, got ${opts.threads}`);
    this.placement = new PlacementTable(opts.threads, (t) => !this.started || this.usable(t));
    this.mover = new PlanetMover(this.placement, { send: (t, m, tr) => this.send(t, m, tr), emit: (t, m) => this.fan(t, m) });
    this.rebalancer = opts.rebalance === false ? undefined : new Rebalancer(this.placement, opts.rebalance ?? {});
  }

  get size(): number {
    return this.opts.threads;
  }

  /** Number of threads currently alive. */
  get live(): number {
    return this.workers.filter(Boolean).length;
  }

  /** The planet's thread (placement table); for a planet not placed, where a load would go now. */
  threadOf(planetId: string): number {
    return this.placement.threadOf(planetId);
  }

  /** Spawns all threads and resolves once each has reported `ready`. */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    process.env.SWC_NODE_PROJECT ??= resolve(import.meta.dirname, '../../../../shared/tsconfig.base.json');
    this.entry = this.opts.entry ?? new URL('./thread/sim-thread.ts', import.meta.url);
    this.execArgv = process.execArgv.some((a) => a.includes(SWC_LOADER)) ? undefined : [...process.execArgv, '--import', SWC_LOADER];
    await Promise.all(Array.from({ length: this.opts.threads }, (_, thread) => this.spawn(thread)));
  }

  /** Spawns a thread that died again (BE-11), with no planets; resolves once it is ready. No-op while it lives or after `shutdown`. */
  async restart(thread: number): Promise<void> {
    if (!this.started || this.stopping || this.workers[thread]) return;
    await this.spawn(thread);
  }

  private spawn(thread: number): Promise<void> {
    const entry = this.entry as URL;
    const execArgv = this.execArgv;
    const init: ThreadInit = {
      thread, flags: this.opts.flags, autoStep: this.opts.autoStep ?? true, deltaHz: this.opts.deltaHz, simModules: this.opts.simModules,
      overrides: this.baseOverrides, statsEveryMs: this.opts.statsEveryMs,
    };
    const w = new Worker(entry, { workerData: init, ...(execArgv ? { execArgv } : {}) });
    this.workers[thread] = w;
    this.cache.spawned(thread);
    return new Promise<void>((resolve, reject) => {
      w.on('message', (msg: FromThread) => {
        if (msg.t === 'ready') return resolve();
        this.onThreadMessage(thread, msg);
      });
      w.on('error', (e: Error) => {
        this.fan(thread, { t: 'error', thread, message: e.message });
        reject(e);
      });
      w.on('exit', () => {
        this.workers[thread] = undefined;
        this.mover.threadDown(thread);
        this.fan(thread, { t: 'stopped', thread });
        // after the listeners: `GamePlanets` finds the dead thread's planets through `threadOf`
        this.placement.releaseThread(thread);
        this.rebalancer?.forgetThread(thread);
        this.cache.drop(thread);
      });
    });
  }

  private onThreadMessage(thread: number, msg: FromThread): void {
    if (this.mover.intercept(thread, msg)) return;
    if (msg.t === 'stats') this.onStats(thread, msg);
    this.fan(thread, msg);
    this.placement.afterMessage(thread, msg);
  }

  private fan(thread: number, msg: FromThread): void {
    for (const l of this.listeners) l(thread, msg);
  }

  private onStats(thread: number, msg: Extract<FromThread, { t: 'stats' }>): void {
    this.cache.put(msg);
    this.placement.observe(thread, msg.planets);
    if (msg.reqId > 0) this.statWaiters.get(msg.reqId)?.(threadStatsOf(msg));
    if (!this.rebalancer || this.stopping) return;
    const now = performance.now();
    this.rebalancer.observe(thread, msg.busyRatio, now);
    const live = this.workers.flatMap((_w, t) => (this.usable(t) ? [t] : []));
    const move = this.rebalancer.decide(now, live, (id) => {
      const p = this.placement.get(id);
      return !!p && p.confirmed && !p.catchingUp && !this.mover.isMoving(id);
    });
    if (move) this.mover.start(move.planetId, move.to);
  }

  /** Receives every message from every thread (the GamePlanets service is the main listener). Returns an unsubscribe fn. */
  listen(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  /** Sends to a specific thread; returns false if it is dead. A `load` sent this way places the planet there. */
  send(thread: number, msg: ToThread, transfer: ArrayBuffer[] = []): boolean {
    const w = this.workers[thread];
    if (!w) return false;
    if (msg.t === 'load') this.placement.placeAt(thread, msg);
    w.postMessage(msg, transfer);
    return true;
  }

  /** Records the base a respawned thread starts with (the live threads receive the `profile` message). */
  setBaseOverrides(o: BalanceOverrides): void { this.baseOverrides = o; }

  /** Sends to the thread that owns `planetId` (held back while the planet moves, then delivered on its new thread). */
  sendToPlanet(planetId: string, msg: ToThread, transfer: ArrayBuffer[] = []): boolean {
    const thread = this.placement.route(planetId, msg);
    if (this.mover.buffer(planetId, msg, transfer)) return true;
    return this.send(thread, msg, transfer);
  }

  /** Moves a loaded planet to another thread now (rebalancing, tools); false when it cannot move. */
  movePlanet(planetId: string, to: number): boolean {
    const p = this.placement.get(planetId);
    return !!p && p.confirmed && !p.catchingUp && !!this.workers[to] && this.mover.start(planetId, to);
  }

  /** Asks every live thread for its planet table (`ctl stats`). Dead threads have no planets; a silent one its last push. */
  async stats(timeoutMs = 1500): Promise<ThreadStats[]> {
    return Promise.all(this.workers.map((w, thread) => (w ? this.statsOf(thread, timeoutMs) : emptyThreadStats(thread))));
  }

  /** The last stats every thread posted, at once (metrics, placement): never waits on a busy thread. */
  cachedStats(): ThreadStats[] {
    return Array.from({ length: this.opts.threads }, (_, t) => (this.workers[t] ? this.cache.get(t) : emptyThreadStats(t)));
  }

  /** A thread that is dead or has not posted stats for {@link UNRESPONSIVE_AFTER_MS} (since its last push or its start). */
  unresponsive(thread: number): boolean {
    return !this.workers[thread] || this.cache.get(thread).ageMs > UNRESPONSIVE_AFTER_MS;
  }

  /** Alive and responsive: may receive new or moved planets. */
  private usable(thread: number): boolean {
    return !!this.workers[thread] && (this.opts.statsEveryMs === 0 || !this.unresponsive(thread));
  }

  private statsOf(thread: number, timeoutMs: number): Promise<ThreadStats> {
    const reqId = this.nextReq++;
    return new Promise<ThreadStats>((resolve) => {
      const done = (s: ThreadStats) => { clearTimeout(timer); this.statWaiters.delete(reqId); resolve(s); };
      const timer = setTimeout(() => done(this.cache.get(thread)), timeoutMs);
      this.statWaiters.set(reqId, done);
      this.send(thread, { t: 'ctl', op: 'stats', reqId });
    });
  }

  /** Stops every thread and waits for it to exit. */
  async shutdown(): Promise<void> {
    this.stopping = true;
    const ws = this.workers.filter((w): w is Worker => !!w);
    const exited = ws.map((w) => new Promise<void>((r) => w.once('exit', () => r())));
    ws.forEach((w) => w.postMessage({ t: 'ctl', op: 'stop' } satisfies ToThread));
    const timer = setTimeout(() => ws.forEach((w) => void w.terminate()), 3000);
    await Promise.all(exited);
    clearTimeout(timer);
    this.listeners.clear();
  }
}

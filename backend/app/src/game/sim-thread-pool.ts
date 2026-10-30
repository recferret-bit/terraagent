import { Worker } from 'node:worker_threads';
import { threadOf } from './thread/assign';
import type { FromThread, PassStat, PlanetStats, ThreadInit, ToThread } from './thread/protocol';

export interface SimThreadPoolOptions {
  readonly threads: number;
  readonly flags: readonly string[];
  /** Run the scheduler loop inside each thread (default true). */
  readonly autoStep?: boolean;
  /** Deltas per second per subscribed planet (default 5). */
  readonly deltaHz?: number;
  /** Test/dev hook: file URLs of extra `SimModule`s (default export) loaded into every thread. */
  readonly simModules?: readonly string[];
  /** Thread entry; default `./thread/sim-thread.ts` next to this file. */
  readonly entry?: URL;
}

export interface ThreadStats {
  readonly thread: number;
  readonly planets: PlanetStats[];
  readonly steps: number;
  /** Max scheduler lag (steps behind) over the thread's planets. */
  readonly maxLag: number;
  readonly recentPasses: PassStat[];
}

type Listener = (thread: number, msg: FromThread) => void;

const SWC_LOADER = '@swc-node/register/esm-register';

/** N worker threads running planets; planet → thread by `hash(planetId) % n`. The pool only routes messages; it never holds planet state. */
export class SimThreadPool {
  private readonly workers: (Worker | undefined)[] = [];
  private readonly listeners = new Set<Listener>();
  private readonly statWaiters = new Map<number, (s: ThreadStats) => void>();
  private nextReq = 1;
  private started = false;

  constructor(private readonly opts: SimThreadPoolOptions) {
    if (!Number.isInteger(opts.threads) || opts.threads < 1) throw new Error(`SIM_THREADS must be a positive integer, got ${opts.threads}`);
  }

  get size(): number {
    return this.opts.threads;
  }

  /** Number of threads currently alive. */
  get live(): number {
    return this.workers.filter(Boolean).length;
  }

  threadOf(planetId: string): number {
    return threadOf(planetId, this.opts.threads);
  }

  /** Spawns all threads and resolves once each has reported `ready`. */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    const entry = this.opts.entry ?? new URL('./thread/sim-thread.ts', import.meta.url);
    const execArgv = process.execArgv.some((a) => a.includes(SWC_LOADER)) ? undefined : [...process.execArgv, '--import', SWC_LOADER];
    await Promise.all(
      Array.from({ length: this.opts.threads }, (_, thread) => this.spawn(thread, entry, execArgv)),
    );
  }

  private spawn(thread: number, entry: URL, execArgv: string[] | undefined): Promise<void> {
    const init: ThreadInit = { thread, flags: this.opts.flags, autoStep: this.opts.autoStep ?? true, deltaHz: this.opts.deltaHz, simModules: this.opts.simModules };
    const w = new Worker(entry, { workerData: init, ...(execArgv ? { execArgv } : {}) });
    this.workers[thread] = w;
    return new Promise<void>((resolve, reject) => {
      w.on('message', (msg: FromThread) => {
        if (msg.t === 'ready') return resolve();
        if (msg.t === 'stats') this.statWaiters.get(msg.reqId)?.({ thread: msg.thread, planets: msg.planets, steps: msg.steps, maxLag: msg.maxLag, recentPasses: msg.recentPasses });
        for (const l of this.listeners) l(thread, msg);
      });
      w.on('error', (e: Error) => {
        this.listeners.forEach((l) => l(thread, { t: 'error', thread, message: e.message }));
        reject(e);
      });
      w.on('exit', () => {
        this.workers[thread] = undefined;
        this.listeners.forEach((l) => l(thread, { t: 'stopped', thread }));
      });
    });
  }

  /** Receives every message from every thread (the GamePlanets service is the main listener). Returns an unsubscribe fn. */
  listen(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  /** Sends to a specific thread; returns false if it is dead. */
  send(thread: number, msg: ToThread, transfer: ArrayBuffer[] = []): boolean {
    const w = this.workers[thread];
    if (!w) return false;
    w.postMessage(msg, transfer);
    return true;
  }

  /** Sends to the thread that owns `planetId`. */
  sendToPlanet(planetId: string, msg: ToThread, transfer: ArrayBuffer[] = []): boolean {
    return this.send(this.threadOf(planetId), msg, transfer);
  }

  /** Asks every live thread for its planet table (`ctl stats`). Dead or silent threads are reported with no planets. */
  async stats(timeoutMs = 1500): Promise<ThreadStats[]> {
    return Promise.all(this.workers.map((w, thread) => (w ? this.statsOf(thread, timeoutMs) : { thread, planets: [], steps: 0, maxLag: 0, recentPasses: [] })));
  }

  private statsOf(thread: number, timeoutMs: number): Promise<ThreadStats> {
    const reqId = this.nextReq++;
    return new Promise<ThreadStats>((resolve) => {
      const done = (s: ThreadStats) => { clearTimeout(timer); this.statWaiters.delete(reqId); resolve(s); };
      const timer = setTimeout(() => done({ thread, planets: [], steps: 0, maxLag: 0, recentPasses: [] }), timeoutMs);
      this.statWaiters.set(reqId, done);
      this.send(thread, { t: 'ctl', op: 'stats', reqId });
    });
  }

  /** Stops every thread and waits for it to exit. */
  async shutdown(): Promise<void> {
    const ws = this.workers.filter((w): w is Worker => !!w);
    const exited = ws.map((w) => new Promise<void>((r) => w.once('exit', () => r())));
    ws.forEach((w) => w.postMessage({ t: 'ctl', op: 'stop' } satisfies ToThread));
    const timer = setTimeout(() => ws.forEach((w) => void w.terminate()), 3000);
    await Promise.all(exited);
    clearTimeout(timer);
    this.listeners.clear();
  }
}

import type { FromThread, PlanetStats, ToThread } from '../thread/protocol';

/**
 * Assumed load (thread ms per wall second) of a planet until two stats pushes measured it: spreads a burst of loads
 * (boot restores) evenly instead of stacking them on the thread that looked idle a moment ago.
 */
export const UNMEASURED_PLANET_LOAD = 20;
/** Pushes that must list a planet before its measured load replaces the estimate. */
const MEASURED_AFTER_PUSHES = 2;

/** Routing facts of one placed planet: where it runs, and what a move must re-apply on the new thread. */
export interface Placement {
  thread: number;
  /** The thread answered `loaded`. */
  confirmed: boolean;
  /** Loaded with a restart catch-up that has not posted `fastRan` yet. */
  catchingUp: boolean;
  /** Flags / scenario overrides of the load (not in the snapshot). */
  flags?: readonly string[];
  overrides?: Extract<ToThread, { t: 'load' }>['overrides'];
  subscribed: boolean;
  mode?: 'active' | 'coarse';
  /** Last requested dev warp. */
  warp?: number;
  /** Measured thread ms per second (smoothed by the thread), and how many pushes listed it. */
  loadMsPerSec: number;
  pushes: number;
}

/**
 * Placement table (3.1): planet -> sim thread. A planet is placed when its `load` is routed, on the live thread with the
 * lowest load (sum of its planets' measured step ms per second; planets not measured yet count
 * {@link UNMEASURED_PLANET_LOAD}), fewest planets on a tie. It stays there until it is unloaded, fails, its thread dies,
 * or the rebalancer moves it. Every main -> thread message for a planet is routed through `route`.
 */
export class PlacementTable {
  private readonly placed = new Map<string, Placement>();

  constructor(readonly threads: number, private readonly isLive: (thread: number) => boolean = () => true) {}

  /** Where the planet runs; for a planet not placed, where a load would put it now (nothing is pinned). */
  threadOf(planetId: string): number {
    return this.placed.get(planetId)?.thread ?? this.pick();
  }

  get(planetId: string): Placement | undefined {
    return this.placed.get(planetId);
  }

  /** The thread for `msg`: places the planet on a `load`, and records what a move must replay (subscription, mode, warp). */
  route(planetId: string, msg: ToThread): number {
    let p = this.placed.get(planetId);
    if (!p && msg.t === 'load') p = this.place(planetId, this.pick(), msg);
    if (!p) return this.pick();
    if (msg.t === 'subscribe' || msg.t === 'unsubscribe') p.subscribed = msg.t === 'subscribe';
    else if (msg.t === 'ctl' && msg.op === 'mode') p.mode = msg.mode;
    else if (msg.t === 'ctl' && msg.op === 'warp') p.warp = msg.k;
    return p.thread;
  }

  /** A `load` sent straight to a thread (tests, tools): the planet is placed there. */
  placeAt(thread: number, msg: Extract<ToThread, { t: 'load' }>): void {
    if (!this.placed.has(msg.planetId)) this.place(msg.planetId, thread, msg);
  }

  private place(planetId: string, thread: number, msg: Extract<ToThread, { t: 'load' }>): Placement {
    const p: Placement = {
      thread, confirmed: false, catchingUp: (msg.catchUpTicks ?? 0) > 0, flags: msg.flags, overrides: msg.overrides,
      subscribed: false, loadMsPerSec: 0, pushes: 0,
    };
    this.placed.set(planetId, p);
    return p;
  }

  /** Moves the planet's routing to `thread` (rebalancing). */
  setThread(planetId: string, thread: number): void {
    const p = this.placed.get(planetId);
    if (p) { p.thread = thread; p.pushes = 0; }
  }

  release(planetId: string): void {
    this.placed.delete(planetId);
  }

  /** Drops every planet of a dead thread (after the listeners mapped them through `threadOf`). */
  releaseThread(thread: number): void {
    for (const [id, p] of this.placed) if (p.thread === thread) this.placed.delete(id);
  }

  planetsOn(thread: number): string[] {
    return [...this.placed].filter(([, p]) => p.thread === thread).map(([id]) => id);
  }

  /** Measured load of a planet, or the estimate while it has not been measured. */
  loadOf(planetId: string): number {
    const p = this.placed.get(planetId);
    if (!p) return 0;
    return p.pushes >= MEASURED_AFTER_PUSHES ? p.loadMsPerSec : Math.max(p.loadMsPerSec, UNMEASURED_PLANET_LOAD);
  }

  /** Sum of the loads of the planets placed on the thread. */
  threadLoad(thread: number): number {
    let sum = 0;
    for (const [id, p] of this.placed) if (p.thread === thread) sum += this.loadOf(id);
    return sum;
  }

  /** Follows a thread's answer (after the listeners ran): confirms loads, frees planets that left the thread. */
  afterMessage(thread: number, msg: FromThread): void {
    const p = 'planetId' in msg && msg.planetId ? this.placed.get(msg.planetId) : undefined;
    if (!p || p.thread !== thread) return;
    if (msg.t === 'loaded') p.confirmed = true;
    else if (msg.t === 'fastRan') p.catchingUp = false;
    else if (msg.t === 'unloaded' || msg.t === 'planetFailed' || (msg.t === 'error' && !p.confirmed)) this.release(msg.planetId!);
  }

  /** Applies a stats message of `thread`: per-planet measured loads. */
  observe(thread: number, planets: readonly PlanetStats[]): void {
    for (const s of planets) {
      const p = this.placed.get(s.planetId);
      if (!p || p.thread !== thread) continue;
      p.loadMsPerSec = s.loadMsPerSec;
      p.pushes++;
    }
  }

  /** The live thread with the lowest load, then the fewest planets, then the lowest index. */
  pick(): number {
    let best = -1;
    let bestLoad = Infinity;
    let bestCount = Infinity;
    for (let t = 0; t < this.threads; t++) {
      if (!this.isLive(t)) continue;
      const load = this.threadLoad(t);
      const count = this.planetsOn(t).length;
      if (load < bestLoad || (load === bestLoad && count < bestCount)) { best = t; bestLoad = load; bestCount = count; }
    }
    return best < 0 ? 0 : best;
  }
}

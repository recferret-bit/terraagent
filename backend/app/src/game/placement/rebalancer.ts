import type { PlacementTable } from './placement-table';

export interface RebalanceOptions {
  /** A thread busier than this share of wall time is hot (default 0.7). */
  readonly busyAbove?: number;
  /** ...for this long before one of its planets moves (default 60 s). */
  readonly sustainMs?: number;
  /** Min time between two moves (default 60 s). */
  readonly cooldownMs?: number;
}

export const REBALANCE_DEFAULTS: Required<RebalanceOptions> = { busyAbove: 0.7, sustainMs: 60_000, cooldownMs: 60_000 };

export interface MoveDecision { readonly planetId: string; readonly from: number; readonly to: number }

/**
 * Rebalancing policy (3.2), pure: a thread that stays above `busyAbove` for `sustainMs` gives one planet to the least
 * loaded live thread. A planet may move only if the target stays below `busyAbove` with it and below the hot thread's
 * load, so a planet that alone dominates its thread is not moved (that only moves the problem, and could ping-pong);
 * its neighbours are, so they stop sharing a thread with it. Among the candidates a planet nobody watches goes first (no
 * client resync), then the one that leaves the pair's busier side lowest. Planets still loading, catching up or moving
 * never move; one move per cooldown.
 */
export class Rebalancer {
  private readonly hotSince = new Map<number, number>();
  private lastMoveMs = -Infinity;
  private readonly o: Required<RebalanceOptions>;

  constructor(private readonly table: PlacementTable, opts: RebalanceOptions = {}) {
    this.o = { ...REBALANCE_DEFAULTS, ...opts };
  }

  /** One stats sample of a thread. */
  observe(thread: number, busyRatio: number, nowMs: number): void {
    if (busyRatio > this.o.busyAbove) { if (!this.hotSince.has(thread)) this.hotSince.set(thread, nowMs); } else this.hotSince.delete(thread);
  }

  forgetThread(thread: number): void {
    this.hotSince.delete(thread);
  }

  /** The move to make now, if any. `movable` excludes planets that are loading, catching up or already moving. */
  decide(nowMs: number, live: readonly number[], movable: (planetId: string) => boolean): MoveDecision | undefined {
    if (nowMs - this.lastMoveMs < this.o.cooldownMs) return undefined;
    const hot = this.hottest(nowMs, live);
    if (hot === undefined) return undefined;
    const others = live.filter((t) => t !== hot);
    if (others.length === 0) return undefined;
    const to = others.reduce((a, b) => (this.table.threadLoad(b) < this.table.threadLoad(a) ? b : a));
    const pick = this.bestPlanet(hot, to, movable);
    if (!pick) return undefined;
    this.lastMoveMs = nowMs;
    this.hotSince.delete(hot);
    return { planetId: pick, from: hot, to };
  }

  private hottest(nowMs: number, live: readonly number[]): number | undefined {
    let hot: number | undefined;
    for (const t of live) {
      const since = this.hotSince.get(t);
      if (since === undefined || nowMs - since < this.o.sustainMs) continue;
      if (hot === undefined || this.table.threadLoad(t) > this.table.threadLoad(hot)) hot = t;
    }
    return hot;
  }

  private bestPlanet(from: number, to: number, movable: (planetId: string) => boolean): string | undefined {
    const hotLoad = this.table.threadLoad(from);
    const coldLoad = this.table.threadLoad(to);
    const targetCap = Math.min(hotLoad, this.o.busyAbove * 1000); // thread ms per wall second
    let best: { id: string; peak: number; watched: boolean } | undefined;
    for (const id of this.table.planetsOn(from)) {
      const l = this.table.loadOf(id);
      if (!movable(id) || coldLoad + l >= targetCap) continue;
      const peak = Math.max(hotLoad - l, coldLoad + l);
      const watched = this.table.get(id)?.subscribed ?? false;
      if (!best || (watched !== best.watched ? !watched : peak < best.peak)) best = { id, peak, watched };
    }
    return best?.id;
  }
}

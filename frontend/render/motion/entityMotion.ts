import { lerpAngle, type Pose } from './pose';

/**
 * Shared tick-keyed unit motion for gameplay, March and Hive previews. The sim moves a unit a fixed distance per tick along its route; views reach
 * the client at irregular moments (deltas at 5 Hz, predicted views on input, the confirmed view again once a command
 * is acknowledged) and may step back to an older tick when prediction hands over to the confirmed state. Drawing each
 * view as it arrives therefore jitters, pauses and jumps back.
 *
 * Instead every entity keeps a short history of poses by tick (`MotionTrack`: a sample for an older tick is inserted,
 * a newer sample for the same tick replaces the older guess), and the scene is drawn at one shared `RenderClock` that
 * runs at the sim's tick rate a little behind the newest tick seen and never runs backwards. The drawn pose is the
 * linear interpolation of the two samples around the clock, which is exactly the sim's constant-speed walk.
 */

/** How far (ticks) the clock runs behind the newest tick seen: 1.5 ticks absorbs 5 Hz deltas with jitter. */
export const RENDER_DELAY_TICKS = 1.5;
/** Past the newest sample, follow the last velocity for at most this long (ticks), then hold. */
export const MAX_EXTRAPOLATE_TICKS = 0.5;
/** A gap bigger than this (ticks) between the clock and its target is a resync (load, reconnect, warp jump): snap. */
export const SNAP_TICKS = 25;
/** A sample older than the newest by more than this (ticks) is a resync: the track restarts. */
const RESYNC_TICKS = 50;
const CAPACITY = 24;

export interface TickPose extends Pose { tick: number }

/** One entity's recent poses by tick, oldest first. */
export class MotionTrack {
  private s: TickPose[] = [];

  get length(): number { return this.s.length; }
  get newestTick(): number { return this.s.length ? this.s[this.s.length - 1].tick : -Infinity; }

  /**
   * Adds the pose at `tick`: replaces a sample at the same tick, inserts an older one in order, appends a newer one.
   * Returns the correction in tiles: how far a replaced sample (a predicted guess the confirmed view now overrides)
   * moved; 0 when nothing was replaced.
   */
  push(p: TickPose): number {
    const s = this.s;
    if (s.length && p.tick < this.newestTick - RESYNC_TICKS) s.length = 0;
    let i = s.length;
    while (i > 0 && s[i - 1].tick > p.tick) i--;
    let moved = 0;
    if (i > 0 && s[i - 1].tick === p.tick) {
      moved = Math.hypot(p.x - s[i - 1].x, p.y - s[i - 1].y);
      s[i - 1] = { ...p };
    } else s.splice(i, 0, { ...p });
    if (s.length > CAPACITY) s.splice(0, s.length - CAPACITY);
    return moved;
  }

  /** Drops samples after `tick` (a predicted future that a rejected command made wrong). */
  dropAfter(tick: number): void {
    while (this.s.length > 1 && this.s[this.s.length - 1].tick > tick) this.s.pop();
  }

  /** Pose at fractional tick `t` (null when empty). */
  at(t: number): Pose | null {
    const s = this.s;
    if (!s.length) return null;
    const first = s[0];
    const last = s[s.length - 1];
    if (t <= first.tick) return { x: first.x, y: first.y, rot: first.rot };
    if (t <= last.tick) {
      let i = s.length - 2;
      while (i > 0 && s[i].tick > t) i--;
      const a = s[i];
      const b = s[i + 1];
      const k = (t - a.tick) / (b.tick - a.tick);
      return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, rot: lerpAngle(a.rot, b.rot, k) };
    }
    const prev = s[s.length - 2];
    if (!prev) return { x: last.x, y: last.y, rot: last.rot };
    const span = last.tick - prev.tick;
    const ahead = Math.min(t - last.tick, MAX_EXTRAPOLATE_TICKS);
    return { x: last.x + ((last.x - prev.x) / span) * ahead, y: last.y + ((last.y - prev.y) / span) * ahead, rot: last.rot };
  }
}

/**
 * The tick the scene is drawn at, driven by real time. It measures the sim's tick rate from the views it observes
 * (5 ticks/s, or k× that under `warp k`), runs at that rate a little behind the newest tick seen, eases out drift with
 * a real-time gain, and never moves backwards except on a resync.
 */
export class RenderClock {
  private t = Number.NaN;
  private newest = Number.NEGATIVE_INFINITY;
  private elapsed = 0;
  private rateAt = { tick: 0, time: 0 };
  /** Measured sim rate (ticks per real second). */
  rate: number;

  constructor(private readonly tickSeconds: number) {
    this.rate = 1 / tickSeconds;
  }

  get tick(): number { return Number.isNaN(this.t) ? 0 : this.t; }

  /** How far behind the newest tick the clock runs: 1.5 ticks at 1×, the same 0.3 s of real time under warp. */
  private delay(): number { return RENDER_DELAY_TICKS * Math.max(1, this.rate * this.tickSeconds); }

  /** The newest server-confirmed tick is `tick` (callers pass confirmed ticks only, never predicted ones). */
  observe(tick: number): void {
    if (Number.isNaN(this.t) || tick < this.newest - RESYNC_TICKS * Math.max(1, this.rate * this.tickSeconds)) {
      this.newest = tick;
      this.t = tick - this.delay();
      this.rateAt = { tick, time: this.elapsed };
      return;
    }
    if (tick <= this.newest) return;
    this.newest = tick;
    const span = this.elapsed - this.rateAt.time;
    if (span >= 0.4) { // measure over at least two 5 Hz deltas
      const sample = (tick - this.rateAt.tick) / span;
      const base = 1 / this.tickSeconds;
      this.rate = Math.min(base * 200, Math.max(base, this.rate * 0.6 + sample * 0.4));
      this.rateAt = { tick, time: this.elapsed };
    }
  }

  /** Moves the clock by `realDtSeconds` of wall-clock time (not warp-scaled: the measured rate covers warp). */
  advance(realDtSeconds: number): number {
    this.elapsed += realDtSeconds;
    if (Number.isNaN(this.t)) return 0;
    const target = this.newest - this.delay();
    const next = this.t + realDtSeconds * this.rate;
    const err = target - next;
    if (Math.abs(err) > SNAP_TICKS * Math.max(1, this.rate * this.tickSeconds)) {
      this.t = target; // resync (load, reconnect, long stall): snap
      return this.t;
    }
    this.t = Math.max(this.t, next + err * Math.min(0.5, realDtSeconds * 2));
    return this.t;
  }
}

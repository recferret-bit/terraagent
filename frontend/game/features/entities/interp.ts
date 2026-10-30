import { lerpAngle, type Pose } from './blend';

/** `?predict=0` fallback (SIM-X-05, CLIENT §7): render the replica 400 ms behind the server, extrapolate <= 200 ms, then hold. */
export const INTERP_DELAY_TICKS = 2;
export const EXTRAPOLATE_MAX_TICKS = 1;
/** Entities never move this fast (tiles per tick); a bigger step is a teleport, so it is not extrapolated. */
export const MAX_EXTRAPOLATE_SPEED = 2;
const CAPACITY = 8;

export interface Sample extends Pose { tick: number }

export class SampleBuffer {
  private s: Sample[] = [];

  get length(): number { return this.s.length; }

  /** Same tick replaces the newest sample; an older tick (resync) restarts the buffer. */
  push(p: Sample): void {
    const last = this.s[this.s.length - 1];
    if (last && p.tick === last.tick) { this.s[this.s.length - 1] = { ...p }; return; }
    if (last && p.tick < last.tick) this.s = [];
    this.s.push({ ...p });
    if (this.s.length > CAPACITY) this.s.shift();
  }

  /** Pose at fractional tick `t`, or null when empty. */
  sampleAt(t: number): Pose | null {
    const s = this.s;
    if (s.length === 0) return null;
    const first = s[0], last = s[s.length - 1];
    if (t <= first.tick) return { x: first.x, y: first.y, rot: first.rot };
    if (t < last.tick) {
      let i = s.length - 2;
      while (i > 0 && s[i].tick > t) i--;
      const a = s[i], b = s[i + 1], k = (t - a.tick) / (b.tick - a.tick);
      return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, rot: lerpAngle(a.rot, b.rot, k) };
    }
    const prev = s[s.length - 2];
    if (!prev) return { x: last.x, y: last.y, rot: last.rot };
    const span = last.tick - prev.tick;
    const vx = (last.x - prev.x) / span, vy = (last.y - prev.y) / span;
    if (Math.hypot(vx, vy) > MAX_EXTRAPOLATE_SPEED) return { x: last.x, y: last.y, rot: last.rot };
    const dt = Math.min(t - last.tick, EXTRAPOLATE_MAX_TICKS);
    return { x: last.x + vx * dt, y: last.y + vy * dt, rot: last.rot };
  }
}

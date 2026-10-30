/** Correction blend (SIM-X-04): the rendered pose follows the target; a jump is absorbed over `CORRECTION_MS`. */

export const CORRECTION_MS = 150;
/** A target move longer than this (tiles) is a correction (rebase / server placed it elsewhere): ease-out. Shorter moves are normal motion: linear. */
export const CORRECTION_MIN_TILES = 0.5;

export interface Pose { x: number; y: number; rot: number }

const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;
/** Shortest-arc interpolation of an angle in radians. */
export const lerpAngle = (a: number, b: number, k: number): number => {
  const d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + d * k;
};
const easeOutCubic = (u: number): number => 1 - (1 - u) ** 3;

/**
 * One entity's rendered pose. `setTarget` starts a blend from wherever the entity is drawn right now to the new
 * target; `at(now)` returns the pose (exactly the target once the blend is over). Discrete fields (hp, state, owner,
 * kind) are not blended: callers read them straight from the view.
 */
export class PoseBlender {
  private from: Pose;
  private to: Pose;
  private t0: number;
  private ease = false;
  private duration = CORRECTION_MS;

  constructor(start: Pose, nowMs: number) { this.from = { ...start }; this.to = { ...start }; this.t0 = nowMs; }

  get target(): Pose { return this.to; }

  /** Returns the size of the correction in tiles (0 for no change or ordinary motion). */
  setTarget(p: Pose, nowMs: number, durationMs = CORRECTION_MS): number {
    if (p.x === this.to.x && p.y === this.to.y && p.rot === this.to.rot) return 0;
    const jump = Math.hypot(p.x - this.to.x, p.y - this.to.y);
    this.from = this.at(nowMs);
    this.to = { ...p };
    this.t0 = nowMs;
    this.duration = durationMs;
    this.ease = jump > CORRECTION_MIN_TILES;
    return this.ease ? jump : 0;
  }

  at(nowMs: number): Pose {
    const u = this.duration <= 0 ? 1 : Math.min(1, Math.max(0, (nowMs - this.t0) / this.duration));
    if (u >= 1) return { ...this.to };
    const k = this.ease ? easeOutCubic(u) : u;
    return { x: lerp(this.from.x, this.to.x, k), y: lerp(this.from.y, this.to.y, k), rot: lerpAngle(this.from.rot, this.to.rot, k) };
  }
}

import { HEX_PREP, INITIAL_PREP_START_TIME, PREP_BLEND_DURATION_S } from './chunkMesh';

/**
 * Per-tile start times of the 0.4 s Wild -> Prepared pad blend. A tile prepared during play starts its blend at the
 * current time (its chunk draws the old ground style under the shader wave); once the blend is over, `settle` resets it
 * to the "already complete" sentinel so its chunk can be rebuilt with the same pad style a reload would give (RN-09).
 */
export class PrepTransitions {
  readonly startTimes: Float32Array;
  private readonly prev: Uint8Array;
  private readonly pending = new Set<number>();

  constructor(count: number, prep?: ArrayLike<number>) {
    this.startTimes = new Float32Array(count).fill(INITIAL_PREP_START_TIME);
    this.prev = new Uint8Array(count);
    for (let i = 0; i < count; i++) this.prev[i] = prep?.[i] ?? 0;
  }

  /** Records prep changes: a tile that just became Prepared starts blending at `now`. */
  sync(nextPrep: ArrayLike<number> | undefined, now: number): void {
    for (let i = 0; i < this.prev.length; i++) {
      const wasPrep = this.prev[i] === HEX_PREP.prepared;
      const p = nextPrep?.[i] ?? 0;
      const nowPrep = p === HEX_PREP.prepared;
      if (!wasPrep && nowPrep) { this.startTimes[i] = now; this.pending.add(i); }
      else if (!nowPrep) { this.startTimes[i] = INITIAL_PREP_START_TIME; this.pending.delete(i); }
      this.prev[i] = p;
    }
  }

  /** Tiles whose blend finished by `now`; their start time is reset to the sentinel. Empty most frames. */
  settle(now: number): number[] {
    if (this.pending.size === 0) return [];
    const done: number[] = [];
    for (const i of this.pending) {
      if (now - this.startTimes[i]! < PREP_BLEND_DURATION_S) continue;
      this.startTimes[i] = INITIAL_PREP_START_TIME;
      done.push(i);
    }
    for (const i of done) this.pending.delete(i);
    return done;
  }

  /** [0..1] blend of tile `i` at `now` (0 when it is not Prepared). */
  blend(i: number, isPrepared: boolean, now: number): number {
    if (!isPrepared) return 0;
    const start = this.startTimes[i] ?? INITIAL_PREP_START_TIME;
    return Math.min(1, Math.max(0, (now - start) / PREP_BLEND_DURATION_S));
  }
}

/** Prediction is switched off when the p95 of its rebuild time exceeds this (SIM-X-05). */
export const PREDICT_P95_LIMIT_MS = 4;

/** Sliding window of the last `cap` prediction rebuild times (ms). */
export class StepTimes {
  private v: number[] = [];
  constructor(private readonly cap = 32, private readonly minSamples = 16) {}

  add(ms: number): void { this.v.push(ms); if (this.v.length > this.cap) this.v.shift(); }
  get count(): number { return this.v.length; }

  p95(): number {
    if (this.v.length === 0) return 0;
    const s = [...this.v].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)];
  }

  /** True once there are enough samples and their p95 is over `limitMs`. */
  exceeds(limitMs = PREDICT_P95_LIMIT_MS): boolean { return this.v.length >= this.minSamples && this.p95() > limitMs; }
}

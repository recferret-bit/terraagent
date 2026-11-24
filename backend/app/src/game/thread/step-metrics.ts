import { SLOW_STEP_MS } from '@terra/sim';
import type { StepSamples } from './protocol';

/** A slow step of one planet is reported at most this often (the rest are counted in `suppressed`). */
export const SLOW_WARN_EVERY_MS = 10_000;
/** Step samples kept per planet between two pushes (5 TPS x 1 s needs 5; warp and catch-up need more). */
export const MAX_SAMPLES_PER_PUSH = 512;
/** Smoothing of the per-window load figures (per push window, ~1 s). */
const LOAD_ALPHA = 0.3;

interface PlanetMeter {
  winMs: number;
  loadMsPerSec: number;
  samples: number[];
  lastWarnMs: number;
  suppressed: number;
}

export interface SlowStepReport { readonly ms: number; readonly suppressed: number }

/**
 * Thread-side load accounting (observability 0.6, placement 3.1): wall ms spent stepping each planet, the thread's busy
 * share, step samples for the main-thread histogram, and the rate-limited slow-step gate. Pure (clock injected).
 */
export class ThreadLoadMeter {
  private readonly planets = new Map<string, PlanetMeter>();
  private busyMs = 0;
  private windowStart: number;
  private primed = false;
  /** Smoothed share of wall time spent stepping (0..1). */
  busyRatio = 0;

  constructor(private readonly now: () => number) {
    this.windowStart = now();
  }

  private meter(planetId: string): PlanetMeter {
    let m = this.planets.get(planetId);
    if (!m) this.planets.set(planetId, (m = { winMs: 0, loadMsPerSec: 0, samples: [], lastWarnMs: -Infinity, suppressed: 0 }));
    return m;
  }

  /** One scheduler slot of `ms`. Returns a slow-step report when it was slow and the planet's warn gate is open. */
  record(planetId: string, ms: number, steps = 1): SlowStepReport | undefined {
    const m = this.meter(planetId);
    this.busyMs += ms;
    m.winMs += ms;
    if (m.samples.length < MAX_SAMPLES_PER_PUSH) m.samples.push(Math.round(ms * 100) / 100);
    if (ms / Math.max(1, steps) <= SLOW_STEP_MS) return undefined;
    const t = this.now();
    if (t - m.lastWarnMs < SLOW_WARN_EVERY_MS) { m.suppressed++; return undefined; }
    const suppressed = m.suppressed;
    m.lastWarnMs = t;
    m.suppressed = 0;
    return { ms, suppressed };
  }

  /** Thread time spent on a planet outside the scheduler (restart catch-up): load, no histogram sample. */
  recordBusy(planetId: string, ms: number): void {
    this.busyMs += ms;
    this.meter(planetId).winMs += ms;
  }

  forget(planetId: string): void {
    this.planets.delete(planetId);
  }

  /** Smoothed thread ms per wall second spent on the planet (0 for an unknown one). */
  loadOf(planetId: string): number {
    return this.planets.get(planetId)?.loadMsPerSec ?? 0;
  }

  /** Closes the window: updates the smoothed figures and hands over (and clears) the step samples. */
  roll(): StepSamples[] {
    const t = this.now();
    const windowMs = Math.max(1, t - this.windowStart);
    const alpha = this.primed ? LOAD_ALPHA : 1;
    this.busyRatio += alpha * (Math.min(1, this.busyMs / windowMs) - this.busyRatio);
    const samples: StepSamples[] = [];
    for (const [planetId, m] of this.planets) {
      m.loadMsPerSec += alpha * ((m.winMs * 1000) / windowMs - m.loadMsPerSec);
      m.winMs = 0;
      if (m.samples.length) samples.push({ planetId, ms: m.samples.splice(0) });
    }
    this.busyMs = 0;
    this.windowStart = t;
    this.primed = true;
    return samples;
  }
}

import { COARSE_DT, TICK_MS } from '@terra/sim';

/** Per-planet cadence (SIM-H-03/04): `active` = `dt 1` every `TICK_MS`; `coarse` = `dt COARSE_DT` every `COARSE_STEP_MS`. */
export type StepMode = 'active' | 'coarse';

export const COARSE_STEP_MS = 1000;
/** Max due slots stepped per planet per pass (SIM-H-05). */
export const MAX_CATCHUP = 5;
/** Cap of the time-warp multiplier. */
export const MAX_WARP = 100;

export interface SchedulerClock {
  now(): number;
  /** Runs `fn` once after `delayMs`; returns a cancel function. */
  schedule(fn: () => void, delayMs: number): () => void;
}

export interface SchedulerOptions extends SchedulerClock {
  /** Steps one planet by `dt` ticks. Must not throw (the caller isolates planet errors). */
  step(planetId: string, dt: number): void;
}

export interface PlanetSchedule {
  readonly planetId: string;
  readonly mode: StepMode;
  readonly warp: number;
  readonly nextDueMs: number;
  /** How many steps the planet is behind its due time after the last pass (0 = on time). */
  readonly lagSteps: number;
  /** Engine steps executed for it in the last pass (includes warp multiples). */
  readonly stepsLastPass: number;
}

export interface PassReport {
  readonly atMs: number;
  /** Engine steps executed in this pass across planets. */
  readonly steps: number;
  /** Max steps for a single planet in this pass. */
  readonly maxPlanetSteps: number;
  readonly maxLag: number;
}

interface Entry {
  mode: StepMode;
  warp: number;
  nextDueMs: number;
  lagSteps: number;
  stepsLastPass: number;
}

const intervalOf = (mode: StepMode): number => (mode === 'active' ? TICK_MS : COARSE_STEP_MS);
const dtOf = (mode: StepMode): number => (mode === 'active' ? 1 : COARSE_DT);

/**
 * One drift-free stepping loop per sim thread. Each planet owns `nextDueMs`; a step always advances it by exactly one
 * interval (never "now + interval"), so timer jitter and blocked passes never change the long-run rate. A planet behind
 * its due time steps up to `MAX_CATCHUP` due slots per pass and the remaining lag is reported, not hidden.
 *
 * Time warp (`setWarp(id, k)`): every due slot runs `k` engine steps instead of one. The catch-up cap counts due slots,
 * so a pass executes at most `MAX_CATCHUP * k` engine steps per planet. Mode switching rules (presence) live elsewhere
 * and call `setMode`.
 */
export class PlanetScheduler {
  private readonly entries = new Map<string, Entry>();
  private cancel: (() => void) | undefined;
  private running = false;
  /** Total engine steps executed. */
  totalSteps = 0;
  lastPass: PassReport = { atMs: 0, steps: 0, maxPlanetSteps: 0, maxLag: 0 };
  onPass: ((r: PassReport) => void) | undefined;

  constructor(private readonly o: SchedulerOptions) {}

  start(): void {
    this.running = true;
    this.arm();
  }

  stop(): void {
    this.running = false;
    this.cancel?.();
    this.cancel = undefined;
  }

  /** Registers a planet as `active`, due now. */
  add(planetId: string, mode: StepMode = 'active'): void {
    if (this.entries.has(planetId)) return;
    this.entries.set(planetId, { mode, warp: 1, nextDueMs: this.o.now(), lagSteps: 0, stepsLastPass: 0 });
    if (this.running) this.arm();
  }

  remove(planetId: string): void {
    this.entries.delete(planetId);
  }

  setMode(planetId: string, mode: StepMode): void {
    const e = this.entries.get(planetId);
    if (e) e.mode = mode;
  }

  /** `k` engine steps per due slot, clamped to 1..MAX_WARP. */
  setWarp(planetId: string, k: number): void {
    const e = this.entries.get(planetId);
    if (e) e.warp = Math.min(MAX_WARP, Math.max(1, Math.floor(k) || 1));
  }

  info(planetId: string): PlanetSchedule | undefined {
    const e = this.entries.get(planetId);
    return e && { planetId, ...e };
  }

  /** Max lag over all planets (the `ta_game_tick_lag_steps` value of this thread). */
  get maxLag(): number {
    let m = 0;
    for (const e of this.entries.values()) m = Math.max(m, e.lagSteps);
    return m;
  }

  /** One pass: step every due planet (bounded catch-up), recompute lag. Exposed for deterministic tests. */
  runPass(): PassReport {
    const now = this.o.now();
    let steps = 0;
    let maxPlanetSteps = 0;
    for (const [id, e] of this.entries) {
      const interval = intervalOf(e.mode);
      let slots = 0;
      let n = 0;
      while (e.nextDueMs <= now && slots < MAX_CATCHUP) {
        for (let k = 0; k < e.warp; k++) this.o.step(id, dtOf(e.mode));
        n += e.warp;
        e.nextDueMs += interval;
        slots++;
      }
      e.stepsLastPass = n;
      e.lagSteps = e.nextDueMs <= now ? Math.floor((now - e.nextDueMs) / interval) + 1 : 0;
      steps += n;
      maxPlanetSteps = Math.max(maxPlanetSteps, n);
    }
    this.totalSteps += steps;
    this.lastPass = { atMs: now, steps, maxPlanetSteps, maxLag: this.maxLag };
    this.onPass?.(this.lastPass);
    return this.lastPass;
  }

  private arm(): void {
    this.cancel?.();
    this.cancel = undefined;
    if (!this.running || this.entries.size === 0) return;
    let next = Infinity;
    for (const e of this.entries.values()) next = Math.min(next, e.nextDueMs);
    // delay >= 0; even when still behind we go through the timer so messages are handled between passes
    this.cancel = this.o.schedule(() => { this.cancel = undefined; this.runPass(); this.arm(); }, Math.max(0, next - this.o.now()));
  }
}

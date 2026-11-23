import { COARSE_DT, TICK_MS } from '../kernel/constants';

/** Per-planet cadence (SIM-H-03/04): `active` = `dt 1` every `TICK_MS`; `coarse` = `dt COARSE_DT` every `COARSE_STEP_MS`. */
export type StepMode = 'active' | 'coarse';

export const COARSE_STEP_MS = 1000;
/** Max due slots stepped per planet per turn (SIM-H-05): a planet behind catches up one slot per turn, never in a burst. */
export const MAX_CATCHUP = 1;
/** Max due slots a planet may owe; older slots are skipped (counted in `droppedSlots`), never stepped late. */
export const MAX_DEBT_SLOTS = 25;
/** Wall budget of one turn: after it the scheduler yields to the message loop (commands, stats) before stepping on. */
export const TURN_BUDGET_MS = 8;
/** A step slower than one tick cannot keep 5 TPS. */
export const SLOW_STEP_MS = TICK_MS;
/** A player-less `active` planet whose last this-many steps were all slow is demoted to `coarse`. */
export const DEMOTE_AFTER_SLOW_STEPS = 5;
/** Fair-share weight of a planet with players (subscribed): it gets this many times the thread time of one without. */
export const PLAYER_WEIGHT = 4;
/**
 * A planet whose slots average more than this is heavy: it starts a slot only when no light planet is due within
 * {@link HEAVY_GAP_SHARE} of `min(its slot, one tick)`, i.e. right after the light planets stepped, so a 300 ms slot
 * makes them at most ~120 ms late instead of up to 300 ms.
 */
export const HEAVY_STEP_MS = 20;
export const HEAVY_GAP_SHARE = 0.9;
/**
 * Longest a heavy planet waits for such a gap while no heavy planet found one (staggered light planets may never leave
 * one); one tick with players. While gaps do come, heavy planets share them in fair-share order instead.
 */
export const HEAVY_MAX_HOLD_MS = 1000;
/** Cap of the time-warp multiplier. */
export const MAX_WARP = 100;
/**
 * Thread budget cap: a warped planet still `OVERLOAD_LAG_SLOTS` or more due slots behind after `OVERLOAD_PASSES` consecutive
 * steps cannot be kept up with, so its effective warp is halved (down to 1). It never rises again by itself; a new
 * `setWarp` request starts over from the requested value.
 */
export const OVERLOAD_LAG_SLOTS = 2;
export const OVERLOAD_PASSES = 3;
/** Fair-share credit an idle planet may keep (ms of weighted thread time) so a planet that was not due does not hoard it. */
const VR_SLACK_MS = 2 * TICK_MS;
/** Smoothing of `avgStepMs`. */
const AVG_ALPHA = 0.2;

export interface SchedulerClock {
  now(): number;
  /** Runs `fn` once after `delayMs` (0 = as soon as the message loop had its turn); returns a cancel function. */
  schedule(fn: () => void, delayMs: number): () => void;
}

export interface SchedulerOptions extends SchedulerClock {
  /** Steps one planet by `dt` ticks. Must not throw (the caller isolates planet errors). */
  step(planetId: string, dt: number): void;
  /** Wall budget of one turn (default {@link TURN_BUDGET_MS}). */
  turnBudgetMs?: number;
  /** Max owed slots per planet (default {@link MAX_DEBT_SLOTS}; `Infinity` keeps every slot). */
  maxDebtSlots?: number;
  /** Consecutive slow steps before a player-less planet is demoted (default {@link DEMOTE_AFTER_SLOW_STEPS}; 0 = never). */
  demoteAfterSlowSteps?: number;
  /** Due slots one planet may step in one turn (default {@link MAX_CATCHUP}). */
  maxSlotsPerTurn?: number;
}

/**
 * A host with a single planet and nothing else to serve (the browser `?host=local` engine): the pre-fairness pass, i.e.
 * up to 5 slots per turn with no budget, no debt cap and no demotion, so a throttled background tab (one timer per
 * second) still keeps 5 TPS and a frozen tab catches up all its time.
 */
export const SINGLE_PLANET_SCHEDULE = {
  maxSlotsPerTurn: 5, turnBudgetMs: Infinity, maxDebtSlots: Infinity, demoteAfterSlowSteps: 0,
} as const satisfies Partial<SchedulerOptions>;

export interface PlanetSchedule {
  readonly planetId: string;
  readonly mode: StepMode;
  /** Effective warp (requested, minus the budget cap). */
  readonly warp: number;
  readonly warpRequested: number;
  readonly nextDueMs: number;
  /** How many steps the planet is behind its due time after its last turn (0 = on time). */
  readonly lagSteps: number;
  /** Engine steps executed for it in its last turn (includes warp multiples). */
  readonly stepsLastPass: number;
  /** Someone watches it (subscribed): higher fair share, never demoted. */
  readonly players: boolean;
  /** Wall ms of its last due slot, and the smoothed average. */
  readonly lastStepMs: number;
  readonly avgStepMs: number;
  /** Due slots skipped because it owed more than the debt cap. */
  readonly droppedSlots: number;
  /** Switched to `coarse` by the scheduler (slow and nobody watching), not by presence. */
  readonly demoted: boolean;
}

export interface PassReport {
  readonly atMs: number;
  /** Engine steps executed in this turn across planets. */
  readonly steps: number;
  /** Max steps for a single planet in this turn. */
  readonly maxPlanetSteps: number;
  readonly maxLag: number;
}

/** One due slot of one planet, reported right after it ran (the host flushes that planet's delta here). */
export interface StepReport {
  /** Wall ms of the slot (all warp steps). */
  readonly ms: number;
  readonly steps: number;
  readonly mode: StepMode;
  readonly lagSteps: number;
}

interface Entry {
  readonly id: string;
  mode: StepMode;
  warp: number;
  warpRequested: number;
  overloaded: number;
  nextDueMs: number;
  lagSteps: number;
  stepsLastPass: number;
  players: boolean;
  /** Weighted wall ms consumed (fair share: the due planet with the least goes first). */
  vruntime: number;
  /** Turn number of its last step, and how many slots it stepped in that turn. */
  turn: number;
  turnSlots: number;
  lastStepMs: number;
  avgStepMs: number;
  slowStreak: number;
  droppedSlots: number;
  demoted: boolean;
  /** Heavy planet waiting for a gap: not picked before this time; and since when it waits (-1 = not waiting). */
  holdUntil: number;
  heldSince: number;
}

const intervalOf = (mode: StepMode): number => (mode === 'active' ? TICK_MS : COARSE_STEP_MS);
const dtOf = (mode: StepMode): number => (mode === 'active' ? 1 : COARSE_DT);
const lagOf = (e: Entry, now: number): number => (e.nextDueMs <= now ? Math.floor((now - e.nextDueMs) / intervalOf(e.mode)) + 1 : 0);

/**
 * One drift-free stepping loop per sim thread. Each planet owns `nextDueMs`; a step always advances it by exactly one
 * interval (never "now + interval"), so timer jitter and blocked turns never change the long-run rate.
 *
 * Fairness (one slow planet never stalls the others): a turn steps at most one due slot per planet, picking the due
 * planet with the least weighted thread time first (planets with players weigh {@link PLAYER_WEIGHT}x and win ties).
 * The turn ends once its budget is spent, or when the best due planet already stepped this turn; the thread then
 * yields to its message loop, so commands and stats are handled between any two planet steps. A heavy planet (slots
 * over {@link HEAVY_STEP_MS}) starts a slot only in a gap after the light planets stepped, so it delays them by less
 * than a tick (a slot cannot be pre-empted; moving neighbours off its thread is the rebalancer's job). A planet that owes more
 * than the debt cap skips the oldest slots; a player-less planet whose steps keep exceeding a tick is demoted to
 * `coarse`. Both are reported (`droppedSlots`, `demoted`), never hidden.
 *
 * Time warp (`setWarp(id, k)`): every due slot runs `k` engine steps instead of one. Mode switching rules (presence)
 * live elsewhere and call `setMode`.
 */
export class PlanetScheduler {
  private readonly entries = new Map<string, Entry>();
  private cancel: (() => void) | undefined;
  private running = false;
  private turnNo = 0;
  /** Weighted-time floor: the least vruntime picked so far. New and idle planets start near it. */
  private floorVr = 0;
  /** When a heavy planet last started in a gap (the hold time-box applies only when gaps stopped coming). */
  private lastGapMs = -Infinity;
  private readonly budgetMs: number;
  private readonly maxDebt: number;
  private readonly demoteAfter: number;
  private readonly maxSlots: number;
  /** Total engine steps executed. */
  totalSteps = 0;
  /** Total due slots skipped over the debt cap. */
  droppedSlots = 0;
  lastPass: PassReport = { atMs: 0, steps: 0, maxPlanetSteps: 0, maxLag: 0 };
  /** After every turn. */
  onPass: ((r: PassReport) => void) | undefined;
  /** After every planet slot, before the next planet steps. */
  onStep: ((planetId: string, r: StepReport) => void) | undefined;
  /** Called when a planet's effective warp changes (a request or a budget cap reduction). */
  onWarp: ((planetId: string, effective: number, requested: number) => void) | undefined;
  /** Called when the scheduler demotes a slow, player-less planet to `coarse`. */
  onDemote: ((planetId: string, avgStepMs: number) => void) | undefined;

  constructor(private readonly o: SchedulerOptions) {
    this.budgetMs = o.turnBudgetMs ?? TURN_BUDGET_MS;
    this.maxDebt = Math.max(1, o.maxDebtSlots ?? MAX_DEBT_SLOTS);
    this.demoteAfter = o.demoteAfterSlowSteps ?? DEMOTE_AFTER_SLOW_STEPS;
    this.maxSlots = Math.max(1, o.maxSlotsPerTurn ?? MAX_CATCHUP);
  }

  start(): void {
    this.running = true;
    this.arm();
  }

  stop(): void {
    this.running = false;
    this.cancel?.();
    this.cancel = undefined;
  }

  /** Registers a planet, due now. */
  add(planetId: string, mode: StepMode = 'active'): void {
    if (this.entries.has(planetId)) return;
    this.entries.set(planetId, {
      id: planetId, mode, warp: 1, warpRequested: 1, overloaded: 0, nextDueMs: this.o.now(), lagSteps: 0, stepsLastPass: 0,
      players: false, vruntime: this.floorVr, turn: 0, turnSlots: 0, lastStepMs: 0, avgStepMs: 0, slowStreak: 0, droppedSlots: 0, demoted: false,
      holdUntil: 0, heldSince: -1,
    });
    if (this.running) this.arm();
  }

  remove(planetId: string): void {
    this.entries.delete(planetId);
  }

  has(planetId: string): boolean {
    return this.entries.has(planetId);
  }

  /** Presence (CT-14). An explicit `active` also lifts a scheduler demotion. */
  setMode(planetId: string, mode: StepMode): void {
    const e = this.entries.get(planetId);
    if (!e) return;
    e.mode = mode;
    if (mode === 'active') e.demoted = false;
    e.slowStreak = 0;
  }

  /** Someone watches the planet (subscribed): it weighs more, is never demoted, and a demotion is lifted. */
  setPlayers(planetId: string, players: boolean): void {
    const e = this.entries.get(planetId);
    if (!e) return;
    e.players = players;
    if (players && e.demoted) this.setMode(planetId, 'active');
  }

  /** `k` engine steps per due slot, clamped to 1..MAX_WARP. */
  setWarp(planetId: string, k: number): void {
    const e = this.entries.get(planetId);
    if (!e) return;
    e.warp = e.warpRequested = Math.min(MAX_WARP, Math.max(1, Math.floor(k) || 1));
    e.overloaded = 0;
    this.onWarp?.(planetId, e.warp, e.warpRequested);
  }

  info(planetId: string): PlanetSchedule | undefined {
    const e = this.entries.get(planetId);
    return e && {
      planetId, mode: e.mode, warp: e.warp, warpRequested: e.warpRequested, nextDueMs: e.nextDueMs, lagSteps: e.lagSteps,
      stepsLastPass: e.stepsLastPass, players: e.players, lastStepMs: e.lastStepMs, avgStepMs: e.avgStepMs,
      droppedSlots: e.droppedSlots, demoted: e.demoted,
    };
  }

  /** Max lag over all planets (the `ta_game_tick_lag_steps` value of this thread). */
  get maxLag(): number {
    let m = 0;
    for (const e of this.entries.values()) m = Math.max(m, e.lagSteps);
    return m;
  }

  /** One turn: at most one due slot per planet, fairest first, until the budget is spent. Exposed for deterministic tests. */
  runPass(): PassReport {
    const start = this.o.now();
    const turn = ++this.turnNo;
    this.capDebt(start);
    let steps = 0;
    let maxPlanetSteps = 0;
    for (let e = this.pick(start, turn); e; e = this.pick(this.o.now(), turn)) {
      const n = this.stepSlot(e, turn);
      steps += n;
      maxPlanetSteps = Math.max(maxPlanetSteps, e.stepsLastPass);
      if (this.o.now() - start >= this.budgetMs) break;
    }
    const end = this.o.now();
    for (const e of this.entries.values()) {
      e.lagSteps = lagOf(e, end);
      if (e.turn !== turn) e.stepsLastPass = 0;
    }
    this.totalSteps += steps;
    this.lastPass = { atMs: start, steps, maxPlanetSteps, maxLag: this.maxLag };
    this.onPass?.(this.lastPass);
    return this.lastPass;
  }

  /** Skips the oldest slots of a planet that owes more than the cap; whole intervals, so the phase stays drift-free. */
  private capDebt(now: number): void {
    for (const e of this.entries.values()) {
      const over = lagOf(e, now) - this.maxDebt;
      if (over <= 0) continue;
      e.nextDueMs += over * intervalOf(e.mode);
      e.droppedSlots += over;
      this.droppedSlots += over;
    }
  }

  private keyOf(e: Entry): number {
    return Math.max(e.vruntime, this.floorVr - VR_SLACK_MS);
  }

  /** `a` goes before `b`: less weighted time, then players, then the older due slot. */
  private before(a: Entry, b: Entry): boolean {
    const ka = this.keyOf(a);
    const kb = this.keyOf(b);
    if (ka !== kb) return ka < kb;
    if (a.players !== b.players) return a.players;
    return a.nextDueMs < b.nextDueMs;
  }

  /**
   * The due planet that steps next in this turn, or none (end of turn). A planet that used up its slots this turn is
   * not picked again; if it still goes first among the due ones, the turn ends so it steps again right after the yield
   * instead of a heavier planet running in its place. A heavy planet that would make a light one late waits (`hold`).
   */
  private pick(now: number, turn: number): Entry | undefined {
    const held = new Set<Entry>();
    for (;;) {
      let fresh: Entry | undefined;
      let stepped: Entry | undefined;
      for (const e of this.entries.values()) {
        if (e.nextDueMs > now || e.holdUntil > now || held.has(e)) continue;
        const spent = e.turn === turn && e.turnSlots >= this.maxSlots;
        if (spent) { if (!stepped || this.before(e, stepped)) stepped = e; } else if (!fresh || this.before(e, fresh)) fresh = e;
      }
      if (!fresh || (stepped && this.keyOf(stepped) < this.keyOf(fresh))) return undefined;
      if (!this.hold(fresh, now)) return fresh;
      held.add(fresh);
    }
  }

  /** True (and the planet waits until the next light planet's due time) when its slot would make a light planet late. */
  private hold(e: Entry, now: number): boolean {
    if (e.avgStepMs <= HEAVY_STEP_MS) return this.release(e);
    const maxHold = e.players ? TICK_MS : HEAVY_MAX_HOLD_MS;
    const since = e.heldSince >= 0 ? e.heldSince : now;
    if (now - since >= maxHold && now - this.lastGapMs >= maxHold) return this.release(e); // no gaps at all: run anyway
    let next = Infinity;
    for (const o of this.entries.values()) if (o !== e && o.avgStepMs <= HEAVY_STEP_MS) next = Math.min(next, o.nextDueMs);
    if (next - now >= HEAVY_GAP_SHARE * Math.min(e.avgStepMs, TICK_MS)) { this.lastGapMs = now; return this.release(e); }
    e.holdUntil = Math.min(next, Math.max(since, this.lastGapMs) + maxHold);
    if (e.heldSince < 0) e.heldSince = now;
    return true;
  }

  private release(e: Entry): false {
    e.holdUntil = 0;
    e.heldSince = -1;
    return false;
  }

  /** Runs one due slot (`warp` engine steps), measures it, and reports it before anything else steps. */
  private stepSlot(e: Entry, turn: number): number {
    const mode = e.mode;
    const t0 = this.o.now();
    this.floorVr = Math.max(this.floorVr, this.keyOf(e));
    for (let k = 0; k < e.warp; k++) this.o.step(e.id, dtOf(mode));
    const n = e.warp;
    const t1 = this.o.now();
    e.nextDueMs += intervalOf(mode);
    e.turnSlots = e.turn === turn ? e.turnSlots + 1 : 1;
    e.stepsLastPass = e.turn === turn ? e.stepsLastPass + n : n;
    e.turn = turn;
    if (this.entries.get(e.id) !== e) return n; // the step dropped the planet (failed / unloaded)
    const ms = t1 - t0;
    e.vruntime = this.keyOf(e) + ms / (e.players ? PLAYER_WEIGHT : 1);
    e.lastStepMs = ms;
    e.avgStepMs = e.avgStepMs === 0 ? ms : e.avgStepMs + AVG_ALPHA * (ms - e.avgStepMs);
    e.lagSteps = lagOf(e, t1);
    this.capWarp(e);
    this.maybeDemote(e, ms / n, mode);
    this.onStep?.(e.id, { ms, steps: n, mode, lagSteps: e.lagSteps });
    return n;
  }

  private maybeDemote(e: Entry, perStepMs: number, mode: StepMode): void {
    if (mode !== 'active' || e.players || this.demoteAfter <= 0) { e.slowStreak = 0; return; }
    e.slowStreak = perStepMs > SLOW_STEP_MS ? e.slowStreak + 1 : 0;
    if (e.slowStreak < this.demoteAfter) return;
    e.slowStreak = 0;
    e.mode = 'coarse';
    e.demoted = true;
    this.onDemote?.(e.id, e.avgStepMs);
  }

  private capWarp(e: Entry): void {
    e.overloaded = e.warp > 1 && e.lagSteps >= OVERLOAD_LAG_SLOTS ? e.overloaded + 1 : 0;
    if (e.overloaded < OVERLOAD_PASSES) return;
    e.overloaded = 0;
    e.warp = Math.max(1, Math.floor(e.warp / 2));
    this.onWarp?.(e.id, e.warp, e.warpRequested);
  }

  private arm(): void {
    this.cancel?.();
    this.cancel = undefined;
    if (!this.running || this.entries.size === 0) return;
    let next = Infinity;
    for (const e of this.entries.values()) next = Math.min(next, Math.max(e.nextDueMs, e.holdUntil));
    // delay >= 0; even when still behind we go through the timer so messages are handled between turns
    this.cancel = this.o.schedule(() => { this.cancel = undefined; this.runPass(); this.arm(); }, Math.max(0, next - this.o.now()));
  }
}

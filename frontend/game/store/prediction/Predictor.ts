import type { SimCommandV1, SimEventWire } from '@terra/contracts';
import { TICK_MS, type SimHost, type SimView } from '@terra/sim';
import { PREDICT_P95_LIMIT_MS, StepTimes } from './stepTimes';
import type { DeltaInput, DeltaResult, ReplicaCore, WelcomeInput, WelcomeResult } from '../replica/ReplicaCore';

/** A command the player sent that the confirmed state does not include yet. */
export interface PendingCommand {
  id: string;
  kind: string;
  args: unknown;
  sentAtMs: number;
  /** Set by `cmd.ack`: the tick whose state includes the command. Until a delta reaches it, the command stays pending. */
  appliedAtTick?: number;
}

export interface PredictorOptions {
  /** Local clock (ms). */
  now: () => number;
  /** The most ticks the prediction runs ahead of the confirmed state. */
  maxLeadTicks?: number;
  /** false (`?predict=0`): `view()` is always the confirmed state. */
  enabled?: boolean;
  /** Rebuild-time p95 (ms) above which prediction turns itself off. Default 4. */
  p95LimitMs?: number;
}

export const DEFAULT_MAX_LEAD_TICKS = 25;

/**
 * Client-side prediction (SIM-X-03, CLIENT §7): `confirmed` is the replica at server tick T; `predicted` is
 * `clone(confirmed)` with the pending commands submitted at their due ticks, stepped to the estimated server tick.
 * With nothing pending the confirmed host is the prediction (no clone, no extra steps). The prediction is rebuilt
 * lazily when its inputs (confirmed state, pending list, estimated tick) change, so `submit` shows its effect on the
 * next `view()`. Cost per rebuild: one clone + (steps + pending).
 */
export class Predictor {
  private pend: PendingCommand[] = [];
  private version = 0;
  private cache: { version: number; target: number; host: SimHost } | null = null;
  private epochServerMs: number | null = null;
  private offsetMs = 0;
  private lastRejected: { cmd: PendingCommand; code: string } | null = null;
  enabled: boolean;
  /** Rebuild times (clone + steps) of the predicted host. */
  readonly steps = new StepTimes();
  /** Set when prediction switched itself off because the step p95 went over the limit. */
  autoOff: { p95Ms: number } | null = null;
  private renderEvents: SimEventWire[] = [];
  private renderHigh = -1;
  private readonly p95LimitMs: number;
  private readonly maxLead: number;
  private readonly now: () => number;

  constructor(readonly confirmed: ReplicaCore, opts: PredictorOptions) {
    this.now = opts.now;
    this.maxLead = opts.maxLeadTicks ?? DEFAULT_MAX_LEAD_TICKS;
    this.enabled = opts.enabled ?? true;
    this.p95LimitMs = opts.p95LimitMs ?? PREDICT_P95_LIMIT_MS;
  }

  get pending(): readonly PendingCommand[] { return this.pend; }
  /** The tick of the confirmed state (T). */
  get confirmedTick(): number { return this.confirmed.tick; }

  /** Loads the welcome. Commands that are still pending stay (a re-join does not forget what the player did). */
  welcome(w: WelcomeInput & { serverTimeMs?: number }): WelcomeResult {
    const r = this.confirmed.welcome(w);
    if (w.serverTimeMs !== undefined) {
      this.epochServerMs = w.serverTimeMs - w.tick * TICK_MS;
      this.offsetMs = w.serverTimeMs - this.now();
    }
    if (w.tick < this.renderHigh - this.maxLead) this.renderHigh = -1;
    this.bump();
    if (r.ok) this.dropApplied();
    return r;
  }

  /** Server time minus local time (ms), refreshed from pongs. */
  setServerOffset(offsetMs: number): void { this.offsetMs = offsetMs; this.bump(); }

  onDelta(d: DeltaInput): DeltaResult {
    const r = this.confirmed.delta(d);
    this.bump();
    if (r.ok) this.dropApplied();
    return r;
  }

  /** The player sent a command. The next `view()` shows its effect. */
  submit(cmd: { id: string; kind: string; args: unknown; sentAtMs?: number }): void {
    if (this.pend.some((p) => p.id === cmd.id)) return;
    this.pend.push({ id: cmd.id, kind: cmd.kind, args: cmd.args, sentAtMs: cmd.sentAtMs ?? this.now() });
    this.bump();
  }

  /** `cmd.ack`: the engine applied the command at `appliedAtTick`. Dropped at once if confirmed already includes it. */
  onAck(id: string, appliedAtTick: number): void {
    const c = this.pend.find((p) => p.id === id);
    if (!c) return;
    c.appliedAtTick = appliedAtTick;
    this.bump();
    this.dropApplied();
  }

  /** `cmd.reject`: rolls the command back. Returns it with the reason (undefined for an unknown id). */
  onReject(id: string, code: string): { cmd: PendingCommand; code: string } | undefined {
    const i = this.pend.findIndex((p) => p.id === id);
    if (i < 0) return undefined;
    const [cmd] = this.pend.splice(i, 1);
    this.bump();
    this.lastRejected = { cmd, code };
    return this.lastRejected;
  }

  /** The last rejected command and its reason. */
  get rejected(): { cmd: PendingCommand; code: string } | null { return this.lastRejected; }

  /** Estimated current server tick (from the welcome's server time and the offset), or null before a timed welcome. */
  estimatedServerTick(): number | null {
    if (this.epochServerMs === null) return null;
    return Math.floor((this.now() + this.offsetMs - this.epochServerMs) / TICK_MS);
  }

  /** The tick `predicted` runs to for the current pending list. */
  targetTick(): number {
    const t = this.confirmed.tick;
    const est = this.estimatedServerTick();
    let target = Math.min(Math.max(est ?? t + 1, t + 1), t + this.maxLead);
    for (const p of this.pend) if (p.appliedAtTick !== undefined && p.appliedAtTick > target) target = p.appliedAtTick;
    return target;
  }

  /** The host the render shows: `predicted` when something is pending, else the confirmed host. */
  host(): SimHost {
    if (!this.enabled || this.pend.length === 0) return this.confirmed.simHost;
    const target = this.targetTick();
    if (this.cache && this.cache.version === this.version && this.cache.target === target) return this.cache.host;
    const t0 = this.now();
    const host = this.rebuild(target);
    this.steps.add(this.now() - t0);
    if (this.steps.exceeds(this.p95LimitMs)) { this.enabled = false; this.autoOff = { p95Ms: this.steps.p95() }; }
    this.cache = { version: this.version, target, host };
    return host;
  }

  view(): SimView { return this.host().view(); }
  get tick(): number { return this.host().tick; }

  /** `predicted = clone(confirmed)`, each pending command submitted at its due tick, stepped to `target`. */
  private rebuild(target: number): SimHost {
    const host = this.confirmed.simHost.clone();
    const first = host.tick + 1;
    const byTick = new Map<number, SimCommandV1[]>();
    for (const p of this.pend) {
      const due = Math.max(p.appliedAtTick ?? first, first);
      const list = byTick.get(due) ?? [];
      list.push({ colonyIndex: null, source: 'dev', commandId: p.id, kind: p.kind, args: p.args });
      byTick.set(due, list);
    }
    for (let tick = first; tick <= target; tick++) {
      for (const c of byTick.get(tick) ?? []) host.submit(c);
      this.collect(host.step(1).events);
    }
    return host;
  }

  /** Render-only events (projectiles, VFX) of the predicted steps not shown before. Player-facing events come from the server only. */
  takeRenderEvents(): SimEventWire[] {
    const out = this.renderEvents;
    this.renderEvents = [];
    return out;
  }

  private collect(events: readonly SimEventWire[]): void {
    for (const e of events) {
      if (e.atTick <= this.renderHigh) continue;
      this.renderEvents.push({ kind: e.kind, severity: e.severity, atTick: e.atTick, colonyIds: e.colonyIds, data: e.data });
    }
    for (const e of events) this.renderHigh = Math.max(this.renderHigh, e.atTick);
  }

  private dropApplied(): void {
    if (!this.confirmed.loaded) return;
    const t = this.confirmed.tick;
    const keep = this.pend.filter((p) => p.appliedAtTick === undefined || p.appliedAtTick > t);
    if (keep.length !== this.pend.length) { this.pend = keep; this.bump(); }
  }

  private bump(): void { this.version++; this.cache = null; }
}

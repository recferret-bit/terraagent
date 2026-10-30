import type { SimCommandV1 } from '@terra/contracts';
import {
  allModules, buildPipeline, createPlanet, diffSince, effectiveOverrides, mergeOverrides, restore, snapshot, step, tune,
  type BalanceOverrides, type Pipeline, type PlanetSchedule, type PlanetState, type PlanetTuning, type SimEvent, type SimModule, type TuneRequest,
} from '@terra/sim';
import type { LoadMsg, PassStat, Post, PlanetStats, ToThread } from './protocol';

/** What the host needs from the scheduler to report stats (the scheduler itself lives in the thread entry). */
export interface SchedulerView {
  info(planetId: string): PlanetSchedule | undefined;
  readonly maxLag: number;
  recentPasses(): PassStat[];
}

interface Planet {
  state: PlanetState;
  pipeline: Pipeline;
  /** Balance overrides (D-35): `base` = file ⊕ scenario, `live` = dev tunes. */
  tuning: PlanetTuning;
  pending: SimCommandV1[];
  subscribed: boolean;
  /** Tick of the last delta sent (or of the subscription); the next delta starts here (D-31). */
  lastDeltaTick: number;
  nextDeltaMs: number;
  /** Events of the open delta window; they travel inside the delta (subscribed planets only). */
  windowEvents: SimEvent[];
  deltaMs: number;
  deltaBytes: number;
}

export interface HostOptions {
  /** Extra sim modules on top of the discovered ones (tests/tools). */
  readonly modules?: readonly SimModule[];
  /** Deltas per second per subscribed planet (default 5). */
  readonly deltaHz?: number;
  readonly now?: () => number;
  /** Balance overrides from `TA_BALANCE_OVERRIDES`, under every planet's scenario overrides. */
  readonly overrides?: BalanceOverrides;
}

/** Exact-size copy so the buffer can be transferred without dragging along unrelated bytes. */
function owned(bytes: Uint8Array): Uint8Array {
  return bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? bytes : bytes.slice();
}

/**
 * The planet table of one sim thread and everything that mutates planet state. Runs inside the worker only;
 * the main thread never touches `PlanetState` (SIM-H-01). Transport-agnostic (`post`) so it is unit-testable.
 */
export class PlanetHost {
  readonly planets = new Map<string, Planet>();
  private steps = 0;

  constructor(
    readonly thread: number,
    private readonly flags: readonly string[],
    private readonly post: Post,
    private readonly sched?: SchedulerView,
    private readonly opts: HostOptions = {},
  ) {
    this.deltaIntervalMs = 1000 / (opts.deltaHz && opts.deltaHz > 0 ? opts.deltaHz : 5);
    this.now = opts.now ?? (() => performance.now());
  }

  private readonly deltaIntervalMs: number;
  private readonly now: () => number;

  handle(msg: ToThread): void {
    try {
      this.dispatch(msg);
    } catch (e) {
      const planetId = 'planetId' in msg ? msg.planetId : undefined;
      const commandId = msg.t === 'cmd' ? msg.cmd.commandId : undefined;
      this.post({ t: 'error', thread: this.thread, planetId, commandId, message: e instanceof Error ? e.message : String(e) });
      if (msg.t === 'cmd') this.post({ t: 'reject', planetId: msg.planetId, commandId: msg.cmd.commandId, code: 'internal' });
    }
  }

  private dispatch(msg: ToThread): void {
    switch (msg.t) {
      case 'load': return this.load(msg);
      case 'unload': {
        const p = this.planets.get(msg.planetId);
        if (p) this.flushEvents(msg.planetId, p);
        this.planets.delete(msg.planetId);
        return this.post({ t: 'unloaded', planetId: msg.planetId });
      }
      case 'cmd': return this.enqueue(msg.planetId, msg.cmd);
      case 'subscribe': case 'unsubscribe': {
        const p = this.planets.get(msg.planetId);
        if (p) this.setSubscribed(msg.planetId, p, msg.t === 'subscribe');
        return;
      }
      case 'snapshotNow': return this.snapshotNow(msg.planetId);
      case 'fullState': return this.fullState(msg.planetId, msg.reqId);
      case 'tune': return this.tune(msg.planetId, msg.reqId, msg.req);
      case 'ctl': return this.ctl(msg);
    }
  }

  private load(msg: LoadMsg): void {
    const state = msg.snapshot
      ? restore(msg.snapshot)
      : createPlanet({ type: msg.params?.type ?? 'flat', seed: msg.params?.seed ?? msg.planetId, planetId: msg.planetId, radius: msg.params?.radius });
    const modules = this.opts.modules ? [...allModules(), ...this.opts.modules] : undefined;
    const flags = msg.flags ?? this.flags;
    const base = mergeOverrides(this.opts.overrides ?? {}, msg.overrides ?? {});
    const pipeline = buildPipeline(flags, base, modules);
    this.planets.set(msg.planetId, {
      state, pipeline, tuning: { flags, base, live: {} }, pending: [], subscribed: false, lastDeltaTick: state.meta.tick, nextDeltaMs: 0, windowEvents: [], deltaMs: 0, deltaBytes: 0,
    });
    this.post({ t: 'loaded', planetId: msg.planetId, tick: state.meta.tick });
  }

  private enqueue(planetId: string, cmd: SimCommandV1): void {
    const p = this.planets.get(planetId);
    if (!p) return this.post({ t: 'reject', planetId, commandId: cmd.commandId, code: 'planet_not_loaded' });
    p.pending.push(cmd);
  }

  /** Steps one planet by `dt` ticks: applies queued commands, answers them, publishes events and the delta. */
  stepPlanet(planetId: string, dt: number): void {
    const p = this.planets.get(planetId);
    if (!p) return;
    const cmds = p.pending.splice(0);
    const r = step(p.state, cmds, dt, p.pipeline);
    this.steps++;
    for (const o of r.outcomes) {
      if (o.code) this.post({ t: 'reject', planetId, commandId: o.commandId, code: o.code, appliedAtTick: o.appliedAtTick });
      else this.post({ t: 'ack', planetId, commandId: o.commandId, appliedAtTick: o.appliedAtTick });
    }
    this.publish(planetId, p, r.events);
  }

  private setSubscribed(planetId: string, p: Planet, on: boolean): void {
    if (on === p.subscribed) return;
    if (on) {
      p.lastDeltaTick = p.state.meta.tick;
      p.nextDeltaMs = this.now() + this.deltaIntervalMs;
    } else this.flushEvents(planetId, p);
    p.subscribed = on;
  }

  private flushEvents(planetId: string, p: Planet): void {
    if (p.windowEvents.length) this.post({ t: 'event', planetId, events: p.windowEvents.splice(0) });
  }

  /**
   * Called after every scheduler pass: for each subscribed planet whose delta is due and whose tick advanced, posts one
   * `delta` (`diffSince(lastDeltaTick)` + the window's events). Unsubscribed planets build nothing (SIM-H-04).
   */
  flushDeltas(): void {
    const now = this.now();
    for (const [id, p] of this.planets) {
      if (!p.subscribed || now < p.nextDeltaMs) continue;
      p.nextDeltaMs += this.deltaIntervalMs;
      if (p.nextDeltaMs <= now) p.nextDeltaMs = now + this.deltaIntervalMs; // never queue a burst after a stall
      try { this.sendDelta(id, p); } catch (e) {
        this.post({ t: 'error', thread: this.thread, planetId: id, message: e instanceof Error ? e.message : String(e) });
      }
    }
  }

  /** Posts the delta from `lastDeltaTick` to now if the tick advanced. Also called right before a `fullState` so a welcome is always a delta boundary. */
  private sendDelta(planetId: string, p: Planet): void {
    const toTick = p.state.meta.tick;
    if (toTick <= p.lastDeltaTick) return;
    const t0 = performance.now();
    const diff = diffSince(p.state, p.lastDeltaTick);
    p.deltaMs = performance.now() - t0;
    p.deltaBytes = diff.byteLength;
    const buf = owned(diff);
    this.post({ t: 'delta', planetId, fromTick: p.lastDeltaTick, toTick, diff: buf, events: p.windowEvents.splice(0) }, [buf.buffer as ArrayBuffer]);
    p.lastDeltaTick = toTick;
  }

  /** Steps every loaded planet once (tests/tools); the thread's `PlanetScheduler` does the timing. */
  stepAll(dt = 1): void {
    for (const id of [...this.planets.keys()]) {
      try { this.stepPlanet(id, dt); } catch (e) {
        this.post({ t: 'error', thread: this.thread, planetId: id, message: e instanceof Error ? e.message : String(e) });
      }
    }
  }

  private snapshotNow(planetId?: string): void {
    for (const id of planetId ? [planetId] : [...this.planets.keys()]) {
      const p = this.planets.get(id);
      if (!p) continue;
      const bytes = owned(snapshot(p.state));
      this.post({ t: 'snapshot', planetId: id, tick: p.state.meta.tick, bytes }, [bytes.buffer as ArrayBuffer]);
    }
  }

  /** Reply to `fullState`: the engine snapshot (D-31) plus the sim/data identity the client must match (SIM-X-08). */
  private fullState(planetId: string, reqId: number): void {
    const p = this.planets.get(planetId);
    if (!p) return this.post({ t: 'error', thread: this.thread, planetId, message: `fullState: planet ${planetId} is not loaded` });
    // The welcome at tick T must be followed by a delta starting at T: close the open window first. Message order on the
    // port guarantees main sees this delta (toTick T, ignored by the joining socket) before the snapshot at T.
    if (p.subscribed) this.sendDelta(planetId, p);
    const bytes = owned(snapshot(p.state));
    this.post({
      t: 'fullState', planetId, reqId, tick: p.state.meta.tick, warp: this.sched?.info(planetId)?.warp ?? 1, bytes, simVersion: p.state.meta.simVersion,
      dataHash: p.pipeline.config.data.hash, planetType: p.state.meta.planetType, overrides: effectiveOverrides(p.tuning),
    }, [bytes.buffer as ArrayBuffer]);
  }

  /**
   * Dev `tune` (D-35): rebuilds the planet's pipeline from file ⊕ scenario ⊕ live overrides, so the next step already uses
   * the new numbers, and records a `dev.tuned` event (event log / bus). A bad path or value leaves the planet untouched.
   */
  private tune(planetId: string, reqId: number, req: TuneRequest): void {
    const p = this.planets.get(planetId);
    if (!p) return this.post({ t: 'error', thread: this.thread, planetId, message: `tune: planet ${planetId} is not loaded` });
    const reply = (extra: { ok: boolean; text?: string; error?: string }) =>
      this.post({ t: 'tuned', planetId, reqId, dataHash: p.pipeline.config.data.hash, overrides: effectiveOverrides(p.tuning), ...extra });
    try {
      const out = tune(p.tuning, req, this.opts.modules ? [...allModules(), ...this.opts.modules] : undefined);
      if (out.next) {
        p.pipeline = out.next.pipeline;
        p.tuning.live = out.next.live;
      }
      if (out.event) this.publish(planetId, p, [{ ...out.event, atTick: p.state.meta.tick }]);
      reply({ ok: true, ...(out.text !== undefined ? { text: out.text } : {}) });
    } catch (e) {
      reply({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }

  /** Each event leaves the thread exactly once: inside a delta when the planet is subscribed, else as a bare `event`. */
  private publish(planetId: string, p: Planet, events: SimEvent[]): void {
    if (p.subscribed) p.windowEvents.push(...events);
    else if (events.length) this.post({ t: 'event', planetId, events });
  }

  stats(): PlanetStats[] {
    return [...this.planets].map(([planetId, p]) => {
      const s = this.sched?.info(planetId);
      return {
        planetId, tick: p.state.meta.tick, entities: p.state.entities.count, pendingCmds: p.pending.length, subscribed: p.subscribed,
        deltaMs: p.deltaMs, deltaBytes: p.deltaBytes,
        lagSteps: s?.lagSteps ?? 0, mode: s?.mode ?? 'active', nextDueMs: s?.nextDueMs ?? 0, stepsLastPass: s?.stepsLastPass ?? 0,
        warp: s?.warp ?? 1, warpRequested: s?.warpRequested ?? 1,
      };
    });
  }

  private ctl(msg: Extract<ToThread, { t: 'ctl' }>): void {
    if (msg.op === 'stats') {
      this.post({
        t: 'stats', thread: this.thread, reqId: msg.reqId, planets: this.stats(), steps: this.steps,
        maxLag: this.sched?.maxLag ?? 0, recentPasses: this.sched?.recentPasses() ?? [],
      });
    } else if (msg.op === 'block') {
      if (process.env.NODE_ENV === 'production') return;
      const end = performance.now() + msg.ms;
      while (performance.now() < end) { /* busy-wait: simulates a stalled thread */ }
    }
    // 'warp' and 'stop' are handled by the thread entry (it owns the port and the timer).
  }
}

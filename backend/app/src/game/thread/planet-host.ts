import { randomUUID } from 'node:crypto';
import type { SimCommandV1 } from '@terra/contracts';
import {
  allModules, applyTunedEntityHealth, buildPipeline, clientDeltaFrames, createPlanet, effectiveOverrides, getColonyStock, mergeOverrides, nextLandingSite, restore, snapshot, step,
  StepError, tune,
  type BalanceOverrides, type CommandOutcome, type LedgerPosting, type Pipeline, type PlanetSchedule, type PlanetState, type PlanetTuning, type SimEvent,
  type SimModule, type TuneRequest,
} from '@terra/sim';
import { ProductionBatches } from './production-batches';
import { type LoadMsg, type PassStat, type Post, type PlanetStats, type ToThread, W00_PLANET_TYPE } from './protocol';

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
  /** Stockpile `resourceProduced` batches (W02-28); only when the planet runs with W02 on. */
  production?: ProductionBatches;
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
      case 'landingSite': return this.landingSite(msg.planetId, msg.reqId, msg.colony);
      case 'ctl': return this.ctl(msg);
    }
  }

  private load(msg: LoadMsg): void {
    const state = msg.snapshot
      ? restore(msg.snapshot)
      : createPlanet({
          type: msg.params?.type ?? W00_PLANET_TYPE,
          seed: msg.params?.seed ?? msg.planetId,
          planetId: msg.planetId,
          radius: msg.params?.radius,
          capacity: msg.params?.capacity,
          worldSalt: randomUUID(), // hidden-ground secret: never leaves the server (D-38)
        });
    const modules = this.opts.modules ? [...allModules(), ...this.opts.modules] : undefined;
    const flags = msg.flags ?? this.flags;
    const base = mergeOverrides(this.opts.overrides ?? {}, msg.overrides ?? {});
    const pipeline = buildPipeline(flags, base, modules);
    this.planets.set(msg.planetId, {
      state, pipeline, tuning: { flags, base, live: {} }, pending: [], subscribed: false, lastDeltaTick: state.meta.tick, nextDeltaMs: 0, windowEvents: [], deltaMs: 0, deltaBytes: 0,
      ...(flags.includes('W02') ? { production: new ProductionBatches(state) } : {}),
    });
    const stocks = Array.from({ length: state.colonies?.length ?? 0 }, (_, i) => getColonyStock(state, i));
    this.post({ t: 'loaded', planetId: msg.planetId, tick: state.meta.tick, restored: !!msg.snapshot, genesis: !!msg.genesis, stocks });
  }

  private enqueue(planetId: string, cmd: SimCommandV1): void {
    const p = this.planets.get(planetId);
    if (!p) return this.post({ t: 'reject', planetId, commandId: cmd.commandId, code: 'planet_not_loaded' });
    p.pending.push(cmd);
  }

  /**
   * Steps one planet by `dt` ticks: applies queued commands, answers them, publishes events and the delta. A step that
   * throws (a handler or system bug) leaves the state half-changed. Like `SimHost.step` (LED-09), what the failed step
   * already did still leaves the thread: its postings (`ledger`, so the journal explains `col.stock`) and the outcomes
   * it had produced (`StepError`); its other commands, and those still queued, are rejected `internal`. Then the planet
   * is dropped from this thread and `planetFailed` tells the main thread, which may restore its last snapshot (BE-12).
   * Every command gets exactly one answer. Returns false when the planet failed.
   */
  stepPlanet(planetId: string, dt: number): boolean {
    const p = this.planets.get(planetId);
    if (!p) return true;
    const cmds = p.pending.splice(0);
    let r: ReturnType<typeof step>;
    try {
      r = step(p.state, cmds, dt, p.pipeline);
    } catch (e) {
      this.fail(planetId, p, cmds, e);
      return false;
    }
    this.steps++;
    // Every step's postings leave right away (subscribed or not): the server journal must never miss one (D-34).
    this.answer(planetId, r.stats.tick, r.postings, r.outcomes);
    const batches = p.production?.collect(p.state) ?? [];
    this.publish(planetId, p, batches.length ? [...r.events, ...batches] : r.events);
    return true;
  }

  /** Posts a step's postings (`ledger`), then one `ack` / `reject` (with the sim's `detail`, GP-31) per outcome. */
  private answer(planetId: string, tick: number, postings: readonly LedgerPosting[], outcomes: readonly CommandOutcome[]): void {
    if (postings.length) this.post({ t: 'ledger', planetId, tick, postings });
    for (const o of outcomes) {
      if (o.code) this.post({ t: 'reject', planetId, commandId: o.commandId, code: o.code, appliedAtTick: o.appliedAtTick, ...(o.detail ? { detail: o.detail } : {}), ...(o.unlocksAt ? { unlocksAt: o.unlocksAt } : {}) });
      else this.post({ t: 'ack', planetId, commandId: o.commandId, appliedAtTick: o.appliedAtTick });
    }
  }

  private fail(planetId: string, p: Planet, cmds: readonly SimCommandV1[], e: unknown): void {
    this.planets.delete(planetId);
    const answered = new Set<string>();
    if (e instanceof StepError) {
      // The ledger message must precede `planetFailed`: main drops the planet's journal when it hears the planet is down.
      this.answer(planetId, e.tick, e.postings, e.outcomes);
      for (const o of e.outcomes) answered.add(o.commandId);
    }
    for (const c of [...cmds, ...p.pending]) {
      if (!answered.has(c.commandId)) this.post({ t: 'reject', planetId, commandId: c.commandId, code: 'internal' });
    }
    this.post({ t: 'planetFailed', planetId, message: e instanceof Error ? e.message : String(e) });
  }

  /** Reply to `landingSite`: the landing planner on the live state, with the planet's compiled data (LED-14). */
  private landingSite(planetId: string, reqId: number, colony: number): void {
    const p = this.planets.get(planetId);
    if (!p) return this.post({ t: 'landingSite', planetId, reqId, answer: { ok: false, code: 'planet_not_loaded' } });
    const next = nextLandingSite(p.state, colony, { slotIndex: colony, data: p.pipeline.config.data });
    const answer = next.ok
      ? { ok: true as const, q: next.site.q, r: next.site.r, ...(next.site.slot ? { slotIndex: next.site.slot.index } : {}) }
      : { ok: false as const, code: next.code };
    this.post({ t: 'landingSite', planetId, reqId, answer });
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
   * `delta` (`clientDeltaFrames(lastDeltaTick)`: one frame, or capped chunks for a large tile change, W05-19, + the window's events). Unsubscribed planets build nothing (SIM-H-04).
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
    // One shared path with the local host (W05-19): hidden ground never leaves the server (D-38), a large tile change
    // goes as capped chunks; the window's events ride with the first frame.
    const frames = clientDeltaFrames(p.state, p.lastDeltaTick);
    p.deltaMs = performance.now() - t0;
    p.deltaBytes = frames.reduce((n, f) => n + f.diff.byteLength, 0);
    frames.forEach((f, i) => {
      const buf = owned(f.diff);
      const events = i === 0 ? p.windowEvents.splice(0) : [];
      this.post({ t: 'delta', planetId, fromTick: f.fromTick, toTick: f.toTick, diff: buf, events }, [buf.buffer as ArrayBuffer]);
    });
    p.lastDeltaTick = toTick;
  }

  /** Steps every loaded planet once (tests/tools); the thread's `PlanetScheduler` does the timing. */
  stepAll(dt = 1): void {
    for (const id of [...this.planets.keys()]) this.stepPlanet(id, dt);
  }

  private snapshotNow(planetId?: string): void {
    for (const id of planetId ? [planetId] : [...this.planets.keys()]) {
      const p = this.planets.get(id);
      if (!p) continue;
      const production = p.production?.collect(p.state, true) ?? [];
      if (production.length) this.publish(id, p, production);
      this.flushEvents(id, p); // checkpoint must follow every event it commits, including the open delta window
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
    const bytes = owned(snapshot(p.state, { forClient: true })); // welcome: no hidden layers (D-38)
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
        applyTunedEntityHealth(p.state, p.pipeline.config.data, out.next.pipeline.config.data);
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
    } else if (msg.op === 'step') {
      if (process.env.NODE_ENV !== 'production') this.stepPlanet(msg.planetId, msg.dt);
    } else if (msg.op === 'block') {
      if (process.env.NODE_ENV === 'production') return;
      const end = performance.now() + msg.ms;
      while (performance.now() < end) { /* busy-wait: simulates a stalled thread */ }
    }
    // 'warp' and 'stop' are handled by the thread entry (it owns the port and the timer).
  }
}

import { commandGate, flagsFromList, newId, parseWaves, PlanetType, precheckClientCommand, REJECT_CODES, type RejectCode, type ServerMessage } from '@terra/contracts';
import { createScenarioPlanet } from '@terra/scenarios';
import {
  buildPipeline, effectiveOverrides, PlanetScheduler, SIM_VERSION, SimHost, TICK_MS, tune,
  type BalanceOverrides, type CommandOutcome, type PlanetTuning, type SimCommand, type SimEvent, type TuneRequest,
} from '@terra/sim';
import { ownBytes } from '../bytes';
import type { FromLocalHost, LocalHostOptions, LocalPost, ToLocalHost } from './protocol';
import { compatible, snapshotKey, type SnapshotStore } from './snapshotStore';

export interface LocalHostDeps {
  /** Monotonic ms (the scheduler's clock). */
  now(): number;
  /** Wall-clock ms (`serverTimeMs`, `savedAt`). */
  wallMs(): number;
  /** Runs `fn` once after `delayMs`; returns a cancel function. */
  schedule(fn: () => void, delayMs: number): () => void;
  store: SnapshotStore;
  /** Snapshot cadence (default 10 s). */
  saveEveryMs?: number;
}

/** A dev command failed; `code` is what the console shows (`host_unavailable`, `invalid_args`, `not_found`). */
export class LocalDevError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'LocalDevError'; }
}

const SAVE_EVERY_MS = 10_000;
const isRejectCode = (c: string): c is RejectCode => (REJECT_CODES as readonly string[]).includes(c);

/**
 * The authoritative engine of `?host=local` (SIM-X-06, D-31): one scenario planet stepped at 5 TPS by the shared
 * `PlanetScheduler` (drift-free, bounded catch-up, dev warp x1..x100), answering the client exactly as `/ws` does
 * (`ready`, `welcome`, `delta`, `cmd.ack`, `cmd.reject`, `event`, `pong`). Pure: clock, timers and persistence are
 * injected, so it runs in a Worker (`localHost.worker.ts`) and in Vitest. One delta per scheduler pass (= every 200 ms
 * at x1) carries `diffSince(lastDeltaTick)` and the events of the window.
 */
export class LocalHostCore {
  private host!: SimHost;
  private tuning!: PlanetTuning;
  private scenario = '';
  private joined = false;
  private lastDeltaTick = 0;
  private window: SimEvent[] = [];
  private queue: SimCommand[] = [];
  private unlisten: Array<() => void> = [];
  private cancelSave: (() => void) | undefined;
  private readonly sched: PlanetScheduler;
  private readonly playerId = newId('pr');

  private constructor(private readonly opts: LocalHostOptions, private readonly deps: LocalHostDeps, private readonly post: LocalPost) {
    this.sched = new PlanetScheduler({ now: deps.now, schedule: deps.schedule, step: (_id, dt) => this.stepOnce(dt) });
    this.sched.onPass = () => this.flushDelta();
    this.sched.onWarp = (_id, effective) => this.server({ v: 1, t: 'event', tick: 0, d: { kind: 'dev.warp', severity: 'info', atTick: 0, colonyIds: [], data: { k: effective } } });
  }

  /** Loads the saved planet of `opts.scenario` when compatible, else a fresh one; starts stepping. */
  static async create(opts: LocalHostOptions, deps: LocalHostDeps, post: LocalPost): Promise<LocalHostCore> {
    const core = new LocalHostCore(opts, deps, post);
    await core.build(opts.scenario, false);
    core.sched.add('local');
    core.sched.start();
    core.armSave();
    return core;
  }

  /** The authoritative host (tests, tools). */
  get simHost(): SimHost { return this.host; }
  get planetId(): string { return this.host.state.meta.planetId; }
  get tick(): number { return this.host.tick; }
  get warp(): number { return this.sched.info('local')?.warp ?? 1; }
  get flags(): readonly string[] { return this.tuning.flags; }

  // ---- planet lifecycle -------------------------------------------------------------------------------------------

  /** A planet from the scenario, resumed from the saved snapshot unless `fresh` or incompatible. */
  private async build(id: string, fresh: boolean): Promise<void> {
    const { host: seed } = createScenarioPlanet(id, { planetId: newId('pl'), flags: parseWaves(this.opts.waves).list });
    const flags = [...seed.pipeline.config.flags];
    const key = snapshotKey(id);
    let host = seed;
    let live: BalanceOverrides = {};
    if (fresh) await this.deps.store.remove(key).catch(() => undefined);
    else {
      const snap = await this.deps.store.load(key).catch(() => null);
      const resumed = snap && this.tryResume(snap, flags);
      if (resumed) ({ host, live } = resumed);
    }
    this.scenario = id;
    this.install(host, { flags, base: {}, live });
  }

  private tryResume(snap: NonNullable<Awaited<ReturnType<SnapshotStore['load']>>>, flags: readonly string[]): { host: SimHost; live: BalanceOverrides } | null {
    try {
      const live = (snap.overrides ?? {}) as BalanceOverrides;
      const pipeline = buildPipeline(flags, live);
      if (!compatible(snap, { simVersion: SIM_VERSION, dataHash: pipeline.config.data.hash, flags })) return null;
      const host = new SimHost(pipeline);
      host.load(snap.bytes);
      return { host, live };
    } catch { return null; }
  }

  private install(host: SimHost, tuning: PlanetTuning): void {
    for (const off of this.unlisten) off();
    this.host = host;
    this.tuning = tuning;
    this.queue = [];
    this.window = [];
    this.lastDeltaTick = host.tick;
    this.unlisten = [
      host.onEvents((events) => { if (this.joined) this.window.push(...events); }),
      host.onOutcomes((outcomes) => this.answer(outcomes)),
    ];
  }

  /** Replaces the pipeline (tune) without touching the planet or the queued commands. */
  private swapPipeline(next: SimHost['pipeline'], live: BalanceOverrides): void {
    const next_ = new SimHost(next);
    next_.load(this.host.state);
    const { queue, window, lastDeltaTick } = this;
    this.install(next_, { ...this.tuning, live });
    Object.assign(this, { queue, window, lastDeltaTick });
  }

  private async restart(id: string): Promise<{ planetId: string }> {
    await this.build(id, true);
    this.sched.setWarp('local', 1);
    this.save();
    if (this.joined) this.welcome('resync');
    return { planetId: this.planetId };
  }

  // ---- stepping ---------------------------------------------------------------------------------------------------

  private stepOnce(dt: number): void {
    try {
      for (const c of this.queue.splice(0)) this.host.submit(c);
      this.host.step(dt);
    } catch (e) {
      this.post({ t: 'error', message: `step failed: ${e instanceof Error ? e.message : String(e)}` }, []);
    }
  }

  private answer(outcomes: readonly CommandOutcome[]): void {
    for (const o of outcomes) {
      if (!o.code) this.server({ v: 1, t: 'cmd.ack', d: { id: o.commandId, appliedAtTick: o.appliedAtTick } });
      else this.server({ v: 1, t: 'cmd.reject', d: { id: o.commandId, code: isRejectCode(o.code) ? o.code : 'internal', ...(isRejectCode(o.code) ? {} : { detail: o.code }) } });
    }
  }

  private flushDelta(): void {
    const toTick = this.host.tick;
    if (!this.joined || toTick <= this.lastDeltaTick) return;
    const diff = ownBytes(this.host.diffSince(this.lastDeltaTick));
    this.server({ v: 1, t: 'delta', tick: toTick, d: { fromTick: this.lastDeltaTick, toTick, diff, events: this.window.splice(0) } });
    this.lastDeltaTick = toTick;
  }

  // ---- protocol ---------------------------------------------------------------------------------------------------

  /** Posts a server message, moving its byte buffers. */
  private server(msg: ServerMessage): void {
    const d = msg.d as { state?: Uint8Array; diff?: Uint8Array };
    const transfer = [d.state, d.diff].flatMap((b) => (b ? [b.buffer as ArrayBuffer] : []));
    this.post({ t: 'server', msg } as FromLocalHost, transfer);
  }

  private welcome(reason: 'join' | 'resync'): void {
    const meta = this.host.state.meta;
    const type = PlanetType.safeParse(meta.planetType);
    this.window = [];
    this.lastDeltaTick = meta.tick;
    this.joined = true;
    const warp = this.warp;
    this.server({
      v: 1, t: 'welcome', tick: meta.tick,
      d: {
        reason, colonyId: null, planet: { id: meta.planetId, type: type.success ? type.data : 'temperate', name: `local ${this.scenario}` },
        state: ownBytes(this.host.snapshot()), simVersion: meta.simVersion, dataHash: this.host.pipeline.config.data.hash, tick: meta.tick,
        serverTimeMs: Math.round(this.deps.wallMs()), tickMs: TICK_MS, deltaHz: 5, flags: [...this.tuning.flags],
        overrides: effectiveOverrides(this.tuning) as Record<string, unknown>, ...(warp > 1 ? { warp } : {}),
      },
    });
  }

  /** One client message, as the `/ws` connection handles it (a local host has exactly one planet and one player). */
  handle(msg: ToLocalHost): void {
    if (msg.t === 'save') return this.save();
    if (msg.t !== 'client') return;
    const m = msg.msg;
    switch (m.t) {
      case 'hello': return this.server({ v: 1, t: 'ready', d: { playerId: this.playerId, flags: [...this.tuning.flags] } });
      case 'join': return this.welcome('join');
      case 'leave': this.joined = false; return;
      case 'ping': return this.server({ v: 1, t: 'pong', d: { clientTimeMs: m.d.clientTimeMs, serverTimeMs: Math.round(this.deps.wallMs()), tick: this.host.tick } });
      case 'cmd': return this.command(m.id, m.d.kind, m.d.args);
    }
  }

  private command(id: string, kind: string, args: unknown): void {
    const flags = flagsFromList(this.tuning.flags);
    const pre = precheckClientCommand(kind, args, { gate: (k) => commandGate(k, flags), production: false });
    if (!pre.ok) return this.server({ v: 1, t: 'cmd.reject', d: { id, code: pre.code, ...(pre.detail ? { detail: pre.detail } : {}) } });
    this.queue.push({ colonyIndex: null, source: 'dev', commandId: id, kind, args: pre.args });
  }

  // ---- dev server (warp, scenario, tune, local.reset) -------------------------------------------------------------

  /** The local `DevServer`: what the game server's dev routes do, minus everything that needs a server (`host_unavailable`). */
  async devCommand(name: string, args: unknown): Promise<unknown> {
    const a = (args ?? {}) as Record<string, unknown>;
    switch (name) {
      case 'warp': return this.devWarp(a);
      case 'scenario': {
        if (typeof a.id !== 'string' || !a.id) throw new LocalDevError('invalid_args', 'scenario needs { id }');
        return this.restart(a.id.toLowerCase()).catch((e: unknown) => { throw new LocalDevError('not_found', e instanceof Error ? e.message : String(e)); });
      }
      case 'local.reset': return this.restart(this.scenario);
      case 'tune': return this.devTune(a);
      default: throw new LocalDevError('host_unavailable', `"${name}" needs the game server; not available on this host`);
    }
  }

  private devWarp(a: Record<string, unknown>): { planetId: string; k: number } {
    const k = a.k;
    if (typeof k !== 'number' || !Number.isInteger(k) || k < 1 || k > 100) throw new LocalDevError('invalid_args', 'warp needs an integer k in 1..100');
    this.sched.setWarp('local', k);
    return { planetId: this.planetId, k: this.warp };
  }

  private devTune(a: Record<string, unknown>): { dataHash: string; overrides: BalanceOverrides; text?: string } {
    const req = (a.op === 'set' ? { op: 'set', path: String(a.path ?? ''), value: a.value } : { op: a.op }) as TuneRequest;
    if (!['set', 'reset', 'export'].includes(req.op)) throw new LocalDevError('invalid_args', 'tune op must be set, reset or export');
    try {
      const out = tune(this.tuning, req);
      if (out.next) this.swapPipeline(out.next.pipeline, out.next.live);
      if (out.event && this.joined) this.window.push({ ...out.event, atTick: this.host.tick });
      return { dataHash: this.host.pipeline.config.data.hash, overrides: effectiveOverrides(this.tuning), ...(out.text !== undefined ? { text: out.text } : {}) };
    } catch (e) {
      throw new LocalDevError('invalid_args', e instanceof Error ? e.message : String(e));
    }
  }

  // ---- persistence ------------------------------------------------------------------------------------------------

  /** Writes the planet to the snapshot store (fire and forget; a failure is reported, never thrown into the step loop). */
  save(): void {
    const live = this.tuning.live;
    void this.deps.store.save(snapshotKey(this.scenario), {
      bytes: this.host.snapshot(), tick: this.host.tick, savedAt: this.deps.wallMs(), dataHash: this.host.pipeline.config.data.hash,
      simVersion: this.host.state.meta.simVersion, flags: [...this.tuning.flags], overrides: live as Record<string, unknown>,
    }).catch((e: unknown) => this.post({ t: 'error', message: `snapshot save failed: ${e instanceof Error ? e.message : String(e)}` }, []));
  }

  private armSave(): void {
    this.cancelSave = this.deps.schedule(() => { this.save(); this.armSave(); }, this.deps.saveEveryMs ?? SAVE_EVERY_MS);
  }

  stop(): void {
    this.sched.stop();
    this.cancelSave?.();
    this.save();
    for (const off of this.unlisten) off();
    this.unlisten = [];
  }
}

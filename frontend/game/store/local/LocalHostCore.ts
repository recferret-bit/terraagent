import { commandGate, flagsFromList, newId, parseCommandArgs, parseWaves, PlanetType, precheckClientCommand, REJECT_CODES, REJECT_DETAIL_MAX, type RejectCode, type ServerMessage } from '@terra/contracts';
import {
  applyTunedEntityHealth, buildPipeline, effectiveOverrides, GEN_VERSION, PlanetJournal, PlanetScheduler, previewPlanetTimePatch, SIM_VERSION, SimHost, TICK_MS, tune,
  type BalanceOverrides, type JournalProblem, type CommandOutcome, type PlanetTimePatch, type PlanetTuning, type SimCommand, type SimEvent, type TuneRequest,
} from '@terra/sim';
import { ownBytes } from '../bytes';
import { describeJournalProblem, resumeJournal } from './hostJournal';
import { LocalCargoRelay } from './localCargoRelay';
import { scenarioSource, type PlanetSource, type SeededPlanet } from './planetSource';
import type { FromLocalHost, LocalHostOptions, LocalPost, ToLocalHost } from './protocol';
import { compatible, snapshotKey, type LocalSnapshot, type SnapshotStore } from './snapshotStore';

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
/** Restores after a throwing step before the planet stays down (BE-12: the server allows 3 per 10 min). */
export const MAX_STEP_RESTORES = 3;
const isRejectCode = (c: string): c is RejectCode => (REJECT_CODES as readonly string[]).includes(c);

/**
 * The authoritative engine of the browser hosts (SIM-X-06, D-31): one planet stepped at 5 TPS by the shared
 * `PlanetScheduler` (drift-free, bounded catch-up, dev warp x1..x100), answering the client exactly as `/ws` does
 * (`ready`, `welcome`, `delta`, `cmd.ack`, `cmd.reject`, `event`, `pong`). Pure: clock, timers and persistence are
 * injected, so it runs in a Worker (`?host=local`, `localHost.worker.ts`: `create`, a scenario resumed from IndexedDB)
 * and in-process on the page (`LocalHost`, the dev fallback and unit tests: `open`, a planet from code, stepped by
 * `advance` until `run`). One delta per scheduler pass (= every 200 ms at x1) carries `diffSince(lastDeltaTick)` and
 * the events of the window.
 */
export class LocalHostCore {
  private host!: SimHost;
  private ledger!: PlanetJournal;
  private tuning!: PlanetTuning;
  private source!: PlanetSource;
  private joined = false;
  private lastDeltaTick = 0;
  private window: SimEvent[] = [];
  private queue: SimCommand[] = [];
  private unlisten: Array<() => void> = [];
  private cancelSave: (() => void) | undefined;
  /** Outcomes of the step in progress: answered only once the step completed (a throwing step answers `internal`). */
  private stepOutcomes: CommandOutcome[] | null = null;
  /** A step threw: no stepping, saving or new commands until the planet is restored (or for good after the cap). */
  private down = false;
  private restores = 0;
  private stopped = false;
  private running = false;
  private readonly sched: PlanetScheduler;
  private readonly playerId = newId('pr');
  private readonly cargoRelay = new LocalCargoRelay();

  /** `waves`: the flags a dev `scenario` switch runs with (intersected with the scenario's waves). */
  private constructor(private readonly waves: readonly string[], private readonly deps: LocalHostDeps, private readonly post: LocalPost) {
    this.sched = new PlanetScheduler({ now: deps.now, schedule: deps.schedule, step: (_id, dt) => this.stepOnce(dt) });
    this.sched.onPass = () => this.flushDelta();
    this.sched.onWarp = (_id, effective) => this.server({ v: 1, t: 'event', tick: 0, d: { kind: 'dev.warp', severity: 'info', atTick: 0, colonyIds: [], data: { k: effective } } });
  }

  /** `?host=local`: loads the saved planet of `opts.scenario` when compatible, else a fresh one; starts stepping. */
  static async create(opts: LocalHostOptions, deps: LocalHostDeps, post: LocalPost): Promise<LocalHostCore> {
    const waves = parseWaves(opts.waves).list;
    const core = new LocalHostCore(waves, deps, post);
    await core.build(scenarioSource(opts.scenario, waves), false);
    core.run();
    return core;
  }

  /**
   * In-process host (`LocalHost`): a fresh planet from `source`, synchronously, not stepping yet. `advance` steps it by
   * hand (tests, a scripted boot); `run` hands it to the scheduler (and the periodic save).
   */
  static open(source: PlanetSource, waves: readonly string[], deps: LocalHostDeps, post: LocalPost): LocalHostCore {
    const core = new LocalHostCore(waves, deps, post);
    core.source = source;
    core.installSeed(source.seed());
    core.sched.add('local');
    return core;
  }

  /** Starts the scheduler (due now) and the periodic save; a no-op once running or stopped. */
  run(): void {
    if (this.running || this.stopped) return;
    this.running = true;
    if (!this.down) { this.sched.remove('local'); this.sched.add('local'); } // due from now, not from when it was opened
    this.sched.start();
    this.armSave();
  }

  /**
   * Steps `ticks` ticks right now, outside the scheduler (the in-process host's manual clock), then sends one delta.
   * A throwing step is handled as on the scheduler (`fail`): the rest of the ticks are not run.
   */
  advance(ticks: number): void {
    for (let i = 0; i < ticks && !this.down; i++) this.stepOnce(1);
    if (!this.down) this.flushDelta();
  }

  /** The authoritative host (tests, tools). */
  get simHost(): SimHost { return this.host; }
  get planetId(): string { return this.host.state.meta.planetId; }
  get tick(): number { return this.host.tick; }
  get warp(): number { return this.sched.info('local')?.warp ?? 1; }
  get flags(): readonly string[] { return this.tuning.flags; }
  /** The host-side resource journal (the in-process host's `ledger` query reads it directly). */
  get journal(): PlanetJournal { return this.ledger; }

  // ---- planet lifecycle -------------------------------------------------------------------------------------------

  /** A planet from `source`, resumed from the saved snapshot unless `fresh` or incompatible. */
  private async build(source: PlanetSource, fresh: boolean): Promise<void> {
    const seeded = source.seed();
    const flags = [...seeded.host.pipeline.config.flags];
    const key = snapshotKey(source.name);
    let saved: LocalSnapshot | null = null;
    let resumed: { host: SimHost; live: BalanceOverrides } | null = null;
    if (fresh) await this.deps.store.remove(key).catch(() => undefined);
    else {
      saved = await this.deps.store.load(key).catch(() => null);
      resumed = saved && this.tryResume(saved, flags);
    }
    this.source = source;
    if (!resumed) return this.installSeed(seeded);
    // a resumed snapshot continues the journal saved with it, or opens its balances from col.stock when that journal is
    // missing or does not match
    const { journal, problem } = resumeJournal(saved?.journal, resumed.host.state);
    this.ledger = journal;
    if (problem) this.post({ t: 'error', message: problem }, []);
    this.install(resumed.host, { flags, base: {}, live: resumed.live });
  }

  /** A fresh planet: its journal replays the setup postings (a scenario's real `landing.cargo`, a seated colony's cargo). */
  private installSeed({ host, setupPostings }: SeededPlanet): void {
    this.ledger = PlanetJournal.empty();
    this.report(this.ledger.record(setupPostings));
    this.install(host, { flags: [...host.pipeline.config.flags], base: {}, live: {} });
  }

  /** Journal problems go out as host errors (the journal and the sim's `col.stock` disagree). */
  private report(problems: readonly JournalProblem[]): void {
    for (const p of problems) this.post({ t: 'error', message: describeJournalProblem(p) }, []);
  }

  private tryResume(snap: LocalSnapshot, flags: readonly string[]): { host: SimHost; live: BalanceOverrides } | null {
    try {
      const live = (snap.overrides ?? {}) as BalanceOverrides;
      const pipeline = buildPipeline(flags, live);
      if (!compatible(snap, { simVersion: SIM_VERSION, dataHash: pipeline.config.data.hash, flags })) return null;
      const host = new SimHost(pipeline);
      host.load(snap.bytes);
      if (host.state.meta.genVersion !== GEN_VERSION) return null; // ground from an older world generator: start fresh (D-38)
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
      host.onEvents((events) => {
        if (this.joined) this.window.push(...events);
        this.cargoRelay.onEvents(events, this.host.tick);
      }),
      host.onOutcomes((outcomes) => this.answer(outcomes)),
      // the journal stays here (host-side); postings never reach the client store / replica
      host.onPostings((postings) => this.report(this.ledger.record(postings))),
    ];
  }

  /** Replaces the pipeline (tune) without touching the planet or the queued commands. */
  private swapPipeline(next: SimHost['pipeline'], live: BalanceOverrides): void {
    applyTunedEntityHealth(this.host.state, this.host.pipeline.config.data, next.config.data);
    const next_ = new SimHost(next);
    next_.load(this.host.state);
    const { queue, window, lastDeltaTick } = this;
    this.install(next_, { ...this.tuning, live });
    Object.assign(this, { queue, window, lastDeltaTick });
  }

  private async restart(source: PlanetSource): Promise<{ planetId: string }> {
    this.cargoRelay.reset();
    await this.build(source, true);
    this.up();
    this.sched.setWarp('local', 1);
    void this.save();
    if (this.joined) this.welcome('resync');
    return { planetId: this.planetId };
  }

  // ---- stepping ---------------------------------------------------------------------------------------------------

  private stepOnce(dt: number): void {
    if (this.down) return; // the scheduler pass that saw the failure may still call (warp > 1)
    const due = this.cargoRelay.drainDue(this.host.tick + dt);
    const batch = [...this.queue.splice(0), ...due];
    this.stepOutcomes = [];
    try {
      for (const c of batch) this.host.submit(c);
      this.host.step(dt);
    } catch (e) {
      this.stepOutcomes = null;
      return this.fail(batch, e);
    }
    const outcomes = this.stepOutcomes;
    this.stepOutcomes = null;
    this.answer(outcomes);
  }

  /**
   * A step threw (`StepError`, LED-09): the state is half-changed. As the server does (BE-12): the step's commands and
   * those queued since are rejected `internal` (an outcome `SimHost` published for the failed step is dropped: its
   * effect is rolled back), the planet stops stepping and is restored from its last snapshot (else a fresh one) and
   * re-welcomed, at most `MAX_STEP_RESTORES` times; after that it stays down.
   */
  private fail(batch: readonly SimCommand[], e: unknown): void {
    this.down = true;
    this.sched.remove('local');
    for (const c of [...batch, ...this.queue.splice(0)]) {
      if (this.cargoRelay.isInternalCommand(c.commandId)) continue;
      this.server({ v: 1, t: 'cmd.reject', d: { id: c.commandId, code: 'internal' } });
    }
    const why = e instanceof Error ? e.message : String(e);
    if (this.restores >= MAX_STEP_RESTORES) return this.post({ t: 'error', message: `step failed: ${why}; planet down (restored ${this.restores}×)` }, []);
    this.restores++;
    this.post({ t: 'error', message: `step failed: ${why}; restoring the last snapshot` }, []);
    void this.restore();
  }

  private async restore(): Promise<void> {
    await this.build(this.source, false);
    if (this.stopped) return;
    this.up();
    if (this.joined) this.welcome('resync');
  }

  /** Steps again (after a restore, or a dev restart of a planet that was down). */
  private up(): void {
    this.down = false;
    this.sched.add('local');
  }

  private answer(outcomes: readonly CommandOutcome[]): void {
    if (this.stepOutcomes) { this.stepOutcomes.push(...outcomes); return; }
    for (const o of outcomes) {
      if (this.cargoRelay.isInternalCommand(o.commandId)) continue;
      if (!o.code) { this.server({ v: 1, t: 'cmd.ack', d: { id: o.commandId, appliedAtTick: o.appliedAtTick } }); continue; }
      // a handler may name the cause (`{ code, detail }`, GP-31); a code outside the contract is `internal` with the code as detail
      const code: RejectCode = isRejectCode(o.code) ? o.code : 'internal';
      const detail = code === o.code ? o.detail : o.detail ? `${o.code}: ${o.detail}` : o.code;
      this.server({
        v: 1,
        t: 'cmd.reject',
        d: {
          id: o.commandId,
          code,
          ...(detail ? { detail: detail.slice(0, REJECT_DETAIL_MAX) } : {}),
          ...(code === o.code && o.unlocksAt ? { unlocksAt: o.unlocksAt } : {}),
        },
      });
    }
  }

  private flushDelta(): void {
    const toTick = this.host.tick;
    if (!this.joined || toTick <= this.lastDeltaTick) return;
    // The same frames the server planet host sends (W05-19): a large tile change goes out in capped chunks; events ride frame 0.
    this.host.clientDeltaFrames(this.lastDeltaTick).forEach((f, i) => {
      const events = i === 0 ? this.window.splice(0) : [];
      this.server({ v: 1, t: 'delta', tick: f.toTick, d: { fromTick: f.fromTick, toTick: f.toTick, diff: ownBytes(f.diff), events } });
    });
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
        reason, colonyId: null, planet: { id: meta.planetId, type: type.success ? type.data : 'temperate', name: `local ${this.source.name}` },
        state: ownBytes(this.host.snapshot({ forClient: true })), simVersion: meta.simVersion, dataHash: this.host.pipeline.config.data.hash, tick: meta.tick,
        serverTimeMs: Math.round(this.deps.wallMs()), tickMs: TICK_MS, deltaHz: 5, flags: [...this.tuning.flags],
        overrides: effectiveOverrides(this.tuning) as Record<string, unknown>, ...(warp > 1 ? { warp } : {}),
      },
    });
  }

  /** One client message, as the `/ws` connection handles it (a local host has exactly one planet and one player). */
  handle(msg: ToLocalHost): void {
    if (msg.t === 'save') { void this.save(); return; }
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
    if (this.down) return this.server({ v: 1, t: 'cmd.reject', d: { id, code: 'host_unavailable', detail: 'the local planet is down after a failed step' } });
    const flags = flagsFromList(this.tuning.flags);
    const hasColony = Boolean(this.host.state.colonies?.length && this.host.state.colonies[0]?.status !== 'eliminated');
    const pre = precheckClientCommand(kind, args, { gate: (k) => commandGate(k, flags), production: false, hasColony });
    if (!pre.ok) return this.server({ v: 1, t: 'cmd.reject', d: { id, code: pre.code, ...(pre.detail ? { detail: pre.detail } : {}) } });
    this.queue.push({ colonyIndex: hasColony ? 0 : null, source: pre.dev ? 'dev' : 'player', commandId: id, kind, args: pre.args });
  }

  // ---- dev server (warp, time, scenario, tune, local.reset, ledger) -----------------------------------------------

  /** The local `DevServer` (`warp`, `time`, `scenario`, `local.reset`, `tune`, `ledger`): what the game server's dev routes do, minus everything that needs a server (`host_unavailable`). */
  async devCommand(name: string, args: unknown): Promise<unknown> {
    const a = (args ?? {}) as Record<string, unknown>;
    switch (name) {
      case 'warp': return this.devWarp(a);
      case 'scenario': {
        if (typeof a.id !== 'string' || !a.id) throw new LocalDevError('invalid_args', 'scenario needs { id }');
        return this.restart(scenarioSource(a.id.toLowerCase(), this.waves)).catch((e: unknown) => { throw new LocalDevError('not_found', e instanceof Error ? e.message : String(e)); });
      }
      case 'local.reset': return this.restart(this.source);
      case 'tune': return this.devTune(a);
      case 'time': return this.devTime(a);
      case 'ledger': return this.ledger.view(this.planetId, String(a.account ?? 'colony:0'), Number(a.limit ?? 10) || 10);
      case 'near.mock.fail': return this.cargoRelay.devFail(a);
      case 'cargo.grant': return this.cargoRelay.devGrant(a, this.queue);
      default: throw new LocalDevError('host_unavailable', `"${name}" needs the game server; not available on this host`);
    }
  }

  private devTime(a: Record<string, unknown>): Record<string, unknown> {
    const { planetId: _ignored, ...rest } = a;
    const parsed = parseCommandArgs('dev.time', rest);
    if (!parsed.success) throw new LocalDevError('invalid_args', parsed.error.issues[0]?.message ?? 'invalid time args');
    const patch = parsed.data as PlanetTimePatch;
    if (patch.timeOfDay !== undefined || patch.realHoursPerDay !== undefined || patch.timeScale !== undefined) {
      this.queue.push({ colonyIndex: null, source: 'dev', commandId: newId('cm'), kind: 'dev.time', args: patch });
    }
    const mergedPatch: PlanetTimePatch = {};
    for (const c of this.queue) {
      if (c.kind === 'dev.time' || c.kind === 'setPlanetTime') {
        Object.assign(mergedPatch, c.args as PlanetTimePatch);
      }
    }
    const pt = previewPlanetTimePatch(this.host.state, mergedPatch, this.host.tick, this.host.pipeline.config.data);
    return {
      planetId: this.planetId,
      tick: this.host.tick,
      hour: pt.hour,
      timeOfDay: pt.timeOfDay,
      phase: pt.phase,
      cyclePhase: pt.cyclePhase,
      day: pt.day,
      daylight: pt.daylight,
      isNight: pt.isNight,
      realHoursPerDay: pt.realHoursPerDay,
      timeScale: pt.timeScale,
    };
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

  /**
   * Writes the planet and its journal (captured together, same tick) to the snapshot store. Callers may ignore the
   * promise (the step loop does); it never rejects: a failure is reported as a host error.
   */
  save(): Promise<void> {
    if (this.down) return Promise.resolve(); // never persist a half-changed planet
    const live = this.tuning.live;
    return this.deps.store.save(snapshotKey(this.source.name), {
      bytes: this.host.snapshot(), tick: this.host.tick, savedAt: this.deps.wallMs(), dataHash: this.host.pipeline.config.data.hash,
      simVersion: this.host.state.meta.simVersion, flags: [...this.tuning.flags], overrides: live as Record<string, unknown>,
      journal: this.ledger.toState(),
    }).catch((e: unknown) => this.post({ t: 'error', message: `snapshot save failed: ${e instanceof Error ? e.message : String(e)}` }, []));
  }

  private armSave(): void {
    this.cancelSave = this.deps.schedule(() => { void this.save(); this.armSave(); }, this.deps.saveEveryMs ?? SAVE_EVERY_MS);
  }

  /** Stops stepping and writes the final snapshot; resolves once that save settled. */
  stop(): Promise<void> {
    this.stopped = true;
    this.sched.stop();
    this.cancelSave?.();
    const saved = this.save();
    for (const off of this.unlisten) off();
    this.unlisten = [];
    return saved;
  }
}

import { flagsFromList } from '@terra/contracts';
import { allModules, DiffGapError, FaunaMotionReplica, type BalanceOverrides, SIM_VERSION, SimHost, type PlanetState, type SimModule, type SimView } from '@terra/sim';
import { clientDataFor } from '../../core/flags/data';
import { applyTuned, type TunedData } from './tuneEvent';

/** What the server's `welcome` carries for the replica (engine bytes plus the identity of the engine that made them). */
export interface WelcomeInput {
  state: Uint8Array;
  tick: number;
  flags: readonly string[];
  dataHash: string;
  simVersion: number;
  /** Balance overrides the server compiled its data with (`welcome.overrides`, D-35). */
  overrides?: BalanceOverrides;
}
export interface DeltaInput { fromTick: number; toTick: number; diff: Uint8Array }

/**
 * `empty`: nothing loaded. `ready`: replica is exact at `tick`. `versionMismatch`: engine or data differs from the
 * server's (SIM-X-08: the page should reload; W00 only surfaces it). `needsResync`: a diff did not fit; deltas are
 * ignored until the next welcome.
 */
export type ReplicaStatus = 'empty' | 'ready' | 'versionMismatch' | 'needsResync';

export type WelcomeResult = { ok: true } | { ok: false; reason: 'simVersion' | 'dataHash' | 'badSnapshot'; detail: string };
export type DeltaResult =
  | { ok: true; tick: number }
  | { ok: false; reason: 'gap' | 'badDiff' | 'noState' | 'awaitingResync'; detail: string; request: boolean };

export interface ReplicaOptions {
  /**
   * Sim modules the replica steps/loads with. Diffs are engine data and applying one never runs a system, so modules
   * only matter once the worker also steps (prediction, local host); they must then equal the authority's list.
   */
  modules?: readonly SimModule[];
}

/**
 * Pure replica of the server state (D-31, CLIENT §7): load the `welcome` snapshot, apply deltas in order. No DOM, no
 * Worker: the worker shell, tests and later the prediction / local-host layers all wrap this class.
 */
export class ReplicaCore {
  private host: SimHost | null = null;
  private current: ReplicaStatus = 'empty';
  private lastViewTick = -1;
  /** A continuation chunk arrived since the last view (see `delta`). */
  private continuationTiles = false;
  private flags: readonly string[] = [];
  private overrides: BalanceOverrides | undefined;
  private faunaMotion: FaunaMotionReplica | null = null;
  constructor(private readonly opts: ReplicaOptions = {}) {}

  get status(): ReplicaStatus { return this.current; }
  get loaded(): boolean { return this.host !== null && this.current === 'ready'; }
  get tick(): number { return this.host ? this.host.tick : -1; }
  get state(): PlanetState { return this.requireHost().state; }
  /** The underlying host (the prediction layer clones it). */
  get simHost(): SimHost { return this.requireHost(); }

  private requireHost(): SimHost {
    if (!this.host) throw new Error('ReplicaCore: no welcome applied yet');
    return this.host;
  }

  welcome(w: WelcomeInput): WelcomeResult {
    this.host = null;
    this.faunaMotion = null;
    if (w.simVersion !== SIM_VERSION) return this.fail('simVersion', `server sim ${w.simVersion}, client ${SIM_VERSION}`);
    const data = clientDataFor(flagsFromList(w.flags), w.overrides);
    if (data.hash !== w.dataHash) return this.fail('dataHash', `server data ${w.dataHash}, client ${data.hash}`);
    const host = new SimHost({ flags: w.flags, data, modules: this.opts.modules ?? allModules() });
    try {
      host.load(w.state);
      if (w.flags.includes('W07')) {
        this.faunaMotion = new FaunaMotionReplica();
        this.faunaMotion.welcome(host.state, data);
      }
    } catch (e) { return this.fail('badSnapshot', (e as Error).message); }
    this.host = host;
    this.flags = [...w.flags];
    this.overrides = w.overrides;
    this.current = 'ready';
    this.lastViewTick = -1;
    return { ok: true };
  }

  /**
   * A live `tune` on the host (`dev.tuned`): rebuilds the replica's pipeline with the tuned data, keeping the state, so
   * the prediction steps with the host's numbers (a stale pipeline would, e.g., restart multi-step path searches on
   * every predicted step). False when the client cannot rebuild the same data (`reset`, a rejected path, a hash
   * mismatch): the caller asks for a fresh welcome.
   */
  retune(t: TunedData): boolean {
    const host = this.host;
    if (!host || this.current !== 'ready') return false;
    const overrides = applyTuned(this.overrides, t);
    if (!overrides) return false;
    const data = clientDataFor(flagsFromList(this.flags), overrides);
    if (data.hash !== t.dataHash) return false;
    const next = new SimHost({ flags: this.flags, data, modules: this.opts.modules ?? allModules() });
    next.load(host.state);
    this.host = next;
    this.overrides = overrides;
    return true;
  }

  /** The hash of the data the replica runs with (tests, diagnostics). */
  get dataHash(): string { return this.requireHost().pipeline.config.data.hash; }

  private fail(reason: 'simVersion' | 'dataHash' | 'badSnapshot', detail: string): WelcomeResult {
    this.current = reason === 'badSnapshot' ? 'needsResync' : 'versionMismatch';
    return { ok: false, reason, detail };
  }

  delta(d: DeltaInput): DeltaResult {
    if (this.current === 'versionMismatch') return { ok: false, reason: 'noState', detail: 'version mismatch', request: false };
    if (this.current === 'needsResync') return { ok: false, reason: 'awaitingResync', detail: 'waiting for welcome', request: false };
    if (!this.host) return { ok: false, reason: 'noState', detail: 'delta before welcome', request: true };
    try {
      this.host.applyDiff(d.diff);
      this.faunaMotion?.apply(d.diff, this.host.state, this.host.pipeline.config.data);
    } catch (e) {
      this.current = 'needsResync';
      if (e instanceof DiffGapError) return { ok: false, reason: 'gap', detail: e.message, request: true };
      return { ok: false, reason: 'badDiff', detail: (e as Error).message, request: true };
    }
    // A diff that leaves the replica anywhere but the announced tick cannot be trusted.
    if (this.host.tick !== d.toTick) { this.current = 'needsResync'; return { ok: false, reason: 'badDiff', detail: `at ${this.host.tick}, expected ${d.toTick}`, request: true }; }
    // A continuation chunk (W05-19, `toTick → toTick`) carries tiles stamped inside a window the last view already
    // covered, so the `changedAt` scan cannot see them: the next view must carry tiles again.
    if (d.fromTick === d.toTick) this.continuationTiles = true;
    return { ok: true, tick: d.toTick };
  }

  view(): SimView { return this.requireHost().view(); }

  /** True when any tile changed after the last `markViewed` (scans the `changedAt` layer; tiles are few). */
  tilesChanged(): boolean {
    const stamp = this.state.grid.layers.changedAt;
    if (this.continuationTiles) return true;
    if ((this.state.blobs.colonyExplored?.changedAt ?? -1) > this.lastViewTick) return true;
    for (let i = 0; i < stamp.length; i++) if (stamp[i] > this.lastViewTick) return true;
    return this.lastViewTick < 0;
  }
  markViewed(): void { this.lastViewTick = this.tick; this.continuationTiles = false; }
}

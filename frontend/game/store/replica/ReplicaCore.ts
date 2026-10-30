import { flagsFromList } from '@terra/contracts';
import { allModules, DiffGapError, SIM_VERSION, SimHost, type PlanetState, type SimModule, type SimView } from '@terra/sim';
import { clientDataFor } from '../../core/flags/data';

/** What the server's `welcome` carries for the replica (engine bytes plus the identity of the engine that made them). */
export interface WelcomeInput {
  state: Uint8Array;
  tick: number;
  flags: readonly string[];
  dataHash: string;
  simVersion: number;
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
    if (w.simVersion !== SIM_VERSION) return this.fail('simVersion', `server sim ${w.simVersion}, client ${SIM_VERSION}`);
    const data = clientDataFor(flagsFromList(w.flags));
    if (data.hash !== w.dataHash) return this.fail('dataHash', `server data ${w.dataHash}, client ${data.hash}`);
    const host = new SimHost({ flags: w.flags, data, modules: this.opts.modules ?? allModules() });
    try { host.load(w.state); } catch (e) { return this.fail('badSnapshot', (e as Error).message); }
    this.host = host;
    this.current = 'ready';
    this.lastViewTick = -1;
    return { ok: true };
  }

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
    } catch (e) {
      this.current = 'needsResync';
      if (e instanceof DiffGapError) return { ok: false, reason: 'gap', detail: e.message, request: true };
      return { ok: false, reason: 'badDiff', detail: (e as Error).message, request: true };
    }
    // A diff that leaves the replica anywhere but the announced tick cannot be trusted.
    if (this.host.tick !== d.toTick) { this.current = 'needsResync'; return { ok: false, reason: 'badDiff', detail: `at ${this.host.tick}, expected ${d.toTick}`, request: true }; }
    return { ok: true, tick: d.toTick };
  }

  view(): SimView { return this.requireHost().view(); }

  /** True when any tile changed after the last `markViewed` (scans the `changedAt` layer; tiles are few). */
  tilesChanged(): boolean {
    const stamp = this.state.grid.layers.changedAt;
    for (let i = 0; i < stamp.length; i++) if (stamp[i] > this.lastViewTick) return true;
    return this.lastViewTick < 0;
  }
  markViewed(): void { this.lastViewTick = this.tick; }
}

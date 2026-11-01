import type { ServerMessage } from '@terra/contracts';
import { createPlanet, type PlanetJournal, type PlanetState, type SimHost } from '@terra/sim';
import { DevServerError, type DevServer } from '../../net/devServer';
import { Emitter } from '../../net/emitter';
import type { Outgoing } from '../../net/types';
import { packView, unpackView, type ClientView } from '../replica/viewCodec';
import { WorldStore } from '../WorldStore';
import { LocalDevError, LocalHostCore, type LocalHostDeps } from './LocalHostCore';
import { builtPlanetSource, type PlanetSource } from './planetSource';
import type { FromLocalHost } from './protocol';
import { memorySnapshotStore } from './snapshotStore';

export interface LocalHostOpts {
  /** Wave flags (default W00 + W01). */
  flags?: readonly string[];
  /** The planet (default: a flat planet of `radius` / `seed` with no colony; tests seat their own). */
  source?: PlanetSource;
  radius?: number;
  seed?: string;
}

const JOIN = { t: 'client', msg: { t: 'join', d: { planetId: 'local' } } } as const;

/** Real clock and timers; snapshots stay in memory (a reload is a new planet). */
const pageDeps = (): LocalHostDeps => ({
  now: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
  wallMs: () => Date.now(),
  schedule: (fn, ms) => { const h = setTimeout(fn, ms); return () => clearTimeout(h); },
  store: memorySnapshotStore(),
});

/**
 * The in-process browser host (the dev fallback when no game server answers, FA-06; deterministic unit tests): the
 * same `LocalHostCore` as `?host=local` (precheck, acks / rejects with detail, journal, dev server, failed-step
 * restore), run on the page instead of in a Worker. The page's stores read the authoritative state directly
 * (`bindStore` → `pushView` on every welcome / delta; tile layers only when a tile changed), so no replica applies diffs.
 * It is stepped by hand (`step`) until `start()` hands it to the core's scheduler (5 TPS, dev warp).
 */
export class LocalHost {
  readonly store: WorldStore;
  private readonly core: LocalHostCore;
  private readonly msgs = new Emitter<ServerMessage>();
  private readonly stores = new Set<WorldStore>();
  private lastViewTick = -1;
  private last: ClientView | null = null;

  constructor(opts: LocalHostOpts = {}) {
    const flags = [...(opts.flags ?? ['W00', 'W01'])];
    const source = opts.source ?? builtPlanetSource('local-host', flags, () => createPlanet({ type: 'flat', seed: opts.seed ?? 'local-host', radius: opts.radius ?? 16 }));
    this.core = LocalHostCore.open(source, flags, pageDeps(), (m) => this.fromCore(m));
    this.core.handle(JOIN);
    this.store = new WorldStore(this, () => ({ postMessage() {}, onmessage: null, terminate() {} }));
  }

  /** The authoritative `SimHost` (replaced when a failed step restores the planet). */
  get sim(): SimHost { return this.core.simHost; }
  get state(): PlanetState { return this.core.simHost.state; }
  get tick(): number { return this.core.tick; }
  /** Host-side resource journal (dev console `ledger`); the bound stores only get `col.stock`. */
  get ledger(): PlanetJournal { return this.core.journal; }

  /** Dev console server commands, answered by the core as on `?host=local` (`warp`, `scenario`, `tune`, `local.reset`, `ledger`). */
  readonly devServer: DevServer = async (name, args = {}) => {
    try { return await this.core.devCommand(name, args); } catch (e) {
      throw e instanceof LocalDevError ? new DevServerError(e.code, e.message) : e;
    }
  };

  /** Steps on the core's scheduler (5 TPS, warp) with the periodic snapshot; `step` stays available. */
  start(): void { this.core.run(); }
  /** Stops stepping for good. */
  stop(): void { void this.core.stop(); }

  bindStore(store: WorldStore): void {
    this.stores.add(store);
    store.pushView(this.view(true));
  }

  /** A client message (`cmd`, `join`, `ping`, `leave`), handled as the `/ws` connection does. */
  send(m: Outgoing): void { this.core.handle({ t: 'client', msg: m }); }

  onMessage(fn: (m: ServerMessage) => void): () => void { return this.msgs.on(fn); }

  /** Publishes the current state to every bound store (`withTiles` forces the tile layers in). */
  sync(withTiles = false): ClientView {
    const v = this.view(withTiles);
    for (const s of this.stores) s.pushView(v);
    return v;
  }

  /** Steps `dt` ticks now; the delta at the end publishes the view. */
  step(dt = 1): ClientView {
    this.core.advance(dt);
    return this.last ?? this.sync(true);
  }

  private view(withTiles: boolean): ClientView {
    const tiles = withTiles || this.tilesChanged();
    const { view } = packView(this.core.simHost.view(), tiles);
    this.lastViewTick = this.core.tick;
    this.last = unpackView(view, Date.now());
    return this.last;
  }

  private tilesChanged(): boolean {
    if (this.lastViewTick < 0) return true;
    const stamp = this.core.simHost.state.grid.layers.changedAt;
    for (let i = 0; i < stamp.length; i++) if (stamp[i] > this.lastViewTick) return true;
    return false;
  }

  private fromCore(m: FromLocalHost): void {
    if (m.t === 'error') { console.warn('[local host]', m.message); return; }
    if (m.t !== 'server') return;
    if (m.msg.t === 'welcome' || m.msg.t === 'delta') this.sync(m.msg.t === 'welcome');
    this.msgs.emit(m.msg);
  }
}

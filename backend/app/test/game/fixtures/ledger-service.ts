import type { LedgerPosting } from '@terra/sim';
import pino from 'pino';
import type { LoadOptions, PlanetLedgerListener } from '../../../src/game/game-planets.service';
import { InMemoryLedgerStore } from '../../../src/game/ledger/in-memory-ledger-store';
import type { LedgerRow, LedgerStorePort } from '../../../src/game/ledger/ledger-store.port';
import { PlanetLedgerService } from '../../../src/game/ledger/planet-ledger.service';
import type { LoadedInfo } from '../../../src/game/thread/protocol';

/**
 * Stand-in for `GamePlanets`: captures the listeners the services register so a test can play thread messages
 * (`loaded`, `step`, `snapshot`), and records the loads it is asked for (`loads`; a load "finishes" at once).
 */
export class FakePlanets {
  readonly loads: Array<{ id: string; opts: LoadOptions }> = [];
  readonly loadedSet = new Set<string>();
  private readonly loadedFns: Array<(id: string, tick: number, info: LoadedInfo) => void> = [];
  private readonly unloadedFns: Array<(id: string) => void> = [];
  private readonly snapshotFns: Array<(id: string, s: { tick: number; bytes: Uint8Array }) => void> = [];
  private ledgerFn?: PlanetLedgerListener;
  onPlanetLoaded(fn: (id: string, tick: number, info: LoadedInfo) => void) { this.loadedFns.push(fn); }
  onPlanetUnloaded(fn: (id: string) => void) { this.unloadedFns.push(fn); }
  onPlanetSnapshot(fn: (id: string, s: { tick: number; bytes: Uint8Array }) => void) { this.snapshotFns.push(fn); }
  onPlanetLedger(fn: PlanetLedgerListener) { this.ledgerFn = fn; }
  /** Plays a thread's `loaded` message. */
  loaded(id: string, tick: number, info: LoadedInfo) {
    this.loadedSet.add(id);
    for (const fn of this.loadedFns) fn(id, tick, info);
  }
  unloaded(id: string) {
    this.loadedSet.delete(id);
    for (const fn of this.unloadedFns) fn(id);
  }
  /** Plays a thread's `snapshot` message. */
  snapshot(id: string, tick: number) {
    for (const fn of this.snapshotFns) fn(id, { tick, bytes: new Uint8Array([tick % 256]) });
  }
  /** Plays one step's `ledger` message: the postings get `at = tick`, as the sim stamps them. */
  step(planetId: string, tick: number, postings: readonly LedgerPosting[]) {
    this.ledgerFn!(planetId, tick, postings.map((p) => ({ ...p, at: tick })));
  }
  loadedIds() { return [...this.loadedSet]; }
  isLoaded(id: string) { return this.loadedSet.has(id); }
  requestSnapshot() {}
  markScenarioColonyPlanet() {}
  /** A fresh load answers `loaded` at tick 0 with what the main thread knows (`noSnapshots`). */
  async load(id: string, opts: LoadOptions = {}) {
    this.loads.push({ id, opts });
    this.loaded(id, 0, { restored: Boolean(opts.snapshot), genesis: Boolean(opts.genesis), stocks: [], ...(opts.noSnapshots ? { noSnapshots: true } : {}) });
    return 0;
  }
  async ensureLoaded(id: string, opts: LoadOptions = {}) {
    return this.loadedSet.has(id) ? 0 : this.load(id, opts);
  }
}

/** A `PlanetLedgerService` over `store` with captured JSON logs (`errors()` = level 50). */
export function setupLedgerService<S extends LedgerStorePort = InMemoryLedgerStore>(store: S = new InMemoryLedgerStore() as unknown as S) {
  const logs: Array<Record<string, unknown>> = [];
  const root = pino({ level: 'debug' }, { write: (s: string) => { logs.push(JSON.parse(s) as Record<string, unknown>); } });
  const planets = new FakePlanets();
  const svc = new PlanetLedgerService(planets as never, store, root, {} as never);
  const errors = () => logs.filter((l) => l.level === 50);
  return { svc, planets, store, logs, errors };
}

export const credit = (colony: number, asset: string, n: number, reason = 'landing.cargo'): LedgerPosting => ({
  at: 0, reason, actor: 'system:landing', legs: [{ account: 'sys:landing', asset, delta: -n }, { account: `colony:${colony}`, asset, delta: n }],
});
export const debit = (colony: number, asset: string, n: number, reason = 'construction.spend'): LedgerPosting => ({
  at: 0, reason, actor: 'player:p_1', ref: 'order:1', legs: [{ account: `colony:${colony}`, asset, delta: -n }, { account: 'sys:construction', asset, delta: n }],
});
export const row = (tick: number, idx: number, p: LedgerPosting): LedgerRow => ({ tick, idx, reason: p.reason, actor: p.actor, legs: p.legs, ...(p.ref ? { ref: p.ref } : {}) });
/** A fresh (generated) load of a planet the loader checked has no snapshots: the usual new planet. */
export const FRESH: LoadedInfo = { restored: false, genesis: false, stocks: [], noSnapshots: true };
/** A fresh load nobody checked for snapshots (must keep the stored rows). */
export const UNCHECKED: LoadedInfo = { restored: false, genesis: false, stocks: [] };

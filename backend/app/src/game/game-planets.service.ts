import { canonicalPlanetById, newId, W11_DEFAULT_SECTOR_RADIUS, type SimCommandV1 } from '@terra/contracts';
import { globalTileToSector, hexDistance, type BalanceOverrides, type LedgerPosting, type SimEvent, type TuneRequest } from '@terra/sim';
import type { SimThreadPool } from './sim-thread-pool';
import { ThreadRequests } from './thread-requests';
import type { FromThread, LandingSiteAnswer, LoadedInfo, LoadMsg } from './thread/protocol';

export type CommandOutcomeMsg =
  | { readonly ok: true; readonly commandId: string; readonly appliedAtTick: number }
  | { readonly ok: false; readonly commandId: string; readonly code: string; readonly appliedAtTick?: number; readonly detail?: string; readonly unlocksAt?: string };

/**
 * Reject codes of `submit` that come from the host, not the sim: the planet's thread is down (`thread_down`) or the
 * planet is not loaded on it (`planet_not_loaded`). Not `REJECT_CODES`: WS ingress sends them as `internal` + detail,
 * the seat path as `host_unavailable`.
 */
export const HOST_DOWN_CODES: readonly string[] = ['thread_down', 'planet_not_loaded'];

export interface PlanetSubscriber {
  onDelta?(d: { fromTick: number; toTick: number; diff: Uint8Array; events: SimEvent[] }): void;
  onEvent?(events: SimEvent[]): void;
  onSnapshot?(s: { tick: number; bytes: Uint8Array }): void;
}

export interface FullState {
  readonly planetId: string;
  readonly tick: number;
  readonly bytes: Uint8Array;
  readonly simVersion: number;
  readonly dataHash: string;
  readonly planetType: string;
  /** Effective dev time warp of the planet (1 = none). */
  readonly warp: number;
  /** Balance overrides the planet's data was compiled with (D-35); absent = none. */
  readonly overrides?: BalanceOverrides;
}

export interface TuneResult {
  readonly ok: boolean;
  readonly dataHash: string;
  /** Effective overrides (file ⊕ scenario ⊕ live). */
  readonly overrides: BalanceOverrides;
  /** `export`: the overrides as `balance.overrides.json` text. */
  readonly text?: string;
  readonly error?: string;
}

/**
 * Why a planet went down (BE-11/BE-12): its thread died (`thread_down`) or one of its steps threw (`step_failed`).
 * Either way its pending commands were answered, its loads failed and it is no longer loaded.
 */
export type PlanetDownReason = 'thread_down' | 'step_failed';
export type PlanetDownListener = (planetId: string, reason: PlanetDownReason, detail: string) => void;

/** Global tap on every sim event leaving a thread (each exactly once: from a delta or from a bare `event`). */
export type PlanetEventsListener = (planetId: string, events: readonly SimEvent[]) => void;

/** Main-thread facts about a load, handed to `onPlanetLoaded` with the thread's `loaded` (never sent to the thread). */
type HostLoadInfo = Pick<LoadedInfo, 'setupPostings' | 'noSnapshots'>;

export type LoadOptions = Omit<LoadMsg, 't' | 'planetId'> & HostLoadInfo;

/** Ledger postings of one step leaving a thread (host-side only, see `PlanetLedgerService`). */
export type PlanetLedgerListener = (planetId: string, tick: number, postings: readonly LedgerPosting[]) => void;

interface Waiter<T> { resolve(v: T): void; reject(e: Error): void }

/**
 * Main-thread directory of planets: which are loaded, on which thread, plus promise/callback APIs over the message
 * protocol. Other modules (WS gateway, admin) use this; they never see planet state.
 */
export class GamePlanets {
  private readonly loading = new Map<string, Waiter<number>[]>();
  private readonly loaded = new Set<string>();
  private readonly scenarioColonyPlanets = new Set<string>();
  private readonly cmdWaiters = new Map<string, Waiter<CommandOutcomeMsg>[]>();
  private readonly requests = new ThreadRequests();
  private readonly subs = new Map<string, Set<PlanetSubscriber>>();
  private readonly loadedListeners: ((planetId: string, tick: number, info: LoadedInfo) => void)[] = [];
  private readonly ledgerListeners: PlanetLedgerListener[] = [];
  /** Main-thread load facts (genesis setup postings, the no-snapshot check) of loads in flight, until `loaded` arrives. */
  private readonly hostInfo = new Map<string, HostLoadInfo>();
  private readonly unloadedListeners: ((planetId: string) => void)[] = [];
  private readonly snapshotListeners: ((planetId: string, s: { tick: number; bytes: Uint8Array }) => void)[] = [];
  private readonly shutdownHooks: (() => void | Promise<void>)[] = [];
  private readonly warps = new Map<string, number>();
  private readonly warpListeners = new Set<(planetId: string, k: number) => void>();
  private readonly eventListeners = new Set<PlanetEventsListener>();
  private readonly downListeners = new Set<PlanetDownListener>();
  private readonly threadDownListeners = new Set<(thread: number, planetIds: readonly string[]) => void>();
  /** Set by `shutdown`: threads stopping on purpose are not "down". */
  private stopping = false;
  private readonly unlisten: () => void;

  constructor(readonly pool: SimThreadPool, readonly deltaHz = 5) {
    this.unlisten = pool.listen((thread, msg) => this.onMessage(thread, msg));
  }

  threadOf(planetId: string): number {
    return this.pool.threadOf(planetId);
  }

  loadedIds(): string[] {
    return [...this.loaded];
  }

  /**
   * Loads (or restores from `opts.snapshot`) a planet on its thread; resolves with its tick. A second generating load of
   * a planet that is loading joins the first; any other second load (a restore while loading, or a load of a planet
   * already loaded) is refused (BE-16), so the load listeners (ledger restore) never run twice for one load.
   */
  load(planetId: string, opts: LoadOptions = {}): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      const existing = this.loading.get(planetId);
      if (existing && !opts.snapshot) {
        existing.push({ resolve, reject });
        return;
      }
      if (existing || this.loaded.has(planetId)) {
        reject(new Error(`planet ${planetId} is already ${existing ? 'loading' : 'loaded'}`));
        return;
      }
      this.loading.set(planetId, [{ resolve, reject }]);
      const { setupPostings, noSnapshots, ...msg } = opts;
      const canonical = canonicalPlanetById(planetId);
      const normalizedMsg =
        canonical && !msg.snapshot && msg.params?.radius === undefined
          ? {
              ...msg,
              params: {
                type: msg.params?.type ?? canonical.type,
                seed: msg.params?.seed ?? canonical.seed,
                radius: W11_DEFAULT_SECTOR_RADIUS,
                capacity: msg.params?.capacity ?? 28,
              },
            }
          : msg;
      this.hostInfo.set(planetId, { ...(setupPostings ? { setupPostings } : {}), ...(noSnapshots ? { noSnapshots } : {}) });
      const transfer = normalizedMsg.snapshot ? [normalizedMsg.snapshot.buffer as ArrayBuffer] : [];
      if (!this.pool.sendToPlanet(planetId, { t: 'load', planetId, ...normalizedMsg }, transfer)) this.failLoad(planetId, new Error('sim thread is not running'));
    });
  }

  /**
   * Ensures `planetId` is loaded on its thread, loading it with `opts` if not yet loaded. A fresh (generated) load of a
   * planet that may have snapshots goes through `SnapshotService.loadNew` instead, which checks first.
   */
  async ensureLoaded(planetId: string, opts: LoadOptions = {}): Promise<number> {
    if (this.loaded.has(planetId)) return 0;
    return this.load(planetId, opts);
  }

  /** Global listeners (persistence): a planet finished loading / was unloaded / a snapshot arrived (subscribed or not). */
  onPlanetLoaded(fn: (planetId: string, tick: number, info: LoadedInfo) => void): void { this.loadedListeners.push(fn); }
  /** Every step's ledger postings of every planet, in order, subscribed or not. */
  onPlanetLedger(fn: PlanetLedgerListener): void { this.ledgerListeners.push(fn); }
  onPlanetUnloaded(fn: (planetId: string) => void): void { this.unloadedListeners.push(fn); }
  onPlanetSnapshot(fn: (planetId: string, s: { tick: number; bytes: Uint8Array }) => void): void { this.snapshotListeners.push(fn); }

  private sendSingleCmd(planetId: string, cmd: SimCommandV1): Promise<CommandOutcomeMsg> {
    return new Promise<CommandOutcomeMsg>((resolve, reject) => {
      const key = `${planetId}\0${cmd.commandId}`;
      const list = this.cmdWaiters.get(key) ?? [];
      list.push({ resolve, reject });
      this.cmdWaiters.set(key, list);
      if (!this.pool.sendToPlanet(planetId, { t: 'cmd', planetId, cmd })) {
        this.settleCmd(key, { ok: false, commandId: cmd.commandId, code: 'thread_down' });
      }
    });
  }

  /** Queues a command for the planet's next step; resolves with the ack/reject outcome. */
  async submit(planetId: string, cmd: SimCommandV1): Promise<CommandOutcomeMsg> {
    const isCanonical = canonicalPlanetById(planetId) !== null;
    let normalizedCmd = cmd;
    if (isCanonical && cmd.kind === 'system.spawnColony' && cmd.args && typeof cmd.args === 'object') {
      const args = cmd.args as Record<string, unknown>;
      if (typeof args.q === 'number' && typeof args.r === 'number' && hexDistance(0, 0, args.q, args.r) > W11_DEFAULT_SECTOR_RADIUS) {
        const local = globalTileToSector(args.q, args.r, W11_DEFAULT_SECTOR_RADIUS);
        normalizedCmd = { ...cmd, args: { ...args, q: local.localQ, r: local.localR } };
      }
    }
    const out = await this.sendSingleCmd(planetId, normalizedCmd);
    if (
      !out.ok &&
      isCanonical &&
      cmd.kind === 'system.spawnColony' &&
      (out.code === 'landing_site_taken' || out.code === 'invalid_args') &&
      cmd.args &&
      typeof cmd.args === 'object'
    ) {
      const { q: _q, r: _r, sectorId: _s, landingSlotId: _l, ...restArgs } = cmd.args as Record<string, unknown>;
      const retryCmd: SimCommandV1 = { ...cmd, commandId: newId('cm'), args: restArgs };
      const retryOut = await this.sendSingleCmd(planetId, retryCmd);
      return { ...retryOut, commandId: cmd.commandId };
    }
    return out;
  }

  /** Registers delta/event handlers for a planet; the thread publishes only while someone is subscribed. Returns unsubscribe. */
  subscribe(planetId: string, sub: PlanetSubscriber): () => void {
    let set = this.subs.get(planetId);
    if (!set) this.subs.set(planetId, (set = new Set()));
    set.add(sub);
    if (set.size === 1) this.pool.sendToPlanet(planetId, { t: 'subscribe', planetId });
    return () => {
      const s = this.subs.get(planetId);
      if (!s?.delete(sub)) return;
      if (s.size === 0) { this.subs.delete(planetId); this.pool.sendToPlanet(planetId, { t: 'unsubscribe', planetId }); }
    };
  }

  /** Dev time warp: asks the planet's thread to run `k` (1..100) steps per due slot. The thread answers with the effective value (see `onWarp`). */
  setWarp(planetId: string, k: number): boolean {
    return this.loaded.has(planetId) && this.pool.sendToPlanet(planetId, { t: 'ctl', op: 'warp', planetId, k });
  }

  /** Effective warp of a planet (1 when never warped). */
  warpOf(planetId: string): number {
    return this.warps.get(planetId) ?? 1;
  }

  /** Every planet with warp above 1 and its effective value (metrics). */
  warped(): [string, number][] {
    return [...this.warps].filter(([, k]) => k > 1);
  }

  /** Called whenever a planet's effective warp changes (a request or a thread budget cap). Returns unsubscribe. */
  onWarp(fn: (planetId: string, k: number) => void): () => void {
    this.warpListeners.add(fn);
    return () => this.warpListeners.delete(fn);
  }

  /** A planet went down (thread death or a throwing step): the gateway closes its room. Returns unsubscribe. */
  onPlanetDown(fn: PlanetDownListener): () => void {
    this.downListeners.add(fn);
    return () => this.downListeners.delete(fn);
  }

  /** A sim thread died (not a shutdown); `planetIds` were on it and are down. Returns unsubscribe. */
  onThreadDown(fn: (thread: number, planetIds: readonly string[]) => void): () => void {
    this.threadDownListeners.add(fn);
    return () => this.threadDownListeners.delete(fn);
  }

  /** Registers a tap on all planet events (the bus bridge). Returns unsubscribe. */
  onEvents(l: PlanetEventsListener): () => void {
    this.eventListeners.add(l);
    return () => this.eventListeners.delete(l);
  }

  private tap(planetId: string, events: readonly SimEvent[]): void {
    if (events.length) for (const l of this.eventListeners) l(planetId, events);
  }

  /** Asks the owning thread for a snapshot; it arrives through `onSnapshot` of the planet's subscribers. */
  requestSnapshot(planetId?: string): void {
    if (planetId) this.pool.sendToPlanet(planetId, { t: 'snapshotNow', planetId });
    else for (let t = 0; t < this.pool.size; t++) this.pool.send(t, { t: 'snapshotNow' });
  }

  isLoaded(planetId: string): boolean {
    return this.loaded.has(planetId);
  }

  markScenarioColonyPlanet(planetId: string): void {
    this.scenarioColonyPlanets.add(planetId);
  }

  isScenarioColonyPlanet(planetId: string): boolean {
    return this.scenarioColonyPlanets.has(planetId);
  }

  /** Engine snapshot + simVersion + dataHash of a loaded planet, fetched from its owning thread (welcome payload). */
  fullState(planetId: string, timeoutMs = 10_000): Promise<FullState> {
    return this.requests.ask(planetId, 'fullState', timeoutMs, (reqId) => this.loaded.has(planetId) && this.pool.sendToPlanet(planetId, { t: 'fullState', planetId, reqId }));
  }

  /** Dev `tune` (D-35) on a loaded planet; resolves with the new data hash / export text, or `ok: false` + `error` for a bad path or value. */
  tune(planetId: string, req: TuneRequest, timeoutMs = 10_000): Promise<TuneResult> {
    return this.requests.ask(planetId, 'tune', timeoutMs, (reqId) => this.loaded.has(planetId) && this.pool.sendToPlanet(planetId, { t: 'tune', planetId, reqId, req }));
  }

  /** Where the loaded planet's sim would land colony `colony` now (`nextLandingSite`, LED-14). */
  landingSite(planetId: string, colony: number, timeoutMs = 10_000): Promise<LandingSiteAnswer> {
    return this.requests.ask(planetId, 'landingSite', timeoutMs, (reqId) => this.loaded.has(planetId) && this.pool.sendToPlanet(planetId, { t: 'landingSite', planetId, reqId, colony }));
  }

  /** Registers work to run before threads stop (a later issue snapshots every planet here). */
  onBeforeShutdown(fn: () => void | Promise<void>): void {
    this.shutdownHooks.push(fn);
  }

  async shutdown(): Promise<void> {
    this.stopping = true;
    for (const h of this.shutdownHooks) await h();
    await this.pool.shutdown();
    this.unlisten();
    const err = new Error('game threads stopped');
    this.requests.failAll(err);
    for (const id of [...this.loading.keys()]) this.failLoad(id, err);
    for (const key of [...this.cmdWaiters.keys()]) this.settleCmd(key, { ok: false, commandId: key.split('\0')[1] ?? '', code: 'thread_down' });
  }

  /**
   * A planet is gone from its thread (BE-11/BE-12): every command waiting on it is answered `thread_down`, its loads
   * and requests fail, it leaves the loaded set (listeners drop their per-planet state, e.g. ledgers), and the down
   * listeners run (the gateway closes the planet's room; the game module may restore it).
   */
  private planetDown(planetId: string, reason: PlanetDownReason, detail: string): void {
    const err = new Error(`planet ${planetId} is down (${reason}): ${detail}`);
    const wasLoaded = this.loaded.delete(planetId);
    this.warps.delete(planetId);
    for (const key of [...this.cmdWaiters.keys()]) {
      if (key.startsWith(`${planetId}\0`)) while (this.cmdWaiters.has(key)) this.settleCmd(key, { ok: false, commandId: key.slice(planetId.length + 1), code: 'thread_down' });
    }
    this.failLoad(planetId, err);
    this.requests.failAll(err, planetId);
    if (wasLoaded) for (const fn of this.unloadedListeners) fn(planetId);
    for (const fn of this.downListeners) fn(planetId, reason, detail);
  }

  /** Every planet the dead thread owned or was asked about: loaded, loading, or with commands in flight. */
  private threadDown(thread: number): void {
    const ids = new Set<string>([...this.loaded, ...this.loading.keys(), ...[...this.cmdWaiters.keys()].map((k) => k.split('\0')[0] ?? '')]);
    const down = [...ids].filter((id) => id && this.threadOf(id) === thread);
    for (const id of down) this.planetDown(id, 'thread_down', `sim thread ${thread} stopped`);
    for (const fn of this.threadDownListeners) fn(thread, down);
  }

  private onMessage(thread: number, msg: FromThread): void {
    switch (msg.t) {
      case 'loaded':
        this.loaded.add(msg.planetId);
        for (const w of this.loading.get(msg.planetId) ?? []) w.resolve(msg.tick);
        this.loading.delete(msg.planetId);
        {
          const host = this.hostInfo.get(msg.planetId);
          this.hostInfo.delete(msg.planetId);
          const info: LoadedInfo = { restored: msg.restored ?? false, genesis: msg.genesis ?? false, stocks: msg.stocks ?? [], ...host };
          for (const fn of this.loadedListeners) fn(msg.planetId, msg.tick, info);
        }
        return;
      case 'ledger':
        for (const fn of this.ledgerListeners) fn(msg.planetId, msg.tick, msg.postings);
        return;
      case 'ack': return this.settleCmd(`${msg.planetId}\0${msg.commandId}`, { ok: true, commandId: msg.commandId, appliedAtTick: msg.appliedAtTick });
      case 'reject':
        return this.settleCmd(`${msg.planetId}\0${msg.commandId}`, {
          ok: false, commandId: msg.commandId, code: msg.code, appliedAtTick: msg.appliedAtTick, ...(msg.detail ? { detail: msg.detail } : {}), ...(msg.unlocksAt ? { unlocksAt: msg.unlocksAt } : {}),
        });
      case 'delta':
        this.tap(msg.planetId, msg.events);
        return this.each(msg.planetId, (s) => s.onDelta?.(msg));
      case 'event':
        this.tap(msg.planetId, msg.events);
        return this.each(msg.planetId, (s) => s.onEvent?.(msg.events));
      case 'warp': {
        const changed = this.warpOf(msg.planetId) !== msg.k;
        this.warps.set(msg.planetId, msg.k);
        if (changed) for (const fn of this.warpListeners) fn(msg.planetId, msg.k);
        return;
      }
      case 'fullState':
        this.warps.set(msg.planetId, msg.warp);
        return this.requests.answer(msg.reqId, msg);
      case 'tuned':
      case 'landingSite':
        return this.requests.answer(msg.reqId, msg.t === 'landingSite' ? msg.answer : msg);
      case 'planetFailed':
        return this.planetDown(msg.planetId, 'step_failed', msg.message);
      case 'snapshot':
        for (const fn of this.snapshotListeners) fn(msg.planetId, msg);
        return this.each(msg.planetId, (s) => s.onSnapshot?.(msg));
      case 'error':
        if (msg.planetId && this.loading.has(msg.planetId)) this.failLoad(msg.planetId, new Error(msg.message));
        return;
      case 'stopped': // a thread died (or stopped at shutdown): its planets are gone
        if (!this.stopping) this.threadDown(thread);
        return;
      default: return;
    }
  }

  private each(planetId: string, fn: (s: PlanetSubscriber) => void): void {
    for (const s of this.subs.get(planetId) ?? []) fn(s);
  }

  private settleCmd(key: string, outcome: CommandOutcomeMsg): void {
    const list = this.cmdWaiters.get(key);
    const w = list?.shift();
    if (!list?.length) this.cmdWaiters.delete(key);
    w?.resolve(outcome);
  }

  private failLoad(planetId: string, e: Error): void {
    for (const w of this.loading.get(planetId) ?? []) w.reject(e);
    this.loading.delete(planetId);
    this.hostInfo.delete(planetId);
  }
}

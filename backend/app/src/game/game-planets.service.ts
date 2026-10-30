import type { SimCommandV1 } from '@terra/contracts';
import type { BalanceOverrides, SimEvent } from '@terra/sim';
import type { SimThreadPool } from './sim-thread-pool';
import type { FromThread, LoadMsg } from './thread/protocol';
import type { TuneRequest } from '@terra/sim';

export type CommandOutcomeMsg =
  | { readonly ok: true; readonly commandId: string; readonly appliedAtTick: number }
  | { readonly ok: false; readonly commandId: string; readonly code: string; readonly appliedAtTick?: number };

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

/** Global tap on every sim event leaving a thread (each exactly once: from a delta or from a bare `event`). */
export type PlanetEventsListener = (planetId: string, events: readonly SimEvent[]) => void;

export type LoadOptions = Omit<LoadMsg, 't' | 'planetId'>;

interface Waiter<T> { resolve(v: T): void; reject(e: Error): void }

/**
 * Main-thread directory of planets: which are loaded, on which thread, plus promise/callback APIs over the message
 * protocol. Other modules (WS gateway, admin) use this; they never see planet state.
 */
export class GamePlanets {
  private readonly loading = new Map<string, Waiter<number>[]>();
  private readonly loaded = new Set<string>();
  private readonly cmdWaiters = new Map<string, Waiter<CommandOutcomeMsg>[]>();
  private readonly fullWaiters = new Map<number, Waiter<FullState>>();
  private readonly tuneWaiters = new Map<number, Waiter<TuneResult>>();
  private nextReq = 1;
  private readonly subs = new Map<string, Set<PlanetSubscriber>>();
  private readonly loadedListeners: ((planetId: string, tick: number) => void)[] = [];
  private readonly unloadedListeners: ((planetId: string) => void)[] = [];
  private readonly snapshotListeners: ((planetId: string, s: { tick: number; bytes: Uint8Array }) => void)[] = [];
  private readonly shutdownHooks: (() => void | Promise<void>)[] = [];
  private readonly warps = new Map<string, number>();
  private readonly warpListeners = new Set<(planetId: string, k: number) => void>();
  private readonly eventListeners = new Set<PlanetEventsListener>();
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

  /** Loads (or restores from `opts.snapshot`) a planet on its thread; resolves with its tick. */
  load(planetId: string, opts: LoadOptions = {}): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      const list = this.loading.get(planetId) ?? [];
      list.push({ resolve, reject });
      this.loading.set(planetId, list);
      const transfer = opts.snapshot ? [opts.snapshot.buffer as ArrayBuffer] : [];
      if (!this.pool.sendToPlanet(planetId, { t: 'load', planetId, ...opts }, transfer)) this.failLoad(planetId, new Error('sim thread is not running'));
    });
  }

  /** Global listeners (persistence): a planet finished loading / was unloaded / a snapshot arrived (subscribed or not). */
  onPlanetLoaded(fn: (planetId: string, tick: number) => void): void { this.loadedListeners.push(fn); }
  onPlanetUnloaded(fn: (planetId: string) => void): void { this.unloadedListeners.push(fn); }
  onPlanetSnapshot(fn: (planetId: string, s: { tick: number; bytes: Uint8Array }) => void): void { this.snapshotListeners.push(fn); }

  unload(planetId: string): void {
    this.loaded.delete(planetId);
    this.warps.delete(planetId);
    for (const fn of this.unloadedListeners) fn(planetId);
    this.pool.sendToPlanet(planetId, { t: 'unload', planetId });
  }

  /** Queues a command for the planet's next step; resolves with the ack/reject outcome. */
  submit(planetId: string, cmd: SimCommandV1): Promise<CommandOutcomeMsg> {
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

  /** Engine snapshot + simVersion + dataHash of a loaded planet, fetched from its owning thread (welcome payload). */
  fullState(planetId: string, timeoutMs = 10_000): Promise<FullState> {
    return new Promise<FullState>((resolve, reject) => {
      const reqId = this.nextReq++;
      const timer = setTimeout(() => { this.fullWaiters.delete(reqId); reject(new Error(`fullState timeout for ${planetId}`)); }, timeoutMs);
      this.fullWaiters.set(reqId, { resolve: (v) => { clearTimeout(timer); resolve(v); }, reject: (e) => { clearTimeout(timer); reject(e); } });
      if (!this.loaded.has(planetId) || !this.pool.sendToPlanet(planetId, { t: 'fullState', planetId, reqId })) {
        this.fullWaiters.delete(reqId);
        clearTimeout(timer);
        reject(new Error(`planet ${planetId} is not loaded`));
      }
    });
  }

  /** Dev `tune` (D-35) on a loaded planet; resolves with the new data hash / export text, or `ok: false` + `error` for a bad path or value. */
  tune(planetId: string, req: TuneRequest, timeoutMs = 10_000): Promise<TuneResult> {
    return new Promise<TuneResult>((resolve, reject) => {
      const reqId = this.nextReq++;
      const timer = setTimeout(() => { this.tuneWaiters.delete(reqId); reject(new Error(`tune timeout for ${planetId}`)); }, timeoutMs);
      this.tuneWaiters.set(reqId, { resolve: (v) => { clearTimeout(timer); resolve(v); }, reject: (e) => { clearTimeout(timer); reject(e); } });
      if (!this.loaded.has(planetId) || !this.pool.sendToPlanet(planetId, { t: 'tune', planetId, reqId, req })) {
        this.tuneWaiters.delete(reqId);
        clearTimeout(timer);
        reject(new Error(`planet ${planetId} is not loaded`));
      }
    });
  }

  /** Registers work to run before threads stop (a later issue snapshots every planet here). */
  onBeforeShutdown(fn: () => void | Promise<void>): void {
    this.shutdownHooks.push(fn);
  }

  async shutdown(): Promise<void> {
    for (const h of this.shutdownHooks) await h();
    await this.pool.shutdown();
    this.unlisten();
    const err = new Error('game threads stopped');
    for (const [id, w] of [...this.fullWaiters]) { this.fullWaiters.delete(id); w.reject(err); }
    for (const [id, w] of [...this.tuneWaiters]) { this.tuneWaiters.delete(id); w.reject(err); }
    for (const id of [...this.loading.keys()]) this.failLoad(id, err);
    for (const key of [...this.cmdWaiters.keys()]) this.settleCmd(key, { ok: false, commandId: key.split('\0')[1] ?? '', code: 'thread_down' });
  }

  private onMessage(thread: number, msg: FromThread): void {
    switch (msg.t) {
      case 'loaded':
        this.loaded.add(msg.planetId);
        for (const w of this.loading.get(msg.planetId) ?? []) w.resolve(msg.tick);
        this.loading.delete(msg.planetId);
        for (const fn of this.loadedListeners) fn(msg.planetId, msg.tick);
        return;
      case 'ack': return this.settleCmd(`${msg.planetId}\0${msg.commandId}`, { ok: true, commandId: msg.commandId, appliedAtTick: msg.appliedAtTick });
      case 'reject':
        return this.settleCmd(`${msg.planetId}\0${msg.commandId}`, { ok: false, commandId: msg.commandId, code: msg.code, appliedAtTick: msg.appliedAtTick });
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
      case 'fullState': {
        this.warps.set(msg.planetId, msg.warp);
        const w = this.fullWaiters.get(msg.reqId);
        this.fullWaiters.delete(msg.reqId);
        return w?.resolve(msg);
      }
      case 'tuned': {
        const w = this.tuneWaiters.get(msg.reqId);
        this.tuneWaiters.delete(msg.reqId);
        return w?.resolve(msg);
      }
      case 'snapshot':
        for (const fn of this.snapshotListeners) fn(msg.planetId, msg);
        return this.each(msg.planetId, (s) => s.onSnapshot?.(msg));
      case 'error':
        if (msg.planetId && this.loading.has(msg.planetId)) this.failLoad(msg.planetId, new Error(msg.message));
        return;
      case 'stopped': // a thread died: its planets are gone
        for (const id of [...this.loaded]) if (this.threadOf(id) === thread) this.loaded.delete(id);
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
  }
}

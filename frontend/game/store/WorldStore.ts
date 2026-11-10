import { flagsFromList, newId, type AwayDigestV1, type CargoStatusPayload, type DeedUpdatedPayload, type MarketBookPayload, type MarketTradePayload, type ServerMessage, type SimEventWire } from '@terra/contracts';
import { compileData, TICK_MS, type BalanceOverrides } from '@terra/sim';
import { digestFromWelcome } from './awayWelcome';
import { ownBytes } from './bytes';
import { Emitter } from '../net/emitter';
import type { Transport } from '../net/types';
import {
  createDefaultSimWorker,
  handleFeatureServerMessage,
  normalizeWorldCommand,
} from './parts/worldStoreFrames';
import type { FromWorker, ToWorker } from './worker/protocol';
import { unpackView, type ClientTiles, type ClientView } from './replica/viewCodec';
import type { ReplicaStatus } from './replica/ReplicaCore';
import { applyTuned, tunedEvents } from './replica/tuneEvent';
import type { PredictionInfo, PredictionMode } from '../net/netStats';

export type CommandInput =
  | string
  | {
      type?: string;
      kind?: string;
      args?: unknown;
      [key: string]: unknown;
    };

/** The bits of a `Worker` the store uses (tests pass an in-process fake). */
export interface WorkerLike {
  postMessage(msg: ToWorker, transfer: Transferable[]): void;
  onmessage: ((e: { data: FromWorker }) => void) | null;
  terminate(): void;
}

export const createSimWorker = createDefaultSimWorker;

export interface WorldStatus { status: ReplicaStatus | 'idle'; detail?: string }


/**
 * Main-thread side of the replica (CLIENT §7): owns the sim worker, feeds it `welcome` / `delta` from a Transport
 * (bytes transferred), hands the unpacked views to subscribers and re-joins on a resync request. It also keeps the
 * server clock estimate used by the tick display.
 */
export class WorldStore {
  private worker: WorkerLike | null = null;
  private off: (() => void) | null = null;
  private readonly views = new Emitter<ClientView>();
  private readonly statuses = new Emitter<WorldStatus>();
  private planetId = '';
  /** The planet of the last welcome, or null before it. */
  currentPlanetId(): string | null { return this.planetId || null; }
  /** Flags + balance overrides of the last welcome: the server compiled its data with them (D-35). */
  private welcomeData: { flags: string[]; overrides?: BalanceOverrides; data?: ReturnType<typeof compileData> } | null = null;
  /**
   * The compiled balance data the host runs with: the last welcome's flags + overrides, with later live `tune set`s
   * (`dev.tuned` events) applied on top, so client-side rule previews (the placement ghost, D-37) evaluate with the
   * host's numbers; null before the first welcome. A `tune reset` asks for a fresh welcome, which carries them (D-35).
   */
  simData(): ReturnType<typeof compileData> | null {
    const w = this.welcomeData;
    if (!w) return null;
    return (w.data ??= compileData(flagsFromList(w.flags), w.overrides));
  }
  private latestView: ClientView | null = null;
  private currentStatus: WorldStatus = { status: 'idle' };
  private tiles: ClientTiles | null = null;
  private lastApplyMs = 0;
  /** serverTimeMs - local time (ms), refreshed by welcome and pong. */
  private offsetMs = 0;
  private baseTick = 0;
  private baseLocalMs = 0;
  private mode: PredictionMode = 'on';
  private info: { pending: number; p95Ms: number } = { pending: 0, p95Ms: 0 };
  private awaitingPredictionSince = 0;
  private lagDirtyRender = true;
  private hadLagPending = false;
  private readonly hasLagParam = typeof location !== 'undefined' && Number(new URLSearchParams(location.search).get('lag')) > 0;
  private readonly renderEvents = new Emitter<readonly SimEventWire[]>();
  private readonly serverEvents = new Emitter<readonly SimEventWire[]>();
  private readonly rejects = new Emitter<{ id: string; kind: string; code: string }>();
  private latestCargoStatus: CargoStatusPayload | null = null;
  private readonly cargoStatuses = new Emitter<CargoStatusPayload>();
  private readonly marketBooks = new Emitter<MarketBookPayload>();
  private readonly marketTrades = new Emitter<MarketTradePayload>();
  private latestAwayDigest: AwayDigestV1 | null = null;
  private readonly awayDigests = new Emitter<AwayDigestV1>();
  private readonly deedUpdates = new Emitter<DeedUpdatedPayload>();

  constructor(
    private readonly transport: Pick<Transport, 'send' | 'onMessage'> & { bindStore?: (store: WorldStore) => void },
    private readonly makeWorker: () => WorkerLike = createSimWorker,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.transport.bindStore?.(this);
  }

  get latest(): ClientView | null { return this.latestView; }
  /** The newest tile layers (views carry `tiles` only when they changed). */
  get latestTiles(): ClientTiles | null { return this.tiles; }
  get tick(): number { return this.latestView?.tick ?? -1; }
  get status(): WorldStatus { return this.currentStatus; }
  /** Milliseconds the worker spent on the last diff + view pack. */
  get applyMs(): number { return this.lastApplyMs; }
  get cargoStatus(): CargoStatusPayload | null { return this.latestCargoStatus; }
  onView(fn: (v: ClientView) => void): () => void { return this.views.on(fn); }
  onStatus(fn: (s: WorldStatus) => void): () => void { return this.statuses.on(fn); }
  onCargoStatus(fn: (s: CargoStatusPayload) => void): () => void { return this.cargoStatuses.on(fn); }
  /** W13 `market.book` / `market.trade` pushes of the joined planet. */
  onMarketBook(fn: (p: MarketBookPayload) => void): () => void { return this.marketBooks.on(fn); }
  onMarketTrade(fn: (p: MarketTradePayload) => void): () => void { return this.marketTrades.on(fn); }
  /** Latest join digest (`welcome.away`). Null before one arrives. A resync welcome does not clear it. */
  latestAway(): AwayDigestV1 | null { return this.latestAwayDigest; }
  /** Fires when a join welcome carries `away`. The rest of welcome handling is unchanged. */
  onAwayDigest(fn: (d: AwayDigestV1) => void): () => void { return this.awayDigests.on(fn); }
  /** W20 `deed.updated` pushes for the joined planet/colony. */
  onDeedUpdated(fn: (p: DeedUpdatedPayload) => void): () => void { return this.deedUpdates.on(fn); }

  /** Render-only events from the predicted engine (projectiles, VFX); never toasts or alerts. */
  onRenderEvents(fn: (e: readonly SimEventWire[]) => void): () => void { return this.renderEvents.on(fn); }
  /** Player-facing events (toasts, alerts): only what the server sent (`event` messages and `delta.events`). */
  onServerEvents(fn: (e: readonly SimEventWire[]) => void): () => void { return this.serverEvents.on(fn); }

  /** `on`, `off` (`?predict=0`) or `auto-off` (the worker step p95 went over 4 ms). */
  get predictionMode(): PredictionMode { return this.mode; }
  get predictionInfo(): PredictionInfo { return { mode: this.mode, ...this.info }; }
  /** The newest server-confirmed tick (welcome / delta), independent of the client's prediction running ahead. */
  get confirmedTick(): number { return this.baseTick; }
  /** Estimated server tick with its fraction (interpolation render time). */
  serverTickF(): number { return this.baseTick + (this.now() - this.baseLocalMs) / TICK_MS; }

  /** A pending command was rolled back by `cmd.reject` (also reaches the CommandBus through the transport). */
  onCommandRejected(fn: (r: { id: string; kind: string; code: string }) => void): () => void { return this.rejects.on(fn); }

  /**
   * Sends a command over the transport and notifies the worker for immediate prediction.
   * Accepts either `(kind, args)` or `({ type, ...args })`.
   */
  sendCommand(input: CommandInput | unknown, maybeArgs?: unknown): string {
    const { kind, args } = normalizeWorldCommand(input, maybeArgs);
    const id = newId('cm');
    this.transport.send({ t: 'cmd', id, d: { kind, args } });
    this.notifySent(id, kind, args);
    return id;
  }

  /** Directly publishes a confirmed `ClientView` (the in-process `LocalHost`, `store/local/LocalHost.ts`). */
  pushView(view: ClientView): void {
    if (view.tiles) this.tiles = view.tiles;
    this.baseTick = view.tick; // an in-process host only pushes confirmed states
    this.baseLocalMs = this.now();
    this.latestView = view;
    this.views.emit(view);
  }

  /**
   * The player sent a command (the CommandBus / online session calls this right after `transport.send`): the worker
   * predicts it from the next view on. Acks and rejects are picked up from the transport by the store itself.
   */
  notifySent(id: string, kind: string, args: unknown): void {
    if (this.mode === 'on') this.awaitingPredictionSince = typeof performance !== 'undefined' ? performance.now() : this.now();
    this.worker?.postMessage({ t: 'cmdSent', id, kind, args, sentAtMs: this.now() }, []);
  }

  /** True right after `notifySent` while the worker is computing the immediate predicted view (< 250 ms), or when `?lag=` suppresses idle GPU renders. */
  isAwaitingPrediction(nowMs = typeof performance !== 'undefined' ? performance.now() : this.now()): boolean {
    if (this.awaitingPredictionSince > 0 && nowMs - this.awaitingPredictionSince < 250) return true;
    if (this.hasLagParam) {
      if (!this.latestView) return true;
      if (this.lagDirtyRender) {
        this.lagDirtyRender = false;
        return false;
      }
      return true;
    }
    return false;
  }

  /**
   * The CommandBus gave up on a command (no ack / reject in time): the prediction rolls it back as a `timeout` reject,
   * so a command lost with a dropped socket is not predicted forever (`onCommandRejected` fires as for a reject).
   */
  notifyTimedOut(id: string): void {
    this.worker?.postMessage({ t: 'reject', id, code: 'timeout' }, []);
  }

  /** `predict: false` is `?predict=0`: views are the confirmed state only. */
  start(flags: readonly string[] = [], opts: { predict?: boolean } = {}): void {
    if (this.worker) return;
    const w = this.makeWorker();
    this.worker = w;
    w.onmessage = (e) => this.fromWorker(e.data);
    this.mode = opts.predict === false ? 'off' : 'on';
    w.postMessage({ t: 'init', flags: [...flags], predict: opts.predict !== false }, []);
    this.off = this.transport.onMessage((m) => this.fromServer(m));
  }

  dispose(): void {
    this.off?.(); this.off = null;
    this.worker?.postMessage({ t: 'stop' }, []);
    this.worker?.terminate();
    this.worker = null;
  }

  /** Estimated server time now (ms), from the last welcome / pong. */
  serverTimeMs(): number { return this.now() + this.offsetMs; }
  /** Estimated current server tick: the last applied tick plus the time since it arrived (not clamped by data). */
  serverTick(): number { return this.baseTick + Math.floor((this.now() - this.baseLocalMs) / TICK_MS); }

  private fromServer(m: ServerMessage): void {
    const w = this.worker;
    if (!w) return;
    if (handleFeatureServerMessage(m, {
      setCargoStatus: (s) => { this.latestCargoStatus = s; },
      latestView: this.latestView,
      views: this.views,
      cargoStatuses: this.cargoStatuses,
      marketBooks: this.marketBooks,
      marketTrades: this.marketTrades,
      deedUpdates: this.deedUpdates,
    })) return;
    switch (m.t) {
      case 'welcome': {
        this.planetId = m.d.planet.id;
        this.welcomeData = { flags: [...m.d.flags], overrides: m.d.overrides as BalanceOverrides | undefined };
        this.offsetMs = m.d.serverTimeMs - this.now();
        this.baseTick = m.d.tick;
        this.baseLocalMs = this.now();
        const state = ownBytes(m.d.state);
        w.postMessage(
          {
            t: 'welcome',
            state,
            tick: m.d.tick,
            flags: [...m.d.flags],
            dataHash: m.d.dataHash,
            simVersion: m.d.simVersion,
            serverTimeMs: m.d.serverTimeMs,
            colonyId: m.d.colonyId,
            overrides: m.d.overrides as BalanceOverrides | undefined,
          },
          [state.buffer],
        );
        this.publishJoinAway(m.d);
        return;
      }
      case 'delta': {
        this.baseTick = m.d.toTick;
        this.baseLocalMs = this.now();
        if (m.d.events?.length) this.retune(m.d.events);
        const diff = ownBytes(m.d.diff);
        w.postMessage({ t: 'delta', fromTick: m.d.fromTick, toTick: m.d.toTick, diff }, [diff.buffer]);
        if (m.d.events?.length) this.serverEvents.emit(m.d.events);
        return;
      }
      case 'event':
        this.retune([m.d]);
        this.serverEvents.emit([m.d]);
        return;
      case 'pong': {
        const rtt = this.now() - m.d.clientTimeMs;
        this.offsetMs = m.d.serverTimeMs + rtt / 2 - this.now();
        w.postMessage({ t: 'clock', serverNowMs: this.serverTimeMs() }, []);
        return;
      }
      case 'cmd.ack':
        w.postMessage({ t: 'ack', id: m.d.id, appliedAtTick: m.d.appliedAtTick }, []);
        return;
      case 'cmd.reject':
        w.postMessage({ t: 'reject', id: m.d.id, code: m.d.code }, []);
        return;
      default:
        return;
    }
  }

  private fromWorker(m: FromWorker): void {
    if ((m.t === 'view' && (m.pred?.pending ?? 0) > 0) || m.t === 'cmdRejected' || m.t === 'status') {
      this.awaitingPredictionSince = 0;
    }
    switch (m.t) {
      case 'view': {
        if ((m.pred?.pending ?? 0) > 0) {
          this.hadLagPending = true;
        } else if (this.hadLagPending) {
          this.hadLagPending = false;
          this.lagDirtyRender = true;
        }
        this.lastApplyMs = m.applyMs;
        if (m.pred) this.info = { pending: m.pred.pending, p95Ms: m.pred.p95Ms };
        const v = unpackView(m.view, this.serverTimeMs());
        if (v.tiles) this.tiles = v.tiles;
        if (this.latestCargoStatus) {
          (v as unknown as Record<string, unknown>).cargoStatus = this.latestCargoStatus;
        }
        this.latestView = v;
        this.views.emit(v);
        return;
      }
      case 'cmdRejected':
        this.rejects.emit({ id: m.id, kind: m.kind, code: m.code });
        return;
      case 'renderEvents':
        this.renderEvents.emit(m.events);
        return;
      case 'status':
        if (m.status === 'predictionOff') {
          this.mode = 'auto-off';
          this.info = { ...this.info, p95Ms: m.p95Ms ?? this.info.p95Ms };
          console.warn(`[world] prediction off: ${m.detail ?? ''}`);
          return;
        }
        this.currentStatus = { status: m.status, detail: m.detail };
        this.statuses.emit(this.currentStatus);
        return;
      default:
        this.requestResync();
        return;
    }
  }

  /** Live tunes (`dev.tuned`): the worker rebuilds its data (prediction), and `simData()` follows a `set`. */
  private retune(events: readonly SimEventWire[]): void {
    for (const t of tunedEvents(events)) {
      this.worker?.postMessage({ t: 'tune', tune: t }, []);
      const w = this.welcomeData;
      const next = w && applyTuned(w.overrides, t);
      if (w && next) this.welcomeData = { flags: w.flags, overrides: next };
    }
  }

  private publishJoinAway(d: { reason?: string; away?: AwayDigestV1 }): void {
    const away = digestFromWelcome(d);
    if (!away) return;
    this.latestAwayDigest = away;
    this.awayDigests.emit(away);
  }

  /** A diff did not fit: ask for a fresh welcome by joining again (the transport must be connected). */
  private requestResync(): void {
    if (!this.planetId) return;
    try { this.transport.send({ t: 'join', d: { planetId: this.planetId } }); } catch (e) { console.warn('[world] resync join failed', e); }
  }
}

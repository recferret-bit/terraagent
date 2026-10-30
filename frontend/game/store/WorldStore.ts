import type { ServerMessage, SimEventWire } from '@terra/contracts';
import { TICK_MS, type BalanceOverrides } from '@terra/sim';
import { ownBytes } from './bytes';
import { Emitter } from '../net/emitter';
import type { Transport } from '../net/types';
import type { FromWorker, ToWorker } from './worker/protocol';
import { unpackView, type ClientTiles, type ClientView } from './replica/viewCodec';
import type { ReplicaStatus } from './replica/ReplicaCore';
import type { PredictionInfo, PredictionMode } from '../net/netStats';

/** The bits of a `Worker` the store uses (tests pass an in-process fake). */
export interface WorkerLike {
  postMessage(msg: ToWorker, transfer: Transferable[]): void;
  onmessage: ((e: { data: FromWorker }) => void) | null;
  terminate(): void;
}

export const createSimWorker = (): WorkerLike =>
  new Worker(new URL('./worker/sim.worker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike;

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
  private readonly renderEvents = new Emitter<readonly SimEventWire[]>();
  private readonly serverEvents = new Emitter<readonly SimEventWire[]>();
  private readonly rejects = new Emitter<{ id: string; kind: string; code: string }>();

  constructor(private readonly transport: Transport, private readonly makeWorker: () => WorkerLike = createSimWorker, private readonly now: () => number = () => Date.now()) {}

  get latest(): ClientView | null { return this.latestView; }
  /** The newest tile layers (views carry `tiles` only when they changed). */
  get latestTiles(): ClientTiles | null { return this.tiles; }
  get tick(): number { return this.latestView?.tick ?? -1; }
  get status(): WorldStatus { return this.currentStatus; }
  /** Milliseconds the worker spent on the last diff + view pack. */
  get applyMs(): number { return this.lastApplyMs; }
  onView(fn: (v: ClientView) => void): () => void { return this.views.on(fn); }
  onStatus(fn: (s: WorldStatus) => void): () => void { return this.statuses.on(fn); }

  /** Render-only events from the predicted engine (projectiles, VFX); never toasts or alerts. */
  onRenderEvents(fn: (e: readonly SimEventWire[]) => void): () => void { return this.renderEvents.on(fn); }
  /** Player-facing events (toasts, alerts): only what the server sent (`event` messages and `delta.events`). */
  onServerEvents(fn: (e: readonly SimEventWire[]) => void): () => void { return this.serverEvents.on(fn); }

  /** `on`, `off` (`?predict=0`) or `auto-off` (the worker step p95 went over 4 ms). */
  get predictionMode(): PredictionMode { return this.mode; }
  get predictionInfo(): PredictionInfo { return { mode: this.mode, ...this.info }; }
  /** Estimated server tick with its fraction (interpolation render time). */
  serverTickF(): number { return this.baseTick + (this.now() - this.baseLocalMs) / TICK_MS; }

  /** A pending command was rolled back by `cmd.reject` (also reaches the CommandBus through the transport). */
  onCommandRejected(fn: (r: { id: string; kind: string; code: string }) => void): () => void { return this.rejects.on(fn); }

  /**
   * The player sent a command (the CommandBus / online session calls this right after `transport.send`): the worker
   * predicts it from the next view on. Acks and rejects are picked up from the transport by the store itself.
   */
  notifySent(id: string, kind: string, args: unknown): void {
    this.worker?.postMessage({ t: 'cmdSent', id, kind, args, sentAtMs: this.now() }, []);
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
    if (m.t === 'welcome') {
      this.planetId = m.d.planet.id;
      this.offsetMs = m.d.serverTimeMs - this.now();
      this.baseTick = m.d.tick; this.baseLocalMs = this.now();
      const state = ownBytes(m.d.state);
      w.postMessage({ t: 'welcome', state, tick: m.d.tick, flags: [...m.d.flags], dataHash: m.d.dataHash, simVersion: m.d.simVersion, serverTimeMs: m.d.serverTimeMs, overrides: m.d.overrides as BalanceOverrides | undefined }, [state.buffer]);
    } else if (m.t === 'delta') {
      this.baseTick = m.d.toTick; this.baseLocalMs = this.now();
      const diff = ownBytes(m.d.diff);
      w.postMessage({ t: 'delta', fromTick: m.d.fromTick, toTick: m.d.toTick, diff }, [diff.buffer]);
      if (m.d.events?.length) this.serverEvents.emit(m.d.events);
    } else if (m.t === 'event') {
      this.serverEvents.emit([m.d]);
    } else if (m.t === 'pong') {
      const rtt = this.now() - m.d.clientTimeMs;
      this.offsetMs = m.d.serverTimeMs + rtt / 2 - this.now();
      w.postMessage({ t: 'clock', serverNowMs: this.serverTimeMs() }, []);
    } else if (m.t === 'cmd.ack') {
      w.postMessage({ t: 'ack', id: m.d.id, appliedAtTick: m.d.appliedAtTick }, []);
    } else if (m.t === 'cmd.reject') {
      w.postMessage({ t: 'reject', id: m.d.id, code: m.d.code }, []);
    }
  }

  private fromWorker(m: FromWorker): void {
    if (m.t === 'view') {
      this.lastApplyMs = m.applyMs;
      if (m.pred) this.info = { pending: m.pred.pending, p95Ms: m.pred.p95Ms };
      const v = unpackView(m.view, this.serverTimeMs());
      if (v.tiles) this.tiles = v.tiles;
      this.latestView = v;
      this.views.emit(v);
    } else if (m.t === 'cmdRejected') {
      this.rejects.emit({ id: m.id, kind: m.kind, code: m.code });
    } else if (m.t === 'renderEvents') {
      this.renderEvents.emit(m.events);
    } else if (m.t === 'status') {
      if (m.status === 'predictionOff') {
        this.mode = 'auto-off';
        this.info = { ...this.info, p95Ms: m.p95Ms ?? this.info.p95Ms };
        console.warn(`[world] prediction off: ${m.detail ?? ''}`);
        return;
      }
      this.currentStatus = { status: m.status, detail: m.detail };
      this.statuses.emit(this.currentStatus);
    } else {
      this.requestResync();
    }
  }

  /** A diff did not fit: ask for a fresh welcome by joining again (the transport must be connected). */
  private requestResync(): void {
    if (!this.planetId) return;
    try { this.transport.send({ t: 'join', d: { planetId: this.planetId } }); } catch (e) { console.warn('[world] resync join failed', e); }
  }
}

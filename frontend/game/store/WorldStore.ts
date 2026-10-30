import type { ServerMessage } from '@terra/contracts';
import { TICK_MS } from '@terra/sim';
import { Emitter } from '../net/emitter';
import type { Transport } from '../net/types';
import type { FromWorker, ToWorker } from './worker/protocol';
import { unpackView, type ClientTiles, type ClientView } from './replica/viewCodec';
import type { ReplicaStatus } from './replica/ReplicaCore';

/** The bits of a `Worker` the store uses (tests pass an in-process fake). */
export interface WorkerLike {
  postMessage(msg: ToWorker, transfer: Transferable[]): void;
  onmessage: ((e: { data: FromWorker }) => void) | null;
  terminate(): void;
}

export const createSimWorker = (): WorkerLike =>
  new Worker(new URL('./worker/sim.worker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike;

export interface WorldStatus { status: ReplicaStatus | 'idle'; detail?: string }

/** Bytes that exactly fill their buffer, so the buffer can be transferred without detaching unrelated data. */
const own = (u: Uint8Array): Uint8Array => (u.byteOffset === 0 && u.byteLength === u.buffer.byteLength ? u : u.slice());

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
  private latestView: ClientView | null = null;
  private currentStatus: WorldStatus = { status: 'idle' };
  private tiles: ClientTiles | null = null;
  private lastApplyMs = 0;
  /** serverTimeMs - local time (ms), refreshed by welcome and pong. */
  private offsetMs = 0;
  private baseTick = 0;
  private baseLocalMs = 0;

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

  start(flags: readonly string[] = []): void {
    if (this.worker) return;
    const w = this.makeWorker();
    this.worker = w;
    w.onmessage = (e) => this.fromWorker(e.data);
    w.postMessage({ t: 'init', flags: [...flags] }, []);
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
      const state = own(m.d.state);
      w.postMessage({ t: 'welcome', state, tick: m.d.tick, flags: [...m.d.flags], dataHash: m.d.dataHash, simVersion: m.d.simVersion }, [state.buffer]);
    } else if (m.t === 'delta') {
      this.baseTick = m.d.toTick; this.baseLocalMs = this.now();
      const diff = own(m.d.diff);
      w.postMessage({ t: 'delta', fromTick: m.d.fromTick, toTick: m.d.toTick, diff }, [diff.buffer]);
    } else if (m.t === 'pong') {
      const rtt = this.now() - m.d.clientTimeMs;
      this.offsetMs = m.d.serverTimeMs + rtt / 2 - this.now();
    }
  }

  private fromWorker(m: FromWorker): void {
    if (m.t === 'view') {
      this.lastApplyMs = m.applyMs;
      const v = unpackView(m.view, this.serverTimeMs());
      if (v.tiles) this.tiles = v.tiles;
      this.latestView = v;
      this.views.emit(v);
    } else if (m.t === 'status') {
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

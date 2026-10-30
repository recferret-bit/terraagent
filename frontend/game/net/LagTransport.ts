import type { ServerMessage } from '@terra/contracts';
import { Emitter } from './emitter';
import type { ConnectionState, Listener, Outgoing, Transport } from './types';

export interface LagDeps {
  now(): number;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
}

const realDeps: LagDeps = {
  now: () => Date.now(),
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

/** FIFO of `(due time, job)`: one timer, jobs run in insertion order once due. */
class DelayLine {
  private items: { due: number; run: () => void }[] = [];
  private timer: unknown = null;
  constructor(private readonly ms: number, private readonly deps: LagDeps) {}

  push(run: () => void): void {
    this.items.push({ due: this.deps.now() + this.ms, run });
    this.arm();
  }

  clear(): void {
    this.items = [];
    if (this.timer !== null) { this.deps.clearTimer(this.timer); this.timer = null; }
  }

  private arm(): void {
    if (this.timer !== null || this.items.length === 0) return;
    this.timer = this.deps.setTimer(() => { this.timer = null; this.drain(); }, Math.max(0, this.items[0].due - this.deps.now()));
  }

  private drain(): void {
    const now = this.deps.now();
    while (this.items.length > 0 && this.items[0].due <= now) this.items.shift()!.run();
    this.arm();
  }
}

/**
 * Dev only (`?lag=<ms>`): delays everything this transport sends and every message it receives by `ms`, in order, so
 * a round trip costs `2 * ms`. Connection state is not delayed. Used to check prediction against a slow link.
 */
export class LagTransport implements Transport {
  private readonly msgs = new Emitter<ServerMessage>();
  private readonly out: DelayLine;
  private readonly inn: DelayLine;
  private off: (() => void) | null = null;

  constructor(private readonly inner: Transport, readonly ms: number, deps: LagDeps = realDeps) {
    this.out = new DelayLine(ms, deps);
    this.inn = new DelayLine(ms, deps);
    this.off = inner.onMessage((m) => this.inn.push(() => this.msgs.emit(m)));
  }

  get state(): ConnectionState { return this.inner.state; }
  start(): void { this.inner.start(); }
  stop(): void { this.out.clear(); this.inn.clear(); this.inner.stop(); }
  send(msg: Outgoing): void { this.out.push(() => { try { this.inner.send(msg); } catch (e) { console.warn('[lag] delayed send failed', e); } }); }
  onMessage(fn: Listener<ServerMessage>): () => void { return this.msgs.on(fn); }
  onState(fn: Listener<ConnectionState>): () => void { return this.inner.onState(fn); }
  dispose(): void { this.off?.(); this.off = null; this.stop(); }
}

/** `?lag=<ms>` from a query string, or 0 (absent, not a positive number, or above 10 s). */
export function lagFromSearch(search: string): number {
  const v = new URLSearchParams(search).get('lag');
  const n = v === null ? 0 : Number(v);
  return Number.isFinite(n) && n > 0 && n <= 10_000 ? Math.round(n) : 0;
}

/** Wraps `transport` in a `LagTransport` when the query has `?lag=<ms>`; dev builds only (never in production). */
export function withDevLag(transport: Transport, search: string, deps?: LagDeps): Transport {
  if (!(import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV) return transport;
  const ms = lagFromSearch(search);
  return ms > 0 ? new LagTransport(transport, ms, deps) : transport;
}

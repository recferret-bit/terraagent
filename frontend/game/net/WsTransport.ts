import { decodeWire, encodeWire, ServerMessage, type ServerMessageOf } from '@terra/contracts';
import { backoffDelay, STABLE_AFTER_MS } from './backoff';
import { closeAction, REPEAT_WINDOW_MS } from './closeCodes';
import { Emitter } from './emitter';
import type { ConnectionPhase, ConnectionState, Outgoing, SessionTarget, Transport } from './types';

/** The bits of a browser `WebSocket` the transport uses (tests pass a fake). */
export interface SocketLike {
  binaryType: string;
  onopen: (() => void) | null;
  onmessage: ((e: { data: unknown }) => void) | null;
  onclose: ((e: { code: number; reason: string }) => void) | null;
  onerror: (() => void) | null;
  send(data: string | Uint8Array): void;
  close(code?: number, reason?: string): void;
}

export interface WsTransportDeps {
  socket(url: string): SocketLike;
  now(): number;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  random(): number;
  clientVersion: string;
}

export const browserDeps = (version = '0.1.0'): WsTransportDeps => ({
  socket: (url) => new WebSocket(url) as unknown as SocketLike,
  now: () => Date.now(),
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  random: Math.random,
  clientVersion: version,
});

const PING_EVERY_MS = 20_000;
const CONNECTED: readonly ConnectionPhase[] = ['welcomed', 'streaming', 'resyncing'];

/**
 * Online transport (CLIENT §6): hello → ready → join → welcome, deltas checked for gaps (a gap re-joins for a fresh
 * welcome), pings every 20 s, reconnect with jittered backoff capped at 10 s, close codes per CLIENT §6.3.
 */
export class WsTransport implements Transport {
  private readonly msgs = new Emitter<ServerMessage>();
  private readonly states = new Emitter<ConnectionState>();
  private current: ConnectionState = { phase: 'idle', attempt: 0, downSinceMs: null };
  private ws: SocketLike | null = null;
  private planetId = '';
  private lastToTick = -1;
  private stopped = true;
  private lastRetryOnceAt = -Infinity;
  private timers = new Set<unknown>();
  private stableTimer: unknown = null;

  constructor(private readonly target: SessionTarget, private readonly deps: WsTransportDeps) {}

  get state(): ConnectionState { return this.current; }
  onMessage(fn: (m: ServerMessage) => void) { return this.msgs.on(fn); }
  onState(fn: (s: ConnectionState) => void) { return this.states.on(fn); }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    void this.connect();
  }

  stop(): void {
    this.stopped = true;
    for (const t of this.timers) this.deps.clearTimer(t);
    this.timers.clear();
    const ws = this.ws; this.ws = null;
    ws?.close(1000, 'client stop');
    this.setState({ phase: 'idle', downSinceMs: null });
  }

  send(msg: Outgoing): void {
    if (!this.ws || !CONNECTED.includes(this.current.phase)) throw new Error(`cannot send ${msg.t} while ${this.current.phase}`);
    this.ws.send(encodeWire({ v: 1, ...msg }));
  }

  private setState(patch: Partial<ConnectionState>): void {
    this.current = { ...this.current, ...patch };
    this.states.emit(this.current);
  }

  private later(fn: () => void, ms: number): unknown {
    const h = this.deps.setTimer(() => { this.timers.delete(h); fn(); }, ms);
    this.timers.add(h);
    return h;
  }

  private async connect(): Promise<void> {
    if (this.stopped) return;
    this.setState({ phase: 'resolving' });
    try {
      this.planetId = (await this.target.resolve()).planetId;
    } catch (e) {
      return this.onClosed(1006, `resolve failed: ${(e as Error).message}`);
    }
    if (this.stopped) return;
    this.setState({ phase: 'connecting' });
    const ws = this.deps.socket(this.target.url);
    this.ws = ws;
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => this.raw({ t: 'hello', d: { accessToken: this.target.accessToken, proto: [1], client: { app: 'game', version: this.deps.clientVersion } } });
    ws.onmessage = (e) => this.onFrame(e.data);
    ws.onclose = (e) => { if (this.ws === ws) { this.ws = null; this.onClosed(e.code, e.reason); } };
    ws.onerror = () => { /* onclose follows */ };
  }

  private raw(msg: object): void { this.ws?.send(encodeWire({ v: 1, ...msg })); }

  private onFrame(data: unknown): void {
    let parsed;
    try {
      const frame = typeof data === 'string' || data instanceof ArrayBuffer || ArrayBuffer.isView(data) ? data : String(data);
      parsed = ServerMessage.safeParse(decodeWire(frame as string | ArrayBuffer));
    } catch { parsed = null; }
    if (!parsed?.success) { console.warn('[net] dropped an invalid server frame'); return; }
    const m = parsed.data;
    if (m.t === 'ready') this.raw({ t: 'join', d: { planetId: this.planetId } });
    else if (m.t === 'welcome') this.onWelcome(m);
    else if (m.t === 'delta' && !this.acceptDelta(m)) return;
    this.msgs.emit(m);
  }

  private onWelcome(m: ServerMessageOf<'welcome'>): void {
    this.lastToTick = m.d.tick;
    this.setState({ phase: 'welcomed', downSinceMs: null, code: undefined, reason: undefined });
    this.schedulePing();
  }

  /** WS-22: a delta must start where the last one ended; otherwise re-join for a fresh welcome. */
  private acceptDelta(m: ServerMessageOf<'delta'>): boolean {
    if (this.current.phase === 'resyncing') return false;
    if (m.d.fromTick !== this.lastToTick) {
      this.setState({ phase: 'resyncing' });
      this.raw({ t: 'join', d: { planetId: this.planetId } });
      return false;
    }
    this.lastToTick = m.d.toTick;
    if (this.current.phase === 'welcomed') {
      this.setState({ phase: 'streaming' });
      this.stableTimer = this.later(() => this.setState({ attempt: 0 }), STABLE_AFTER_MS);
    }
    return true;
  }

  private schedulePing(): void {
    this.later(() => {
      if (!this.ws || !CONNECTED.includes(this.current.phase)) return;
      this.raw({ t: 'ping', d: { clientTimeMs: Math.round(this.deps.now()) } });
      this.schedulePing();
    }, PING_EVERY_MS);
  }

  private onClosed(code: number, reason: string): void {
    if (this.stableTimer) { this.deps.clearTimer(this.stableTimer); this.timers.delete(this.stableTimer); this.stableTimer = null; }
    if (this.stopped) return;
    const now = this.deps.now();
    const downSinceMs = this.current.downSinceMs ?? now;
    const action = closeAction(code);
    if (action === 'terminal' || (action === 'reconnect-once' && now - this.lastRetryOnceAt < REPEAT_WINDOW_MS)) {
      this.stopped = true;
      return this.setState({ phase: 'terminal', code, reason, downSinceMs });
    }
    if (action === 'reconnect-once') this.lastRetryOnceAt = now;
    const attempt = this.current.attempt + 1;
    const delay = action === 'reconnect-once' ? 0 : backoffDelay(attempt, this.deps.random);
    this.setState({ phase: 'reconnecting', attempt, code, reason, downSinceMs });
    this.later(() => void this.connect(), delay);
  }
}

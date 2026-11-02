import { CLOSE_CODES, decodeWire, encodeWire, ServerMessage, type ServerMessageOf } from '@terra/contracts';
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
/** Renew the access token this long before it expires (the server closes `4003` at `exp`, LB-02). */
export const REAUTH_LEAD_MS = 60_000;
const CONNECTED: readonly ConnectionPhase[] = ['welcomed', 'streaming', 'resyncing'];

/**
 * Online transport (CLIENT §6): hello → ready → join → welcome, deltas checked for gaps (a gap re-joins for a fresh
 * welcome), pings every 20 s, reconnect with jittered backoff capped at 10 s, close codes per CLIENT §6.3.
 * Token lifetime (LB-02): when the target knows its token's expiry, the token is renewed (`target.refresh`) and sent as
 * `reauth` `REAUTH_LEAD_MS` before it runs out; a reconnect after `4000` / `4003`, or with a token about to expire,
 * renews it before the next `hello`.
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
  private pingTimer: unknown = null;
  private reauthTimer: unknown = null;
  private renewBeforeHello = false;
  private disposed = false;

  constructor(private readonly target: SessionTarget, private readonly deps: WsTransportDeps) {}

  get state(): ConnectionState { return this.current; }
  onMessage(fn: (m: ServerMessage) => void) { return this.msgs.on(fn); }
  onState(fn: (s: ConnectionState) => void) { return this.states.on(fn); }

  /** Connects (again after `stop()` or a terminal close, e.g. the banner's Retry); refused once disposed. */
  start(): void {
    if (!this.stopped || this.disposed) return;
    this.stopped = false;
    void this.connect();
  }

  stop(): void {
    this.stopped = true;
    for (const t of this.timers) this.deps.clearTimer(t);
    this.timers.clear();
    this.stableTimer = this.pingTimer = this.reauthTimer = null;
    const ws = this.ws; this.ws = null;
    ws?.close(1000, 'client stop');
    this.setState({ phase: 'idle', downSinceMs: null });
  }

  /** Stops for good: a later `start()` (a late boot step, a Retry click) does nothing. */
  dispose(): void {
    this.disposed = true;
    this.stop();
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

  private cancel(h: unknown): null {
    if (h !== null) { this.deps.clearTimer(h); this.timers.delete(h); }
    return null;
  }

  /** The token is rejected (`4000` / `4003`) or within `REAUTH_LEAD_MS` of its expiry. */
  private tokenStale(): boolean {
    const exp = this.target.tokenExpiresAtMs;
    return this.renewBeforeHello || (exp !== undefined && exp - this.deps.now() < REAUTH_LEAD_MS);
  }

  private async connect(): Promise<void> {
    if (this.stopped) return;
    this.setState({ phase: 'resolving' });
    try {
      if (this.target.refresh && this.tokenStale()) {
        this.renewBeforeHello = false;
        await this.target.refresh();
      }
      if (this.stopped) return;
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
    // the handshake's `ready` joins; the `ready` that answers a `reauth` on a joined socket only re-arms the renewal
    if (m.t === 'ready') {
      if (this.current.phase === 'connecting') this.raw({ t: 'join', d: { planetId: this.planetId } });
      else this.armReauth();
    } else if (m.t === 'welcome') this.onWelcome(m);
    else if (m.t === 'delta' && !this.acceptDelta(m)) return;
    this.msgs.emit(m);
  }

  private onWelcome(m: ServerMessageOf<'welcome'>): void {
    this.lastToTick = m.d.tick;
    this.setState({ phase: 'welcomed', downSinceMs: null, code: undefined, reason: undefined });
    this.schedulePing();
    this.armReauth();
  }

  /** One renewal timer per socket: `REAUTH_LEAD_MS` before the token's expiry, refresh it and send `reauth`. */
  private armReauth(): void {
    this.reauthTimer = this.cancel(this.reauthTimer);
    const exp = this.target.tokenExpiresAtMs;
    if (!this.target.refresh || exp === undefined) return;
    const ws = this.ws;
    this.reauthTimer = this.later(() => {
      this.reauthTimer = null;
      void this.reauth(ws);
    }, Math.max(0, exp - this.deps.now() - REAUTH_LEAD_MS));
  }

  private async reauth(ws: SocketLike | null): Promise<void> {
    const renewed = await Promise.resolve(this.target.refresh?.()).catch(() => false);
    // a failed renewal leaves the old token: the server closes 4003 at its expiry and the reconnect renews again
    if (!renewed || this.ws !== ws || !ws || !CONNECTED.includes(this.current.phase)) return;
    this.raw({ t: 'reauth', d: { accessToken: this.target.accessToken } });
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

  /** One ping chain per socket: a resync welcome on the same socket restarts it instead of adding another. */
  private schedulePing(): void {
    this.pingTimer = this.cancel(this.pingTimer);
    this.pingTimer = this.later(() => {
      this.pingTimer = null;
      if (!this.ws || !CONNECTED.includes(this.current.phase)) return;
      this.raw({ t: 'ping', d: { clientTimeMs: Math.round(this.deps.now()) } });
      this.schedulePing();
    }, PING_EVERY_MS);
  }

  private onClosed(code: number, reason: string): void {
    this.stableTimer = this.cancel(this.stableTimer);
    this.pingTimer = this.cancel(this.pingTimer);
    this.reauthTimer = this.cancel(this.reauthTimer);
    if (code === CLOSE_CODES.bad_hello || code === CLOSE_CODES.forbidden) this.renewBeforeHello = true;
    if (this.stopped) return;
    const now = this.deps.now();
    const downSinceMs = this.current.downSinceMs ?? now;
    const action = closeAction(code, reason);
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

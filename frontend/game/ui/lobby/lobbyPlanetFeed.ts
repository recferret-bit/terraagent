import { PlanetListV1Schema, type PlanetListV1, type PlanetSummaryV1 } from '@terra/contracts';
import {
  createDefaultCanonicalPlanetMap,
  mergePlanetListIntoCanonicalMap,
} from './orbitalPickerModel';

export interface LobbyWsLike {
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { readonly data: unknown }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  send?(data: string): void;
  close(): void;
}

export type LobbyWsFactory = (url: string) => LobbyWsLike | null;

export interface LobbyTimerApi {
  setInterval(cb: () => void, ms: number): ReturnType<typeof globalThis.setInterval> | number;
  clearInterval(id: ReturnType<typeof globalThis.setInterval> | number): void;
}

export type LobbyFetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<{
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}>;

export type LobbyFeedMode = 'idle' | 'ws' | 'polling';

export interface LobbyPlanetFeedOptions {
  /** REST endpoint for planet & sector summaries (default `'/v1/planets'`). */
  readonly endpoint?: string;
  /** Optional lobby WebSocket URL (default `'/v1/lobby/ws'`). */
  readonly wsUrl?: string | null;
  /**
   * Injectable WebSocket factory. When omitted, returning `null`, throwing, or emitting
   * `onerror` / `onclose`, the feed automatically falls back to HTTP polling (`GET /v1/planets`).
   */
  readonly createWebSocket?: LobbyWsFactory | null;
  /** Injectable HTTP `fetch` implementation (defaults to `globalThis.fetch`). */
  readonly fetch?: LobbyFetchLike;
  /** Polling interval in ms when WS is blocked/unavailable/disconnected (default `2500`). */
  readonly pollIntervalMs?: number;
  /** Injectable timer API for deterministic unit testing. */
  readonly timer?: LobbyTimerApi;
  /** Callback invoked whenever a new `PlanetListV1` snapshot arrives. */
  readonly onUpdate?: (list: PlanetListV1) => void;
  /** Callback invoked when transport mode changes (`'idle'` | `'ws'` | `'polling'`). */
  readonly onModeChange?: (mode: LobbyFeedMode) => void;
  /** Callback invoked when a network/protocol error occurs. */
  readonly onError?: (err: unknown) => void;
}

const DEFAULT_TIMER: LobbyTimerApi = {
  setInterval: (cb, ms) => globalThis.setInterval(cb, ms),
  clearInterval: (id) => globalThis.clearInterval(id as ReturnType<typeof globalThis.setInterval>),
};

export function coercePlanetListPayload(raw: unknown): PlanetListV1 | null {
  if (!raw || typeof raw !== 'object') return null;
  const strict = PlanetListV1Schema.safeParse(raw);
  if (strict.success) return strict.data;

  const candidate = raw as {
    planets?: unknown;
    queuePaused?: unknown;
    updatedAt?: unknown;
  };
  if (!Array.isArray(candidate.planets)) return null;
  const canonicalMap = mergePlanetListIntoCanonicalMap(
    candidate.planets as PlanetSummaryV1[],
    createDefaultCanonicalPlanetMap(),
  );
  const planets: [PlanetSummaryV1, PlanetSummaryV1, PlanetSummaryV1] = [
    canonicalMap.dune,
    canonicalMap.oceanForest,
    canonicalMap.forestRock,
  ];
  const updatedAt =
    typeof candidate.updatedAt === 'string' && candidate.updatedAt.length > 0
      ? candidate.updatedAt
      : planets[0].updatedAt;
  return {
    planets,
    queuePaused: Boolean(candidate.queuePaused),
    updatedAt,
  };
}

function extractWsPayload(raw: unknown): { kind: 'list'; list: PlanetListV1 } | { kind: 'ping' } | null {
  let obj: unknown = raw;
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!obj || typeof obj !== 'object') return null;
  const direct = coercePlanetListPayload(obj);
  if (direct) return { kind: 'list', list: direct };

  const env = obj as {
    type?: unknown;
    topic?: unknown;
    data?: unknown;
    payload?: unknown;
  };
  const inner = env.data ?? env.payload;
  const innerList = coercePlanetListPayload(inner);
  if (innerList) return { kind: 'list', list: innerList };

  if (env.type === 'planets.changed' || env.topic === 'planets') {
    return { kind: 'ping' };
  }
  return null;
}

/**
 * Real-time lobby planet & sector feed (`GET /v1/planets` + optional lobby WebSocket topic `planets`).
 * Automatically falls back to HTTP polling when the lobby WebSocket is blocked, unavailable, or disconnected.
 */
export class LobbyPlanetFeed {
  private readonly endpoint: string;
  private readonly wsUrl: string | null;
  private readonly createWs: LobbyWsFactory | null;
  private readonly doFetch: LobbyFetchLike;
  private readonly pollIntervalMs: number;
  private readonly timer: LobbyTimerApi;
  private readonly listeners = new Set<(list: PlanetListV1) => void>();
  private ws: LobbyWsLike | null = null;
  private pollTimerId: ReturnType<typeof globalThis.setInterval> | number | null = null;
  private mode: LobbyFeedMode = 'idle';
  private latest: PlanetListV1 | null = null;
  private disposed = false;
  private running = false;

  constructor(private readonly opts: LobbyPlanetFeedOptions = {}) {
    this.endpoint = opts.endpoint ?? '/v1/planets';
    this.wsUrl = opts.wsUrl === undefined ? '/v1/lobby/ws' : opts.wsUrl;
    this.createWs = opts.createWebSocket ?? null;
    this.doFetch =
      opts.fetch ??
      ((input, init) => {
        if (typeof globalThis.fetch !== 'function') {
          return Promise.reject(new Error('fetch is not available'));
        }
        return globalThis.fetch(input, init);
      });
    this.pollIntervalMs = Math.max(100, opts.pollIntervalMs ?? 2500);
    this.timer = opts.timer ?? DEFAULT_TIMER;
    if (opts.onUpdate) this.listeners.add(opts.onUpdate);
  }

  getMode(): LobbyFeedMode {
    return this.mode;
  }

  getLatest(): PlanetListV1 | null {
    return this.latest;
  }

  isPolling(): boolean {
    return this.pollTimerId !== null;
  }

  subscribe(listener: (list: PlanetListV1) => void): () => void {
    this.listeners.add(listener);
    if (this.latest) listener(this.latest);
    return () => {
      this.listeners.delete(listener);
    };
  }

  start(): this {
    if (this.disposed || this.running) return this;
    this.running = true;
    void this.refreshNow();
    this.connectWebSocketOrFallback();
    return this;
  }

  stop(): void {
    this.running = false;
    this.stopPolling();
    this.closeWs();
    this.setMode('idle');
  }

  dispose(): void {
    if (this.disposed) return;
    this.stop();
    this.disposed = true;
    this.listeners.clear();
  }

  async refreshNow(): Promise<PlanetListV1 | null> {
    if (this.disposed) return null;
    try {
      const res = await this.doFetch(this.endpoint, {
        method: 'GET',
        headers: { accept: 'application/json' },
      });
      if (!res.ok) {
        this.opts.onError?.(new Error(`GET ${this.endpoint}: ${res.status}`));
        return null;
      }
      const raw = await res.json();
      if (this.disposed) return null;
      const list = coercePlanetListPayload(raw);
      if (!list) {
        this.opts.onError?.(new Error(`GET ${this.endpoint}: invalid PlanetListV1 payload`));
        return null;
      }
      this.emitList(list);
      return list;
    } catch (err) {
      if (!this.disposed) this.opts.onError?.(err);
      return null;
    }
  }

  private setMode(next: LobbyFeedMode): void {
    if (this.mode === next) return;
    this.mode = next;
    this.opts.onModeChange?.(next);
  }

  private emitList(list: PlanetListV1): void {
    this.latest = list;
    for (const listener of this.listeners) {
      listener(list);
    }
  }

  private connectWebSocketOrFallback(): void {
    if (!this.wsUrl || !this.createWs) {
      this.activatePollingFallback(false);
      return;
    }
    let socket: LobbyWsLike | null = null;
    try {
      socket = this.createWs(this.wsUrl);
    } catch (err) {
      this.opts.onError?.(err);
      this.activatePollingFallback(false);
      return;
    }
    if (!socket) {
      this.activatePollingFallback(false);
      return;
    }
    this.ws = socket;
    // Start fallback polling immediately while WS handshakes so a silently blocked WS still polls;
    // if `onopen` succeeds, we switch to `'ws'` mode and stop the poll timer.
    this.startPolling();
    this.setMode('polling');

    socket.onopen = () => {
      if (this.disposed || this.ws !== socket) return;
      this.stopPolling();
      this.setMode('ws');
      try {
        socket.send?.(JSON.stringify({ type: 'subscribe', topic: 'planets' }));
      } catch {
        /* optional subscribe frame */
      }
    };
    socket.onmessage = (ev) => {
      if (this.disposed || this.ws !== socket) return;
      const parsed = extractWsPayload(ev?.data);
      if (!parsed) return;
      if (parsed.kind === 'list') {
        this.emitList(parsed.list);
      } else {
        void this.refreshNow();
      }
    };
    socket.onerror = (err) => {
      if (this.disposed || this.ws !== socket) return;
      this.opts.onError?.(err);
      this.activatePollingFallback(true);
    };
    socket.onclose = () => {
      if (this.disposed || this.ws !== socket) return;
      this.ws = null;
      this.activatePollingFallback(true);
    };
  }

  private activatePollingFallback(triggerImmediatePoll: boolean): void {
    if (this.disposed || !this.running) return;
    this.setMode('polling');
    this.startPolling();
    if (triggerImmediatePoll) {
      void this.refreshNow();
    }
  }

  private startPolling(): void {
    if (this.pollTimerId !== null || this.disposed) return;
    this.pollTimerId = this.timer.setInterval(() => {
      if (this.disposed || !this.running) return;
      void this.refreshNow();
    }, this.pollIntervalMs);
  }

  private stopPolling(): void {
    if (this.pollTimerId === null) return;
    this.timer.clearInterval(this.pollTimerId);
    this.pollTimerId = null;
  }

  private closeWs(): void {
    const socket = this.ws;
    this.ws = null;
    if (!socket) return;
    socket.onopen = null;
    socket.onmessage = null;
    socket.onerror = null;
    socket.onclose = null;
    try {
      socket.close();
    } catch {
      /* ignore close errors */
    }
  }
}

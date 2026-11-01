import type { ServerMessage } from '@terra/contracts';

/**
 * Connection states (CLIENT §6.1). `resolving` finds the planet to join, `connecting` runs hello → ready → join,
 * `welcomed` has the engine snapshot, `streaming` applies deltas, `reconnecting` waits out a backoff, `terminal`
 * stops for good (replaced, planet ended, eliminated, repeated bad hello / forbidden).
 */
export type ConnectionPhase = 'idle' | 'resolving' | 'connecting' | 'welcomed' | 'streaming' | 'resyncing' | 'reconnecting' | 'terminal';

export interface ConnectionState {
  readonly phase: ConnectionPhase;
  /** Consecutive failed attempts since the last stable stream. */
  readonly attempt: number;
  /** When the current outage started (ms, the transport clock), or null while connected. */
  readonly downSinceMs: number | null;
  /** Last close code seen. */
  readonly code?: number;
  readonly reason?: string;
}

/** A message the client sends after the handshake (`cmd`, `ping`, `join`, `leave`); the transport fills `v`. */
export type Outgoing =
  | { t: 'cmd'; id: string; d: { kind: string; args: unknown } }
  | { t: 'join'; d: { planetId: string } }
  | { t: 'leave'; d: Record<string, never> }
  | { t: 'ping'; d: { clientTimeMs: number } };

export type Listener<T> = (value: T) => void;

/**
 * What the rest of the client talks to (D-31): `WsTransport` (online) and `LocalTransport` (`?host=local`) both
 * deliver the same server messages (`welcome`, `delta`, `cmd.ack`, `cmd.reject`, `event`, `pong`, `bye`).
 */
export interface Transport {
  start(): void;
  stop(): void;
  /** Releases the transport for good (sockets, workers, timers); `start()` afterwards does nothing. Falls back to `stop()`. */
  dispose?(): void;
  send(msg: Outgoing): void;
  onMessage(fn: Listener<ServerMessage>): () => void;
  onState(fn: Listener<ConnectionState>): () => void;
  readonly state: ConnectionState;
}

/** Where to connect and what to join. `resolve` runs before every (re)connect (CLIENT §6.1 `resolving`). */
export interface SessionTarget {
  url: string;
  accessToken: string;
  /** When `accessToken` expires (ms, the transport clock); undefined for tokens that do not expire (dev tokens). */
  tokenExpiresAtMs?: number;
  resolve(): Promise<{ planetId: string }>;
  /**
   * Renews `accessToken` (and `tokenExpiresAtMs`); true when a fresh token is in place. The transport calls it before
   * the expiry (then sends `reauth`) and before a reconnect after `4000` / `4003` (CLIENT §6.3).
   */
  refresh?(): Promise<boolean>;
}

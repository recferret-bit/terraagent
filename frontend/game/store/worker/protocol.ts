import type { WireView } from '../replica/viewCodec';
import type { ReplicaStatus } from '../replica/ReplicaCore';

/** Main thread → sim worker. `state` / `diff` are transferred (their buffers move, the sender must not reuse them). */
export type ToWorker =
  | { t: 'init'; flags: string[]; /** false: no prediction (`?predict=0`), views are the confirmed state. Default true. */ predict?: boolean }
  | { t: 'welcome'; state: Uint8Array; tick: number; flags: string[]; dataHash: string; simVersion: number; serverTimeMs?: number }
  | { t: 'delta'; fromTick: number; toTick: number; diff: Uint8Array }
  /** The player sent a command (`cm_` id): it is predicted until its ack is covered by a delta. */
  | { t: 'cmdSent'; id: string; kind: string; args: unknown; sentAtMs: number }
  | { t: 'ack'; id: string; appliedAtTick: number }
  | { t: 'reject'; id: string; code: string }
  /** Server time estimate now (ms), from welcome / pong. The worker keeps the offset to its own clock. */
  | { t: 'clock'; serverNowMs: number }
  | { t: 'stop' };

/**
 * Sim worker → main thread.
 * `view`: one per applied delta / welcome; `applyMs` is the time spent applying the diff and packing the view.
 * `resync`: a diff did not fit, ask the transport for a fresh welcome. `status`: replica status changes
 * (`versionMismatch` carries which side differs; the page should reload, SIM-X-08).
 */
export type FromWorker =
  | { t: 'view'; view: WireView; applyMs: number }
  | { t: 'resync'; reason: string }
  /** A pending command was rolled back (`cmd.reject`); the next view no longer shows it. */
  | { t: 'cmdRejected'; id: string; kind: string; code: string }
  | { t: 'status'; status: ReplicaStatus | 'idle'; detail?: string };

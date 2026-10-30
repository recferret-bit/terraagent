import type { WireView } from '../replica/viewCodec';
import type { ReplicaStatus } from '../replica/ReplicaCore';

/** Main thread → sim worker. `state` / `diff` are transferred (their buffers move, the sender must not reuse them). */
export type ToWorker =
  | { t: 'init'; flags: string[] }
  | { t: 'welcome'; state: Uint8Array; tick: number; flags: string[]; dataHash: string; simVersion: number }
  | { t: 'delta'; fromTick: number; toTick: number; diff: Uint8Array }
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
  | { t: 'status'; status: ReplicaStatus | 'idle'; detail?: string };

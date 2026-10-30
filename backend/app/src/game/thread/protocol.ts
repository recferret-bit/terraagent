import type { SimCommandV1 } from '@terra/contracts';
import type { SimEvent } from '@terra/sim';

/** In-process MessagePort protocol between the main thread and a sim thread (PROTOCOL §6). Plain structured-clone data only. */

/** Passed to the Worker as `workerData`. */
export interface ThreadInit {
  readonly thread: number;
  /** Enabled wave flags used by every planet loaded on this thread unless `load` overrides them. */
  readonly flags: readonly string[];
  /** Run the placeholder fixed-interval stepper (to be replaced by the scheduler). */
  readonly autoStep: boolean;
}

export type CtlOp =
  | { readonly op: 'stats'; readonly reqId: number }
  | { readonly op: 'warp'; readonly planetId: string; readonly ticks: number }
  | { readonly op: 'stop' };

export interface LoadMsg {
  readonly t: 'load';
  readonly planetId: string;
  /** Restore from this snapshot (buffer is transferred); otherwise a new planet is generated. */
  readonly snapshot?: Uint8Array;
  /** New-planet params; `seed` defaults to the planet id. */
  readonly params?: { readonly type?: string; readonly seed?: string; readonly radius?: number };
  /** Overrides the thread's wave flags for this planet. */
  readonly flags?: readonly string[];
}

/** main → thread */
export type ToThread =
  | LoadMsg
  | { readonly t: 'unload'; readonly planetId: string }
  | { readonly t: 'cmd'; readonly planetId: string; readonly cmd: SimCommandV1 }
  | { readonly t: 'subscribe'; readonly planetId: string }
  | { readonly t: 'unsubscribe'; readonly planetId: string }
  | { readonly t: 'snapshotNow'; readonly planetId?: string }
  | { readonly t: 'fullState'; readonly planetId: string; readonly reqId: number }
  | ({ readonly t: 'ctl' } & CtlOp);

export interface PlanetStats {
  readonly planetId: string;
  readonly tick: number;
  readonly entities: number;
  readonly pendingCmds: number;
  readonly subscribed: boolean;
}

/** thread → main */
export type FromThread =
  | { readonly t: 'ready'; readonly thread: number }
  | { readonly t: 'loaded'; readonly planetId: string; readonly tick: number }
  | { readonly t: 'unloaded'; readonly planetId: string }
  | { readonly t: 'delta'; readonly planetId: string; readonly fromTick: number; readonly toTick: number; readonly diff: Uint8Array; readonly events: SimEvent[] }
  | { readonly t: 'event'; readonly planetId: string; readonly events: SimEvent[] }
  | { readonly t: 'ack'; readonly planetId: string; readonly commandId: string; readonly appliedAtTick: number }
  | { readonly t: 'reject'; readonly planetId: string; readonly commandId: string; readonly code: string; readonly appliedAtTick?: number }
  | { readonly t: 'snapshot'; readonly planetId: string; readonly tick: number; readonly bytes: Uint8Array }
  | { readonly t: 'fullState'; readonly planetId: string; readonly reqId: number; readonly tick: number; readonly bytes: Uint8Array; readonly simVersion: number; readonly dataHash: string; readonly planetType: string }
  | { readonly t: 'stats'; readonly thread: number; readonly reqId: number; readonly planets: PlanetStats[]; readonly steps: number }
  | { readonly t: 'error'; readonly thread: number; readonly planetId?: string; readonly commandId?: string; readonly message: string }
  | { readonly t: 'stopped'; readonly thread: number };

export type Post = (msg: FromThread, transfer?: ArrayBuffer[]) => void;

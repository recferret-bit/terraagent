import type { SimCommandV1 } from '@terra/contracts';
import type { BalanceOverrides, SimEvent } from '@terra/sim';
import type { TuneRequest } from '@terra/sim';

/** In-process MessagePort protocol between the main thread and a sim thread (PROTOCOL §6). Plain structured-clone data only. */

/** Passed to the Worker as `workerData`. */
export interface ThreadInit {
  readonly thread: number;
  /** Enabled wave flags used by every planet loaded on this thread unless `load` overrides them. */
  readonly flags: readonly string[];
  /** Run the drift-free scheduler loop; when false no loop runs (tests drive `stepPlanet` directly). */
  readonly autoStep: boolean;
  /** Deltas per second per subscribed planet. */
  readonly deltaHz?: number;
  /** Test/dev hook: file URLs of modules whose default export is an extra `SimModule` added to every planet's pipeline. */
  readonly simModules?: readonly string[];
  /** Balance overrides from `TA_BALANCE_OVERRIDES` (D-35), applied to every planet of this thread. */
  readonly overrides?: BalanceOverrides;
}

export type CtlOp =
  | { readonly op: 'stats'; readonly reqId: number }
  /** Dev time warp: `k` engine steps per due slot (1..100); the thread may run less (budget cap) and answers with a `warp` message. */
  | { readonly op: 'warp'; readonly planetId: string; readonly k: number }
  /** Test/dev only (ignored in production): busy-wait the thread for `ms`. */
  | { readonly op: 'block'; readonly ms: number }
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
  /** Scenario balance overrides (D-35), layered over the file overrides. */
  readonly overrides?: BalanceOverrides;
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
  /** Dev `tune` (D-35): set a field live / drop live tunes / export the merged overrides. Answered with `tuned`. */
  | { readonly t: 'tune'; readonly planetId: string; readonly reqId: number; readonly req: TuneRequest }
  | ({ readonly t: 'ctl' } & CtlOp);

export interface PlanetStats {
  readonly planetId: string;
  readonly tick: number;
  readonly entities: number;
  readonly pendingCmds: number;
  readonly subscribed: boolean;
  /** Build time (ms) and size (bytes) of the last delta. */
  readonly deltaMs: number;
  readonly deltaBytes: number;
  /** Steps behind the due time after the last pass (0 = on time). */
  readonly lagSteps: number;
  readonly mode: 'active' | 'coarse';
  readonly nextDueMs: number;
  readonly stepsLastPass: number;
  /** Effective time warp (after the budget cap) and the requested one. */
  readonly warp: number;
  readonly warpRequested: number;
}

/** Diagnostic ring of recent scheduler passes that stepped something. */
export interface PassStat { readonly steps: number; readonly maxPlanetSteps: number; readonly maxLag: number }

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
  | { readonly t: 'warp'; readonly planetId: string; /** effective warp */ readonly k: number; readonly requested: number }
  | { readonly t: 'fullState'; readonly planetId: string; readonly reqId: number; readonly tick: number; readonly warp: number; readonly bytes: Uint8Array; readonly simVersion: number; readonly dataHash: string; readonly planetType: string; readonly overrides?: BalanceOverrides }
  | { readonly t: 'tuned'; readonly planetId: string; readonly reqId: number; readonly ok: boolean; readonly dataHash: string; readonly overrides: BalanceOverrides; readonly text?: string; readonly error?: string }
  | { readonly t: 'stats'; readonly thread: number; readonly reqId: number; readonly planets: PlanetStats[]; readonly steps: number; readonly maxLag: number; readonly recentPasses: PassStat[] }
  | { readonly t: 'error'; readonly thread: number; readonly planetId?: string; readonly commandId?: string; readonly message: string }
  | { readonly t: 'stopped'; readonly thread: number };

export type Post = (msg: FromThread, transfer?: ArrayBuffer[]) => void;

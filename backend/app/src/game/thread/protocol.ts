import type { SimCommandV1 } from '@terra/contracts';
import type { BalanceOverrides, LedgerPosting, ResolvedRegion, SimEvent } from '@terra/sim';
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
  /** CT-14: `active` steps `dt` 1 every tick; `coarse` steps `dt` 5 every second. The thread applies it on the next due step. */
  | { readonly op: 'mode'; readonly planetId: string; readonly mode: 'active' | 'coarse' }
  /** Test/dev only (ignored in production): busy-wait the thread for `ms`. */
  | { readonly op: 'block'; readonly ms: number }
  /** Test/dev only (ignored in production): step the planet by `dt` now, in message order (engine parity test, run with `autoStep: false`). */
  | { readonly op: 'step'; readonly planetId: string; readonly dt: number }
  | { readonly op: 'stop' };

export interface LoadMsg {
  readonly t: 'load';
  readonly planetId: string;
  /** Restore from this snapshot (buffer is transferred); otherwise a new planet is generated. */
  readonly snapshot?: Uint8Array;
  /**
   * New-planet params; `seed` defaults to the planet id. `type` is required (BE-25): every caller names its generator.
   * A load with neither `snapshot` nor `params` builds the W00 flat planet ({@link W00_PLANET_TYPE}).
   */
  readonly params?: {
    readonly type: string;
    readonly seed?: string;
    readonly radius?: number;
    readonly capacity?: number;
    /** W13 only: the resolved regional endowment (server profile); absent with W13 on = the bootstrap-table region (`regionForNewPlanet`). */
    readonly region?: ResolvedRegion;
  };
  /** Overrides the thread's wave flags for this planet. */
  readonly flags?: readonly string[];
  /** Scenario balance overrides (D-35), layered over the file overrides. */
  readonly overrides?: BalanceOverrides;
  /**
   * The snapshot is a brand-new planet (scenario), not a restore: the server ledger opens it with the colonies' stock as
   * opening balances instead of replaying a journal. Echoed back in `loaded`.
   */
  readonly genesis?: boolean;
  /**
   * Restart fast-run (CT-51): coarse steps (`dt` 5) before the scheduler starts.
   * The planet is not scheduled until they finish, then it joins as `active` (BE-57).
   */
  readonly catchUpTicks?: number;
}

/** Generator of a load without `params` or `snapshot`: the W00 empty flat planet (tests, `GAME_DEV_PLANETS` without W01). */
export const W00_PLANET_TYPE = 'flat';

/** Where the planet's sim would land a colony next (`nextLandingSite` on the live state, LED-14), or why it cannot. */
export type LandingSiteAnswer =
  | { readonly ok: true; readonly q: number; readonly r: number; readonly slotIndex?: number }
  | { readonly ok: false; readonly code: string };

/** What the server ledger needs from a `loaded` planet (restore consistency, see `PlanetLedgerService`). */
export interface LoadedInfo {
  /** Loaded from a snapshot (false = generated fresh). */
  readonly restored: boolean;
  /** The snapshot was a brand-new planet (`LoadMsg.genesis`). */
  readonly genesis: boolean;
  /** `getColonyStock` of every colony record, by colony index (whole units per resource key). */
  readonly stocks: readonly Readonly<Record<string, number>>[];
  /**
   * Genesis only: the postings made while the planet was built (a scenario's setup steps, e.g. `landing.cargo`). The
   * journal starts with them; the main thread keeps them (`GamePlanets.load` option), they never travel to the thread.
   */
  readonly setupPostings?: readonly LedgerPosting[];
  /**
   * Fresh (generated) load only: the loader checked that the planet has no snapshot rows (`SnapshotService.loadNew`),
   * so journal rows under its id belong to an older planet and are deleted. Main thread only, like `setupPostings`.
   * A fresh load without it keeps the rows (a planet with snapshots must never lose its journal).
   */
  readonly noSnapshots?: boolean;
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
  /** Seating (LED-14): where colony `colony` would land now. Answered with `landingSite`. */
  | { readonly t: 'landingSite'; readonly planetId: string; readonly reqId: number; readonly colony: number }
  /**
   * Economy profile swap (W13-39): `overrides` is the new thread base (file ⊕ env ⊕ active profile). Every loaded planet
   * rebuilds its pipeline from it once its tick reaches `effectiveTick` (later loads use it at once). Answered with
   * `profileScheduled` (stored) and, per planet, `profileApplied`.
   */
  | { readonly t: 'profile'; readonly reqId: number; readonly overrides: BalanceOverrides; readonly effectiveTick: number; readonly profileHash: string }
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
  | ({ readonly t: 'loaded'; readonly planetId: string; readonly tick: number } & Partial<LoadedInfo>)
  /**
   * Ledger postings of one step at `tick`, in order (`idx` = array index). Host-side only: never relayed to clients, and
   * posted whether or not the planet is subscribed, so the server journal never loses one.
   */
  | { readonly t: 'ledger'; readonly planetId: string; readonly tick: number; readonly postings: readonly LedgerPosting[] }
  | { readonly t: 'unloaded'; readonly planetId: string }
  | { readonly t: 'delta'; readonly planetId: string; readonly fromTick: number; readonly toTick: number; readonly diff: Uint8Array; readonly events: SimEvent[] }
  | { readonly t: 'event'; readonly planetId: string; readonly events: SimEvent[] }
  | { readonly t: 'ack'; readonly planetId: string; readonly commandId: string; readonly appliedAtTick: number }
  /** `detail`: the sim's cause of the rejection when the handler gave one (GP-31), passed on in `cmd.reject.detail`. */
  | { readonly t: 'reject'; readonly planetId: string; readonly commandId: string; readonly code: string; readonly appliedAtTick?: number; readonly detail?: string; readonly unlocksAt?: string }
  | { readonly t: 'snapshot'; readonly planetId: string; readonly tick: number; readonly bytes: Uint8Array }
  | { readonly t: 'warp'; readonly planetId: string; /** effective warp */ readonly k: number; readonly requested: number }
  | { readonly t: 'fullState'; readonly planetId: string; readonly reqId: number; readonly tick: number; readonly warp: number; readonly bytes: Uint8Array; readonly simVersion: number; readonly dataHash: string; readonly planetType: string; readonly overrides?: BalanceOverrides }
  | { readonly t: 'tuned'; readonly planetId: string; readonly reqId: number; readonly ok: boolean; readonly dataHash: string; readonly overrides: BalanceOverrides; readonly text?: string; readonly error?: string }
  | { readonly t: 'profileScheduled'; readonly thread: number; readonly reqId: number; readonly profileHash: string; readonly planets: number }
  | { readonly t: 'profileApplied'; readonly planetId: string; readonly tick: number; readonly profileHash: string; readonly dataHash: string }
  | { readonly t: 'stats'; readonly thread: number; readonly reqId: number; readonly planets: PlanetStats[]; readonly steps: number; readonly maxLag: number; readonly recentPasses: PassStat[] }
  | { readonly t: 'landingSite'; readonly planetId: string; readonly reqId: number; readonly answer: LandingSiteAnswer }
  /**
   * A step of the planet threw (BE-12). Before this message the thread posted the failed step's postings (`ledger`) and
   * answered its commands: the outcomes the step had produced (`StepError`), `internal` for the rest. The planet was
   * dropped from the thread (its state may be half-changed); the main thread treats it as down and may restore its
   * last snapshot.
   */
  | { readonly t: 'planetFailed'; readonly planetId: string; readonly message: string }
  | { readonly t: 'error'; readonly thread: number; readonly planetId?: string; readonly commandId?: string; readonly message: string }
  | { readonly t: 'stopped'; readonly thread: number }
  /**
   * Restart fast-run finished (CT-51). `tick` is after the coarse steps; `seconds` is wall time.
   * Posted only when the planet is still loaded, so `GamePlanets.load` can resolve.
   */
  | { readonly t: 'fastRan'; readonly planetId: string; readonly tick: number; readonly ticks: number; readonly seconds: number };

export type Post = (msg: FromThread, transfer?: ArrayBuffer[]) => void;

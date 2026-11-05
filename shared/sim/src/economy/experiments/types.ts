import type { ExperimentManifest, MetricRow, ResourceKey, ScenarioManifest } from '@terra/contracts';
import type { CompiledDataLike } from '../../kernel/config';
import type { SimHost } from '../../host/SimHost';
import type { MarketHarness } from './market-harness';
import type { MarketBridge } from './market-bridge';

/** What a scenario fixture provides: its pinned manifest and a way to build the seeded host on the COMPILED data. */
export interface ExperimentScenarioDef {
  readonly manifest: ScenarioManifest;
  /**
   * Builds the scenario's planet for `seed` and returns a host that runs `data` (the compiled profile's tables, never
   * the bootstrap ones). Pure: only `@terra/sim`; no clock, randomness or I/O.
   */
  createHost(input: { readonly seed: number; readonly flags: readonly string[]; readonly data: CompiledDataLike }): SimHost;
}

/** Mutable counters a behaviour fills (rejects are recorded, never thrown). */
export interface BehaviorStats {
  exports: number;
  imports: number;
  ordersRequested: number;
  rejected: Record<string, number>;
}

export interface BehaviorContext {
  readonly host: SimHost;
  readonly harness: MarketHarness;
  readonly bridge: MarketBridge;
  readonly manifest: ExperimentManifest;
  readonly scenario: ScenarioManifest;
  /** The behaviour's own xoshiro stream (`seedStream(seed, 'experiment')`): the only random source. */
  readonly rng: Uint32Array;
  readonly stats: BehaviorStats;
  /** Resources the scenario trades. */
  readonly resources: readonly ResourceKey[];
  /** Unique command id of this run (`b<n>`, at most 40 chars). */
  nextCommandId(): string;
}

/** A scripted, deterministic policy (ECONOMY §6 `behaviorProfile`): no live model output, no wall clock. */
export interface BehaviorProfile {
  readonly id: string;
  /** Ticks between decisions. */
  readonly actEveryTicks: number;
  /** Called once after warmup starts, before the first tick. */
  init?(ctx: BehaviorContext): void;
  act(ctx: BehaviorContext): void;
}

export interface FlowsReconciliationRow {
  readonly opening: string;
  readonly production: string;
  readonly imports: string;
  readonly exports: string;
  readonly consumption: string;
  readonly recovered: string;
  readonly capped: string;
  readonly expectedClosing: string;
  readonly closing: string;
  /** `closing - expectedClosing`: must be 0 (hard gate). */
  readonly drift: string;
}

export interface FlowsReconciliation {
  readonly window: { readonly startTick: number; readonly endTick: number };
  readonly basis: 'stock';
  readonly resources: Readonly<Record<string, FlowsReconciliationRow>>;
  /** Mock USDC: faucet total vs what the mock ledger holds; `drift` must be 0. */
  readonly usdc: { readonly funded: string; readonly held: string; readonly drift: string };
  /** Resources whose stock went negative at any sample (hard gate). */
  readonly negativeStock: readonly string[];
}

export interface RunHashes {
  readonly profileHash: string;
  readonly dataHash: string;
  readonly scenarioHash: string;
  readonly stateHash: string;
}

export interface RunSummary {
  readonly ticks: number;
  readonly trades: number;
  readonly placedOrders: number;
  readonly rejectedOrders: number;
  readonly expiredOrders: number;
  readonly volumeByResource: Readonly<Record<string, string>>;
  readonly notionalUsdc: string;
  readonly platformFeeUsdc: string;
  readonly stallFeeUsdc: string;
  readonly behavior: BehaviorStats;
}

export interface RunResult {
  readonly runId: string;
  readonly scenarioId: string;
  readonly scenarioVersion: number;
  readonly seed: number;
  readonly metrics: MetricRow[];
  readonly flowsReconciliation: FlowsReconciliation;
  readonly hashes: RunHashes;
  /** Final state of the behaviour's PRNG stream (restart input). */
  readonly rngState: number[];
  readonly summary: RunSummary;
}

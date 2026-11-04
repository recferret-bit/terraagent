import type { Ratio } from '../flows/ratio';

/** Logistics coefficients in integer bp (10000 = 1.0), as in `data/logistics.ts` row `coefficients`. */
export interface LogisticsCoefficients {
  readonly alphaBp: number;
  readonly maxMultiplierBp: number;
  readonly betaBp: number;
  readonly referenceRouteTiles: number;
  readonly maxDistanceRatioBp: number;
  readonly readinessReserveBp: number;
  readonly readinessReadyBp: number;
  readonly readinessMovingBp: number;
  readonly readinessCombatBp: number;
  readonly minCombatServiceBp: number;
  readonly graceWindows: number;
}

export type UnitReadiness = 'reserve' | 'ready' | 'moving' | 'combat';
export interface TileRef { readonly q: number; readonly r: number }

/** Whole units of each resource per window at full activity. Fractional recipes scale the weights, never use floats. */
export type Consumption = Readonly<Record<string, number | bigint>>;

interface EntityBase {
  readonly id: string;
  /** Service domain: one colony's connected reachable supply network. */
  readonly domainId: string;
  readonly tile: TileRef;
  /** Logistics weight in load units per window (whole). */
  readonly weight: number;
  readonly consumption: Consumption;
  /** Army label / sector: carried for reports only, never changes capacity or assignment. */
  readonly groupId?: string;
}

export interface LogisticsBuilding extends EntityBase {
  /** Operating fraction in bp (0..10000). */
  readonly operatingBp: number;
}
export interface LogisticsUnit extends EntityBase {
  readonly readiness: UnitReadiness;
}

export interface LogisticsNode {
  readonly id: string;
  readonly domainId: string;
  readonly tile: TileRef;
  readonly kind: 'commandHub' | 'supplyDepot';
  /** Logistics throughput per window (not storage capacity, not control slots). */
  readonly throughputPerWindow: number;
  readonly reachTiles: number;
  readonly commissioned: boolean;
  readonly powered: boolean;
  readonly operational: boolean;
}

/** Route length in tiles from an entity to a node, or `null` when no path exists. */
export type RouteTilesFn = (entity: { readonly id: string; readonly tile: TileRef }, node: LogisticsNode) => number | null;

export interface EvaluateLogisticsInput {
  readonly buildings: readonly LogisticsBuilding[];
  readonly units: readonly LogisticsUnit[];
  readonly nodes: readonly LogisticsNode[];
  readonly coefficients: LogisticsCoefficients;
  readonly routeTiles: RouteTilesFn;
}

export type UnavailableReason = 'no_supply_node' | 'no_capacity' | 'unreachable' | 'out_of_reach';

export interface EntityService {
  readonly id: string;
  readonly kind: 'building' | 'unit';
  readonly domainId: string;
  readonly groupId?: string;
  readonly activityBp: number;
  readonly nodeId: string | null;
  readonly routeTiles: number | null;
  /** `1 + beta * min(route / reference, maxRatio)`; null when unavailable. */
  readonly distanceFactor: Ratio | null;
  /** Per resource, after distance and congestion; empty when unavailable. */
  readonly supplyCost: Readonly<Record<string, Ratio>>;
  readonly unavailable: UnavailableReason | null;
}

export interface DomainEvaluation {
  readonly domainId: string;
  /** Intended load of every active entity of the domain (load units), exact. */
  readonly intendedLoad: Ratio;
  /** Load of the entities that have a supply route (the one used for congestion). */
  readonly L: Ratio;
  /** Sum of throughput of distinct commissioned, powered, operational nodes. */
  readonly K: number;
  /** `L / K`; null when `K = 0`. */
  readonly u: Ratio | null;
  /** Congestion multiplier `min(max, 1 + alpha * max(0, u-1)^2)`; null when `K = 0`. */
  readonly M: Ratio | null;
  readonly supplyCost: Readonly<Record<string, Ratio>>;
  readonly entities: readonly EntityService[];
  /** Entities that cannot be supplied, by reason. */
  readonly unavailable: Readonly<Partial<Record<UnavailableReason, readonly string[]>>>;
}

export interface LogisticsEvaluation {
  readonly domains: readonly DomainEvaluation[];
  /** Global colony report: every domain aggregated. */
  readonly totals: { readonly L: Ratio; readonly K: number; readonly supplyCost: Readonly<Record<string, Ratio>> };
}

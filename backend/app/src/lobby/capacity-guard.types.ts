import {
  W11_DEFAULT_FOUNDING_SEATS_PER_SECTOR,
  W11_DEFAULT_LAND_SECTORS,
  type AtlasConfigV1,
  type AtlasManifestV1,
  type PlanetLook,
  type PlanetType,
  type SectorId,
  type SectorKind,
  type WorldAdmissionState,
  type WorldAvailability,
  type WorldHealthState,
  type WorldLifecycleState,
} from '@terra/contracts';
import {
  W11_DEFAULT_MAX_FOUNDING_SEATS_PER_SECTOR,
  type AtlasRolloutLimits,
  type AtlasRolloutViolation,
  type GeneratedSmallAtlas,
} from '@terra/sim';
import type { LobbyPersistenceService } from './lobby-persistence.service';
import {
  LobbyPersistenceConflictError,
  type LobbyConflictCode,
  type MatchTicketRecord,
} from './lobby-persistence.types';
import type { MatchmakerTickSummary, ProcessTicketResult } from './matchmaker.types';
import { resolveCanonicalPlanetType } from './planets.helpers';

/** Hard cap on canonical persistent worlds (`desert`, `ocean`, `temperate`) — replaces legacy `MAX_ACTIVE_PLANETS = 60` (`MM-42..44`). */
export const CANONICAL_WORLDS_CAP = 3;
export const MAX_CANONICAL_WORLDS = 3;

/** Warm-pool planet creation is permanently disabled in W11 (`MM-42`). */
export const WARM_POOL_PER_TYPE = 0;
export const WARM_POOL_ENABLED = false;

/** Default W11 safe-site capacity per canonical world at `X=4` across `7` land sectors (`28` seats/world, `84` cluster-wide). */
export const W11_DEFAULT_WORLD_SEAT_CAP =
  W11_DEFAULT_LAND_SECTORS * W11_DEFAULT_FOUNDING_SEATS_PER_SECTOR;
export const W11_DEFAULT_CLUSTER_SEAT_CAP = CANONICAL_WORLDS_CAP * W11_DEFAULT_WORLD_SEAT_CAP;

/** Maximum supported W11 safe-site capacity per canonical world at `X=5` across `7` land sectors (`35` seats/world, `105` cluster-wide). */
export const W11_MAX_WORLD_SEAT_CAP =
  W11_DEFAULT_LAND_SECTORS * W11_DEFAULT_MAX_FOUNDING_SEATS_PER_SECTOR;
export const W11_MAX_CLUSTER_SEAT_CAP = CANONICAL_WORLDS_CAP * W11_MAX_WORLD_SEAT_CAP;

/** Prometheus counter metric name for matchmaking/join evaluations blocked by exhausted safe-site capacity (`MM-43`, §9). */
export const MM_CAPACITY_BLOCKED_METRIC = 'mm_capacity_blocked_total';

export type CapacityGuardErrorCode = Extract<
  LobbyConflictCode,
  | 'non_canonical_world_forbidden'
  | 'warm_pool_disabled'
  | 'overflow_world_forbidden'
  | 'rollout_limit_exceeded'
  | 'safe_site_budget_exceeded'
  | 'canonical_type_conflict'
>;

export class CapacityGuardError extends LobbyPersistenceConflictError {
  override readonly code: CapacityGuardErrorCode;

  constructor(
    code: CapacityGuardErrorCode,
    message: string,
    details?: Readonly<Record<string, unknown>>,
  ) {
    super(code, `${code}: ${message}`, { code, ...(details ?? {}) });
    this.name = 'CapacityGuardError';
    this.code = code;
  }
}

export interface CanonicalWorldIdentityInput {
  readonly id?: string;
  readonly planetId?: string;
  readonly type?: PlanetType | string;
  readonly planetType?: PlanetType | string;
  readonly name?: string;
  readonly look?: PlanetLook | string;
  readonly seed?: string;
  readonly source?: 'canonical' | 'warm_pool' | 'on_demand' | 'overflow' | 'admin' | string;
  readonly warmPool?: boolean;
  readonly isWarmPool?: boolean;
  readonly overflow?: boolean;
  readonly isOverflow?: boolean;
  readonly worldIndex?: number;
  readonly existingWorldIds?: readonly string[];
}

export interface WorldProvisionBudgetSectorInput {
  readonly sectorId?: SectorId;
  readonly kind: SectorKind;
  readonly radius?: number;
  readonly tileCount?: number;
  readonly foundingCapacity: number;
  readonly validatedSafeSites?: number;
  readonly validatedCapacity?: number;
  readonly safeLandingSlots?: readonly unknown[];
}

export interface WorldProvisionBudgetLimits extends AtlasRolloutLimits {
  readonly maxCanonicalWorlds?: number;
  readonly maxValidatedSafeSitesPerWorld?: number;
  readonly maxClusterSafeSites?: number;
}

export interface WorldProvisionBudgetInput extends CanonicalWorldIdentityInput {
  readonly manifest?: AtlasManifestV1;
  readonly config?: AtlasConfigV1;
  readonly atlas?: GeneratedSmallAtlas;
  readonly sectorRadius?: number;
  readonly foundingSeatsPerSector?: number;
  readonly validatedSeatsPerSector?: number;
  readonly totalSectors?: number;
  readonly landSectors?: number;
  readonly oceanSectors?: number;
  readonly totalTiles?: number;
  readonly nominalCapacity?: number;
  readonly validatedCapacity?: number;
  readonly validatedSafeSites?: number;
  readonly maxColonies?: number;
  readonly clusterValidatedSafeSites?: number;
  readonly sectors?: readonly WorldProvisionBudgetSectorInput[];
  readonly limits?: WorldProvisionBudgetLimits;
}

export type CapacityBudgetViolationField =
  | AtlasRolloutViolation['field']
  | 'canonicalIdentity'
  | 'warmPoolDisabled'
  | 'overflowWorldForbidden'
  | 'oceanSectorSafeSites'
  | 'validatedSafeSitesExceedsFoundingCapacity'
  | 'landingSlotsMismatch'
  | 'worldSafeSiteCap'
  | 'clusterSafeSiteCap';

export interface CapacityBudgetViolation {
  readonly field: CapacityBudgetViolationField;
  readonly actual: number | string;
  readonly limit: number | string;
  readonly message: string;
}

export interface WorldProvisionBudgetResult {
  readonly ok: boolean;
  readonly code?: CapacityGuardErrorCode;
  readonly reason?: string;
  readonly planetId: string | null;
  readonly planetType: PlanetType | null;
  readonly limits: Required<AtlasRolloutLimits> & {
    readonly maxCanonicalWorlds: number;
    readonly defaultWorldSeatsAtX4: number;
    readonly defaultClusterSeatsAtX4: number;
    readonly maxWorldSeatsAtX5: number;
    readonly maxClusterSeatsAtX5: number;
  };
  readonly observed: {
    readonly totalSectors: number;
    readonly landSectors: number;
    readonly oceanSectors: number;
    readonly sectorRadius: number;
    readonly totalTiles: number;
    readonly foundingSeatsPerSector: number;
    readonly nominalCapacity: number;
    readonly validatedSafeSites: number;
    readonly validatedCapacity: number;
    readonly maxColonies: number;
  };
  readonly violations: readonly CapacityBudgetViolation[];
}

export interface PlanetCapacitySnapshot {
  readonly id: string;
  readonly planetId: string;
  readonly type: PlanetType;
  readonly planetType: PlanetType;
  readonly name: string;
  readonly look: PlanetLook;
  readonly provisioned: boolean;
  readonly lifecycle: WorldLifecycleState;
  readonly health: WorldHealthState;
  readonly admission: WorldAdmissionState;
  readonly availability: WorldAvailability;
  readonly totalSectors: number;
  readonly landSectors: number;
  readonly oceanSectors: number;
  readonly nominalCapacity: number;
  readonly validatedSafeSites: number;
  readonly validatedCapacity: number;
  readonly reservedSeats: number;
  readonly foundedSeats: number;
  readonly freeSeats: number;
  readonly takenSeats: number;
  readonly seatsTaken: number;
  readonly isFull: boolean;
  readonly full: boolean;
  readonly queuedTicketsCount: number;
  readonly queuedDemand: number;
  readonly capacityBlockedCount: number;
  readonly capacityBlockedTotal: number;
}

export interface ClusterCapacitySnapshot {
  readonly canonicalWorldsCount: number;
  readonly maxCanonicalWorlds: 3;
  readonly warmPoolEnabled: false;
  readonly warmPoolCount: 0;
  readonly overflowWorldsCount: 0;
  readonly canonicalPlanetIds: readonly string[];
  readonly totalNominalCapacity: number;
  readonly nominalCapacity: number;
  readonly totalValidatedSafeSites: number;
  readonly totalValidatedCapacity: number;
  readonly validatedSafeSites: number;
  readonly totalReservedSeats: number;
  readonly reservedSeats: number;
  readonly totalFoundedSeats: number;
  readonly foundedSeats: number;
  readonly totalFreeSeats: number;
  readonly freeSeats: number;
  readonly totalTakenSeats: number;
  readonly seatsTaken: number;
  readonly queuedTicketsCount: number;
  readonly queuedDemand: number;
  readonly capacityBlockedTotal: number;
  readonly mm_capacity_blocked_total: number;
  readonly capacityBlockedByPlanet: Readonly<Record<PlanetType, number>> &
    Readonly<Record<string, number>>;
  readonly capacityBlockedByReason: Readonly<Record<string, number>>;
  readonly allSlotsExhausted: boolean;
  readonly clusterFull: boolean;
  readonly planets: readonly PlanetCapacitySnapshot[];
  readonly byPlanet: Readonly<Record<PlanetType, PlanetCapacitySnapshot>> &
    Readonly<Record<string, PlanetCapacitySnapshot>>;
  readonly updatedAt: string;
}

export interface RecordCapacityBlockedInput {
  readonly planetId?: string;
  readonly planetType?: PlanetType | string;
  readonly sectorId?: SectorId;
  readonly ticketId?: string;
  readonly reason?: string;
  readonly count?: number;
}

export interface TicketCapacityEvaluationResult {
  readonly blocked: boolean;
  readonly reason: string | null;
  readonly outcome?: ProcessTicketResult['outcome'];
  readonly ticketId: string;
  readonly planetId: string;
  readonly planetType: PlanetType;
  readonly sectorId: SectorId | null;
  readonly freeSeats: number;
  readonly capacityBlockedTotal: number;
  readonly ticket: MatchTicketRecord;
}

export interface GuardedMatchmakerTickResult extends MatchmakerTickSummary {
  readonly capacity: ClusterCapacitySnapshot;
  readonly capacityBlockedInTick: number;
  readonly capacityBlockedTotal: number;
  readonly canonicalWorldsCount: number;
  readonly warmPoolCreated: 0;
  readonly overflowWorldsCreated: 0;
}

export interface SharedCapacityMetricsState {
  capacityBlockedTotal: number;
  readonly byPlanet: Record<PlanetType, number>;
  readonly byReason: Map<string, number>;
  readonly recordedResults: WeakSet<object>;
  readonly listeners: Set<(planetType: PlanetType | null, reason: string, delta: number) => void>;
}

const sharedMetricsByPersistence = new WeakMap<
  LobbyPersistenceService,
  SharedCapacityMetricsState
>();

export function getSharedCapacityMetricsState(
  persistence: LobbyPersistenceService,
): SharedCapacityMetricsState {
  let state = sharedMetricsByPersistence.get(persistence);
  if (!state) {
    state = {
      capacityBlockedTotal: 0,
      byPlanet: { desert: 0, ocean: 0, temperate: 0 },
      byReason: new Map<string, number>(),
      recordedResults: new WeakSet<object>(),
      listeners: new Set(),
    };
    sharedMetricsByPersistence.set(persistence, state);
  }
  return state;
}

export function incrementSharedCapacityBlocked(
  state: SharedCapacityMetricsState,
  input?: string | RecordCapacityBlockedInput,
): number {
  const opts: RecordCapacityBlockedInput =
    typeof input === 'string' ? { planetId: input } : (input ?? {});
  const delta = Math.max(1, Math.floor(opts.count ?? 1));
  const rawTarget = opts.planetType ?? opts.planetId ?? '';
  const resolvedType = rawTarget ? resolveCanonicalPlanetType(String(rawTarget)) : null;
  const reason = opts.reason?.trim() || 'planet_full';

  state.capacityBlockedTotal += delta;
  if (resolvedType) state.byPlanet[resolvedType] += delta;
  state.byReason.set(reason, (state.byReason.get(reason) ?? 0) + delta);
  for (const listener of state.listeners) listener(resolvedType, reason, delta);
  return state.capacityBlockedTotal;
}

export function isCapacityBlockedProcessResult(result: ProcessTicketResult): {
  readonly blocked: boolean;
  readonly reason: string;
} {
  if (result.outcome === 'queued_planet_full') {
    return { blocked: true, reason: result.reason ?? 'planet_full' };
  }
  if (result.outcome === 'queued_chosen_sector_full') {
    return { blocked: true, reason: result.reason ?? 'chosen_sector_full' };
  }
  if (
    result.outcome === 'transfer_pending' &&
    (result.reason === 'destination_planet_full' ||
      result.reason === 'sector_full' ||
      result.reason === 'slot_taken')
  ) {
    return { blocked: true, reason: result.reason };
  }
  return { blocked: false, reason: result.reason ?? 'not_blocked' };
}

export function recordCapacityBlockedForProcessResult(
  state: SharedCapacityMetricsState,
  result: ProcessTicketResult,
): boolean {
  const check = isCapacityBlockedProcessResult(result);
  if (!check.blocked || state.recordedResults.has(result)) return false;
  state.recordedResults.add(result);
  incrementSharedCapacityBlocked(state, {
    planetId: result.ticket.planetId,
    planetType: result.ticket.planetType,
    sectorId:
      result.ticket.sectorIntent.kind === 'chosen'
        ? result.ticket.sectorIntent.sectorId
        : undefined,
    ticketId: result.ticket.id,
    reason: check.reason,
  });
  return true;
}

import type {
  AtlasManifestV1,
  LandingSlotId,
  ReservationStateV1,
  SafeLandingSlotV1,
  SectorId,
  SectorReservationV1,
} from '@terra/contracts';
import type { GeneratedSmallAtlas, PlanetState, SimState } from '@terra/sim';
import type {
  CanonicalWorldRecord,
  MatchTicketRecord,
  PlanetSectorRecord,
  SectorLandingSlotRecord,
  SectorReservationRecord,
} from './lobby-persistence.types';

/** Default seat reservation hold TTL in seconds (MATCHMAKING §5.2: `MATCH_SEAT_TTL_S = 90`). */
export const MATCH_SEAT_TTL_S = 90;

/** Default seat reservation hold TTL in milliseconds (`90_000` ms). */
export const MATCH_SEAT_TTL_MS = MATCH_SEAT_TTL_S * 1000;

/** DI token for an optional external sim landing authority validator. */
export const SIM_LANDING_AUTHORITY_VALIDATOR = Symbol('SIM_LANDING_AUTHORITY_VALIDATOR');

export type ReservationFailureCode =
  | 'sector_full'
  | 'no_safe_slot'
  | 'ocean_sector'
  | 'slot_taken'
  | 'admission_paused'
  | 'world_faulted'
  | 'world_provisioning'
  | 'world_archived'
  | 'queue_paused'
  | 'planet_not_found'
  | 'sector_not_found'
  | 'ticket_not_found'
  | 'ticket_not_reservable';

export type ManagedReservationState = ReservationStateV1 | 'SPAWNING';

export interface ManagedSectorReservationRecord extends Omit<SectorReservationRecord, 'state'> {
  readonly id: string;
  readonly state: ManagedReservationState;
}

export interface SimLandingAuthorityCheckInput {
  readonly planetId: string;
  readonly world: CanonicalWorldRecord;
  readonly sector: PlanetSectorRecord;
  readonly slot: SectorLandingSlotRecord;
  readonly manifestSlot: SafeLandingSlotV1 | null;
  readonly pinnedManifest: AtlasManifestV1 | null;
  readonly ticketId: string;
  readonly playerId: string;
  readonly colonyId: string;
  readonly epoch: number;
  readonly now: Date;
  readonly simState?: SimState | PlanetState | null;
  readonly generatedAtlas?: GeneratedSmallAtlas | null;
}

export interface SimLandingAuthorityDecision {
  readonly ok: boolean;
  readonly reason?: string;
  readonly epoch?: number;
}

export type SimLandingAuthorityCallback = (
  input: SimLandingAuthorityCheckInput,
) => Promise<SimLandingAuthorityDecision | boolean> | SimLandingAuthorityDecision | boolean;

export interface SimLandingAuthorityValidatorObject {
  validateLandingSlot(
    input: SimLandingAuthorityCheckInput,
  ): Promise<SimLandingAuthorityDecision | boolean> | SimLandingAuthorityDecision | boolean;
}

export type SimLandingAuthorityValidator =
  | SimLandingAuthorityCallback
  | SimLandingAuthorityValidatorObject;

export interface ReserveSectorSlotRequest {
  readonly planetId: string;
  readonly sectorId: SectorId;
  readonly landingSlotId?: LandingSlotId;
  readonly ticketId: string;
  readonly playerId: string;
  readonly colonyId: string;
  readonly reservationId?: string;
  readonly ttlMs?: number;
  readonly ttlS?: number;
  readonly now?: Date;
  readonly authorityValidator?: SimLandingAuthorityValidator;
  readonly simState?: SimState | PlanetState | null;
  readonly generatedAtlas?: GeneratedSmallAtlas | null;
}

export interface ReserveSlotForTicketOptions {
  readonly sectorId?: SectorId;
  readonly landingSlotId?: LandingSlotId;
  readonly reservationId?: string;
  readonly ttlMs?: number;
  readonly ttlS?: number;
  readonly now?: Date;
  readonly authorityValidator?: SimLandingAuthorityValidator;
  readonly simState?: SimState | PlanetState | null;
  readonly generatedAtlas?: GeneratedSmallAtlas | null;
}

export interface SectorReservationSuccessResult {
  readonly ok: true;
  readonly idempotent: boolean;
  readonly reservation: ManagedSectorReservationRecord;
  readonly reservationV1: SectorReservationV1;
  readonly slot: SectorLandingSlotRecord;
  readonly sector: PlanetSectorRecord;
  readonly ticket: MatchTicketRecord | null;
}

export interface SectorReservationFailureResult {
  readonly ok: false;
  readonly code: ReservationFailureCode;
  readonly reason: ReservationFailureCode;
  readonly message: string;
  readonly rejectedSlotIds?: readonly LandingSlotId[];
  readonly ticket?: MatchTicketRecord | null;
}

export type SectorReservationResult =
  | SectorReservationSuccessResult
  | SectorReservationFailureResult;

export interface CommitReservationOptions {
  readonly expectedEpoch?: number;
  readonly now?: Date;
}

export interface ReleaseReservationOptions {
  readonly expectedEpoch?: number;
  readonly requeueTicket?: boolean;
  readonly now?: Date;
}

export interface ReleaseReservationResult {
  readonly released: boolean;
  readonly reservation: ManagedSectorReservationRecord;
  readonly ticket: MatchTicketRecord | null;
}

export interface SweepExpiredReservationsOptions {
  readonly now?: Date;
  readonly planetId?: string;
  readonly ignoreQueuePause?: boolean;
}

/**
 * Policy registered by `SpawnSagaService` so `SectorReservationService` never reassigns a landing slot
 * while an expired/timed-out reservation's in-flight spawn is still unresolved (MM-35..38).
 */
export interface ReservationSlotFencePolicy {
  isSlotBlockedByPendingSpawn(planetId: string, landingSlotId: LandingSlotId): boolean;
  isSlotDeprioritized?(planetId: string, landingSlotId: LandingSlotId): boolean;
}


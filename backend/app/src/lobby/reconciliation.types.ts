import type {
  AtlasManifestV1,
  PlanetLook,
  PlanetType,
  SectorId,
  SectorKind,
  WorldAdmissionState,
  WorldAvailability,
  WorldHealthState,
  WorldLifecycleState,
} from '@terra/contracts';
import type { ColonyRecord } from '../core/home/home.repository';
import type { CanonicalWorldRecord, MatchTicketRecord } from './lobby-persistence.types';
import type { CanonicalWorldProvisionOutcome } from './provisioning.types';
import type { ManagedSectorReservationRecord } from './reservation.types';
import type { ReconciledOrphanColonyRecord, ReconcileOrphanColonyInput } from './spawn-saga.types';

/** Default maximum wait time in `QUEUED` before a ticket expires (`MM-40`, §8: `900 s = 15 min`). */
export const MATCH_TICKET_MAX_WAIT_S = 900;
export const MATCH_TICKET_MAX_WAIT_MS = MATCH_TICKET_MAX_WAIT_S * 1_000;

/** Default reconciliation sweeper interval (`30 s`). */
export const RECONCILIATION_SWEEP_INTERVAL_MS = 30_000;

/** Failure code recorded on tickets that expire after waiting > `MATCH_TICKET_MAX_WAIT_S` (`MM-40`). */
export const TICKET_TIMEOUT_FAILURE_CODE = 'timeout';

export type PlanetLifecycleEventKind =
  | 'extinct'
  | 'all_eliminated'
  | 'settled'
  | 'all_settled'
  | 'victory'
  | 'planet.victory'
  | 'age_check'
  | 'tick_sweep'
  | 'lifetime'
  | 'window'
  | 'inactivity_check'
  | 'refill_check';

export interface ReconciliationSweepOptions {
  readonly now?: Date | number | string;
  readonly planetId?: string;
  readonly maxTicketWaitMs?: number;
  readonly maxTicketWaitS?: number;
  readonly maxTicketAttempts?: number;
  readonly ignoreQueuePause?: boolean;
  readonly autoRetryFaultedWorlds?: boolean;
  readonly actor?: string;
  readonly orphanColonies?: readonly (string | ReconcileOrphanColonyInput)[];
}

export interface SectorCounterDriftRepairRecord {
  readonly planetId: string;
  readonly sectorId: SectorId;
  readonly previousReservedSeats: number;
  readonly previousFoundedSeats: number;
  readonly previousFreeSeats: number;
  readonly repairedReservedSeats: number;
  readonly repairedFoundedSeats: number;
  readonly repairedFreeSeats: number;
  readonly repairedAt: string;
}

export interface SectorReconciliationSnapshot {
  readonly planetId: string;
  readonly sectorId: SectorId;
  readonly continentId: string | null;
  readonly kind: SectorKind;
  readonly foundingCapacity: number;
  readonly validatedCapacity: number;
  readonly reservedSeats: number;
  readonly foundedSeats: number;
  readonly freeSeats: number;
  readonly livingColonies: number;
  readonly eliminatedColonies: number;
  readonly settledColonies: number;
  readonly availability: WorldAvailability;
  readonly repaired: boolean;
}

export interface WorldReconciliationSnapshot {
  readonly id: string;
  readonly planetId: string;
  readonly type: PlanetType;
  readonly planetType: PlanetType;
  readonly name: string;
  readonly look: PlanetLook;
  readonly seed: string;
  readonly lifecycle: WorldLifecycleState;
  readonly health: WorldHealthState;
  readonly admission: WorldAdmissionState;
  readonly availability: WorldAvailability;
  readonly atlasVersion: number;
  readonly atlasHash: string;
  readonly configHash: string;
  readonly manifestPinned: boolean;
  readonly manifest: AtlasManifestV1 | null;
  readonly elapsedAgeMs: number;
  readonly ageSealed: false;
  readonly expired: false;
  readonly ended: false;
  readonly archivedBySweep: false;
  readonly replaced: false;
  readonly wiped: false;
  readonly nominalCapacity: number;
  readonly validatedCapacity: number;
  readonly reservedSeats: number;
  readonly foundedSeats: number;
  readonly freeSeats: number;
  readonly livingColonies: number;
  readonly eliminatedColonies: number;
  readonly settledColonies: number;
  readonly expiredReservationsInSweep: number;
  readonly repairedSectorsInSweep: number;
  readonly sectors: readonly SectorReconciliationSnapshot[];
  readonly world: CanonicalWorldRecord;
}

export interface ReconciliationSweepReport {
  readonly sweptAt: string;
  readonly nowMs: number;
  readonly queuePaused: boolean;
  readonly canonicalWorldsCount: number;
  readonly warmPoolCount: 0;
  readonly overflowWorldsCount: 0;
  readonly ageSealedCount: 0;
  readonly endedWorldsCount: 0;
  readonly archivedBySweepCount: 0;
  readonly replacedWorldsCount: 0;
  readonly evictedFoundedSeatsCount: 0;
  readonly expiredReservationsCount: number;
  readonly expiredReservations: readonly ManagedSectorReservationRecord[];
  readonly requeuedTicketsCount: number;
  readonly requeuedTickets: readonly MatchTicketRecord[];
  readonly failedSpawnTicketsCount: number;
  readonly failedSpawnTickets: readonly MatchTicketRecord[];
  readonly expiredTicketsCount: number;
  readonly expiredTickets: readonly MatchTicketRecord[];
  readonly reconciledOrphansCount: number;
  readonly reconciledOrphans: readonly ReconciledOrphanColonyRecord[];
  readonly repairedSectorsCount: number;
  readonly repairedSectors: readonly SectorCounterDriftRepairRecord[];
  readonly retriedWorldsCount: number;
  readonly retriedWorlds: readonly CanonicalWorldProvisionOutcome[];
  readonly worlds: readonly WorldReconciliationSnapshot[];
  readonly byPlanet: Readonly<Record<PlanetType, WorldReconciliationSnapshot>> &
    Readonly<Record<string, WorldReconciliationSnapshot>>;
}

export interface HandlePlanetEventOptions {
  readonly now?: Date | number | string;
  readonly winnerColonyId?: string | null;
  readonly colonyIds?: readonly string[];
  readonly preserveColonyStatus?: boolean;
  readonly elapsedMs?: number;
  readonly details?: Readonly<Record<string, unknown>>;
}

export interface HandlePlanetEventInput extends HandlePlanetEventOptions {
  readonly planetId?: string;
  readonly type?: PlanetType | string;
  readonly planetType?: PlanetType | string;
  readonly event?: PlanetLifecycleEventKind;
  readonly kind?: PlanetLifecycleEventKind;
}

export interface RecordedPlanetOutcome {
  readonly id: string;
  readonly planetId: string;
  readonly planetType: PlanetType;
  readonly event: PlanetLifecycleEventKind;
  readonly outcomeKind: 'extinct' | 'all_settled' | 'victory' | 'age_evaluated';
  readonly winnerColonyId: string | null;
  readonly foundedSeats: number;
  readonly livingColonies: number;
  readonly recordedAt: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

export interface PlanetEventOutcomeResult {
  readonly planetId: string;
  readonly planetType: PlanetType;
  readonly event: PlanetLifecycleEventKind;
  readonly outcomeRecorded: boolean;
  readonly outcome: RecordedPlanetOutcome;
  readonly worldEnded: false;
  readonly ageSealed: false;
  readonly archived: false;
  readonly replaced: false;
  readonly wiped: false;
  readonly seatsEvicted: 0;
  readonly lifecycle: WorldLifecycleState;
  readonly health: WorldHealthState;
  readonly admission: WorldAdmissionState;
  readonly availability: WorldAvailability;
  readonly foundedSeats: number;
  readonly reservedSeats: number;
  readonly freeSeats: number;
  readonly livingColonies: number;
  readonly eliminatedColonies: number;
  readonly settledColonies: number;
  readonly world: CanonicalWorldRecord;
}

export interface ColonyEliminationReconcileResult {
  readonly colonyId: string;
  readonly planetId: string;
  readonly sectorId: SectorId;
  readonly landingSlotId: string | null;
  readonly status: 'ELIMINATED' | 'TRANSFERRED';
  readonly foundedSeatHeld: true;
  readonly seatEvicted: false;
  readonly sectorFoundedSeats: number;
  readonly sectorReservedSeats: number;
  readonly sectorFreeSeats: number;
  readonly sectorLivingColonies: number;
  readonly colony: ColonyRecord | null;
}

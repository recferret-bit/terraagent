import type {
  SectorId,
  WorldAdmissionState,
  WorldAvailability,
  WorldHealthState,
  WorldLifecycleState,
} from '@terra/contracts';
import {
  LobbyPersistenceConflictError,
  type CanonicalWorldRecord,
  type PlanetSectorRecord,
} from './lobby-persistence.types';

/**
 * Thrown (HTTP 409) when an optimistic concurrency check (`expectedUpdatedAt`) fails
 * during a world lifecycle, health, or admission transition (W11-03, MM-01).
 */
export class ConcurrencyConflictError extends LobbyPersistenceConflictError {
  readonly planetId: string;
  readonly expectedUpdatedAt: string;
  readonly actualUpdatedAt: string;

  constructor(planetId: string, expectedUpdatedAt: Date | string | number, actualUpdatedAt: Date | string) {
    const expectedIso =
      expectedUpdatedAt instanceof Date
        ? expectedUpdatedAt.toISOString()
        : typeof expectedUpdatedAt === 'number'
          ? new Date(expectedUpdatedAt).toISOString()
          : String(expectedUpdatedAt);
    const actualIso = actualUpdatedAt instanceof Date ? actualUpdatedAt.toISOString() : String(actualUpdatedAt);
    super(
      'concurrency_conflict',
      `optimistic concurrency conflict on planet "${planetId}": expected updatedAt=${expectedIso}, actual updatedAt=${actualIso}`,
      { planetId, expectedUpdatedAt: expectedIso, actualUpdatedAt: actualIso },
    );
    this.name = 'ConcurrencyConflictError';
    this.planetId = planetId;
    this.expectedUpdatedAt = expectedIso;
    this.actualUpdatedAt = actualIso;
  }
}

/**
 * Thrown (HTTP 409) when a caller attempts an invalid lifecycle or admission transition
 * (e.g. `ARCHIVED -> ACTIVE`, `ARCHIVED -> PROVISIONING`, `ACTIVE -> PROVISIONING`, or legacy `SEALED`).
 */
export class InvalidLifecycleTransitionError extends LobbyPersistenceConflictError {
  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super('invalid_lifecycle_transition', message, details);
    this.name = 'InvalidLifecycleTransitionError';
  }
}

/**
 * Thrown (HTTP 409) when an operator transition omits a non-empty `actor` or `reason`.
 */
export class AuditMetadataRequiredError extends LobbyPersistenceConflictError {
  constructor(action: string, field: 'actor' | 'reason') {
    super(
      'audit_metadata_required',
      `non-empty "${field}" is required for audited operator transition "${action}"`,
      { action, field },
    );
    this.name = 'AuditMetadataRequiredError';
  }
}

export type WorldAdmissionAuditAction =
  | 'PAUSE'
  | 'RESUME'
  | 'ARCHIVE'
  | 'HEALTH_CHANGE'
  | 'LIFECYCLE_CHANGE'
  | 'QUEUE_PAUSE'
  | 'QUEUE_RESUME';

export interface WorldAdmissionAuditEntry {
  readonly id: string;
  readonly planetId: string | null;
  readonly action: WorldAdmissionAuditAction;
  readonly fromLifecycle?: WorldLifecycleState;
  readonly toLifecycle?: WorldLifecycleState;
  readonly fromHealth?: WorldHealthState;
  readonly toHealth?: WorldHealthState;
  readonly fromAdmission: WorldAdmissionState;
  readonly toAdmission: WorldAdmissionState;
  readonly actor: string;
  readonly reason: string;
  readonly at: string;
}

export interface SectorStatusSnapshot extends PlanetSectorRecord {
  readonly availability: WorldAvailability;
}

export interface WorldStatusSnapshot extends CanonicalWorldRecord {
  readonly availability: WorldAvailability;
  readonly nominalCapacity: number;
  readonly validatedCapacity: number;
  readonly reservedSeats: number;
  readonly foundedSeats: number;
  readonly freeSeats: number;
  readonly sectors: readonly SectorStatusSnapshot[];
  readonly world: CanonicalWorldRecord;
  readonly auditEntry?: WorldAdmissionAuditEntry;
}

export interface PauseResumePlanetAdmissionInput {
  readonly planetId: string;
  readonly actor: string;
  readonly reason: string;
  readonly expectedUpdatedAt?: Date | string | number;
  readonly now?: Date;
}

export interface SetQueuePausedInput {
  readonly paused: boolean;
  readonly actor: string;
  readonly reason: string;
  readonly now?: Date;
}

export interface QueuePauseStatus {
  readonly queuePaused: boolean;
  readonly updatedAt: string;
  readonly auditEntry: WorldAdmissionAuditEntry;
}

export interface UpdateWorldHealthInput {
  readonly planetId: string;
  readonly health: WorldHealthState;
  readonly faultCode?: string | null;
  readonly retryCount?: number;
  readonly placementAttempts?: number;
  readonly actor?: string;
  readonly reason?: string;
  readonly expectedUpdatedAt?: Date | string | number;
  readonly now?: Date;
}

export interface TransitionWorldLifecycleInput {
  readonly planetId: string;
  readonly toLifecycle?: WorldLifecycleState | string;
  readonly lifecycle?: WorldLifecycleState | string;
  readonly to?: WorldLifecycleState | string;
  readonly health?: WorldHealthState;
  readonly admission?: WorldAdmissionState;
  readonly actor?: string;
  readonly reason?: string;
  readonly faultCode?: string | null;
  readonly retryCount?: number;
  readonly placementAttempts?: number;
  readonly expectedUpdatedAt?: Date | string | number;
  readonly now?: Date;
}

export interface MarkWorldProvisionedInput {
  readonly planetId: string;
  readonly actor?: string;
  readonly reason?: string;
  readonly retryCount?: number;
  readonly placementAttempts?: number;
  readonly expectedUpdatedAt?: Date | string | number;
  readonly now?: Date;
}

export interface ElapsedAgeEvaluationResult {
  readonly planetId: string;
  readonly elapsedMs: number;
  readonly ageSealed: false;
  readonly expired: false;
  readonly changed: false;
  readonly lifecycle: WorldLifecycleState;
  readonly health: WorldHealthState;
  readonly admission: WorldAdmissionState;
  readonly availability: WorldAvailability;
  readonly freeSeats: number;
  readonly reservedSeats: number;
  readonly foundedSeats: number;
  readonly validatedCapacity: number;
  readonly world: CanonicalWorldRecord;
}

export type AdmissionEligibilityStatus =
  | 'open'
  | 'full'
  | 'paused'
  | 'faulted'
  | 'archived'
  | 'ocean_sector';

export interface AdmissionEligibilityResult {
  readonly eligible: boolean;
  readonly planetId: string;
  readonly sectorId: SectorId | null;
  readonly status: AdmissionEligibilityStatus;
  readonly reason: AdmissionEligibilityStatus;
  readonly lifecycle: WorldLifecycleState;
  readonly health: WorldHealthState;
  readonly admission: WorldAdmissionState;
  readonly availability: WorldAvailability;
  readonly freeSeats: number;
  readonly sectorFreeSeats: number | null;
  readonly queuePaused: boolean;
}

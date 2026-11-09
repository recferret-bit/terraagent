import {
  deriveSectorOccupancy,
  deriveWorldAvailability,
  WORLD_ADMISSION_STATES,
  WORLD_HEALTH_STATES,
  WORLD_LIFECYCLE_STATES,
  type WorldAdmissionState,
  type WorldHealthState,
  type WorldLifecycleState,
} from '@terra/contracts';
import type {
  CanonicalWorldRecord,
  PlanetSectorRecord,
  UpdateCanonicalWorldStateInput,
} from './lobby-persistence.types';
import {
  AuditMetadataRequiredError,
  ConcurrencyConflictError,
  InvalidLifecycleTransitionError,
  type SectorStatusSnapshot,
  type WorldAdmissionAuditEntry,
  type WorldStatusSnapshot,
} from './lifecycle.types';

export { deriveSectorOccupancy, deriveWorldAvailability };

const ALLOWED_LIFECYCLE_TRANSITIONS: Readonly<
  Record<WorldLifecycleState, readonly WorldLifecycleState[]>
> = {
  PROVISIONING: ['PROVISIONING', 'ACTIVE', 'ARCHIVED'],
  ACTIVE: ['ACTIVE', 'ARCHIVED'],
  ARCHIVED: [],
};

export function isValidLifecycleState(state: string): state is WorldLifecycleState {
  return (WORLD_LIFECYCLE_STATES as readonly string[]).includes(state);
}

export function isValidHealthState(state: string): state is WorldHealthState {
  return (WORLD_HEALTH_STATES as readonly string[]).includes(state);
}

export function isValidAdmissionState(state: string): state is WorldAdmissionState {
  return (WORLD_ADMISSION_STATES as readonly string[]).includes(state);
}

/**
 * Pure guard checking whether `from -> to` is an allowed persistent-world lifecycle transition.
 * Legacy `SEALED` / `RECRUITING` / `ENDED` states and any transition out of `ARCHIVED` or `ACTIVE -> PROVISIONING` return false.
 */
export function canTransitionWorldLifecycle(from: WorldLifecycleState, to: string): to is WorldLifecycleState {
  if (!isValidLifecycleState(from) || !isValidLifecycleState(to)) return false;
  return ALLOWED_LIFECYCLE_TRANSITIONS[from].includes(to);
}

export function assertValidLifecycleTransition(
  from: WorldLifecycleState,
  to: string,
  planetId?: string,
): WorldLifecycleState {
  if (!isValidLifecycleState(to)) {
    throw new InvalidLifecycleTransitionError(
      `unsupported world lifecycle state "${to}"${planetId ? ` on planet "${planetId}"` : ''}: persistent canonical worlds only allow ${WORLD_LIFECYCLE_STATES.join(', ')} (never SEALED)`,
      { ...(planetId ? { planetId } : {}), from, to },
    );
  }
  if (!canTransitionWorldLifecycle(from, to)) {
    throw new InvalidLifecycleTransitionError(
      `invalid world lifecycle transition ${from} -> ${to}${planetId ? ` on planet "${planetId}"` : ''}`,
      { ...(planetId ? { planetId } : {}), from, to },
    );
  }
  return to;
}

export function assertValidHealthState(health: string, planetId?: string): WorldHealthState {
  if (!isValidHealthState(health)) {
    throw new InvalidLifecycleTransitionError(
      `unsupported world health state "${health}"${planetId ? ` on planet "${planetId}"` : ''}`,
      { ...(planetId ? { planetId } : {}), health },
    );
  }
  return health;
}

export function assertValidAdmissionTransition(
  fromLifecycle: WorldLifecycleState,
  fromAdmission: WorldAdmissionState,
  toAdmission: string,
  planetId?: string,
): WorldAdmissionState {
  if (!isValidAdmissionState(toAdmission)) {
    throw new InvalidLifecycleTransitionError(
      `unsupported world admission state "${toAdmission}"${planetId ? ` on planet "${planetId}"` : ''}`,
      { ...(planetId ? { planetId } : {}), fromAdmission, toAdmission },
    );
  }
  if ((fromLifecycle === 'ARCHIVED' || fromAdmission === 'ARCHIVED') && toAdmission !== 'ARCHIVED') {
    throw new InvalidLifecycleTransitionError(
      `cannot change admission ${fromAdmission} -> ${toAdmission} on archived planet${planetId ? ` "${planetId}"` : ''}`,
      { ...(planetId ? { planetId } : {}), fromLifecycle, fromAdmission, toAdmission },
    );
  }
  return toAdmission;
}

export function requireAuditActorAndReason(
  actor: string | undefined,
  reason: string | undefined,
  action: string,
): { readonly actor: string; readonly reason: string } {
  const cleanActor = typeof actor === 'string' ? actor.trim() : '';
  if (!cleanActor) throw new AuditMetadataRequiredError(action, 'actor');
  const cleanReason = typeof reason === 'string' ? reason.trim() : '';
  if (!cleanReason) throw new AuditMetadataRequiredError(action, 'reason');
  return { actor: cleanActor, reason: cleanReason };
}

export function assertExpectedUpdatedAt(
  existing: CanonicalWorldRecord,
  expectedUpdatedAt: Date | string | number | undefined,
): void {
  if (expectedUpdatedAt === undefined) return;
  const expectedMs =
    expectedUpdatedAt instanceof Date
      ? expectedUpdatedAt.getTime()
      : typeof expectedUpdatedAt === 'number'
        ? expectedUpdatedAt
        : new Date(expectedUpdatedAt).getTime();
  if (Number.isNaN(expectedMs) || existing.updatedAt.getTime() !== expectedMs) {
    throw new ConcurrencyConflictError(existing.id, expectedUpdatedAt, existing.updatedAt);
  }
}

export function validateCanonicalWorldStateUpdate(
  existing: CanonicalWorldRecord,
  input: UpdateCanonicalWorldStateInput,
): void {
  assertExpectedUpdatedAt(existing, input.expectedUpdatedAt);
  if (input.lifecycle !== undefined) {
    assertValidLifecycleTransition(existing.lifecycle, input.lifecycle, existing.id);
  }
  if (input.health !== undefined) {
    assertValidHealthState(input.health, existing.id);
  }
  if (input.admission !== undefined) {
    assertValidAdmissionTransition(existing.lifecycle, existing.admission, input.admission, existing.id);
  }
}

export function buildSectorStatusSnapshot(
  world: CanonicalWorldRecord,
  sec: PlanetSectorRecord,
): SectorStatusSnapshot {
  const occ = deriveSectorOccupancy({
    kind: sec.kind,
    foundingCapacity: sec.foundingCapacity,
    validatedCapacity: sec.validatedCapacity,
    reservedSeats: sec.reservedSeats,
    foundedSeats: sec.foundedSeats,
    livingColonies: null,
    presentColonies: null,
    onlinePlayers: null,
    lifecycle: world.lifecycle,
    health: world.health,
    admission: world.admission,
  });
  return {
    ...sec,
    freeSeats: occ.freeSeats,
    availability: occ.availability,
  };
}

export function buildWorldStatusSnapshot(
  world: CanonicalWorldRecord,
  sectors: readonly PlanetSectorRecord[],
  auditEntry?: WorldAdmissionAuditEntry,
): WorldStatusSnapshot {
  const sectorSnapshots = sectors.map((sec) => buildSectorStatusSnapshot(world, sec));
  const landSectors = sectorSnapshots.filter((s) => s.kind === 'land');
  const hasSectors = sectorSnapshots.length > 0;

  const nominalCapacity = hasSectors
    ? landSectors.reduce((sum, s) => sum + s.foundingCapacity, 0)
    : world.capacity;
  const validatedCapacity = hasSectors
    ? landSectors.reduce((sum, s) => sum + Math.min(s.foundingCapacity, s.validatedCapacity), 0)
    : world.capacity;
  const reservedSeats = hasSectors ? landSectors.reduce((sum, s) => sum + s.reservedSeats, 0) : 0;
  const foundedSeats = hasSectors
    ? landSectors.reduce((sum, s) => sum + s.foundedSeats, 0)
    : world.seatsTaken;
  const freeSeats = hasSectors
    ? landSectors.reduce((sum, s) => sum + s.freeSeats, 0)
    : Math.max(0, validatedCapacity - reservedSeats - foundedSeats);

  const availability = deriveWorldAvailability({
    lifecycle: world.lifecycle,
    health: world.health,
    admission: world.admission,
    freeSeats,
  });

  return {
    ...world,
    availability,
    nominalCapacity,
    validatedCapacity,
    reservedSeats,
    foundedSeats,
    freeSeats,
    sectors: sectorSnapshots,
    world,
    ...(auditEntry ? { auditEntry } : {}),
  };
}

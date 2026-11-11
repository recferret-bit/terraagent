import type { SectorId } from '@terra/contracts';
import {
  LobbyPersistenceConflictError,
  type ReserveSectorSlotInput,
  type ReserveSectorSlotOutcome,
} from '../lobby-persistence.types';

export function isActiveReservationState(state: string): boolean {
  return state === 'HELD' || state === 'COMMITTED' || state === 'SPAWNING';
}

export function checkWorldAdmissionForReservation(
  planetId: string,
  world:
    | {
        readonly admission: string;
        readonly lifecycle: string;
        readonly health: string;
      }
    | null
    | undefined,
): ReserveSectorSlotOutcome | null {
  if (world && (world.admission !== 'OPEN' || world.lifecycle !== 'ACTIVE' || world.health !== 'OK')) {
    return {
      ok: false,
      reason: 'admission_closed',
      message: `planet ${planetId} is not open for admission`,
    };
  }
  return null;
}

export function checkSectorCapacityForReservation(
  planetId: string,
  sectorId: SectorId,
  sector:
    | {
        readonly kind: string;
        readonly foundingCapacity: number;
        readonly validatedCapacity: number;
        readonly reservedSeats: number;
        readonly foundedSeats: number;
      }
    | null
    | undefined,
): ReserveSectorSlotOutcome | null {
  if (!sector) {
    throw new LobbyPersistenceConflictError(
      'sector_not_found',
      `sector ${sectorId} on ${planetId} not found`,
      { planetId, sectorId },
    );
  }
  if (sector.kind === 'ocean') {
    return {
      ok: false,
      reason: 'ocean_sector',
      message: `ocean sector ${sectorId} has zero founding seats`,
    };
  }
  const effectiveCap = Math.min(sector.foundingCapacity, sector.validatedCapacity);
  if (sector.reservedSeats + sector.foundedSeats >= effectiveCap) {
    return {
      ok: false,
      reason: 'sector_full',
      message: `sector ${sectorId} is at capacity (${sector.reservedSeats + sector.foundedSeats}/${effectiveCap})`,
    };
  }
  return null;
}

export function matchesIdempotentReservationInput(
  r: {
    readonly ticketId: string;
    readonly colonyId: string;
    readonly playerId: string;
    readonly planetId: string;
    readonly sectorId: string;
    readonly landingSlotId: string;
  },
  input: ReserveSectorSlotInput,
): boolean {
  return (
    r.ticketId === input.ticketId &&
    r.colonyId === input.colonyId &&
    r.playerId === input.playerId &&
    r.planetId === input.planetId &&
    r.sectorId === input.sectorId &&
    (!input.landingSlotId || r.landingSlotId === input.landingSlotId)
  );
}

export function assertFencedEpochMatches(
  reservationId: string,
  actualEpoch: number,
  expectedEpoch?: number,
): void {
  if (expectedEpoch !== undefined && actualEpoch !== expectedEpoch) {
    throw new LobbyPersistenceConflictError(
      'reservation_fenced',
      `reservation "${reservationId}" epoch mismatch (${actualEpoch} !== ${expectedEpoch})`,
    );
  }
}

export function assertCanCommitReservationState(reservationId: string, state: string): void {
  if (state !== 'HELD' && state !== 'SPAWNING') {
    throw new LobbyPersistenceConflictError(
      'reservation_fenced',
      `cannot commit reservation "${reservationId}" in state ${state}`,
    );
  }
}

export function assertCanReleaseReservationState(
  reservationId: string,
  state: string,
  allowCommitted?: boolean,
): boolean {
  const wasCommitted = state === 'COMMITTED';
  if (wasCommitted && !allowCommitted) {
    throw new LobbyPersistenceConflictError(
      'reservation_fenced',
      `cannot release committed reservation "${reservationId}": founded seats remain held`,
    );
  }
  return wasCommitted;
}

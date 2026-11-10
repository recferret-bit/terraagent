import { newId, type SectorId } from '@terra/contracts';
import type {
  AdmissionEligibilityResult,
  AdmissionEligibilityStatus,
  ElapsedAgeEvaluationResult,
  SectorStatusSnapshot,
  SetQueuePausedInput,
  WorldAdmissionAuditAction,
  WorldAdmissionAuditEntry,
  WorldStatusSnapshot,
} from '../lifecycle.types';
import type { CanonicalWorldRecord } from '../lobby-persistence.types';

function resolveSectorEligibility(sec: SectorStatusSnapshot): AdmissionEligibilityStatus {
  if (sec.kind === 'ocean') return 'ocean_sector';
  if (sec.freeSeats <= 0) return 'full';
  return 'open';
}

function resolveWorldEligibility(
  worldStatus: WorldStatusSnapshot,
  sec: SectorStatusSnapshot | null,
): AdmissionEligibilityStatus {
  if (worldStatus.lifecycle === 'ARCHIVED' || worldStatus.admission === 'ARCHIVED') {
    return 'archived';
  }
  if (worldStatus.lifecycle !== 'ACTIVE' || worldStatus.health !== 'OK') {
    return 'faulted';
  }
  if (worldStatus.admission === 'PAUSED') {
    return 'paused';
  }
  if (sec !== null) {
    return resolveSectorEligibility(sec);
  }
  return worldStatus.freeSeats <= 0 ? 'full' : 'open';
}

export async function evaluateAdmissionEligibility(
  planetId: string,
  sectorId: SectorId | undefined,
  queuePaused: boolean,
  getWorldStatus: (planetId: string) => Promise<WorldStatusSnapshot>,
  getSectorStatus: (planetId: string, sectorId: SectorId) => Promise<SectorStatusSnapshot>,
): Promise<AdmissionEligibilityResult> {
  const worldStatus = await getWorldStatus(planetId);
  const canCheckSector =
    sectorId !== undefined &&
    worldStatus.lifecycle === 'ACTIVE' &&
    worldStatus.health === 'OK' &&
    worldStatus.admission !== 'PAUSED' &&
    worldStatus.admission !== 'ARCHIVED';
  const sec = canCheckSector ? await getSectorStatus(planetId, sectorId) : null;
  const status = resolveWorldEligibility(worldStatus, sec);

  return {
    eligible: status === 'open',
    planetId,
    sectorId: sectorId ?? null,
    status,
    reason: status,
    lifecycle: worldStatus.lifecycle,
    health: worldStatus.health,
    admission: worldStatus.admission,
    availability: worldStatus.availability,
    freeSeats: worldStatus.freeSeats,
    sectorFreeSeats: sec ? sec.freeSeats : null,
    queuePaused,
  };
}

export function toElapsedAgeResult(
  snapshot: WorldStatusSnapshot,
  elapsedMs: number,
): ElapsedAgeEvaluationResult {
  return {
    planetId: snapshot.id,
    elapsedMs: Math.max(0, elapsedMs),
    ageSealed: false,
    expired: false,
    changed: false,
    lifecycle: snapshot.lifecycle,
    health: snapshot.health,
    admission: snapshot.admission,
    availability: snapshot.availability,
    freeSeats: snapshot.freeSeats,
    reservedSeats: snapshot.reservedSeats,
    foundedSeats: snapshot.foundedSeats,
    validatedCapacity: snapshot.validatedCapacity,
    world: snapshot.world,
  };
}

export function createAuditEntry(
  entry: Omit<WorldAdmissionAuditEntry, 'id'>,
): WorldAdmissionAuditEntry {
  return {
    id: `aud_${newId('mt').slice(3)}`,
    ...entry,
  };
}

export function buildTransitionEntry(
  prev: CanonicalWorldRecord,
  next: CanonicalWorldRecord,
  action: WorldAdmissionAuditAction,
  actor: string,
  reason: string,
): Omit<WorldAdmissionAuditEntry, 'id'> {
  return {
    planetId: next.id,
    action,
    fromLifecycle: prev.lifecycle,
    toLifecycle: next.lifecycle,
    fromHealth: prev.health,
    toHealth: next.health,
    fromAdmission: prev.admission,
    toAdmission: next.admission,
    actor,
    reason,
    at: next.updatedAt.toISOString(),
  };
}

export function normalizeQueuePauseInput(
  paused: boolean,
  defaultReason: string,
  inputOrActor?: Partial<Omit<SetQueuePausedInput, 'paused'>> | string,
  reason?: string,
): SetQueuePausedInput {
  if (typeof inputOrActor === 'string') {
    return {
      paused,
      actor: inputOrActor,
      reason: reason ?? defaultReason,
    };
  }
  return {
    paused,
    actor: inputOrActor?.actor ?? 'system:ops',
    reason: inputOrActor?.reason ?? defaultReason,
    ...(inputOrActor?.now ? { now: inputOrActor.now } : {}),
  };
}

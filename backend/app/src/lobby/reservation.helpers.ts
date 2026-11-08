import {
  SafeLandingSlotV1Schema,
  SectorReservationV1Schema,
  type AtlasManifestV1,
  type LandingSlotId,
  type ReservationStateV1,
  type SafeLandingSlotV1,
  type SectorId,
  type SectorReservationV1,
} from '@terra/contracts';
import {
  checkGroundForSlot,
  createAtlasQueryView,
  extractPinnedAtlasManifest,
  hexDistance,
  landingBlock,
  W11_DEFAULT_MIN_BUILDABLE_R4,
  type LandingSiteValidationIssue,
} from '@terra/sim';
import type { LobbyPersistenceService } from './lobby-persistence.service';
import {
  LobbyPersistenceConflictError,
  type CanonicalWorldRecord,
  type MatchTicketRecord,
  type PlanetSectorRecord,
  type SectorLandingSlotRecord,
  type SectorReservationRecord,
} from './lobby-persistence.types';
import {
  MATCH_SEAT_TTL_MS,
  type ManagedReservationState,
  type ManagedSectorReservationRecord,
  type ReservationFailureCode,
  type ReservationSlotFencePolicy,
  type SectorReservationFailureResult,
  type SimLandingAuthorityCheckInput,
  type SimLandingAuthorityDecision,
  type SimLandingAuthorityValidator,
} from './reservation.types';

export function resolveReservationTtlMs(ttlMs?: number, ttlS?: number): number {
  if (typeof ttlMs === 'number' && Number.isFinite(ttlMs) && ttlMs > 0) {
    return Math.floor(ttlMs);
  }
  if (typeof ttlS === 'number' && Number.isFinite(ttlS) && ttlS > 0) {
    return Math.floor(ttlS * 1000);
  }
  return MATCH_SEAT_TTL_MS;
}

export function makeFailureResult(
  code: ReservationFailureCode,
  message: string,
  extra?: Partial<Omit<SectorReservationFailureResult, 'ok' | 'code' | 'reason' | 'message'>>,
): SectorReservationFailureResult {
  return {
    ok: false,
    code,
    reason: code,
    message,
    ...extra,
  };
}

export function toManagedReservationRecord(
  record: SectorReservationRecord,
  overrideState?: ManagedReservationState,
): ManagedSectorReservationRecord {
  const state = overrideState ?? (record.state as ManagedReservationState);
  return {
    ...record,
    id: record.id ?? record.reservationId,
    reservationId: record.reservationId,
    state,
  };
}

export function toSectorReservationV1(
  record: SectorReservationRecord | ManagedSectorReservationRecord,
): SectorReservationV1 {
  const state: ReservationStateV1 =
    record.state === 'SPAWNING' ? 'HELD' : (record.state as ReservationStateV1);
  const candidate: SectorReservationV1 = {
    reservationId: record.reservationId,
    ticketId: record.ticketId,
    colonyId: record.colonyId,
    playerId: record.playerId,
    planetId: record.planetId,
    sectorId: record.sectorId,
    landingSlotId: record.landingSlotId,
    slotIndex: record.slotIndex,
    q: record.q,
    r: record.r,
    epoch: record.epoch,
    expiresAt: record.expiresAt,
    state,
  };
  const parsed = SectorReservationV1Schema.safeParse(candidate);
  return parsed.success ? parsed.data : candidate;
}

export function evaluateWorldAdmissionGuard(
  world: CanonicalWorldRecord,
  queuePaused: boolean,
): SectorReservationFailureResult | null {
  if (queuePaused) {
    return makeFailureResult(
      'queue_paused',
      `Global matchmaking queue is paused; cannot reserve slot on ${world.id}`,
    );
  }
  if (world.lifecycle === 'PROVISIONING') {
    return makeFailureResult(
      'world_provisioning',
      `Canonical world ${world.id} is still PROVISIONING`,
    );
  }
  if (world.lifecycle === 'ARCHIVED') {
    return makeFailureResult(
      'world_archived',
      `Canonical world ${world.id} is ARCHIVED`,
    );
  }
  if (world.health === 'FAULTED' || world.health === 'LOADING' || world.health === 'RETRYING') {
    return makeFailureResult(
      'world_faulted',
      `Canonical world ${world.id} health is ${world.health}`,
    );
  }
  if (world.admission !== 'OPEN') {
    return makeFailureResult(
      'admission_paused',
      `Canonical world ${world.id} admission is ${world.admission}`,
    );
  }
  return null;
}

export function evaluateSectorCapacityGuard(
  sector: PlanetSectorRecord,
): SectorReservationFailureResult | null {
  if (sector.kind === 'ocean') {
    return makeFailureResult(
      'ocean_sector',
      `Ocean sector ${sector.sectorId} on ${sector.planetId} has 0 founding capacity`,
    );
  }
  const effectiveCap = Math.min(sector.foundingCapacity, sector.validatedCapacity);
  const takenSeats = sector.reservedSeats + sector.foundedSeats;
  if (effectiveCap <= 0 || takenSeats >= effectiveCap || sector.freeSeats <= 0) {
    return makeFailureResult(
      'sector_full',
      `Sector ${sector.sectorId} on ${sector.planetId} is full (${takenSeats}/${effectiveCap})`,
    );
  }
  return null;
}

export async function resolveTargetSectorForTicket(
  persistence: LobbyPersistenceService,
  ticket: MatchTicketRecord,
  explicitSectorId?: SectorId,
): Promise<SectorId | null> {
  if (explicitSectorId) return explicitSectorId;
  if (ticket.sectorIntent.kind === 'chosen') {
    return ticket.sectorIntent.sectorId;
  }
  const sectors = await persistence.listSectors(ticket.planetId);
  const availableLand = sectors.find((s) => s.kind === 'land' && s.freeSeats > 0);
  return availableLand?.sectorId ?? sectors.find((s) => s.kind === 'land')?.sectorId ?? null;
}

export async function findCandidateFreeSlots(
  persistence: LobbyPersistenceService,
  planetId: string,
  sectorId: SectorId,
  requestedSlotId: string | undefined,
  ticket: MatchTicketRecord | null,
  slotFencePolicy?: ReservationSlotFencePolicy,
): Promise<
  | { readonly ok: true; readonly slots: readonly SectorLandingSlotRecord[] }
  | { readonly ok: false; readonly failure: SectorReservationFailureResult }
> {
  if (requestedSlotId) {
    const slot = await persistence.getLandingSlot(planetId, requestedSlotId);
    if (!slot || slot.sectorId !== sectorId) {
      throw new LobbyPersistenceConflictError(
        'slot_not_found',
        `Landing slot "${requestedSlotId}" not found in sector "${sectorId}"`,
        { planetId, sectorId, landingSlotId: requestedSlotId },
      );
    }
    if (
      slot.state !== 'FREE' ||
      slotFencePolicy?.isSlotBlockedByPendingSpawn(planetId, slot.landingSlotId)
    ) {
      return {
        ok: false,
        failure: makeFailureResult(
          'slot_taken',
          `Landing slot "${requestedSlotId}" is already ${slot.state === 'FREE' ? 'fenced by an unresolved spawn' : slot.state}`,
          { ticket },
        ),
      };
    }
    return { ok: true, slots: [slot] };
  }

  const sectorSlots = await persistence.listLandingSlots(planetId, sectorId);
  const freeSlots = sectorSlots
    .filter(
      (s) =>
        s.state === 'FREE' &&
        !slotFencePolicy?.isSlotBlockedByPendingSpawn(planetId, s.landingSlotId),
    )
    .sort((a, b) => {
      const depA = slotFencePolicy?.isSlotDeprioritized?.(planetId, a.landingSlotId) ? 1 : 0;
      const depB = slotFencePolicy?.isSlotDeprioritized?.(planetId, b.landingSlotId) ? 1 : 0;
      return depA - depB || a.slotIndex - b.slotIndex;
    });

  if (freeSlots.length === 0) {
    return {
      ok: false,
      failure: makeFailureResult(
        'sector_full',
        `No free validated landing slots remain in sector "${sectorId}"`,
        { ticket },
      ),
    };
  }
  return { ok: true, slots: freeSlots };
}

export function extractManifestSlotForCandidate(
  pinnedManifest: AtlasManifestV1 | null,
  sectorId: SectorId,
  landingSlotId: LandingSlotId,
): SafeLandingSlotV1 | null {
  if (!pinnedManifest) return null;
  const view = createAtlasQueryView(pinnedManifest);
  const slot = view.getSafeLandingSlot(landingSlotId);
  if (slot && slot.sectorId === sectorId) return slot;
  const sec = view.getSector(sectorId);
  return sec?.safeLandingSlots.find((s) => s.slotId === landingSlotId) ?? null;
}

export function runDefaultSimAuthorityValidation(
  input: SimLandingAuthorityCheckInput,
): SimLandingAuthorityDecision {
  const { sector, slot, pinnedManifest, simState, generatedAtlas } = input;
  if (sector.kind !== 'land') {
    return { ok: false, reason: 'ocean_sector' };
  }
  if (!Number.isSafeInteger(slot.q) || !Number.isSafeInteger(slot.r)) {
    return { ok: false, reason: 'invalid_coordinates' };
  }
  if (hexDistance(slot.q, slot.r, sector.centerQ, sector.centerR) > sector.radius) {
    return { ok: false, reason: 'outside_sector_radius' };
  }

  const effectiveManifest =
    pinnedManifest ?? extractPinnedAtlasManifest(simState ?? undefined);
  if (effectiveManifest) {
    const manifestSlot =
      input.manifestSlot ??
      extractManifestSlotForCandidate(effectiveManifest, sector.sectorId, slot.landingSlotId);
    if (!manifestSlot) {
      return { ok: false, reason: 'slot_not_in_pinned_manifest' };
    }
    if (!SafeLandingSlotV1Schema.safeParse(manifestSlot).success) {
      return { ok: false, reason: 'invalid_manifest_slot' };
    }
    if (
      manifestSlot.sectorId !== sector.sectorId ||
      manifestSlot.q !== slot.q ||
      manifestSlot.r !== slot.r
    ) {
      return { ok: false, reason: 'manifest_coordinate_mismatch' };
    }
  }

  if (generatedAtlas) {
    const groundIssues: LandingSiteValidationIssue[] = [];
    const safeSlot: SafeLandingSlotV1 = input.manifestSlot ?? {
      slotId: slot.landingSlotId,
      sectorId: sector.sectorId,
      slotIndex: slot.slotIndex,
      q: slot.q,
      r: slot.r,
    };
    checkGroundForSlot(
      generatedAtlas,
      safeSlot,
      W11_DEFAULT_MIN_BUILDABLE_R4,
      groundIssues,
    );
    if (groundIssues.length > 0) {
      return { ok: false, reason: groundIssues[0]!.reason };
    }
  }

  if (simState) {
    const blockReason = landingBlock(simState, -1, slot.q, slot.r);
    if (blockReason !== null) {
      return { ok: false, reason: blockReason };
    }
  }

  return { ok: true, epoch: slot.epoch + 1 };
}

export async function invokeSimAuthorityValidator(
  validator: SimLandingAuthorityValidator | undefined,
  input: SimLandingAuthorityCheckInput,
): Promise<SimLandingAuthorityDecision> {
  const defaultDecision = runDefaultSimAuthorityValidation(input);
  if (!validator) return defaultDecision;

  const rawResult =
    typeof validator === 'function'
      ? await validator(input)
      : await validator.validateLandingSlot(input);

  if (typeof rawResult === 'boolean') {
    return rawResult
      ? { ok: true, epoch: defaultDecision.epoch ?? input.epoch }
      : { ok: false, reason: 'authority_rejected' };
  }
  return rawResult;
}

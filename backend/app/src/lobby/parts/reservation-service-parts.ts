import type { AtlasManifestV1 } from '@terra/contracts';
import { extractPinnedAtlasManifest } from '@terra/sim';
import type { LobbyPersistenceService } from '../lobby-persistence.service';
import type {
  CanonicalWorldRecord,
  MatchTicketRecord,
  PlanetSectorRecord,
  SectorLandingSlotRecord,
  SectorReservationRecord,
} from '../lobby-persistence.types';
import {
  extractManifestSlotForCandidate,
  invokeSimAuthorityValidator,
  makeFailureResult,
  resolveReservationTtlMs,
  toSectorReservationV1,
} from '../reservation.helpers';
import type {
  ManagedSectorReservationRecord,
  ReserveSectorSlotRequest,
  SectorReservationResult,
  SimLandingAuthorityValidator,
} from '../reservation.types';

export async function checkIdempotentTicketReservation(params: {
  readonly persistence: LobbyPersistenceService;
  readonly input: ReserveSectorSlotRequest;
  readonly ticket: MatchTicketRecord | null;
  readonly spawningStateById: ReadonlyMap<string, boolean>;
  readonly decorateRecord: (record: SectorReservationRecord) => ManagedSectorReservationRecord;
}): Promise<SectorReservationResult | null> {
  const { persistence, input, ticket, spawningStateById, decorateRecord } = params;
  const existing = await persistence.getReservationByTicketId(input.ticketId);
  if (!existing) return null;
  const isActive =
    existing.state === 'HELD' ||
    existing.state === 'COMMITTED' ||
    spawningStateById.has(existing.reservationId);
  if (!isActive) return null;

  if (
    existing.planetId === input.planetId &&
    existing.sectorId === input.sectorId &&
    existing.playerId === input.playerId &&
    existing.colonyId === input.colonyId &&
    (!input.landingSlotId || existing.landingSlotId === input.landingSlotId)
  ) {
    const slot = await persistence.getLandingSlot(existing.planetId, existing.landingSlotId);
    const sector = await persistence.getSector(existing.planetId, existing.sectorId);
    if (slot && sector) {
      const managed = decorateRecord(existing);
      return {
        ok: true,
        idempotent: true,
        reservation: managed,
        reservationV1: toSectorReservationV1(managed),
        slot,
        sector,
        ticket,
      };
    }
  }
  return null;
}

async function trySingleCandidateSlotWithAuthority(params: {
  readonly persistence: LobbyPersistenceService;
  readonly input: ReserveSectorSlotRequest;
  readonly world: CanonicalWorldRecord;
  readonly sector: PlanetSectorRecord;
  readonly candidate: SectorLandingSlotRecord;
  readonly pinnedManifest: AtlasManifestV1 | null;
  readonly validator: SimLandingAuthorityValidator | undefined;
  readonly ttlMs: number;
  readonly now: Date;
  readonly ticket: MatchTicketRecord | null;
  readonly decorateRecord: (record: SectorReservationRecord) => ManagedSectorReservationRecord;
}): Promise<{ readonly kind: 'reserved' | 'failed'; readonly result: SectorReservationResult } | { readonly kind: 'rejected' }> {
  const { persistence, input, world, sector, candidate, pinnedManifest, validator, ttlMs, now, ticket, decorateRecord } = params;
  const manifestSlot = extractManifestSlotForCandidate(pinnedManifest, sector.sectorId, candidate.landingSlotId);
  const authorityDecision = await invokeSimAuthorityValidator(validator, {
    planetId: world.id,
    world,
    sector,
    slot: candidate,
    manifestSlot,
    pinnedManifest,
    ticketId: input.ticketId,
    playerId: input.playerId,
    colonyId: input.colonyId,
    epoch: candidate.epoch + 1,
    now,
    simState: input.simState,
    generatedAtlas: input.generatedAtlas,
  });
  if (!authorityDecision.ok) return { kind: 'rejected' };

  const outcome = await persistence.reserveSectorSlot({
    planetId: input.planetId,
    sectorId: input.sectorId,
    landingSlotId: candidate.landingSlotId,
    playerId: input.playerId,
    ticketId: input.ticketId,
    colonyId: input.colonyId,
    reservationId: input.reservationId,
    ttlMs,
    now,
  });
  if (!outcome.ok) {
    if (outcome.reason === 'slot_taken' && !input.landingSlotId) return { kind: 'rejected' };
    const mappedCode = outcome.reason === 'admission_closed' ? 'admission_paused' : outcome.reason;
    return { kind: 'failed', result: makeFailureResult(mappedCode, outcome.message, { ticket }) };
  }

  const updatedTicket = await persistence.getTicketById(input.ticketId);
  const managed = decorateRecord(outcome.reservation);
  return {
    kind: 'reserved',
    result: {
      ok: true,
      idempotent: outcome.idempotent,
      reservation: managed,
      reservationV1: toSectorReservationV1(managed),
      slot: outcome.slot,
      sector: outcome.sector,
      ticket: updatedTicket,
    },
  };
}

export async function tryCandidateSlotsWithAuthorityHelper(params: {
  readonly persistence: LobbyPersistenceService;
  readonly input: ReserveSectorSlotRequest;
  readonly world: CanonicalWorldRecord;
  readonly sector: PlanetSectorRecord;
  readonly candidates: readonly SectorLandingSlotRecord[];
  readonly ticket: MatchTicketRecord | null;
  readonly defaultValidator: SimLandingAuthorityValidator | undefined;
  readonly decorateRecord: (record: SectorReservationRecord) => ManagedSectorReservationRecord;
}): Promise<SectorReservationResult> {
  const {
    persistence,
    input,
    world,
    sector,
    candidates,
    ticket,
    defaultValidator,
    decorateRecord,
  } = params;
  const pinnedAtlas = await persistence.getAtlasVersion(world.id, world.atlasVersion);
  const pinnedManifest =
    pinnedAtlas?.manifest ?? extractPinnedAtlasManifest(input.simState ?? undefined);
  const validator = input.authorityValidator ?? defaultValidator;
  const now = input.now ?? new Date();
  const ttlMs = resolveReservationTtlMs(input.ttlMs, input.ttlS);
  const rejectedSlotIds: string[] = [];

  for (const candidate of candidates) {
    const step = await trySingleCandidateSlotWithAuthority({
      persistence,
      input,
      world,
      sector,
      candidate,
      pinnedManifest,
      validator,
      ttlMs,
      now,
      ticket,
      decorateRecord,
    });
    if (step.kind === 'reserved' || step.kind === 'failed') {
      return step.result;
    }
    rejectedSlotIds.push(candidate.landingSlotId);
  }

  return makeFailureResult(
    'no_safe_slot',
    `Sim authority rejected all ${rejectedSlotIds.length} candidate landing slot(s) in ${sector.sectorId}`,
    { rejectedSlotIds, ticket },
  );
}

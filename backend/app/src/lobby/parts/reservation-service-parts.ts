import type { AtlasManifestV1 } from '@terra/contracts';
import { extractPinnedAtlasManifest } from '@terra/sim';
import { normalizeColonyStatus, type SectorAntiCheatService } from '../../core/anticheat';
import {
  buildDefaultColonySlotAllowance,
  type ColonySlotAllowanceService,
} from '../../core/home/colony-slot-allowance.service';
import type { HomeRepository } from '../../core/home/home.repository';
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

export interface OwnedBaseRef {
  readonly colonyId: string;
  readonly planetId: string;
  readonly sectorId: string;
}

export async function collectPlayerOwnedBasesForReservation(params: {
  readonly persistence: LobbyPersistenceService;
  readonly homeRepo?: HomeRepository;
  readonly antiCheat?: SectorAntiCheatService;
  readonly playerId: string;
  readonly excludeColonyId?: string;
}): Promise<OwnedBaseRef[]> {
  const { persistence, homeRepo, antiCheat, playerId, excludeColonyId } = params;
  const seen = new Set<string>();
  const out: OwnedBaseRef[] = [];

  if (antiCheat) {
    const liveBases = await antiCheat.resolveAuthoritativeActiveBases(playerId);
    for (const b of liveBases) {
      if (b.colonyId === excludeColonyId || seen.has(b.colonyId)) continue;
      seen.add(b.colonyId);
      out.push({ colonyId: b.colonyId, planetId: b.planetId, sectorId: b.baseSectorId });
    }
  }

  const repoColonies = homeRepo ? await homeRepo.listColoniesByPlayerId(playerId) : [];
  const repoById = new Map(repoColonies.map((c) => [c.id, c]));
  for (const row of repoColonies) {
    if (row.id === excludeColonyId || seen.has(row.id) || normalizeColonyStatus(row.status) !== 'ACTIVE') {
      continue;
    }
    const live = antiCheat?.index.getColonyById(row.id);
    if (live?.terminalFromLive && live.status !== 'ACTIVE') continue;
    const planet = await homeRepo!.findPlanetById(row.planetId);
    if (planet && (planet.status === 'ENDED' || planet.status === 'PLANET_ENDED')) continue;
    const world = await persistence.getCanonicalWorldById(row.planetId);
    if (world && (world.lifecycle === 'ARCHIVED' || world.admission === 'ARCHIVED')) continue;
    seen.add(row.id);
    out.push({
      colonyId: row.id,
      planetId: row.planetId,
      sectorId: (row.foundingSectorId ?? 'sec_0_0').trim() || 'sec_0_0',
    });
  }

  const worlds = await persistence.listCanonicalWorlds();
  for (const w of worlds) {
    if (w.lifecycle === 'ARCHIVED') continue;
    const reservations = await persistence.listReservations(w.id);
    for (const r of reservations) {
      if (
        r.playerId !== playerId ||
        (r.state !== 'COMMITTED' && r.state !== 'HELD') ||
        r.colonyId === excludeColonyId ||
        seen.has(r.colonyId)
      ) {
        continue;
      }
      const liveCol = antiCheat?.index.getColonyById(r.colonyId);
      if (liveCol && liveCol.status !== 'ACTIVE') continue;
      const repoCol = repoById.get(r.colonyId);
      if (repoCol && normalizeColonyStatus(repoCol.status) !== 'ACTIVE') continue;
      seen.add(r.colonyId);
      out.push({ colonyId: r.colonyId, planetId: r.planetId, sectorId: r.sectorId });
    }
  }

  return out;
}

export async function listPlayerOwnedSectorIdsOnPlanet(params: {
  readonly persistence: LobbyPersistenceService;
  readonly homeRepo?: HomeRepository;
  readonly antiCheat?: SectorAntiCheatService;
  readonly playerId: string;
  readonly planetId: string;
  readonly excludeColonyId?: string;
}): Promise<Set<string>> {
  const bases = await collectPlayerOwnedBasesForReservation(params);
  return new Set(bases.filter((b) => b.planetId === params.planetId).map((b) => b.sectorId));
}

export async function evaluateSpawnMultiColonyGuard(params: {
  readonly persistence: LobbyPersistenceService;
  readonly homeRepo?: HomeRepository;
  readonly antiCheat?: SectorAntiCheatService;
  readonly slotAllowance?: ColonySlotAllowanceService;
  readonly playerId: string;
  readonly planetId: string;
  readonly sectorId: string;
  readonly colonyId: string;
  readonly isTransfer: boolean;
}): Promise<
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly code: 'sector_already_colonized' | 'staking_required' | 'ai_slot_limit';
      readonly message: string;
    }
> {
  const { persistence, homeRepo, antiCheat, slotAllowance, playerId, planetId, sectorId, colonyId, isTransfer } = params;
  if (isTransfer) return { ok: true };

  const ownedBases = await collectPlayerOwnedBasesForReservation({
    persistence,
    homeRepo,
    antiCheat,
    playerId,
    excludeColonyId: colonyId,
  });
  if (ownedBases.length === 0) return { ok: true };

  const sameSector = ownedBases.find((b) => b.planetId === planetId && b.sectorId === sectorId);
  if (sameSector) {
    return {
      ok: false,
      code: 'sector_already_colonized',
      message: `Player "${playerId}" already owns active colony "${sameSector.colonyId}" in sector ${sectorId} on ${planetId}`,
    };
  }

  const allowance = slotAllowance
    ? await slotAllowance.resolveForPlayer(playerId, ownedBases.length)
    : buildDefaultColonySlotAllowance(ownedBases.length);
  if (!allowance.isStaker) {
    return {
      ok: false,
      code: 'staking_required',
      message: 'Multiple colonies require NEAR staking (Tier 2 · 50+ NEAR for 3 NEAR.AI colony slots).',
    };
  }
  if (ownedBases.length >= allowance.max) {
    return {
      ok: false,
      code: 'ai_slot_limit',
      message: `All ${allowance.max} NEAR.AI colony slots for Tier ${allowance.tier} are already in use.`,
    };
  }
  return { ok: true };
}

export async function evaluateMultiColonyReservationGuard(params: {
  readonly persistence: LobbyPersistenceService;
  readonly homeRepo?: HomeRepository;
  readonly antiCheat?: SectorAntiCheatService;
  readonly slotAllowance?: ColonySlotAllowanceService;
  readonly input: ReserveSectorSlotRequest;
  readonly ticket: MatchTicketRecord | null;
}): Promise<SectorReservationResult | null> {
  const { persistence, homeRepo, antiCheat, slotAllowance, input, ticket } = params;
  const check = await evaluateSpawnMultiColonyGuard({
    persistence,
    homeRepo,
    antiCheat,
    slotAllowance,
    playerId: input.playerId,
    planetId: input.planetId,
    sectorId: input.sectorId,
    colonyId: input.colonyId,
    isTransfer: ticket?.mode === 'TRANSFER',
  });
  if (check.ok) return null;
  antiCheat?.recordRejection('http', 'join', 'not_your_sector');
  return makeFailureResult('ticket_not_reservable', check.message, { ticket });
}

export async function syncCommittedReservationAntiCheat(params: {
  readonly persistence: LobbyPersistenceService;
  readonly antiCheat?: SectorAntiCheatService;
  readonly committed: SectorReservationRecord;
}): Promise<void> {
  const { persistence, antiCheat, committed } = params;
  if (!antiCheat) return;
  const ticket = await persistence.getTicketById(committed.ticketId);
  if (ticket?.mode === 'TRANSFER') {
    const priorSourceColonyId =
      ticket.sourceColonyId ??
      ticket.transferCarry?.sourceColonyId ??
      antiCheat.index.getActiveBaseByPlayer(committed.playerId)?.colonyId;
    if (priorSourceColonyId && priorSourceColonyId !== committed.colonyId) {
      antiCheat.recordColonyStatus(priorSourceColonyId, 'TRANSFERRED');
    }
  }
  let colonyIndex = antiCheat.index.getColonyById(committed.colonyId)?.colonyIndex ?? committed.slotIndex;
  let existingIdx = antiCheat.index.getColonyByPlanetIndex(committed.planetId, colonyIndex);
  if (existingIdx && existingIdx.colonyId !== committed.colonyId && existingIdx.status === 'ACTIVE') {
    colonyIndex = 0;
    while (
      (existingIdx = antiCheat.index.getColonyByPlanetIndex(committed.planetId, colonyIndex)) &&
      existingIdx.colonyId !== committed.colonyId &&
      existingIdx.status === 'ACTIVE'
    ) {
      colonyIndex++;
    }
  }
  antiCheat.index.upsertColonyBase({
    playerId: committed.playerId,
    colonyId: committed.colonyId,
    planetId: committed.planetId,
    colonyIndex,
    foundingSectorId: committed.sectorId,
    spawnQ: committed.q,
    spawnR: committed.r,
    status: 'ACTIVE',
    authoritativeStatus: true,
  });
  await antiCheat.hydratePlanetSectors(committed.planetId);
}

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

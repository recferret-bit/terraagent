import {
  CANONICAL_PLANETS,
  type MatchTicketV1,
  type SectorId,
} from '@terra/contracts';
import type { LobbyPersistenceService } from './lobby-persistence.service';
import type {
  CanonicalWorldRecord,
  MatchTicketRecord,
  PlanetSectorRecord,
  SectorIntentInput,
  TransferCarryRecord,
} from './lobby-persistence.types';
import {
  MM_TRANSFER_PRIORITY,
  type AcceptAlternativeSectorInput,
  type AcceptAlternativeSectorOptions,
  type MatchmakerTicketOutcome,
  type MatchmakerTickSummary,
  type ProcessTicketResult,
} from './matchmaker.types';
import { resolveCanonicalPlanetType } from './planets.helpers';
import type { SectorReservationSuccessResult } from './reservation.types';
import { MatchTicketNotFoundException } from './tickets.types';

/**
 * Filters a planet's sectors to eligible `'land'` sectors with `freeSeats > 0`
 * and sorts them fill-first (`(reservedSeats + foundedSeats)` descending, then `sectorId` ascending).
 */
export function sortEligibleLandSectorsFillFirst(
  sectors: readonly PlanetSectorRecord[],
  excludeSectorId?: SectorId,
): PlanetSectorRecord[] {
  return sectors
    .filter((s) => {
      if (s.kind !== 'land') return false;
      if (excludeSectorId && s.sectorId === excludeSectorId) return false;
      const effectiveCap = Math.min(s.foundingCapacity, s.validatedCapacity);
      const taken = s.reservedSeats + s.foundedSeats;
      return effectiveCap > 0 && taken < effectiveCap && s.freeSeats > 0;
    })
    .sort(
      (a, b) =>
        b.reservedSeats + b.foundedSeats - (a.reservedSeats + a.foundedSeats) ||
        a.sectorId.localeCompare(b.sectorId),
    );
}

/**
 * Computes eligible alternative `'land'` sector IDs on the same planet when a chosen sector is full,
 * sorted fill-first (`(reservedSeats + foundedSeats)` descending, then `sectorId` ascending).
 */
export function computeAlternativeSectorIds(
  sectors: readonly PlanetSectorRecord[],
  chosenSectorId: SectorId,
): SectorId[] {
  return sortEligibleLandSectorsFillFirst(sectors, chosenSectorId).map((s) => s.sectorId);
}

/**
 * Extracts durable `transferCarry` from a `MatchTicketRecord`.
 */
export function resolveTransferCarry(ticket: MatchTicketRecord): TransferCarryRecord | null {
  const sourcePlanetId =
    ticket.transferCarry?.sourcePlanetId ?? ticket.sourcePlanetId ?? '';
  const sourceColonyId =
    ticket.transferCarry?.sourceColonyId ?? ticket.sourceColonyId ?? '';
  const carryOver = ticket.transferCarry?.carryOver ?? ticket.carryOver ?? undefined;

  if (!sourcePlanetId && !sourceColonyId && !carryOver) {
    return null;
  }
  return {
    sourcePlanetId,
    sourceColonyId,
    ...(carryOver ? { carryOver: { ...carryOver } } : {}),
  };
}

/**
 * Checks whether a `TransferCarryRecord` has both non-empty `sourcePlanetId` and `sourceColonyId`.
 */
export function isValidTransferCarry(
  carry: TransferCarryRecord | null | undefined,
): carry is TransferCarryRecord {
  return Boolean(
    carry &&
      typeof carry.sourcePlanetId === 'string' &&
      carry.sourcePlanetId.trim().length > 0 &&
      typeof carry.sourceColonyId === 'string' &&
      carry.sourceColonyId.trim().length > 0,
  );
}

/**
 * Resolves a canonical planet ID (`pl_01J...`) from a planet ID, type, or slug alias.
 */
export function resolveCanonicalPlanetId(idOrType: string | null | undefined): string | null {
  if (!idOrType) return null;
  const trimmed = idOrType.trim();
  if (!trimmed) return null;
  const resolvedType = resolveCanonicalPlanetType(trimmed);
  if (resolvedType) {
    return CANONICAL_PLANETS[resolvedType].id;
  }
  return trimmed;
}

/**
 * Evaluates whether a canonical world is currently eligible for seat reservation (`MM-01..06`, `MM-32`).
 */
export function evaluateWorldMatchmakingEligibility(world: CanonicalWorldRecord | null): {
  readonly eligible: boolean;
  readonly reason?: string;
} {
  if (!world) return { eligible: false, reason: 'planet_not_found' };
  if (world.lifecycle === 'PROVISIONING') return { eligible: false, reason: 'world_provisioning' };
  if (world.lifecycle === 'ARCHIVED') return { eligible: false, reason: 'world_archived' };
  if (world.health !== 'OK') return { eligible: false, reason: 'world_faulted' };
  if (world.admission !== 'OPEN') return { eligible: false, reason: 'admission_paused' };
  return { eligible: true };
}

/**
 * Sorts `QUEUED` tickets by `priority DESC, createdAt ASC, id ASC` (`TRANSFER` tickets default to priority >= 10).
 */
export function sortQueuedTicketsByPriority(
  tickets: readonly MatchTicketRecord[],
): MatchTicketRecord[] {
  return [...tickets].sort((a, b) => {
    const prioA = a.mode === 'TRANSFER' ? Math.max(MM_TRANSFER_PRIORITY, a.priority) : a.priority;
    const prioB = b.mode === 'TRANSFER' ? Math.max(MM_TRANSFER_PRIORITY, b.priority) : b.priority;
    if (prioB !== prioA) return prioB - prioA;
    const timeDiff = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    if (timeDiff !== 0) return timeDiff;
    return a.id.localeCompare(b.id);
  });
}

function isIntentObject(val: unknown): val is SectorIntentInput {
  return (
    typeof val === 'object' &&
    val !== null &&
    ('kind' in val || 'mode' in val || 'sectorId' in val)
  );
}

/**
 * Normalizes flexible call arguments for `MatchmakerService.acceptAlternativeSector`.
 */
export function extractAcceptAlternativeArgs(
  firstArg: string | AcceptAlternativeSectorInput,
  secondArg?: string | SectorIntentInput,
  thirdArg?: SectorIntentInput | SectorId | AcceptAlternativeSectorOptions,
  fourthArg?: AcceptAlternativeSectorOptions,
): {
  readonly ticketId: string;
  readonly playerId?: string;
  readonly newSectorIntent: SectorIntentInput | SectorId;
  readonly options: AcceptAlternativeSectorOptions;
} {
  if (typeof firstArg === 'object' && firstArg !== null) {
    const intent: SectorIntentInput | SectorId =
      firstArg.newSectorIntent ??
      firstArg.sectorIntent ??
      (firstArg.sectorId
        ? { kind: 'chosen', sectorId: firstArg.sectorId }
        : { kind: 'auto' });
    return {
      ticketId: firstArg.ticketId,
      playerId: firstArg.playerId,
      newSectorIntent: intent,
      options: firstArg,
    };
  }

  const ticketId = firstArg;
  if (isIntentObject(secondArg)) {
    return {
      ticketId,
      newSectorIntent: secondArg,
      options: (thirdArg as AcceptAlternativeSectorOptions | undefined) ?? {},
    };
  }

  if (
    typeof secondArg === 'string' &&
    (thirdArg === undefined ||
      (typeof thirdArg === 'object' && thirdArg !== null && !isIntentObject(thirdArg)))
  ) {
    return {
      ticketId,
      newSectorIntent: secondArg,
      options: (thirdArg as AcceptAlternativeSectorOptions | undefined) ?? {},
    };
  }

  return {
    ticketId,
    playerId: typeof secondArg === 'string' ? secondArg : undefined,
    newSectorIntent: (thirdArg as SectorIntentInput | SectorId | undefined) ?? { kind: 'auto' },
    options: fourthArg ?? {},
  };
}

export function buildQueuedProcessResult(
  outcome: Exclude<MatchmakerTicketOutcome, 'reserved'>,
  ticket: MatchTicketRecord,
  alternativeSectors: readonly SectorId[],
  transferCarry: TransferCarryRecord | null,
  reason?: string,
): ProcessTicketResult {
  return {
    outcome,
    reserved: false,
    ticket,
    reservation: null,
    reservationV1: null,
    sector: null,
    slot: null,
    alternativeSectors: [...alternativeSectors],
    transferCarry,
    ...(reason ? { reason } : {}),
  };
}

export function buildReservedProcessResult(
  res: SectorReservationSuccessResult,
  ticket: MatchTicketRecord,
  transferCarry: TransferCarryRecord | null,
): ProcessTicketResult {
  return {
    outcome: 'reserved',
    reserved: true,
    idempotent: res.idempotent,
    ticket,
    reservation: res.reservation,
    reservationV1: res.reservationV1,
    sector: res.sector,
    slot: res.slot,
    alternativeSectors: [],
    transferCarry,
  };
}

export async function loadAndSyncTicketRecord(
  persistence: LobbyPersistenceService,
  ticketOrId: string | MatchTicketRecord | MatchTicketV1,
): Promise<MatchTicketRecord> {
  const ticketId = typeof ticketOrId === 'string' ? ticketOrId : ticketOrId.id;
  const stored = await persistence.getTicketById(ticketId);
  if (!stored) {
    throw new MatchTicketNotFoundException(`Ticket "${ticketId}" not found`, { ticketId });
  }
  if (typeof ticketOrId === 'string') {
    return stored;
  }
  const passedCarry = resolveTransferCarry(ticketOrId as MatchTicketRecord);
  if (passedCarry && !stored.transferCarry) {
    return persistence.updateTicket({ ticketId: stored.id, transferCarry: passedCarry });
  }
  return stored;
}

export async function resolveTicketTargetWorld(
  persistence: LobbyPersistenceService,
  ticket: MatchTicketRecord,
): Promise<CanonicalWorldRecord | null> {
  const byId = await persistence.getCanonicalWorldById(ticket.planetId);
  if (byId) return byId;
  return persistence.getCanonicalWorldByType(ticket.planetType);
}

export async function updateQueuedTicketPositionAndEtaHelper(
  persistence: LobbyPersistenceService,
  ticket: MatchTicketRecord,
  alternativeSectors: readonly SectorId[],
  transferCarry: TransferCarryRecord | null,
  etaNull: boolean,
  avgAssignmentS: number,
  now: Date,
  priorityOverride?: number,
): Promise<MatchTicketRecord> {
  const queuedOnPlanet = sortQueuedTicketsByPriority(
    await persistence.listTickets({ planetId: ticket.planetId, state: 'QUEUED' }),
  );
  const idx = queuedOnPlanet.findIndex((t) => t.id === ticket.id);
  const position = idx >= 0 ? idx : 0;
  const etaS = etaNull ? null : Math.max(1, (position + 1) * Math.round(avgAssignmentS));

  return persistence.updateTicket({
    ticketId: ticket.id,
    state: 'QUEUED',
    ...(priorityOverride !== undefined ? { priority: priorityOverride } : {}),
    position,
    etaS,
    alternativeSectors,
    ...(transferCarry ? { transferCarry } : {}),
    now,
  });
}

export async function refreshRemainingQueuePositionsHelper(
  persistence: LobbyPersistenceService,
  planetId: string | undefined,
  paused: boolean,
  avgAssignmentS: number,
  now: Date,
): Promise<MatchTicketRecord[]> {
  const remaining = sortQueuedTicketsByPriority(
    await persistence.listTickets({
      state: 'QUEUED',
      ...(planetId ? { planetId } : {}),
    }),
  );
  const byPlanet = new Map<string, MatchTicketRecord[]>();
  for (const ticket of remaining) {
    const list = byPlanet.get(ticket.planetId) ?? [];
    list.push(ticket);
    byPlanet.set(ticket.planetId, list);
  }

  const updatedAll: MatchTicketRecord[] = [];
  for (const [pId, planetTickets] of byPlanet.entries()) {
    const world = await persistence.getCanonicalWorldById(pId);
    const worldEligible = evaluateWorldMatchmakingEligibility(world).eligible;
    const sectors = await persistence.listSectors(pId);
    const eligibleLand = sortEligibleLandSectorsFillFirst(sectors);
    const planetFull = eligibleLand.length === 0;

    for (let idx = 0; idx < planetTickets.length; idx++) {
      const t = planetTickets[idx]!;
      const position = idx;
      const etaS =
        paused || !worldEligible || planetFull
          ? null
          : Math.max(1, (position + 1) * Math.round(avgAssignmentS));
      const alternatives =
        t.sectorIntent.kind === 'chosen'
          ? computeAlternativeSectorIds(sectors, t.sectorIntent.sectorId)
          : (t.alternativeSectors ?? []);
      const carry = resolveTransferCarry(t);
      const updated = await persistence.updateTicket({
        ticketId: t.id,
        position,
        etaS,
        alternativeSectors: alternatives,
        ...(carry ? { transferCarry: carry } : {}),
        now,
      });
      updatedAll.push(updated);
    }
  }
  return sortQueuedTicketsByPriority(updatedAll);
}

export async function buildPausedTickSummaryHelper(
  persistence: LobbyPersistenceService,
  batchSize: number,
  planetId: string | undefined,
  avgAssignmentS: number,
  now: Date,
): Promise<MatchmakerTickSummary> {
  const queuedTickets = await refreshRemainingQueuePositionsHelper(
    persistence,
    planetId,
    true,
    avgAssignmentS,
    now,
  );
  const transferPendingTickets = queuedTickets.filter((t) => t.mode === 'TRANSFER');
  return {
    queuePaused: true,
    batchSize,
    processed: 0,
    reserved: 0,
    queued: queuedTickets.length,
    transferPending: transferPendingTickets.length,
    expiredReservations: 0,
    reservedTickets: [],
    queuedTickets,
    transferPendingTickets,
    expiredReservationRecords: [],
    results: [],
  };
}

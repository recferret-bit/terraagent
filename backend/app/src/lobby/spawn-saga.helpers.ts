import { newId, W11_DEFAULT_SECTOR_RADIUS, type LandingSlotId, type SectorId, type SimCommandV1 } from '@terra/contracts';
import { DEV_PLANET_CAPACITY } from '@terra/sim';
import type { ColonyRecord, HomeRepository, PlanetRecord } from '../core/home/home.repository';
import { createSpawnColonyCommand, type ColonySeatAssignment } from '../core/home/home.service';
import type { GamePlanets } from '../game/game-planets.service';
import type { LobbyPersistenceService } from './lobby-persistence.service';
import type { MatchTicketRecord, SectorReservationRecord } from './lobby-persistence.types';
import { toManagedReservationRecord } from './reservation.helpers';
import type { ManagedSectorReservationRecord } from './reservation.types';
import {
  DEFAULT_SPAWN_TIMEOUT_MS,
  ORPHAN_RETIRE_REASON,
  type ColonySpawnExecutor,
  type DefaultSimColonyState,
  type ExecuteSpawnSagaOptions,
  type RetireColonyCommand,
  type RetireColonyExecutionRequest,
  type SpawnColonyExecutionOutcome,
  type SpawnColonyExecutionRequest,
  type SpawnSagaInput,
} from './spawn-saga.types';

export const SPAWN_ATTEMPT_TIMED_OUT = Symbol('SPAWN_ATTEMPT_TIMED_OUT');

export interface AttemptExecutionResult {
  readonly ok: boolean;
  readonly timedOut: boolean;
  readonly appliedAtTick: number | null;
  readonly code: string;
  readonly error: string | null;
  readonly inFlightPromise?: Promise<SpawnColonyExecutionOutcome>;
}

/**
 * Deterministic in-memory colony spawn & retire executor for unit tests and local default operation.
 * Enforces `colonyId` idempotency (`MM-35`) and per-slot single-occupant safety in the simulated planet state.
 */
export class DefaultColonySpawnExecutor {
  private readonly coloniesByPlanet = new Map<string, Map<string, DefaultSimColonyState>>();
  private readonly slotOccupantByKey = new Map<string, string>();
  private tickCounter = 1;

  spawnColony(request: SpawnColonyExecutionRequest): SpawnColonyExecutionOutcome {
    let planetMap = this.coloniesByPlanet.get(request.planetId);
    if (!planetMap) {
      planetMap = new Map();
      this.coloniesByPlanet.set(request.planetId, planetMap);
    }

    const existing = planetMap.get(request.colonyId);
    if (existing && existing.status === 'ACTIVE' && existing.landingSlotId === request.landingSlotId) {
      return {
        ok: true,
        colonyId: existing.colonyId,
        appliedAtTick: existing.appliedAtTick,
        spawnTile: { q: existing.q, r: existing.r },
        duplicate: true,
      };
    }

    const slotKey = `${request.planetId}:${request.landingSlotId}`;
    const currentOccupant = this.slotOccupantByKey.get(slotKey);
    if (currentOccupant && currentOccupant !== request.colonyId) {
      return {
        ok: false,
        colonyId: request.colonyId,
        code: 'landing_site_taken',
        message: `Landing slot ${request.landingSlotId} on ${request.planetId} is already occupied by ${currentOccupant}`,
      };
    }

    const appliedAtTick = this.tickCounter++;
    planetMap.set(request.colonyId, {
      colonyId: request.colonyId,
      playerId: request.playerId,
      planetId: request.planetId,
      sectorId: request.sectorId,
      landingSlotId: request.landingSlotId,
      slotIndex: request.slotIndex,
      colonyIndex: request.colonyIndex,
      q: request.q,
      r: request.r,
      appliedAtTick,
      status: 'ACTIVE',
    });
    this.slotOccupantByKey.set(slotKey, request.colonyId);

    return {
      ok: true,
      colonyId: request.colonyId,
      appliedAtTick,
      spawnTile: { q: request.q, r: request.r },
      duplicate: false,
    };
  }

  retireColony(request: RetireColonyExecutionRequest): {
    readonly ok: boolean;
    readonly colonyId: string;
    readonly retiredAtTick: number;
    readonly reason: string;
  } {
    const planetMap = this.coloniesByPlanet.get(request.planetId);
    const existing = planetMap?.get(request.colonyId);
    const retiredAtTick = this.tickCounter++;
    const slotKey = `${request.planetId}:${request.landingSlotId}`;
    if (this.slotOccupantByKey.get(slotKey) === request.colonyId) {
      this.slotOccupantByKey.delete(slotKey);
    }
    if (planetMap && (!existing || existing.landingSlotId === request.landingSlotId)) {
      planetMap.set(request.colonyId, {
        colonyId: request.colonyId,
        playerId: existing?.playerId ?? request.playerId,
        planetId: request.planetId,
        sectorId: existing?.sectorId ?? request.sectorId,
        landingSlotId: existing?.landingSlotId ?? request.landingSlotId,
        slotIndex: existing?.slotIndex ?? request.slotIndex,
        colonyIndex: existing?.colonyIndex ?? request.colonyIndex,
        q: existing?.q ?? request.q,
        r: existing?.r ?? request.r,
        appliedAtTick: existing?.appliedAtTick ?? retiredAtTick,
        status: 'RETIRED',
        retiredReason: request.reason,
      });
    }
    return { ok: true, colonyId: request.colonyId, retiredAtTick, reason: request.reason };
  }

  getActiveColonies(planetId?: string): DefaultSimColonyState[] {
    return this.getAllColonies(planetId).filter((c) => c.status === 'ACTIVE');
  }

  getAllColonies(planetId?: string): DefaultSimColonyState[] {
    const out: DefaultSimColonyState[] = [];
    for (const [pId, map] of this.coloniesByPlanet.entries()) {
      if (planetId && pId !== planetId) continue;
      for (const col of map.values()) out.push(col);
    }
    return out;
  }
}

export function createRetireColonyCommand(params: {
  readonly colonyId: string;
  readonly colonyIndex?: number;
  readonly reason?: string;
  readonly planetId: string;
  readonly sectorId: SectorId;
  readonly landingSlotId: LandingSlotId;
  readonly slotIndex: number;
  readonly reservationId: string;
  readonly epoch: number;
}): RetireColonyCommand {
  return {
    colonyIndex: params.colonyIndex ?? params.slotIndex,
    source: 'system',
    commandId: newId('cm'),
    kind: 'system.retireColony',
    args: {
      colonyId: params.colonyId,
      reason: params.reason ?? ORPHAN_RETIRE_REASON,
      planetId: params.planetId,
      sectorId: params.sectorId,
      landingSlotId: params.landingSlotId,
      slotIndex: params.slotIndex,
      reservationId: params.reservationId,
      epoch: params.epoch,
    },
  };
}

export function buildProvisionalColonyRecord(
  reservation: ManagedSectorReservationRecord | SectorReservationRecord,
  status: 'FOUNDING' | 'ACTIVE' | 'ABANDONED' | 'RETIRED',
  options?: { readonly displayName?: string; readonly handle?: string; readonly colonyIndex?: number },
): ColonyRecord {
  const handle = options?.handle?.trim() || `Colonist-${reservation.playerId.slice(-4)}`;
  const name = options?.displayName?.trim() || `${handle.slice(0, 22)}'s Colony`;
  const colonyIndex = options?.colonyIndex ?? reservation.slotIndex;
  return {
    id: reservation.colonyId,
    playerId: reservation.playerId,
    planetId: reservation.planetId,
    colonyIndex,
    name,
    color: colonyIndex,
    status,
    state: status,
    foundingSectorId: reservation.sectorId,
    landingSlotId: reservation.landingSlotId,
    recapSeen: false,
    spawnQ: reservation.q,
    spawnR: reservation.r,
    spawn: { q: reservation.q, r: reservation.r },
    createdAt: reservation.createdAt ?? new Date(),
  };
}

export async function buildSpawnExecutionRequest(params: {
  readonly persistence: LobbyPersistenceService;
  readonly homeRepo: HomeRepository;
  readonly reservation: ManagedSectorReservationRecord;
  readonly ticket: MatchTicketRecord;
  readonly attempt: number;
  readonly maxRetries: number;
  readonly options: ExecuteSpawnSagaOptions;
}): Promise<SpawnColonyExecutionRequest> {
  const { persistence, homeRepo, reservation, ticket, attempt, maxRetries, options } = params;
  const world = await persistence.getCanonicalWorldById(reservation.planetId);
  const planet: PlanetRecord =
    (await homeRepo.findPlanetById(reservation.planetId)) ??
    (await homeRepo.upsertDevPlanet(reservation.planetId, {
      name: world?.name ?? reservation.planetId,
      type: world?.type ?? ticket.planetType,
      seed: world?.seed ?? 'w11',
      radius: W11_DEFAULT_SECTOR_RADIUS,
      state: 'ACTIVE',
      capacity: world?.capacity ?? DEV_PLANET_CAPACITY,
    }));

  const handle = options.handle?.trim() || `Colonist-${reservation.playerId.slice(-4)}`;
  const displayName = options.displayName?.trim() || `${handle.slice(0, 22)}'s Colony`;
  const colonyRecord = buildProvisionalColonyRecord(reservation, 'FOUNDING', {
    handle,
    displayName,
    colonyIndex: reservation.slotIndex,
  });
  const assignment: ColonySeatAssignment = {
    player: { id: reservation.playerId, handle },
    colony: colonyRecord,
    planet,
    slot: {
      index: reservation.slotIndex,
      q: reservation.q,
      r: reservation.r,
      sectorId: reservation.sectorId,
      landingSlotId: reservation.landingSlotId,
    },
  };
  const command = createSpawnColonyCommand(assignment);
  return {
    planetId: reservation.planetId,
    sectorId: reservation.sectorId,
    landingSlotId: reservation.landingSlotId,
    slotIndex: reservation.slotIndex,
    q: reservation.q,
    r: reservation.r,
    colonyId: reservation.colonyId,
    colonyIndex: reservation.slotIndex,
    ticketId: reservation.ticketId,
    reservationId: reservation.reservationId,
    playerId: reservation.playerId,
    handle,
    displayName,
    attempt,
    maxRetries,
    ticketAttempt: ticket.attempts,
    epoch: reservation.epoch,
    expiresAt: reservation.expiresAt,
    command,
    assignment,
    reservation,
    ticket,
    planet,
    carryOver: ticket.carryOver ?? ticket.transferCarry?.carryOver ?? null,
  };
}

async function normalizeRawSpawnOutcome(
  rawPromise: Promise<SpawnColonyExecutionOutcome | boolean | void>,
  request: SpawnColonyExecutionRequest,
): Promise<SpawnColonyExecutionOutcome> {
  const raw = await rawPromise;
  if (typeof raw === 'boolean') {
    return raw
      ? { ok: true, colonyId: request.colonyId, appliedAtTick: 1, spawnTile: { q: request.q, r: request.r } }
      : { ok: false, colonyId: request.colonyId, code: 'spawn_rejected', message: 'Spawn rejected by executor' };
  }
  if (raw === undefined || raw === null) {
    return { ok: true, colonyId: request.colonyId, appliedAtTick: 1, spawnTile: { q: request.q, r: request.r } };
  }
  return raw;
}

function dispatchToActiveSpawnExecutor(
  request: SpawnColonyExecutionRequest,
  activeExecutor: ColonySpawnExecutor | undefined,
  gamePlanets: GamePlanets | undefined,
  defaultExecutor: DefaultColonySpawnExecutor,
): Promise<SpawnColonyExecutionOutcome> {
  if (typeof activeExecutor === 'function') {
    return normalizeRawSpawnOutcome(Promise.resolve().then(() => activeExecutor(request)), request);
  }
  if (activeExecutor) {
    if (activeExecutor.spawnColony) {
      return normalizeRawSpawnOutcome(Promise.resolve().then(() => activeExecutor.spawnColony!(request)), request);
    }
    if (activeExecutor.submit) {
      return Promise.resolve()
        .then(() => activeExecutor.submit!(request.planetId, request.command))
        .then((res) => ({
          ok: res.ok,
          colonyId: request.colonyId,
          appliedAtTick: res.appliedAtTick ?? 1,
          spawnTile: { q: request.q, r: request.r },
          code: 'code' in res ? res.code : undefined,
        }));
    }
    if (activeExecutor.onColonySeated) {
      return Promise.resolve()
        .then(() => activeExecutor.onColonySeated!(request.assignment))
        .then(() => ({ ok: true, colonyId: request.colonyId, appliedAtTick: 1, spawnTile: { q: request.q, r: request.r } }));
    }
  }
  if (gamePlanets && gamePlanets.isLoaded(request.planetId)) {
    return gamePlanets.submit(request.planetId, request.command).then((res) => ({
      ok: res.ok,
      colonyId: request.colonyId,
      appliedAtTick: res.appliedAtTick ?? 1,
      spawnTile: { q: request.q, r: request.r },
      code: res.ok ? undefined : res.code,
    }));
  }
  return Promise.resolve(defaultExecutor.spawnColony(request));
}

export async function invokeSpawnExecutorWithTimeout(params: {
  readonly request: SpawnColonyExecutionRequest;
  readonly activeExecutor: ColonySpawnExecutor | undefined;
  readonly gamePlanets: GamePlanets | undefined;
  readonly defaultExecutor: DefaultColonySpawnExecutor;
  readonly spawnTimeoutMs?: number;
}): Promise<AttemptExecutionResult> {
  const timeoutMs = Math.max(5, params.spawnTimeoutMs ?? DEFAULT_SPAWN_TIMEOUT_MS);
  const inFlightPromise = dispatchToActiveSpawnExecutor(
    params.request,
    params.activeExecutor,
    params.gamePlanets,
    params.defaultExecutor,
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutRace = new Promise<typeof SPAWN_ATTEMPT_TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(SPAWN_ATTEMPT_TIMED_OUT), timeoutMs);
  });

  try {
    const raced = await Promise.race([inFlightPromise, timeoutRace]);
    if (raced === SPAWN_ATTEMPT_TIMED_OUT) {
      return {
        ok: false,
        timedOut: true,
        appliedAtTick: null,
        code: 'spawn_timeout',
        error: `spawnColony timed out after ${timeoutMs}ms for colony ${params.request.colonyId}`,
        inFlightPromise,
      };
    }
    if (!raced.ok) {
      return {
        ok: false,
        timedOut: false,
        appliedAtTick: raced.appliedAtTick ?? null,
        code: raced.code ?? 'spawn_rejected',
        error: raced.message ?? `spawnColony rejected (${raced.code ?? 'spawn_rejected'})`,
      };
    }
    params.defaultExecutor.spawnColony(params.request);
    return { ok: true, timedOut: false, appliedAtTick: raced.appliedAtTick ?? 1, code: 'ok', error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const code =
      typeof err === 'object' && err !== null && 'code' in err && typeof (err as { code?: unknown }).code === 'string'
        ? (err as { code: string }).code
        : 'spawn_error';
    return {
      ok: false,
      timedOut: code.includes('timeout') || message.toLowerCase().includes('timeout'),
      appliedAtTick: null,
      code,
      error: message,
    };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export async function invokeRetireColonyExecutor(params: {
  readonly request: RetireColonyExecutionRequest;
  readonly activeExecutor: ColonySpawnExecutor | undefined;
  readonly gamePlanets: GamePlanets | undefined;
  readonly defaultExecutor: DefaultColonySpawnExecutor;
  readonly onRetireColony?: (req: RetireColonyExecutionRequest) => Promise<void> | void;
}): Promise<void> {
  const { request, activeExecutor, gamePlanets, defaultExecutor, onRetireColony } = params;
  defaultExecutor.retireColony(request);
  if (onRetireColony) await onRetireColony(request);
  if (typeof activeExecutor === 'object' && activeExecutor !== null) {
    if (activeExecutor.retireColony) {
      await activeExecutor.retireColony(request);
      return;
    }
    if (activeExecutor.submit) {
      await activeExecutor.submit(request.planetId, request.command);
      return;
    }
  }
  if (gamePlanets && gamePlanets.isLoaded(request.planetId)) {
    await gamePlanets.submit(request.planetId, request.command as unknown as SimCommandV1);
  }
}

export async function upsertActiveColonyInHomeRepo(
  homeRepo: HomeRepository,
  reservation: ManagedSectorReservationRecord,
  options?: { readonly handle?: string; readonly displayName?: string },
): Promise<ColonyRecord> {
  const existingById = await homeRepo.findColonyById(reservation.colonyId);
  if (existingById) {
    if (
      existingById.status === 'ACTIVE' &&
      existingById.foundingSectorId === reservation.sectorId &&
      existingById.landingSlotId === reservation.landingSlotId
    ) {
      return existingById;
    }
    await homeRepo.deleteColony(reservation.colonyId);
  }
  const onPlanet = await homeRepo.listColoniesByPlanetId(reservation.planetId);
  for (const col of onPlanet) {
    if (col.colonyIndex === reservation.slotIndex && (col.status === 'ABANDONED' || col.status === 'RETIRED')) {
      await homeRepo.deleteColony(col.id);
    }
  }
  const refreshed = await homeRepo.listColoniesByPlanetId(reservation.planetId);
  const usedIndices = new Set(refreshed.map((c) => c.colonyIndex));
  let colonyIndex = reservation.slotIndex;
  if (usedIndices.has(colonyIndex)) {
    colonyIndex = 0;
    while (usedIndices.has(colonyIndex)) colonyIndex++;
  }
  const handle = options?.handle?.trim() || `Colonist-${reservation.playerId.slice(-4)}`;
  const name = options?.displayName?.trim() || `${handle.slice(0, 22)}'s Colony`;
  const { colony } = await homeRepo.createColony({
    id: reservation.colonyId,
    playerId: reservation.playerId,
    planetId: reservation.planetId,
    colonyIndex,
    name,
    color: colonyIndex,
    status: 'ACTIVE',
    foundingSectorId: reservation.sectorId,
    landingSlotId: reservation.landingSlotId,
    spawnQ: reservation.q,
    spawnR: reservation.r,
  });
  return colony;
}

export async function resolveReservationAndTicket(
  persistence: LobbyPersistenceService,
  input: SpawnSagaInput,
): Promise<{
  readonly reservation: ManagedSectorReservationRecord | null;
  readonly ticket: MatchTicketRecord | null;
}> {
  if (typeof input === 'string') {
    const byResId = await persistence.getReservationById(input);
    if (byResId) {
      return { reservation: toManagedReservationRecord(byResId), ticket: await persistence.getTicketById(byResId.ticketId) };
    }
    const byTicketId = await persistence.getReservationByTicketId(input);
    return { reservation: byTicketId ? toManagedReservationRecord(byTicketId) : null, ticket: await persistence.getTicketById(input) };
  }
  if ('reservationId' in input && typeof input.reservationId === 'string' && 'sectorId' in input) {
    const record = input as SectorReservationRecord;
    const latest = (await persistence.getReservationById(record.reservationId)) ?? record;
    return { reservation: toManagedReservationRecord(latest), ticket: await persistence.getTicketById(latest.ticketId) };
  }
  if ('mode' in input && 'sectorIntent' in input && typeof input.id === 'string') {
    const ticket = (await persistence.getTicketById(input.id)) ?? input;
    const res = await persistence.getReservationByTicketId(ticket.id);
    return { reservation: res ? toManagedReservationRecord(res) : null, ticket };
  }
  const wrapper = input as {
    readonly reservationId?: string;
    readonly ticketId?: string;
    readonly reservation?: SectorReservationRecord;
    readonly ticket?: MatchTicketRecord | null;
  };
  const resRecord =
    wrapper.reservation ??
    (wrapper.reservationId ? await persistence.getReservationById(wrapper.reservationId) : null) ??
    (wrapper.ticketId ? await persistence.getReservationByTicketId(wrapper.ticketId) : null);
  const ticketId = wrapper.ticket?.id ?? wrapper.ticketId ?? resRecord?.ticketId;
  const ticket = ticketId ? await persistence.getTicketById(ticketId) : (wrapper.ticket ?? null);
  return { reservation: resRecord ? toManagedReservationRecord(resRecord) : null, ticket };
}

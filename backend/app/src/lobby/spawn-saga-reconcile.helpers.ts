import type { SimCommandV1 } from '@terra/contracts';
import type { ColonyRecord, HomeRepository } from '../core/home/home.repository';
import type { GamePlanets } from '../game/game-planets.service';
import type { LobbyPersistenceService } from './lobby-persistence.service';
import type { MatchTicketRecord } from './lobby-persistence.types';
import { toManagedReservationRecord } from './reservation.helpers';
import type { SectorReservationService } from './reservation.service';
import type { ManagedSectorReservationRecord } from './reservation.types';
import type { NormalizedReconcileTarget, SpawnSagaStateStore } from './spawn-saga-state';
import {
  buildProvisionalColonyRecord,
  createRetireColonyCommand,
  invokeRetireColonyExecutor,
  upsertActiveColonyInHomeRepo,
} from './spawn-saga.helpers';
import {
  DEFAULT_MAX_TICKET_ATTEMPTS,
  ORPHAN_RETIRE_REASON,
  SPAWN_FAILED_CODE,
  type ColonySpawnExecutor,
  type ExecuteSpawnSagaOptions,
  type ReconciledOrphanColonyRecord,
  type ReconcileOrphanColonyInput,
  type ReconcileOrphanColonyResult,
  type RetireColonyCommand,
  type RetireColonyExecutionRequest,
  type SpawnSagaOutcome,
} from './spawn-saga.types';

export function resolveSagaClock(now?: Date | (() => Date)): () => Date {
  if (typeof now === 'function') return now;
  if (now instanceof Date) return () => now;
  return () => new Date();
}

export async function releaseAndTransitionTicketOnExpiryHelper(params: {
  readonly persistence: LobbyPersistenceService;
  readonly reservations: SectorReservationService;
  readonly state: SpawnSagaStateStore;
  readonly reservation: ManagedSectorReservationRecord;
  readonly maxTicketAttempts: number;
}): Promise<MatchTicketRecord | null> {
  const { persistence, reservations, state, reservation, maxTicketAttempts } = params;
  const beforeTicket = await persistence.getTicketById(reservation.ticketId);
  const alreadyProcessed = state.processedExpiryByReservationId.has(reservation.reservationId);
  const currentRes = await persistence.getReservationById(reservation.reservationId);
  const wasAlreadyExpiredInStore = !currentRes || currentRes.state === 'EXPIRED';

  if (currentRes && currentRes.state === 'HELD') {
    await reservations.expireReservation(reservation.reservationId);
  }

  let ticket = await persistence.getTicketById(reservation.ticketId);
  if (!ticket) return null;

  if (!alreadyProcessed) {
    state.processedExpiryByReservationId.add(reservation.reservationId);
    state.reservationsExpiredCount++;
    const ticketStillOnThisReservation =
      ticket.state !== 'ASSIGNED' &&
      (!ticket.reservedLandingSlotId || ticket.reservedLandingSlotId === reservation.landingSlotId);
    if (ticketStillOnThisReservation) {
      const beforeAttempts = beforeTicket?.attempts ?? ticket.attempts;
      const nextAttempts =
        ticket.attempts > beforeAttempts
          ? ticket.attempts
          : wasAlreadyExpiredInStore && ticket.attempts > 0
            ? ticket.attempts
            : beforeAttempts + 1;
      const isFailed = nextAttempts >= maxTicketAttempts;
      if (isFailed) state.spawnsFailedCount++;
      if (isFailed || ticket.state !== 'QUEUED' || ticket.attempts !== nextAttempts) {
        ticket = await persistence.updateTicket(ticket.id, {
          state: isFailed ? 'FAILED' : 'QUEUED',
          attempts: nextAttempts,
          failureCode: isFailed ? SPAWN_FAILED_CODE : null,
          reservedPlanetId: null,
          reservedSectorId: null,
          reservedLandingSlotId: null,
          reservationEpoch: null,
          reservationExpiresAt: null,
        });
      }
    }
  }
  return ticket;
}

export async function expireAndFenceReservationHelper(params: {
  readonly persistence: LobbyPersistenceService;
  readonly reservations: SectorReservationService;
  readonly homeRepo: HomeRepository;
  readonly state: SpawnSagaStateStore;
  readonly reservation: ManagedSectorReservationRecord;
  readonly ticket: MatchTicketRecord | null;
  readonly now: Date;
  readonly reason: 'expired' | 'cancelled' | 'retries_exhausted';
  readonly attemptsUsed: number;
  readonly backoffDelaysMs: readonly number[];
  readonly spawnCommand: SimCommandV1 | null;
  readonly error: string;
  readonly maxTicketAttempts: number;
  readonly options: ExecuteSpawnSagaOptions;
}): Promise<SpawnSagaOutcome> {
  const { persistence, reservations, homeRepo, state, reservation, now, reason, attemptsUsed, backoffDelaysMs, spawnCommand, error, maxTicketAttempts, options } = params;
  const abandonedColony = state.recordFenceAndAbandonedColony(reservation, now, reason, options);
  const existingHomeColony = await homeRepo.findColonyById(reservation.colonyId);
  if (existingHomeColony && (existingHomeColony.status !== 'ACTIVE' || existingHomeColony.landingSlotId === reservation.landingSlotId)) {
    await homeRepo.deleteColony(reservation.colonyId);
  }
  const updatedTicket = await releaseAndTransitionTicketOnExpiryHelper({ persistence, reservations, state, reservation, maxTicketAttempts });
  const latestRes = await persistence.getReservationById(reservation.reservationId);
  const managedRes: ManagedSectorReservationRecord = latestRes ? toManagedReservationRecord(latestRes, 'EXPIRED') : { ...reservation, state: 'EXPIRED' };
  const ticketFailed = updatedTicket?.state === 'FAILED';

  return {
    ok: false,
    status: ticketFailed ? 'failed' : 'expired',
    duplicateAck: false,
    idempotent: false,
    orphanReconciled: false,
    requeued: updatedTicket?.state === 'QUEUED',
    ticketFailed,
    attemptsUsed,
    ticketAttempts: updatedTicket?.attempts ?? (params.ticket?.attempts ?? 0),
    backoffDelaysMs,
    appliedAtTick: null,
    colonyId: reservation.colonyId,
    planetId: reservation.planetId,
    sectorId: reservation.sectorId,
    landingSlotId: reservation.landingSlotId,
    colony: abandonedColony,
    reservation: managedRes,
    ticket: updatedTicket,
    spawnCommand,
    retireCommand: null,
    failureCode: ticketFailed ? SPAWN_FAILED_CODE : null,
    error,
  };
}

export function buildSyntheticReservationFromTarget(
  target: NormalizedReconcileTarget,
): ManagedSectorReservationRecord {
  return {
    id: target.reservationId,
    reservationId: target.reservationId,
    ticketId: target.ticketId,
    playerId: target.playerId,
    planetId: target.planetId,
    sectorId: target.sectorId,
    landingSlotId: target.landingSlotId,
    slotIndex: target.slotIndex,
    q: target.q,
    r: target.r,
    colonyId: target.colonyId,
    state: 'EXPIRED',
    epoch: target.epoch,
    expiresAt: new Date(0).toISOString(),
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

export function buildCommittedOutcomeRecord(params: {
  readonly committed: ManagedSectorReservationRecord;
  readonly colony: ColonyRecord;
  readonly assignedTicket: MatchTicketRecord | null;
  readonly fallbackAttempts: number;
  readonly attemptsUsed: number;
  readonly backoffDelaysMs: readonly number[];
  readonly appliedAtTick: number;
  readonly spawnCommand: SimCommandV1;
}): SpawnSagaOutcome {
  return {
    ok: true,
    status: 'committed',
    duplicateAck: false,
    idempotent: false,
    orphanReconciled: false,
    requeued: false,
    ticketFailed: false,
    attemptsUsed: params.attemptsUsed,
    ticketAttempts: params.assignedTicket?.attempts ?? params.fallbackAttempts,
    backoffDelaysMs: params.backoffDelaysMs,
    appliedAtTick: params.appliedAtTick,
    colonyId: params.committed.colonyId,
    planetId: params.committed.planetId,
    sectorId: params.committed.sectorId,
    landingSlotId: params.committed.landingSlotId,
    colony: params.colony,
    reservation: params.committed,
    ticket: params.assignedTicket,
    spawnCommand: params.spawnCommand,
    retireCommand: null,
    failureCode: null,
    error: null,
  };
}

export function buildAlreadyReconciledResult(params: {
  readonly existing: ReconciledOrphanColonyRecord;
  readonly colony: ColonyRecord | null;
  readonly ticket: MatchTicketRecord | null;
  readonly orphanColoniesReconciled: number;
}): ReconcileOrphanColonyResult {
  const { existing, colony, ticket, orphanColoniesReconciled } = params;
  return {
    reconciled: true,
    alreadyReconciled: true,
    duplicateAck: true,
    status: 'reconciled_orphan',
    colonyId: existing.colonyId,
    planetId: existing.planetId,
    sectorId: existing.sectorId,
    landingSlotId: existing.landingSlotId,
    reason: existing.reason,
    colony,
    ticket,
    reservation: null,
    retireCommand: existing.command,
    orphanColoniesReconciled,
  };
}

function createRetireRequestForTarget(target: NormalizedReconcileTarget): {
  readonly command: RetireColonyCommand;
  readonly retireRequest: RetireColonyExecutionRequest;
} {
  const command: RetireColonyCommand = createRetireColonyCommand({
    colonyId: target.colonyId,
    colonyIndex: target.slotIndex,
    reason: target.reason,
    planetId: target.planetId,
    sectorId: target.sectorId,
    landingSlotId: target.landingSlotId,
    slotIndex: target.slotIndex,
    reservationId: target.reservationId,
    epoch: target.epoch,
  });
  const retireRequest: RetireColonyExecutionRequest = {
    planetId: target.planetId,
    sectorId: target.sectorId,
    landingSlotId: target.landingSlotId,
    slotIndex: target.slotIndex,
    q: target.q,
    r: target.r,
    colonyId: target.colonyId,
    colonyIndex: target.slotIndex,
    ticketId: target.ticketId,
    reservationId: target.reservationId,
    playerId: target.playerId,
    epoch: target.epoch,
    reason: target.reason,
    command,
  };
  return { command, retireRequest };
}

export async function executeOrphanReconciliationHelper(params: {
  readonly persistence: LobbyPersistenceService;
  readonly reservations: SectorReservationService;
  readonly homeRepo: HomeRepository;
  readonly state: SpawnSagaStateStore;
  readonly gamePlanets: GamePlanets | undefined;
  readonly defaultSpawnExecutor: ColonySpawnExecutor | undefined;
  readonly target: NormalizedReconcileTarget;
  readonly reconcileKey: string;
  readonly options: ExecuteSpawnSagaOptions;
}): Promise<ReconcileOrphanColonyResult> {
  const { persistence, reservations, homeRepo, state, gamePlanets, defaultSpawnExecutor, target, reconcileKey, options } = params;
  const getNow = resolveSagaClock(options.now);
  const maxTicketAttempts = Math.max(1, options.maxTicketAttempts ?? DEFAULT_MAX_TICKET_ATTEMPTS);
  const persistedRes = target.reservationId ? await persistence.getReservationById(target.reservationId) : null;

  if (persistedRes && persistedRes.state === 'HELD') {
    await expireAndFenceReservationHelper({
      persistence,
      reservations,
      homeRepo,
      state,
      reservation: toManagedReservationRecord(persistedRes),
      ticket: await persistence.getTicketById(persistedRes.ticketId),
      now: getNow(),
      reason: 'expired',
      attemptsUsed: 1,
      backoffDelaysMs: [],
      spawnCommand: null,
      error: 'Late spawn after reservation expiry',
      maxTicketAttempts,
      options,
    });
  }

  const { command, retireRequest } = createRetireRequestForTarget(target);
  const activeExecutor = options.executor ?? options.spawnExecutor ?? defaultSpawnExecutor;
  await invokeRetireColonyExecutor({
    request: retireRequest,
    activeExecutor,
    gamePlanets,
    defaultExecutor: state.defaultExecutor,
    onRetireColony: options.onRetireColony,
  });
  state.retireCommandsSent.push(command);

  const existingHomeColony = await homeRepo.findColonyById(target.colonyId);
  if (
    existingHomeColony &&
    (existingHomeColony.status !== 'ACTIVE' ||
      existingHomeColony.landingSlotId === target.landingSlotId)
  ) {
    await homeRepo.deleteColony(target.colonyId);
  }

  const syntheticRes = buildSyntheticReservationFromTarget(target);
  const abandonedColony = buildProvisionalColonyRecord(syntheticRes, 'ABANDONED', options);
  if (!existingHomeColony || existingHomeColony.landingSlotId === target.landingSlotId) {
    state.provisionalColoniesById.set(target.colonyId, abandonedColony);
    state.committedOutcomeByColonyId.delete(target.colonyId);
  }
  state.clearPendingLateSpawn(syntheticRes);

  const record: ReconciledOrphanColonyRecord = {
    ...target,
    command,
    reconciledAt: getNow(),
  };
  state.reconciledOrphanByKey.set(reconcileKey, record);
  state.reconciledOrphanByColonyId.set(target.colonyId, record);

  const ticket = target.ticketId ? await persistence.getTicketById(target.ticketId) : null;
  return {
    reconciled: true,
    alreadyReconciled: false,
    duplicateAck: false,
    status: 'reconciled_orphan',
    colonyId: target.colonyId,
    planetId: target.planetId,
    sectorId: target.sectorId,
    landingSlotId: target.landingSlotId,
    reason: target.reason,
    colony: abandonedColony,
    ticket,
    reservation: persistedRes ? toManagedReservationRecord(persistedRes, 'EXPIRED') : syntheticRes,
    retireCommand: command,
    orphanColoniesReconciled: state.reconciledOrphanByKey.size,
  };
}

async function handleExpiredDuringSpawnAttempt(params: {
  readonly persistence: LobbyPersistenceService;
  readonly reservations: SectorReservationService;
  readonly homeRepo: HomeRepository;
  readonly state: SpawnSagaStateStore;
  readonly reservation: ManagedSectorReservationRecord;
  readonly ticket: MatchTicketRecord;
  readonly now: Date;
  readonly attemptsUsed: number;
  readonly backoffDelaysMs: readonly number[];
  readonly appliedAtTick: number;
  readonly spawnCommand: SimCommandV1;
  readonly maxTicketAttempts: number;
  readonly options: ExecuteSpawnSagaOptions;
  readonly reconcileOrphan: (
    input: ReconcileOrphanColonyInput,
    options: ExecuteSpawnSagaOptions,
  ) => Promise<ReconcileOrphanColonyResult>;
}): Promise<SpawnSagaOutcome> {
  const {
    persistence,
    reservations,
    homeRepo,
    state,
    reservation,
    ticket,
    now,
    attemptsUsed,
    backoffDelaysMs,
    appliedAtTick,
    spawnCommand,
    maxTicketAttempts,
    options,
    reconcileOrphan,
  } = params;
  const expiredOutcome = await expireAndFenceReservationHelper({
    persistence,
    reservations,
    homeRepo,
    state,
    reservation,
    ticket,
    now,
    reason: 'expired',
    attemptsUsed,
    backoffDelaysMs,
    spawnCommand,
    error: 'Reservation expired while spawnColony was in flight',
    maxTicketAttempts,
    options,
  });
  const reconciled = await reconcileOrphan(
    {
      colonyId: reservation.colonyId,
      reservationId: reservation.reservationId,
      ticketId: reservation.ticketId,
      playerId: reservation.playerId,
      planetId: reservation.planetId,
      sectorId: reservation.sectorId,
      landingSlotId: reservation.landingSlotId,
      slotIndex: reservation.slotIndex,
      q: reservation.q,
      r: reservation.r,
      epoch: reservation.epoch,
      appliedAtTick,
      reason: ORPHAN_RETIRE_REASON,
    },
    options,
  );
  return {
    ...expiredOutcome,
    status: 'reconciled_orphan',
    orphanReconciled: true,
    appliedAtTick,
    colony: reconciled.colony,
    retireCommand: reconciled.retireCommand,
  };
}

export async function finalizeSuccessfulSpawnAttemptHelper(params: {
  readonly persistence: LobbyPersistenceService;
  readonly reservations: SectorReservationService;
  readonly homeRepo: HomeRepository;
  readonly state: SpawnSagaStateStore;
  readonly reservation: ManagedSectorReservationRecord;
  readonly ticket: MatchTicketRecord;
  readonly getNow: () => Date;
  readonly attemptsUsed: number;
  readonly backoffDelaysMs: readonly number[];
  readonly appliedAtTick: number;
  readonly spawnCommand: SimCommandV1;
  readonly maxTicketAttempts: number;
  readonly options: ExecuteSpawnSagaOptions;
  readonly reconcileOrphan: (
    input: ReconcileOrphanColonyInput,
    options: ExecuteSpawnSagaOptions,
  ) => Promise<ReconcileOrphanColonyResult>;
}): Promise<SpawnSagaOutcome> {
  const { persistence, reservations, homeRepo, state, reservation, ticket, getNow, attemptsUsed, backoffDelaysMs, appliedAtTick, spawnCommand, options } = params;
  if (await state.isReservationFencedOrExpired(persistence, reservation, getNow())) {
    return handleExpiredDuringSpawnAttempt({ ...params, now: getNow() });
  }

  let committed: ManagedSectorReservationRecord | null = null;
  try {
    committed = await reservations.commitReservation(reservation.reservationId, {
      expectedEpoch: reservation.epoch,
      now: getNow(),
    });
  } catch {
    committed = null;
  }
  if (!committed) {
    return handleExpiredDuringSpawnAttempt({
      ...params,
      now: new Date(Date.parse(reservation.expiresAt) + 1),
    });
  }

  state.clearPendingLateSpawn(reservation);
  const colony = await upsertActiveColonyInHomeRepo(homeRepo, committed, options);
  state.provisionalColoniesById.set(colony.id, colony);
  const assignedTicket = await persistence.getTicketById(committed.ticketId);
  state.spawnsCommittedCount++;

  const outcome = buildCommittedOutcomeRecord({
    committed,
    colony,
    assignedTicket,
    fallbackAttempts: ticket.attempts,
    attemptsUsed,
    backoffDelaysMs,
    appliedAtTick,
    spawnCommand,
  });
  state.committedOutcomeByColonyId.set(committed.colonyId, outcome);
  return outcome;
}

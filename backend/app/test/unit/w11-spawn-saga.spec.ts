import { describe, expect, it } from 'vitest';
import { CANONICAL_PLANETS } from '@terra/contracts';
import { HomeRepository } from '../../src/core/home/home.repository';
import {
  DEFAULT_SPAWN_RETRY_BACKOFF_MS,
  LobbyPersistenceService,
  MatchmakerService,
  MemoryLobbyStore,
  ORPHAN_RETIRE_REASON,
  SPAWN_FAILED_CODE,
  SectorReservationService,
  SpawnSagaService,
  WorldLifecycleService,
  type PlanetSectorRecord,
  type SpawnColonyExecutionRequest,
} from '../../src/lobby';

interface TestHarness {
  readonly store: MemoryLobbyStore;
  readonly persistence: LobbyPersistenceService;
  readonly lifecycle: WorldLifecycleService;
  readonly reservations: SectorReservationService;
  readonly matchmaker: MatchmakerService;
  readonly homeRepo: HomeRepository;
  readonly saga: SpawnSagaService;
  readonly planetId: string;
  readonly landSectors: readonly PlanetSectorRecord[];
}

async function createSpawnSagaHarness(foundingSeatsPerSector = 4): Promise<TestHarness> {
  const store = new MemoryLobbyStore();
  const persistence = new LobbyPersistenceService(undefined, undefined, store);
  const lifecycle = new WorldLifecycleService(persistence);
  const reservations = new SectorReservationService(persistence, lifecycle);
  const matchmaker = new MatchmakerService(persistence, reservations, lifecycle);
  const homeRepo = new HomeRepository();
  const saga = new SpawnSagaService(persistence, reservations, homeRepo, lifecycle);

  await persistence.provisionAllCanonicalWorlds({
    foundingSeatsPerSector,
    validatedSeatsPerSector: foundingSeatsPerSector,
  });
  const planetId = CANONICAL_PLANETS.temperate.id;
  const sectors = await persistence.listSectors(planetId);
  const landSectors = sectors.filter((s) => s.kind === 'land');

  return {
    store,
    persistence,
    lifecycle,
    reservations,
    matchmaker,
    homeRepo,
    saga,
    planetId,
    landSectors,
  };
}

describe('W11-13 — 1. Happy path & duplicate ack idempotency (MM-35, MM-36)', () => {
  it('transitions HELD -> SPAWNING -> COMMITTED, activates 1 colony in HomeRepository, and treats duplicate calls/acks as no-ops', async () => {
    const { persistence, reservations, homeRepo, saga, planetId, landSectors } =
      await createSpawnSagaHarness(4);
    const targetSector = landSectors[0]!;

    const { ticket } = await persistence.enqueueTicket({
      playerId: 'player_happy_1',
      idempotencyKey: 'idem_happy_1',
      request: {
        mode: 'JOIN_PLANET',
        planetType: 'temperate',
        sectorId: targetSector.sectorId,
      },
    });

    const reserved = await reservations.reserveSlotForTicket(ticket);
    expect(reserved.ok).toBe(true);
    if (!reserved.ok) throw new Error('Expected reservation to succeed');
    expect(reserved.reservation.state).toBe('HELD');

    const observedStatesDuringSpawn: string[] = [];
    const outcome = await saga.executeSpawnForReservation(reserved.reservation, {
      executor: async (req: SpawnColonyExecutionRequest) => {
        const inFlight = await reservations.getReservationById(req.reservationId);
        if (inFlight) observedStatesDuringSpawn.push(inFlight.state);
        return {
          ok: true,
          colonyId: req.colonyId,
          appliedAtTick: 12,
          spawnTile: { q: req.q, r: req.r },
        };
      },
    });

    expect(observedStatesDuringSpawn).toEqual(['SPAWNING']);
    expect(outcome.ok).toBe(true);
    expect(outcome.status).toBe('committed');
    expect(outcome.duplicateAck).toBe(false);
    expect(outcome.attemptsUsed).toBe(1);
    expect(outcome.reservation.state).toBe('COMMITTED');
    expect(outcome.ticket?.state).toBe('ASSIGNED');
    expect(outcome.ticket?.colonyId).toBe(reserved.reservation.colonyId);

    const colony = await homeRepo.findColonyById(reserved.reservation.colonyId);
    expect(colony).not.toBeNull();
    expect(colony?.status).toBe('ACTIVE');
    expect(colony?.foundingSectorId).toBe(targetSector.sectorId);
    expect(colony?.landingSlotId).toBe(reserved.reservation.landingSlotId);
    expect(colony?.spawnQ).toBe(reserved.reservation.q);
    expect(colony?.spawnR).toBe(reserved.reservation.r);

    const sectorAfterCommit = await persistence.getSector(planetId, targetSector.sectorId);
    expect(sectorAfterCommit?.foundedSeats).toBe(1);
    expect(sectorAfterCommit?.reservedSeats).toBe(0);

    let duplicateExecutorCalls = 0;
    const dupOutcome = await saga.executeSpawnForReservation(reserved.reservation, {
      executor: () => {
        duplicateExecutorCalls++;
        return { ok: true };
      },
    });
    expect(dupOutcome.ok).toBe(true);
    expect(dupOutcome.status).toBe('committed');
    expect(dupOutcome.duplicateAck).toBe(true);
    expect(dupOutcome.idempotent).toBe(true);
    expect(duplicateExecutorCalls).toBe(0);

    const dupAck = await saga.handleLateSpawnAck(reserved.reservation.colonyId);
    expect(dupAck.reconciled).toBe(false);
    expect(dupAck.duplicateAck).toBe(true);
    expect(dupAck.status).toBe('committed');

    const sectorAfterDup = await persistence.getSector(planetId, targetSector.sectorId);
    expect(sectorAfterDup?.foundedSeats).toBe(1);
    const allPlayerColonies = (await homeRepo.listColoniesByPlanetId(planetId)).filter(
      (c) => c.playerId === 'player_happy_1',
    );
    expect(allPlayerColonies).toHaveLength(1);
  });
});

describe('W11-13 — 2a. Bounded retries within TTL (MM-37)', () => {
  it('retries transient failure on attempt 1 and succeeds on retry 2 with same colonyId, sectorId, and landingSlotId', async () => {
    const { persistence, reservations, homeRepo, saga, planetId, landSectors } =
      await createSpawnSagaHarness(4);
    const targetSector = landSectors[0]!;

    const { ticket } = await persistence.enqueueTicket({
      playerId: 'player_retry_ok',
      idempotencyKey: 'idem_retry_ok',
      request: {
        mode: 'JOIN_PLANET',
        planetType: 'temperate',
        sectorId: targetSector.sectorId,
      },
    });

    const reserved = await reservations.reserveSlotForTicket(ticket);
    expect(reserved.ok).toBe(true);
    if (!reserved.ok) throw new Error('Expected reservation to succeed');

    const attemptedRequests: SpawnColonyExecutionRequest[] = [];
    const recordedSleeps: Array<{ delayMs: number; attempt: number }> = [];

    const outcome = await saga.executeSpawnForReservation(reserved.reservation, {
      sleepFn: (delayMs, attempt) => {
        recordedSleeps.push({ delayMs, attempt });
      },
      executor: (req) => {
        attemptedRequests.push(req);
        if (req.attempt === 1) {
          throw new Error('Transient sim RPC timeout on attempt 1');
        }
        return {
          ok: true,
          colonyId: req.colonyId,
          appliedAtTick: 25,
          spawnTile: { q: req.q, r: req.r },
        };
      },
    });

    expect(outcome.ok).toBe(true);
    expect(outcome.status).toBe('committed');
    expect(outcome.attemptsUsed).toBe(2);
    expect(outcome.backoffDelaysMs).toEqual([DEFAULT_SPAWN_RETRY_BACKOFF_MS[0]]);
    expect(recordedSleeps).toEqual([{ delayMs: 1_000, attempt: 1 }]);
    expect(attemptedRequests).toHaveLength(2);
    expect(attemptedRequests[0]!.colonyId).toBe(attemptedRequests[1]!.colonyId);
    expect(attemptedRequests[0]!.sectorId).toBe(attemptedRequests[1]!.sectorId);
    expect(attemptedRequests[0]!.landingSlotId).toBe(attemptedRequests[1]!.landingSlotId);

    const colonies = await homeRepo.listColoniesByPlanetId(planetId);
    expect(
      colonies.filter((c) => c.playerId === 'player_retry_ok' && c.status === 'ACTIVE'),
    ).toHaveLength(1);
  });
});

describe('W11-13 — 2b. Persistent timeout requeues ticket and fails after 3 cycles (MM-37)', () => {
  it('expires reservation on exhausted retries, requeues ticket preserving createdAt, and transitions to FAILED (spawn_failed) after 3 cycles', async () => {
    const { persistence, reservations, homeRepo, saga, planetId, landSectors } =
      await createSpawnSagaHarness(4);
    const targetSector = landSectors[0]!;

    const { ticket: initialTicket } = await persistence.enqueueTicket({
      playerId: 'player_fail_3',
      idempotencyKey: 'idem_fail_3',
      request: {
        mode: 'JOIN_PLANET',
        planetType: 'temperate',
        sectorId: targetSector.sectorId,
      },
    });
    const originalCreatedAt = initialTicket.createdAt;

    for (let cycle = 1; cycle <= 2; cycle++) {
      const currentTicket = (await persistence.getTicketById(initialTicket.id))!;
      const res = await reservations.reserveSlotForTicket(currentTicket);
      expect(res.ok).toBe(true);
      if (!res.ok) throw new Error(`Expected reservation in cycle ${cycle}`);

      const sleeps: number[] = [];
      const outcome = await saga.executeSpawnForReservation(res.reservation, {
        sleepFn: (delayMs) => {
          sleeps.push(delayMs);
        },
        executor: () => ({
          ok: false,
          code: 'spawn_timeout',
          message: 'Persistent sim timeout',
        }),
      });

      expect(outcome.ok).toBe(false);
      expect(outcome.status).toBe('expired');
      expect(outcome.requeued).toBe(true);
      expect(outcome.ticketFailed).toBe(false);
      expect(outcome.attemptsUsed).toBe(3);
      expect(sleeps).toEqual([1_000, 2_000]);
      expect(outcome.reservation.state).toBe('EXPIRED');
      expect(outcome.colony?.status).toBe('ABANDONED');
      expect(outcome.ticket?.state).toBe('QUEUED');
      expect(outcome.ticket?.attempts).toBe(cycle);
      expect(outcome.ticket?.createdAt).toBe(originalCreatedAt);
    }

    const ticketBeforeCycle3 = (await persistence.getTicketById(initialTicket.id))!;
    expect(ticketBeforeCycle3.attempts).toBe(2);
    const res3 = await reservations.reserveSlotForTicket(ticketBeforeCycle3);
    expect(res3.ok).toBe(true);
    if (!res3.ok) throw new Error('Expected reservation in cycle 3');

    const finalOutcome = await saga.executeSpawnForReservation(res3.reservation, {
      executor: () => ({
        ok: false,
        code: 'spawn_timeout',
        message: 'Persistent sim timeout on 3rd cycle',
      }),
    });

    expect(finalOutcome.ok).toBe(false);
    expect(finalOutcome.status).toBe('failed');
    expect(finalOutcome.ticketFailed).toBe(true);
    expect(finalOutcome.requeued).toBe(false);
    expect(finalOutcome.failureCode).toBe(SPAWN_FAILED_CODE);
    expect(finalOutcome.ticket?.state).toBe('FAILED');
    expect(finalOutcome.ticket?.attempts).toBe(3);
    expect(finalOutcome.ticket?.failureCode).toBe('spawn_failed');

    const activeColonies = (await homeRepo.listColoniesByPlanetId(planetId)).filter(
      (c) => c.playerId === 'player_fail_3' && c.status === 'ACTIVE',
    );
    expect(activeColonies).toHaveLength(0);
    const sectorAfter3Failures = await persistence.getSector(planetId, targetSector.sectorId);
    expect(sectorAfter3Failures?.reservedSeats).toBe(0);
    expect(sectorAfter3Failures?.foundedSeats).toBe(0);
  });
});

describe('W11-13 — 3a. Acceptance Check: Late spawn after in-flight expiry (MM-38 E7)', () => {
  it('reconciles late spawn after expiry via system.retireColony without duplicate colony or reused occupied slot', async () => {
    const { persistence, reservations, homeRepo, saga, planetId, landSectors } =
      await createSpawnSagaHarness(4);
    const targetSector = landSectors[0]!;
    let clockMs = Date.parse('2026-11-08T12:00:00.000Z');
    const getNow = () => new Date(clockMs);

    const { ticket: ticketA } = await persistence.enqueueTicket({
      playerId: 'player_late_A',
      idempotencyKey: 'idem_late_A',
      request: {
        mode: 'JOIN_PLANET',
        planetType: 'temperate',
        sectorId: targetSector.sectorId,
      },
    });
    const resA1 = await reservations.reserveSlotForTicket(ticketA, { now: getNow(), ttlS: 90 });
    expect(resA1.ok).toBe(true);
    if (!resA1.ok) throw new Error('Expected reservation A1');

    const outcomeA1 = await saga.executeSpawnForReservation(resA1.reservation, {
      now: getNow,
      executor: async (req) => {
        clockMs += 95_000;
        await reservations.sweepExpiredReservations({ now: getNow() });
        return {
          ok: true,
          colonyId: req.colonyId,
          appliedAtTick: 42,
          spawnTile: { q: req.q, r: req.r },
        };
      },
    });

    expect(outcomeA1.ok).toBe(false);
    expect(outcomeA1.status).toBe('reconciled_orphan');
    expect(outcomeA1.orphanReconciled).toBe(true);
    expect(outcomeA1.retireCommand?.kind).toBe('system.retireColony');
    expect(outcomeA1.retireCommand?.args.colonyId).toBe(resA1.reservation.colonyId);
    expect(outcomeA1.retireCommand?.args.reason).toBe(ORPHAN_RETIRE_REASON);
    expect(saga.orphanColoniesReconciled).toBe(1);
    expect(outcomeA1.colony?.status).toBe('ABANDONED');

    const ticketAAfterExpiry = (await persistence.getTicketById(ticketA.id))!;
    expect(ticketAAfterExpiry.state).toBe('QUEUED');
    expect(ticketAAfterExpiry.attempts).toBe(1);

    const { ticket: ticketB } = await persistence.enqueueTicket({
      playerId: 'player_late_B',
      idempotencyKey: 'idem_late_B',
      request: {
        mode: 'JOIN_PLANET',
        planetType: 'temperate',
        sectorId: targetSector.sectorId,
      },
    });

    const resB = await reservations.reserveSlotForTicket(ticketB, { now: getNow() });
    const resA2 = await reservations.reserveSlotForTicket(ticketAAfterExpiry, { now: getNow() });
    expect(resB.ok).toBe(true);
    expect(resA2.ok).toBe(true);
    if (!resB.ok || !resA2.ok) throw new Error('Expected reservations B and A2');

    expect(resB.reservation.landingSlotId).not.toBe(resA1.reservation.landingSlotId);
    expect(resA2.reservation.landingSlotId).not.toBe(resB.reservation.landingSlotId);

    const outcomeB = await saga.executeSpawnForReservation(resB.reservation, { now: getNow });
    const outcomeA2 = await saga.executeSpawnForReservation(resA2.reservation, { now: getNow });
    expect(outcomeB.ok).toBe(true);
    expect(outcomeA2.ok).toBe(true);

    const activeInHome = (await homeRepo.listColoniesByPlanetId(planetId)).filter(
      (c) => c.status === 'ACTIVE',
    );
    expect(activeInHome).toHaveLength(2);
    expect(activeInHome.filter((c) => c.playerId === 'player_late_A')).toHaveLength(1);
    expect(activeInHome.filter((c) => c.playerId === 'player_late_B')).toHaveLength(1);
    const occupiedSlots = new Set(activeInHome.map((c) => c.landingSlotId));
    expect(occupiedSlots.size).toBe(2);

    const activeInSim = saga.getDefaultSpawnExecutor().getActiveColonies(planetId);
    expect(activeInSim).toHaveLength(2);
  });
});

describe('W11-13 — 3b. Acceptance Check: Delayed colony.founded ack after timeout & re-queue', () => {
  it('fences unresolved in-flight slot against reuse and retires late orphan without affecting active colonies', async () => {
    const { persistence, reservations, homeRepo, saga, planetId, landSectors } =
      await createSpawnSagaHarness(4);
    const targetSector = landSectors[0]!;

    const { ticket: ticketA } = await persistence.enqueueTicket({
      playerId: 'player_delayed_A',
      idempotencyKey: 'idem_delayed_A',
      request: {
        mode: 'JOIN_PLANET',
        planetType: 'temperate',
        sectorId: targetSector.sectorId,
      },
    });

    const resA1 = await reservations.reserveSlotForTicket(ticketA);
    expect(resA1.ok).toBe(true);
    if (!resA1.ok) throw new Error('Expected reservation A1');
    const orphanColonyId = resA1.reservation.colonyId;
    const orphanSlotId = resA1.reservation.landingSlotId;

    let resolveDelayedSpawn!: (val: { ok: boolean; colonyId: string; appliedAtTick: number }) => void;
    const delayedSpawnPromise = new Promise<{ ok: boolean; colonyId: string; appliedAtTick: number }>(
      (resolve) => {
        resolveDelayedSpawn = resolve;
      },
    );

    const timedOutOutcome = await saga.executeSpawnForReservation(resA1.reservation, {
      maxSpawnRetriesPerReservation: 1,
      spawnTimeoutMs: 10,
      executor: () => delayedSpawnPromise,
    });

    expect(timedOutOutcome.ok).toBe(false);
    expect(timedOutOutcome.status).toBe('expired');
    expect(timedOutOutcome.requeued).toBe(true);
    expect(saga.isSlotBlockedByPendingSpawn(planetId, targetSector.sectorId, orphanSlotId)).toBe(true);

    const { ticket: ticketB } = await persistence.enqueueTicket({
      playerId: 'player_delayed_B',
      idempotencyKey: 'idem_delayed_B',
      request: {
        mode: 'JOIN_PLANET',
        planetType: 'temperate',
        sectorId: targetSector.sectorId,
      },
    });
    const resB = await reservations.reserveSlotForTicket(ticketB);
    const ticketARequeued = (await persistence.getTicketById(ticketA.id))!;
    const resA2 = await reservations.reserveSlotForTicket(ticketARequeued);
    expect(resB.ok).toBe(true);
    expect(resA2.ok).toBe(true);
    if (!resB.ok || !resA2.ok) throw new Error('Expected resB and resA2');

    expect(resB.reservation.landingSlotId).not.toBe(orphanSlotId);
    expect(resA2.reservation.landingSlotId).not.toBe(orphanSlotId);
    expect(resA2.reservation.landingSlotId).not.toBe(resB.reservation.landingSlotId);

    const commitB = await saga.executeSpawnForReservation(resB.reservation);
    const commitA2 = await saga.executeSpawnForReservation(resA2.reservation);
    expect(commitB.ok).toBe(true);
    expect(commitA2.ok).toBe(true);

    resolveDelayedSpawn({ ok: true, colonyId: orphanColonyId, appliedAtTick: 88 });
    const reconcileRes = await saga.handleLateSpawnAck({
      colonyId: orphanColonyId,
      reservationId: resA1.reservation.reservationId,
      planetId,
      sectorId: targetSector.sectorId,
      landingSlotId: orphanSlotId,
      slotIndex: resA1.reservation.slotIndex,
      playerId: 'player_delayed_A',
      appliedAtTick: 88,
    });

    expect(reconcileRes.reconciled).toBe(true);
    expect(reconcileRes.status).toBe('reconciled_orphan');
    expect(reconcileRes.retireCommand?.kind).toBe('system.retireColony');
    expect(reconcileRes.retireCommand?.args.colonyId).toBe(orphanColonyId);
    expect(reconcileRes.retireCommand?.args.reason).toBe('reservation_expired');
    expect(saga.orphanColoniesReconciled).toBe(1);

    const duplicateLateAck = await saga.handleLateSpawnAck(orphanColonyId);
    expect(duplicateLateAck.alreadyReconciled).toBe(true);
    expect(duplicateLateAck.duplicateAck).toBe(true);
    expect(saga.getRetireCommandsSent()).toHaveLength(1);

    expect(saga.isSlotBlockedByPendingSpawn(planetId, targetSector.sectorId, orphanSlotId)).toBe(false);
    const activeColonies = (await homeRepo.listColoniesByPlanetId(planetId)).filter(
      (c) => c.status === 'ACTIVE',
    );
    expect(activeColonies).toHaveLength(2);
    const playerAColonies = activeColonies.filter((c) => c.playerId === 'player_delayed_A');
    expect(playerAColonies).toHaveLength(1);
    expect(playerAColonies[0]!.landingSlotId).toBe(resA2.reservation.landingSlotId);
  });
});

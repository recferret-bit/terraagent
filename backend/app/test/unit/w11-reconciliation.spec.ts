import 'reflect-metadata';
import { CANONICAL_PLANETS, type PlanetType } from '@terra/contracts';
import { describe, expect, it } from 'vitest';
import { HomeRepository } from '../../src/core/home/home.repository';
import {
  CanonicalWorldProvisioningService,
  LobbyPersistenceService,
  MATCH_TICKET_MAX_WAIT_MS,
  MemoryLobbyStore,
  PlanetsService,
  SectorReservationService,
  SpawnSagaService,
  WorldLifecycleService,
  WorldReconciliationService,
} from '../../src/lobby';

const HOURS_MS = 3_600_000;
const DAYS_MS = 24 * HOURS_MS;

function createReconciliationFixture(foundingSeatsPerSector = 4) {
  const store = new MemoryLobbyStore();
  const persistence = new LobbyPersistenceService(undefined, undefined, store);
  const lifecycle = new WorldLifecycleService(persistence);
  const reservations = new SectorReservationService(persistence, lifecycle);
  const homeRepo = new HomeRepository();
  const spawnSaga = new SpawnSagaService(persistence, reservations, homeRepo, lifecycle);
  const provisioning = new CanonicalWorldProvisioningService(persistence, lifecycle, homeRepo);
  const planetsService = new PlanetsService(persistence, lifecycle, homeRepo);
  const reconciliation = new WorldReconciliationService(
    persistence,
    lifecycle,
    reservations,
    spawnSaga,
    provisioning,
    homeRepo,
    planetsService,
  );

  return {
    store,
    persistence,
    lifecycle,
    reservations,
    homeRepo,
    spawnSaga,
    provisioning,
    planetsService,
    reconciliation,
    provisionAll: () =>
      provisioning.provisionAllCanonicalWorlds({
        foundingSeatsPerSector,
      }),
  };
}

async function seedWorldActivity(
  fixture: ReturnType<typeof createReconciliationFixture>,
  t0: number,
): Promise<{
  readonly heldReservationIds: readonly string[];
  readonly overdueTicketIds: readonly string[];
}> {
  const types: readonly PlanetType[] = ['desert', 'ocean', 'temperate'];
  const heldReservationIds: string[] = [];
  const overdueTicketIds: string[] = [];

  for (const type of types) {
    const planetId = CANONICAL_PLANETS[type].id;
    const { ticket: foundedTk } = await fixture.persistence.enqueueTicket({
      playerId: `pr_founded_${type}`,
      request: { mode: 'JOIN_PLANET', planetType: type, sectorId: 'sec_0_0' },
      now: new Date(t0),
    });
    const foundedRes = await fixture.reservations.reserveSlotForTicket(foundedTk, {
      now: new Date(t0),
      ttlS: 90,
    });
    if (!foundedRes.ok) throw new Error('expected founded reservation');
    const committed = await fixture.spawnSaga.executeSpawnForReservation(
      foundedRes.reservation,
      { now: new Date(t0) },
    );
    expect(committed.ok).toBe(true);

    const { ticket: heldTk } = await fixture.persistence.enqueueTicket({
      playerId: `pr_held_${type}`,
      request: { mode: 'JOIN_PLANET', planetType: type, sectorId: 'sec_0_0' },
      now: new Date(t0),
    });
    const heldRes = await fixture.reservations.reserveSlotForTicket(heldTk, {
      now: new Date(t0),
      ttlS: 90,
    });
    if (!heldRes.ok) throw new Error('expected held reservation');
    heldReservationIds.push(heldRes.reservation.reservationId);

    const { ticket: queuedTk } = await fixture.persistence.enqueueTicket({
      playerId: `pr_queued_${type}`,
      request: { mode: 'JOIN_PLANET', planetId, sectorId: 'sec_1_0' },
      now: new Date(t0),
    });
    overdueTicketIds.push(queuedTk.id);
  }

  return { heldReservationIds, overdueTicketIds };
}

describe('W11-04 — 1. Acceptance Check: Advance 30 days with no active colonies → same world, expired holds reconciled', () => {
  it('reconciles expired holds and overdue tickets across 24h, 14d, and 30d with 0 active colonies while keeping the 3 canonical worlds persistent and founded seats held', async () => {
    const fixture = createReconciliationFixture(4);
    await fixture.provisionAll();
    const t0 = Date.parse('2026-11-08T12:00:00.000Z');
    const { heldReservationIds, overdueTicketIds } = await seedWorldActivity(fixture, t0);

    const eliminated = await fixture.reconciliation.eliminateAllColonies({
      now: new Date(t0 + 60_000),
    });
    expect(eliminated).toHaveLength(3);
    expect(eliminated.every((e) => e.status === 'ELIMINATED' && e.foundedSeatHeld)).toBe(true);

    const sweep24h = await fixture.reconciliation.runReconciliationSweep(
      new Date(t0 + 24 * HOURS_MS),
    );
    expect(sweep24h).toMatchObject({
      canonicalWorldsCount: 3,
      warmPoolCount: 0,
      overflowWorldsCount: 0,
      ageSealedCount: 0,
      endedWorldsCount: 0,
      expiredReservationsCount: 3,
      requeuedTicketsCount: 3,
      expiredTicketsCount: 3,
    });

    for (const tkId of overdueTicketIds) {
      const tk = await fixture.persistence.getTicketById(tkId);
      expect(tk?.state).toBe('EXPIRED');
      expect(tk?.failureCode).toBe('timeout');
    }
    for (const resId of heldReservationIds) {
      const res = await fixture.reservations.getReservationById(resId);
      expect(res?.state).toBe('EXPIRED');
    }

    const sweep14d = await fixture.reconciliation.runReconciliationSweep(
      new Date(t0 + 14 * DAYS_MS),
    );
    expect(sweep14d.expiredReservationsCount).toBe(0);
    expect(sweep14d.expiredTicketsCount).toBe(3);

    const sweep30d = await fixture.reconciliation.runReconciliationSweep(
      new Date(t0 + 30 * DAYS_MS),
    );
    expect(sweep30d.canonicalWorldsCount).toBe(3);
    expect(sweep30d.expiredReservationsCount).toBe(0);
    expect(sweep30d.evictedFoundedSeatsCount).toBe(0);

    for (const type of ['desert', 'ocean', 'temperate'] as const) {
      const canonical = CANONICAL_PLANETS[type];
      const worldSnap = sweep30d.byPlanet[type];
      expect(worldSnap).toMatchObject({
        planetId: canonical.id,
        lifecycle: 'ACTIVE',
        health: 'OK',
        admission: 'OPEN',
        availability: 'open',
        ageSealed: false,
        expired: false,
        ended: false,
        manifestPinned: true,
        reservedSeats: 0,
        foundedSeats: 1,
        livingColonies: 0,
        eliminatedColonies: 1,
        freeSeats: 27,
      });

      const summary = await fixture.planetsService.getPlanetSummary(type);
      expect(summary).toMatchObject({
        id: canonical.id,
        lifecycle: 'ACTIVE',
        reservedSeats: 0,
        foundedSeats: 1,
        livingColonies: 0,
      });
    }
  });

  it('keeps canonical worlds with 0 founded colonies persistent across 24h, 14d, and 30d without warm-pool trimming or reset', async () => {
    const { reconciliation, provisionAll } = createReconciliationFixture(4);
    await provisionAll();
    const t0 = Date.parse('2026-11-08T12:00:00.000Z');

    for (const delta of [24 * HOURS_MS, 14 * DAYS_MS, 30 * DAYS_MS]) {
      const report = await reconciliation.runReconciliationSweep(new Date(t0 + delta));
      expect(report.canonicalWorldsCount).toBe(3);
      for (const w of report.worlds) {
        expect(w.lifecycle).toBe('ACTIVE');
        expect(w.admission).toBe('OPEN');
        expect(w.foundedSeats).toBe(0);
        expect(w.livingColonies).toBe(0);
        expect(w.freeSeats).toBe(28);
      }
    }
  });
});

describe('W11-04 — 2. Extinction, All-Settled & Victory Non-Ending Invariants (MM-07..08, WE-33)', () => {
  it('records extinct, all_settled, and victory outcomes without ending, sealing, archiving, or replacing the canonical world', async () => {
    const { persistence, reservations, spawnSaga, reconciliation, provisionAll } =
      createReconciliationFixture(4);
    await provisionAll();
    const t0 = Date.parse('2026-11-08T12:00:00.000Z');

    for (const [idx, type] of (['desert', 'ocean', 'temperate'] as const).entries()) {
      const { ticket } = await persistence.enqueueTicket({
        playerId: `pr_evt_${idx}`,
        request: { mode: 'JOIN_PLANET', planetType: type, sectorId: 'sec_0_0' },
        now: new Date(t0),
      });
      const res = await reservations.reserveSlotForTicket(ticket, { now: new Date(t0) });
      if (!res.ok) throw new Error('expected reservation');
      await spawnSaga.executeSpawnForReservation(res.reservation, { now: new Date(t0) });
    }

    const extinctOut = await reconciliation.handlePlanetEvent('extinct', 'desert', {
      now: new Date(t0 + 3 * DAYS_MS),
    });
    expect(extinctOut).toMatchObject({
      planetId: CANONICAL_PLANETS.desert.id,
      outcomeRecorded: true,
      worldEnded: false,
      ageSealed: false,
      archived: false,
      replaced: false,
      seatsEvicted: 0,
      lifecycle: 'ACTIVE',
      admission: 'OPEN',
      foundedSeats: 1,
      livingColonies: 0,
      eliminatedColonies: 1,
    });

    const settledOut = await reconciliation.handlePlanetEvent('all_settled', 'ocean', {
      now: new Date(t0 + 5 * DAYS_MS),
    });
    expect(settledOut).toMatchObject({
      planetId: CANONICAL_PLANETS.ocean.id,
      outcomeRecorded: true,
      worldEnded: false,
      ageSealed: false,
      archived: false,
      replaced: false,
      seatsEvicted: 0,
      lifecycle: 'ACTIVE',
      admission: 'OPEN',
      foundedSeats: 1,
      livingColonies: 0,
      settledColonies: 1,
    });

    const victoryOut = await reconciliation.handlePlanetEvent('victory', 'temperate', {
      now: new Date(t0 + 10 * DAYS_MS),
      winnerColonyId: 'co_winner',
    });
    expect(victoryOut).toMatchObject({
      planetId: CANONICAL_PLANETS.temperate.id,
      outcomeRecorded: true,
      worldEnded: false,
      ageSealed: false,
      archived: false,
      replaced: false,
      lifecycle: 'ACTIVE',
      admission: 'OPEN',
      foundedSeats: 1,
      livingColonies: 1,
    });
    expect(victoryOut.outcome?.winnerColonyId).toBe('co_winner');
    expect(reconciliation.getRecordedOutcomes()).toHaveLength(3);
  });
});

describe('W11-04 — 3. Counter Drift Healing & Idempotent Sweep', () => {
  it('repairs drifted reservedSeats and foundedSeats from authoritative rows and is idempotent on repeated sweeps', async () => {
    const { persistence, reservations, spawnSaga, reconciliation, provisionAll } =
      createReconciliationFixture(4);
    await provisionAll();
    const desertId = CANONICAL_PLANETS.desert.id;
    const t0 = Date.parse('2026-11-08T12:00:00.000Z');

    const { ticket: tkCommitted } = await persistence.enqueueTicket({
      playerId: 'pr_drift_committed',
      request: { mode: 'JOIN_PLANET', planetType: 'desert', sectorId: 'sec_0_0' },
      now: new Date(t0),
    });
    const resCommitted = await reservations.reserveSlotForTicket(tkCommitted, {
      now: new Date(t0),
    });
    if (!resCommitted.ok) throw new Error('expected reservation');
    await spawnSaga.executeSpawnForReservation(resCommitted.reservation, { now: new Date(t0) });

    const { ticket: tkHeld } = await persistence.enqueueTicket({
      playerId: 'pr_drift_held',
      request: { mode: 'JOIN_PLANET', planetType: 'desert', sectorId: 'sec_0_0' },
      now: new Date(t0),
    });
    const resHeld = await reservations.reserveSlotForTicket(tkHeld, {
      now: new Date(t0),
      ttlS: 90,
    });
    expect(resHeld.ok).toBe(true);

    await persistence.updateSectorCounters({
      planetId: desertId,
      sectorId: 'sec_0_0',
      reservedSeats: 4,
      foundedSeats: 3,
    });

    const sweep1 = await reconciliation.runReconciliationSweep(new Date(t0 + 30_000));
    expect(sweep1.expiredReservationsCount).toBe(0);
    expect(sweep1.repairedSectorsCount).toBe(1);
    expect(sweep1.repairedSectors[0]).toMatchObject({
      planetId: desertId,
      sectorId: 'sec_0_0',
      previousReservedSeats: 4,
      previousFoundedSeats: 3,
      repairedReservedSeats: 1,
      repairedFoundedSeats: 1,
      repairedFreeSeats: 2,
    });

    const sweepAfterExpiry1 = await reconciliation.runReconciliationSweep(new Date(t0 + 120_000));
    expect(sweepAfterExpiry1.expiredReservationsCount).toBe(1);
    expect(sweepAfterExpiry1.byPlanet.desert.reservedSeats).toBe(0);
    expect(sweepAfterExpiry1.byPlanet.desert.foundedSeats).toBe(1);

    const sweepAfterExpiry2 = await reconciliation.runReconciliationSweep(new Date(t0 + 120_000));
    expect(sweepAfterExpiry2.expiredReservationsCount).toBe(0);
    expect(sweepAfterExpiry2.repairedSectorsCount).toBe(0);
    expect(sweepAfterExpiry2.byPlanet.desert.reservedSeats).toBe(0);
    expect(sweepAfterExpiry2.byPlanet.desert.foundedSeats).toBe(1);
    expect(sweepAfterExpiry2.byPlanet.desert.freeSeats).toBe(27);
  });
});

describe('W11-04 — 4. Queue Pause, Ticket Wait Boundaries, Orphan Retirement & Fault Recovery', () => {
  it('suspends reservation & ticket expiry while queue is paused, enforces the 15-min boundary, and fails 3rd-attempt tickets', async () => {
    const { persistence, lifecycle, reservations, reconciliation, provisionAll } =
      createReconciliationFixture(4);
    await provisionAll();
    const t0 = Date.parse('2026-11-08T12:00:00.000Z');

    const { ticket: queuedTk } = await persistence.enqueueTicket({
      playerId: 'pr_boundary_q',
      request: { mode: 'JOIN_PLANET', planetType: 'ocean', sectorId: 'sec_0_0' },
      now: new Date(t0),
    });
    const { ticket: thirdAttemptTk } = await persistence.enqueueTicket({
      playerId: 'pr_attempt_3',
      request: { mode: 'JOIN_PLANET', planetType: 'ocean', sectorId: 'sec_0_0' },
      now: new Date(t0),
    });
    await persistence.updateTicket(thirdAttemptTk.id, { attempts: 2 });
    await reservations.reserveSlotForTicket(thirdAttemptTk, { now: new Date(t0), ttlS: 60 });

    await lifecycle.pauseQueue('op_admin', 'test pause');
    const pausedSweep = await reconciliation.runReconciliationSweep(
      new Date(t0 + MATCH_TICKET_MAX_WAIT_MS + 10_000),
    );
    expect(pausedSweep.queuePaused).toBe(true);
    expect(pausedSweep.expiredReservationsCount).toBe(0);
    expect(pausedSweep.expiredTicketsCount).toBe(0);

    await lifecycle.resumeQueue('op_admin', 'test resume');
    const atExactBoundary = await reconciliation.runReconciliationSweep(
      new Date(t0 + MATCH_TICKET_MAX_WAIT_MS),
    );
    expect(atExactBoundary.expiredReservationsCount).toBe(1);
    expect(atExactBoundary.failedSpawnTicketsCount).toBe(1);
    expect(atExactBoundary.failedSpawnTickets[0]?.failureCode).toBe('spawn_failed');
    expect(atExactBoundary.expiredTicketsCount).toBe(0);

    const pastBoundary = await reconciliation.runReconciliationSweep(
      new Date(t0 + MATCH_TICKET_MAX_WAIT_MS + 1),
    );
    expect(pastBoundary.expiredTicketsCount).toBe(1);
    expect(pastBoundary.expiredTickets[0]?.id).toBe(queuedTk.id);
    expect(pastBoundary.expiredTickets[0]?.failureCode).toBe('timeout');
  });

  it('retires late-founded orphan colonies on expired reservations and optionally retries faulted canonical worlds', async () => {
    const { persistence, lifecycle, reservations, homeRepo, reconciliation, provisionAll } =
      createReconciliationFixture(4);
    await provisionAll();
    const t0 = Date.parse('2026-11-08T12:00:00.000Z');
    const temperateId = CANONICAL_PLANETS.temperate.id;

    const { ticket } = await persistence.enqueueTicket({
      playerId: 'pr_orphan_sweep',
      request: { mode: 'JOIN_PLANET', planetType: 'temperate', sectorId: 'sec_0_0' },
      now: new Date(t0),
    });
    const res = await reservations.reserveSlotForTicket(ticket, { now: new Date(t0), ttlS: 30 });
    if (!res.ok) throw new Error('expected reservation');

    await reservations.expireReservation(res.reservation.reservationId, {
      now: new Date(t0 + 40_000),
    });
    await homeRepo.createColony({
      id: res.reservation.colonyId,
      playerId: 'pr_orphan_sweep',
      planetId: temperateId,
      colonyIndex: res.reservation.slotIndex,
      name: 'Late Orphan',
      status: 'ACTIVE',
      foundingSectorId: 'sec_0_0',
      landingSlotId: res.reservation.landingSlotId,
      spawnQ: res.reservation.q,
      spawnR: res.reservation.r,
    });
    await lifecycle.updateWorldHealth({
      planetId: temperateId,
      health: 'FAULTED',
      faultCode: 'sim_worker_crash',
      actor: 'watchdog',
      reason: 'simulated crash',
    });

    const report = await reconciliation.runReconciliationSweep(new Date(t0 + 50_000), {
      autoRetryFaultedWorlds: true,
    });
    expect(report.reconciledOrphansCount).toBe(1);
    expect(report.reconciledOrphans[0]?.colonyId).toBe(res.reservation.colonyId);
    expect(report.retriedWorldsCount).toBe(1);
    expect(report.byPlanet.temperate.health).toBe('OK');
    expect(report.byPlanet.temperate.foundedSeats).toBe(0);
    expect(await homeRepo.findColonyById(res.reservation.colonyId)).toBeNull();
  });
});

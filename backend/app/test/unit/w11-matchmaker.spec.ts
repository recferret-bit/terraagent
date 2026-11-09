import { describe, expect, it } from 'vitest';
import { CANONICAL_PLANETS, newId, type PlanetType, type SectorId } from '@terra/contracts';
import {
  LobbyPersistenceService,
  MatchmakerService,
  MemoryLobbyStore,
  PlanetsService,
  SectorReservationService,
  WorldLifecycleService,
} from '../../src/lobby';

async function createMatchmakerFixture(foundingSeatsPerSector = 4) {
  const persistence = new LobbyPersistenceService(undefined, undefined, new MemoryLobbyStore());
  const lifecycle = new WorldLifecycleService(persistence);
  const reservations = new SectorReservationService(persistence, lifecycle);
  const matchmaker = new MatchmakerService(persistence, reservations, lifecycle);
  const planets = new PlanetsService(persistence, lifecycle);

  await persistence.provisionAllCanonicalWorlds({
    foundingSeatsPerSector,
    validatedSeatsPerSector: foundingSeatsPerSector,
  });

  return { persistence, lifecycle, reservations, matchmaker, planets };
}

async function fillChosenSector(
  persistence: LobbyPersistenceService,
  matchmaker: MatchmakerService,
  planetType: PlanetType,
  sectorId: SectorId,
  count: number,
) {
  for (let i = 0; i < count; i++) {
    const { ticket } = await persistence.enqueueTicket({
      id: `tk_fill_${planetType}_${sectorId}_${i}`,
      playerId: newId('pr'),
      colonyId: newId('co'),
      request: {
        mode: 'JOIN_PLANET',
        planetType,
        sectorIntent: { mode: 'chosen', sectorId },
      },
    });
    const out = await matchmaker.processTicket(ticket);
    expect(out.outcome).toBe('reserved');
    expect(out.reservation?.sectorId).toBe(sectorId);
  }
}

describe('W11-12 — Acceptance: Fill chosen sector/world → explicit alternative or queue, never extra planet', () => {
  it('fills sec_0_0 (X=4), auto-places { mode: "auto" } on the same planet, and queues { mode: "chosen", sectorId: "sec_0_0" } with alternativeSectors until acceptAlternativeSector', async () => {
    const { persistence, matchmaker } = await createMatchmakerFixture(4);
    const desertId = CANONICAL_PLANETS.desert.id;
    const chosenSectorId = 'sec_0_0';

    await persistence.upsertSectorWithSlots({
      planetId: desertId,
      sectorId: 'sec_2_0',
      kind: 'ocean',
      macroQ: 2,
      macroR: 0,
      foundingCapacity: 0,
      validatedCapacity: 0,
    });

    await fillChosenSector(persistence, matchmaker, 'desert', chosenSectorId, 4);
    await fillChosenSector(persistence, matchmaker, 'desert', 'sec_1_0', 2);

    const { ticket: autoTicket } = await persistence.enqueueTicket({
      id: 'tk_auto_same_planet',
      playerId: newId('pr'),
      colonyId: newId('co'),
      request: {
        mode: 'JOIN_PLANET',
        planetType: 'desert',
        sectorIntent: { mode: 'auto' },
      },
    });
    const autoOutcome = await matchmaker.processTicket(autoTicket);
    expect(autoOutcome.outcome).toBe('reserved');
    expect(autoOutcome.reservation?.planetId).toBe(desertId);
    expect(autoOutcome.reservation?.sectorId).toBe('sec_1_0');
    expect(autoOutcome.ticket.state).toBe('RESERVED');

    const chosenPlayerId = newId('pr');
    const { ticket: chosenTicket } = await persistence.enqueueTicket({
      id: 'tk_chosen_full_sec',
      playerId: chosenPlayerId,
      colonyId: newId('co'),
      request: {
        mode: 'JOIN_PLANET',
        planetType: 'desert',
        sectorIntent: { mode: 'chosen', sectorId: chosenSectorId },
      },
    });
    const chosenOutcome = await matchmaker.processTicket(chosenTicket);
    expect(chosenOutcome.outcome).toBe('queued_chosen_sector_full');
    expect(chosenOutcome.reserved).toBe(false);
    expect(chosenOutcome.ticket.state).toBe('QUEUED');
    expect(chosenOutcome.ticket.planetId).toBe(desertId);
    expect(chosenOutcome.ticket.reservedPlanetId).toBeNull();
    expect(chosenOutcome.alternativeSectors[0]).toBe('sec_1_0');
    expect(chosenOutcome.alternativeSectors).not.toContain(chosenSectorId);
    expect(chosenOutcome.alternativeSectors).not.toContain('sec_2_0');
    expect(chosenOutcome.ticket.alternativeSectors).toEqual(chosenOutcome.alternativeSectors);

    const consentedOutcome = await matchmaker.acceptAlternativeSector(
      chosenTicket.id,
      chosenPlayerId,
      { mode: 'chosen', sectorId: 'sec_1_0' },
    );
    expect(consentedOutcome.outcome).toBe('reserved');
    expect(consentedOutcome.ticket.state).toBe('RESERVED');
    expect(consentedOutcome.reservation?.planetId).toBe(desertId);
    expect(consentedOutcome.reservation?.sectorId).toBe('sec_1_0');
  });
});

describe('W11-12 — Full planet queue invariant & acceptAlternativeSector validation', () => {
  it('keeps subsequent tickets QUEUED when all 7 land sectors on a planet are full and never creates a 4th planet', async () => {
    const { persistence, matchmaker, planets } = await createMatchmakerFixture(1);
    const desertId = CANONICAL_PLANETS.desert.id;

    for (let i = 0; i < 7; i++) {
      const { ticket } = await persistence.enqueueTicket({
        id: `tk_fill_desert_${i}`,
        playerId: newId('pr'),
        colonyId: newId('co'),
        request: {
          mode: 'JOIN_PLANET',
          planetType: 'desert',
          sectorIntent: { mode: 'auto' },
        },
      });
      const res = await matchmaker.processTicket(ticket);
      expect(res.outcome).toBe('reserved');
      expect(res.reservation?.planetId).toBe(desertId);
    }

    const { ticket: overflowAuto } = await persistence.enqueueTicket({
      id: 'tk_overflow_auto',
      playerId: newId('pr'),
      colonyId: newId('co'),
      request: {
        mode: 'JOIN_PLANET',
        planetType: 'desert',
        sectorIntent: { mode: 'auto' },
      },
    });
    const overflowOutcome = await matchmaker.processTicket(overflowAuto);
    expect(overflowOutcome.outcome).toBe('queued_planet_full');
    expect(overflowOutcome.reserved).toBe(false);
    expect(overflowOutcome.ticket.state).toBe('QUEUED');
    expect(overflowOutcome.ticket.planetId).toBe(desertId);
    expect(overflowOutcome.ticket.reservedPlanetId).toBeNull();
    expect(overflowOutcome.alternativeSectors).toEqual([]);
    expect(overflowOutcome.ticket.etaS).toBeNull();

    expect(await persistence.listCanonicalWorlds()).toHaveLength(3);
    const listed = await planets.listPlanets();
    expect(listed.planets).toHaveLength(3);
    const desertSummary = listed.planets.find((p) => p.id === desertId)!;
    expect(desertSummary.availability).toBe('full');
    expect(desertSummary.freeSeats).toBe(0);
    expect(desertSummary.reservedSeats).toBe(7);
  });

  it('validates ownership, land-only sectors, and switching to { mode: "auto" } in acceptAlternativeSector', async () => {
    const { persistence, matchmaker } = await createMatchmakerFixture(1);
    const oceanId = CANONICAL_PLANETS.ocean.id;

    await persistence.upsertSectorWithSlots({
      planetId: oceanId,
      sectorId: 'sec_2_0',
      kind: 'ocean',
      macroQ: 2,
      macroR: 0,
      foundingCapacity: 0,
      validatedCapacity: 0,
    });

    await fillChosenSector(persistence, matchmaker, 'ocean', 'sec_0_0', 1);

    const ownerId = newId('pr');
    const { ticket: waiting } = await persistence.enqueueTicket({
      playerId: ownerId,
      request: { mode: 'JOIN_PLANET', planetType: 'ocean', sectorId: 'sec_0_0' },
    });
    expect((await matchmaker.processTicket(waiting)).outcome).toBe('queued_chosen_sector_full');

    await expect(
      matchmaker.acceptAlternativeSector(waiting.id, 'wrong_player_id', 'sec_1_0'),
    ).rejects.toMatchObject({ status: 403, code: 'forbidden' });

    await expect(
      matchmaker.acceptAlternativeSector(waiting.id, ownerId, 'sec_2_0'),
    ).rejects.toMatchObject({ status: 400, code: 'sector_not_land' });

    await expect(
      matchmaker.acceptAlternativeSector(waiting.id, ownerId, 'sec_9_9'),
    ).rejects.toMatchObject({ status: 400, code: 'invalid_sector' });

    const switchedToAuto = await matchmaker.acceptAlternativeSector(waiting.id, ownerId, {
      mode: 'auto',
    });
    expect(switchedToAuto.outcome).toBe('reserved');
    expect(switchedToAuto.ticket.planetId).toBe(oceanId);
    expect(switchedToAuto.ticket.sectorIntent.mode).toBe('auto');
    expect(switchedToAuto.reservation?.planetId).toBe(oceanId);
    expect(switchedToAuto.reservation?.sectorId).not.toBe('sec_0_0');
  });
});

describe('W11-12 — TRANSFER mode: pending without valid destination & prioritized when slot frees', () => {
  it('keeps TRANSFER pending (QUEUED) with transferCarry intact when only sourcePlanetId has space and prioritizes TRANSFER (priority: 10) when destination frees a slot', async () => {
    const { persistence, lifecycle, matchmaker } = await createMatchmakerFixture(1);
    const sourcePlanetId = CANONICAL_PLANETS.desert.id;
    const destPlanetId = CANONICAL_PLANETS.ocean.id;

    const oceanSectors = (await persistence.listSectors(destPlanetId)).filter(
      (s) => s.kind === 'land',
    );
    const heldReservations = [];
    for (const sec of oceanSectors) {
      const { ticket } = await persistence.enqueueTicket({
        playerId: newId('pr'),
        request: { mode: 'JOIN_PLANET', planetType: 'ocean', sectorId: sec.sectorId },
      });
      const res = await matchmaker.processTicket(ticket);
      if (res.reservation) heldReservations.push(res.reservation);
    }

    const baseTime = new Date('2026-11-08T12:00:00.000Z');
    const { ticket: normalWaiter } = await persistence.enqueueTicket({
      id: 'tk_normal_waiter',
      playerId: newId('pr'),
      priority: 0,
      now: baseTime,
      request: { mode: 'JOIN_PLANET', planetType: 'ocean', sectorIntent: { mode: 'auto' } },
    });

    const transferCarry = {
      sourcePlanetId,
      sourceColonyId: 'col_desert_veteran_01',
      carryOver: { metals: 250, minerals: 120, techUnlocked: ['orbital_launchpad'] },
    };
    const { ticket: transferTicket } = await persistence.enqueueTicket({
      id: 'tk_transfer_ocean',
      playerId: newId('pr'),
      now: new Date(baseTime.getTime() + 1000),
      transferCarry,
      request: {
        mode: 'TRANSFER',
        planetType: 'ocean',
        sectorIntent: { mode: 'auto' },
        sourcePlanetId,
        sourceColonyId: transferCarry.sourceColonyId,
        carryOver: transferCarry.carryOver,
      },
    });

    const fullDestTick = await matchmaker.runMatchmakerTick({ now: baseTime });
    expect(fullDestTick.reserved).toBe(0);
    expect(fullDestTick.transferPending).toBe(1);
    expect(fullDestTick.queued).toBe(2);

    const pendingAfterFull = await persistence.getTicketById(transferTicket.id);
    expect(pendingAfterFull?.state).toBe('QUEUED');
    expect(pendingAfterFull?.reservedPlanetId).toBeNull();
    expect(pendingAfterFull?.transferCarry).toEqual(transferCarry);
    expect(pendingAfterFull?.position).toBe(0);

    await persistence.cancelTicket(heldReservations[0]!.ticketId, heldReservations[0]!.playerId);
    await lifecycle.pausePlanetAdmission({
      planetId: destPlanetId,
      actor: 'ops_1',
      reason: 'temporary destination maintenance',
    });

    const pausedDestOut = await matchmaker.processTicket(transferTicket.id);
    expect(pausedDestOut.outcome).toBe('transfer_pending');
    expect(pausedDestOut.reason).toBe('admission_paused');
    expect(pausedDestOut.transferCarry).toEqual(transferCarry);

    await lifecycle.resumePlanetAdmission({
      planetId: destPlanetId,
      actor: 'ops_1',
      reason: 'maintenance complete',
    });

    const assignTick = await matchmaker.runMatchmakerTick({
      now: new Date(baseTime.getTime() + 5000),
    });
    expect(assignTick.reserved).toBe(1);
    expect(assignTick.reservedTickets[0]?.id).toBe(transferTicket.id);
    expect(assignTick.transferPending).toBe(0);
    expect(assignTick.queued).toBe(1);
    expect(assignTick.queuedTickets[0]?.id).toBe(normalWaiter.id);

    const reservedTransfer = await persistence.getTicketById(transferTicket.id);
    expect(reservedTransfer?.state).toBe('RESERVED');
    expect(reservedTransfer?.reservedPlanetId).toBe(destPlanetId);
    expect(reservedTransfer?.reservedSectorId).toBe(heldReservations[0]!.sectorId);
    expect(reservedTransfer?.transferCarry).toEqual(transferCarry);
  });
});

describe('W11-12 — TRANSFER validation: same-planet & missing transferCarry rejection', () => {
  it('keeps TRANSFER pending if destination equals sourcePlanetId or transferCarry is missing', async () => {
    const { persistence, matchmaker } = await createMatchmakerFixture(4);
    const desertId = CANONICAL_PLANETS.desert.id;

    const { ticket: samePlanetTransfer } = await persistence.enqueueTicket({
      id: 'tk_transfer_same_planet',
      playerId: newId('pr'),
      transferCarry: {
        sourcePlanetId: desertId,
        sourceColonyId: 'col_same_planet_src',
        carryOver: { metals: 50 },
      },
      request: {
        mode: 'TRANSFER',
        planetId: desertId,
        planetType: 'desert',
        sectorIntent: { mode: 'auto' },
        sourcePlanetId: desertId,
        sourceColonyId: 'col_same_planet_src',
      },
    });

    const samePlanetOut = await matchmaker.processTicket(samePlanetTransfer);
    expect(samePlanetOut.outcome).toBe('transfer_pending');
    expect(samePlanetOut.reason).toBe('same_planet_transfer');
    expect(samePlanetOut.ticket.state).toBe('QUEUED');
    expect(samePlanetOut.ticket.reservedPlanetId).toBeNull();
    expect(samePlanetOut.transferCarry).toEqual({
      sourcePlanetId: desertId,
      sourceColonyId: 'col_same_planet_src',
      carryOver: { metals: 50 },
    });

    const { ticket: missingCarryTransfer } = await persistence.enqueueTicket({
      id: 'tk_transfer_no_carry',
      playerId: newId('pr'),
      request: {
        mode: 'TRANSFER',
        planetType: 'temperate',
        sectorIntent: { mode: 'auto' },
      },
    });
    const missingCarryOut = await matchmaker.processTicket(missingCarryTransfer);
    expect(missingCarryOut.outcome).toBe('transfer_pending');
    expect(missingCarryOut.reason).toBe('invalid_transfer_carry');
    expect(missingCarryOut.ticket.state).toBe('QUEUED');
  });
});

describe('W11-12 — Queue pause guard (MM-46) & expired reservation sweep in runMatchmakerTick', () => {
  it('makes zero reservations, suspends expiry, freezes positions, and sets etaS: null when WorldLifecycleService.pauseQueue is active', async () => {
    const { persistence, lifecycle, matchmaker } = await createMatchmakerFixture(4);
    const temperateId = CANONICAL_PLANETS.temperate.id;
    const t0 = new Date('2026-11-08T12:00:00.000Z');

    const { ticket: t1 } = await persistence.enqueueTicket({
      id: 'tk_pause_1',
      playerId: newId('pr'),
      now: t0,
      request: {
        mode: 'JOIN_PLANET',
        planetType: 'temperate',
        sectorIntent: { mode: 'chosen', sectorId: 'sec_0_0' },
      },
    });
    const { ticket: t2 } = await persistence.enqueueTicket({
      id: 'tk_pause_2',
      playerId: newId('pr'),
      now: new Date(t0.getTime() + 1000),
      request: {
        mode: 'JOIN_PLANET',
        planetType: 'temperate',
        sectorIntent: { mode: 'auto' },
      },
    });

    await lifecycle.pauseQueue({ actor: 'ops_admin', reason: 'freeze queue for maintenance' });
    expect(lifecycle.isQueuePaused()).toBe(true);

    const singlePaused = await matchmaker.processTicket(t1.id, { now: t0 });
    expect(singlePaused.outcome).toBe('queue_paused');
    expect(singlePaused.reserved).toBe(false);
    expect(singlePaused.ticket.etaS).toBeNull();

    const tickPaused = await matchmaker.runMatchmakerTick({ now: t0 });
    expect(tickPaused.queuePaused).toBe(true);
    expect(tickPaused.processed).toBe(0);
    expect(tickPaused.reserved).toBe(0);
    expect(tickPaused.queued).toBe(2);
    expect(tickPaused.expiredReservations).toBe(0);
    expect(tickPaused.queuedTickets.map((t) => [t.id, t.position, t.etaS])).toEqual([
      [t1.id, 0, null],
      [t2.id, 1, null],
    ]);

    const secAfterPause = await persistence.getSector(temperateId, 'sec_0_0');
    expect(secAfterPause?.reservedSeats).toBe(0);

    await lifecycle.resumeQueue({ actor: 'ops_admin', reason: 'resume queue' });
    const tickResumed = await matchmaker.runMatchmakerTick({
      now: new Date(t0.getTime() + 5000),
    });
    expect(tickResumed.queuePaused).toBe(false);
    expect(tickResumed.reserved).toBe(2);
    expect(tickResumed.queued).toBe(0);
  });

  it('sweeps expired reservations first in runMatchmakerTick and assigns waiting tickets to the newly freed slot', async () => {
    const { persistence, matchmaker } = await createMatchmakerFixture(1);
    const t0 = new Date('2026-11-08T12:00:00.000Z');

    const { ticket: holder } = await persistence.enqueueTicket({
      id: 'tk_expiring_holder',
      playerId: newId('pr'),
      now: t0,
      request: {
        mode: 'JOIN_PLANET',
        planetType: 'desert',
        sectorIntent: { mode: 'chosen', sectorId: 'sec_0_0' },
      },
    });
    expect((await matchmaker.processTicket(holder, { now: t0, ttlS: 90 })).outcome).toBe('reserved');

    const { ticket: waiter } = await persistence.enqueueTicket({
      id: 'tk_waiting_for_expiry',
      playerId: newId('pr'),
      now: new Date(t0.getTime() + 1000),
      request: {
        mode: 'JOIN_PLANET',
        planetType: 'desert',
        sectorIntent: { mode: 'chosen', sectorId: 'sec_0_0' },
      },
    });

    const tick = await matchmaker.runMatchmakerTick({
      now: new Date(t0.getTime() + 91_000),
      batchSize: 1,
    });
    expect(tick.expiredReservations).toBe(1);
    expect(tick.reserved).toBe(1);

    const waiterReloaded = await persistence.getTicketById(waiter.id);
    const holderReloaded = await persistence.getTicketById(holder.id);
    expect([waiterReloaded?.state, holderReloaded?.state].sort()).toEqual(['QUEUED', 'RESERVED']);
  });
});

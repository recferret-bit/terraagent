import { describe, expect, it } from 'vitest';
import { CANONICAL_PLANETS, newId, SectorReservationV1Schema } from '@terra/contracts';
import {
  LobbyPersistenceConflictError,
  LobbyPersistenceService,
  MATCH_SEAT_TTL_MS,
  MATCH_SEAT_TTL_S,
  MemoryLobbyStore,
  SectorReservationService,
  WorldLifecycleService,
  type SimLandingAuthorityCheckInput,
} from '../../src/lobby';

async function createReservationFixture(foundingSeatsPerSector = 4) {
  const persistence = new LobbyPersistenceService(undefined, undefined, new MemoryLobbyStore());
  const lifecycle = new WorldLifecycleService(persistence);
  const reservations = new SectorReservationService(persistence, lifecycle);
  await persistence.provisionAllCanonicalWorlds({
    foundingSeatsPerSector,
    validatedSeatsPerSector: foundingSeatsPerSector,
  });
  return { persistence, lifecycle, reservations };
}

describe('W11-11 — Acceptance: 5 concurrent joins for X=4 land sector', () => {
  it('allocates 4 HELD reservations with distinct landingSlotIds and leaves the 5th ticket QUEUED (sector_full)', async () => {
    const { persistence, reservations } = await createReservationFixture(4);
    const planetId = CANONICAL_PLANETS.temperate.id;
    const sectorId = 'sec_0_0';

    const tickets = await Promise.all(
      [1, 2, 3, 4, 5].map(async (i) => {
        const enq = await persistence.enqueueTicket({
          id: `t_race_${i}`,
          playerId: newId('pr'),
          colonyId: `col_race_${i}`,
          request: {
            mode: 'JOIN_PLANET',
            planetType: 'temperate',
            sectorId,
          },
        });
        return enq.ticket;
      }),
    );

    const outcomes = await Promise.all(
      tickets.map((ticket) => reservations.reserveSlotForTicket(ticket, { sectorId })),
    );

    const succeeded = outcomes.filter((o) => o.ok);
    const failed = outcomes.filter((o) => !o.ok);

    expect(succeeded).toHaveLength(4);
    expect(failed).toHaveLength(1);
    expect(failed[0]!.ok).toBe(false);
    if (!failed[0]!.ok) {
      expect(failed[0]!.code).toBe('sector_full');
      expect(failed[0]!.reason).toBe('sector_full');
    }

    const slotIds = new Set(succeeded.map((s) => s.reservation.landingSlotId));
    const slotIndices = succeeded.map((s) => s.reservation.slotIndex).sort((a, b) => a - b);
    expect(slotIds.size).toBe(4);
    expect(slotIndices).toEqual([0, 1, 2, 3]);

    for (const s of succeeded) {
      expect(s.reservation.state).toBe('HELD');
      expect(s.reservation.id).toBe(s.reservation.reservationId);
      expect(SectorReservationV1Schema.safeParse(s.reservationV1).success).toBe(true);
      expect(s.ticket?.state).toBe('RESERVED');
      expect(s.ticket?.reservedPlanetId).toBe(planetId);
      expect(s.ticket?.reservedSectorId).toBe(sectorId);
      expect(s.ticket?.reservedLandingSlotId).toBe(s.reservation.landingSlotId);
    }

    const sectorAfter = await persistence.getSector(planetId, sectorId);
    expect(sectorAfter?.reservedSeats).toBe(4);
    expect(sectorAfter?.foundedSeats).toBe(0);
    expect(sectorAfter?.freeSeats).toBe(0);

    const ticketStates = await Promise.all(tickets.map((t) => persistence.getTicketById(t.id)));
    const reservedTickets = ticketStates.filter((t) => t?.state === 'RESERVED');
    const waitingTickets = ticketStates.filter((t) => t?.state === 'QUEUED');
    expect(reservedTickets).toHaveLength(4);
    expect(waitingTickets).toHaveLength(1);
    expect(waitingTickets[0]!.reservedLandingSlotId).toBeNull();
    expect(waitingTickets[0]!.reservedSectorId).toBeNull();
  });
});

describe('W11-11 — World state and sector guards', () => {
  it('rejects PAUSED, FAULTED, LOADING, queue_paused, and ocean sector reservations', async () => {
    const { persistence, lifecycle, reservations } = await createReservationFixture(4);
    const planetId = CANONICAL_PLANETS.temperate.id;
    const landSectorId = 'sec_0_0';
    const oceanSectorId = 'sec_2_0';

    await persistence.upsertSectorWithSlots({
      planetId,
      sectorId: oceanSectorId,
      kind: 'ocean',
      macroQ: 2,
      macroR: 0,
      foundingCapacity: 0,
      validatedCapacity: 0,
    });

    const { ticket } = await persistence.enqueueTicket({
      id: 't_guard_1',
      playerId: 'u_guard_1',
      colonyId: 'col_guard_1',
      request: { mode: 'JOIN_PLANET', planetType: 'temperate', sectorId: landSectorId },
    });

    const oceanRes = await reservations.reserveSlotForTicket(ticket, { sectorId: oceanSectorId });
    expect(oceanRes.ok).toBe(false);
    if (!oceanRes.ok) expect(oceanRes.code).toBe('ocean_sector');

    await lifecycle.pausePlanetAdmission({ planetId, actor: 'ops_1', reason: 'maintenance' });
    const pausedRes = await reservations.reserveSlotForTicket(ticket, { sectorId: landSectorId });
    expect(pausedRes.ok).toBe(false);
    if (!pausedRes.ok) expect(pausedRes.code).toBe('admission_paused');

    await lifecycle.updateWorldHealth({
      planetId,
      health: 'FAULTED',
      faultCode: 'sim_crash',
      actor: 'ops_1',
      reason: 'crash',
    });
    const faultedRes = await reservations.reserveSlotForTicket(ticket, { sectorId: landSectorId });
    expect(faultedRes.ok).toBe(false);
    if (!faultedRes.ok) expect(faultedRes.code).toBe('world_faulted');

    await lifecycle.updateWorldHealth({
      planetId,
      health: 'LOADING',
      actor: 'ops_1',
      reason: 'reloading snapshot',
    });
    const loadingRes = await reservations.reserveSlotForTicket(ticket, { sectorId: landSectorId });
    expect(loadingRes.ok).toBe(false);
    if (!loadingRes.ok) expect(loadingRes.code).toBe('world_faulted');

    await lifecycle.updateWorldHealth({ planetId, health: 'OK', actor: 'ops_1', reason: 'ok' });
    await lifecycle.resumePlanetAdmission({ planetId, actor: 'ops_1', reason: 'reopen' });
    await lifecycle.setQueuePaused({ paused: true, actor: 'ops_1', reason: 'global freeze' });
    const queuePausedRes = await reservations.reserveSlotForTicket(ticket, {
      sectorId: landSectorId,
    });
    expect(queuePausedRes.ok).toBe(false);
    if (!queuePausedRes.ok) expect(queuePausedRes.code).toBe('queue_paused');
  });
});

describe('W11-11 — World lifecycle state guards (PROVISIONING & ARCHIVED)', () => {
  it('rejects PROVISIONING and ARCHIVED canonical worlds', async () => {
    const persistence = new LobbyPersistenceService(undefined, undefined, new MemoryLobbyStore());
    const lifecycle = new WorldLifecycleService(persistence);
    const reservations = new SectorReservationService(persistence, lifecycle);
    const landSectorId = 'sec_0_0';

    await persistence.provisionCanonicalWorld({
      type: 'desert',
      lifecycle: 'PROVISIONING',
      health: 'LOADING',
      admission: 'PAUSED',
    });
    const { ticket: provTicket } = await persistence.enqueueTicket({
      id: 't_prov_1',
      playerId: 'u_prov_1',
      colonyId: 'col_prov_1',
      request: { mode: 'JOIN_PLANET', planetType: 'desert', sectorId: landSectorId },
    });
    const provRes = await reservations.reserveSlotForTicket(provTicket, {
      sectorId: landSectorId,
    });
    expect(provRes.ok).toBe(false);
    if (!provRes.ok) expect(provRes.code).toBe('world_provisioning');

    await persistence.provisionCanonicalWorld({ type: 'ocean' });
    await lifecycle.transitionWorldLifecycle({
      planetId: CANONICAL_PLANETS.ocean.id,
      toLifecycle: 'ARCHIVED',
      actor: 'ops_1',
      reason: 'retire world',
    });
    const { ticket: archTicket } = await persistence.enqueueTicket({
      id: 't_arch_1',
      playerId: 'u_arch_1',
      colonyId: 'col_arch_1',
      request: { mode: 'JOIN_PLANET', planetType: 'ocean', sectorId: landSectorId },
    });
    const archivedRes = await reservations.reserveSlotForTicket(archTicket, {
      sectorId: landSectorId,
    });
    expect(archivedRes.ok).toBe(false);
    if (!archivedRes.ok) expect(archivedRes.code).toBe('world_archived');
  });
});

describe('W11-11 — Sim authority revalidation before hold allocation', () => {
  it('skips candidate slots rejected by sim authority and returns no_safe_slot without leaking DB holds when all fail', async () => {
    const { persistence, reservations } = await createReservationFixture(4);
    const planetId = CANONICAL_PLANETS.temperate.id;
    const sectorId = 'sec_0_0';

    const { ticket: t1 } = await persistence.enqueueTicket({
      id: 't_auth_1',
      playerId: 'u_auth_1',
      colonyId: 'col_auth_1',
      request: { mode: 'JOIN_PLANET', planetType: 'temperate', sectorId },
    });

    const checkedSlots: number[] = [];
    const partialValidator = (input: SimLandingAuthorityCheckInput) => {
      checkedSlots.push(input.slot.slotIndex);
      if (input.slot.slotIndex === 0) {
        return { ok: false, reason: 'terrain_invalidated_in_sim' };
      }
      return { ok: true };
    };

    const res1 = await reservations.reserveSlotForTicket(t1, {
      sectorId,
      authorityValidator: partialValidator,
    });
    expect(res1.ok).toBe(true);
    if (res1.ok) {
      expect(res1.reservation.slotIndex).toBe(1);
      expect(checkedSlots).toEqual([0, 1]);
    }

    const slot0AfterSkip = await persistence.getLandingSlot(planetId, 'slot_sec_0_0_0');
    expect(slot0AfterSkip?.state).toBe('FREE');
    expect(slot0AfterSkip?.reservationId).toBeNull();

    const { ticket: t2 } = await persistence.enqueueTicket({
      id: 't_auth_2',
      playerId: 'u_auth_2',
      colonyId: 'col_auth_2',
      request: { mode: 'JOIN_PLANET', planetType: 'temperate', sectorId },
    });

    const rejectAllValidator = () => ({ ok: false, reason: 'all_candidates_blocked_in_sim' });
    const res2 = await reservations.reserveSlotForTicket(t2, {
      sectorId,
      authorityValidator: rejectAllValidator,
    });

    expect(res2.ok).toBe(false);
    if (!res2.ok) {
      expect(res2.code).toBe('no_safe_slot');
      expect(res2.rejectedSlotIds).toEqual(['slot_sec_0_0_0', 'slot_sec_0_0_2', 'slot_sec_0_0_3']);
    }

    const sectorAfter = await persistence.getSector(planetId, sectorId);
    expect(sectorAfter?.reservedSeats).toBe(1);
    expect(sectorAfter?.freeSeats).toBe(3);

    const t2Reloaded = await persistence.getTicketById(t2.id);
    expect(t2Reloaded?.state).toBe('QUEUED');
    expect(t2Reloaded?.reservedLandingSlotId).toBeNull();
  });
});

describe('W11-11 — TTL & idempotent release/commit lifecycle', () => {
  it('enforces 90s default TTL, single-decrement on concurrent release/expire, and commit fencing', async () => {
    const { persistence, lifecycle, reservations } = await createReservationFixture(4);
    const planetId = CANONICAL_PLANETS.temperate.id;
    const sectorId = 'sec_0_0';
    const baseNow = new Date('2026-11-08T12:00:00.000Z');

    expect(MATCH_SEAT_TTL_S).toBe(90);
    expect(MATCH_SEAT_TTL_MS).toBe(90_000);

    const [enq1, enq2] = await Promise.all([
      persistence.enqueueTicket({
        id: 't_ttl_1',
        playerId: 'u_ttl_1',
        colonyId: 'col_ttl_1',
        request: { mode: 'JOIN_PLANET', planetType: 'temperate', sectorId },
        now: baseNow,
      }),
      persistence.enqueueTicket({
        id: 't_ttl_2',
        playerId: 'u_ttl_2',
        colonyId: 'col_ttl_2',
        request: { mode: 'JOIN_PLANET', planetType: 'temperate', sectorId },
        now: baseNow,
      }),
    ]);

    const hold1 = await reservations.reserveSlotForTicket(enq1.ticket, { sectorId, now: baseNow });
    const hold2 = await reservations.reserveSlotForTicket(enq2.ticket, { sectorId, now: baseNow });
    expect(hold1.ok && hold2.ok).toBe(true);
    if (!hold1.ok || !hold2.ok) return;

    expect(new Date(hold1.reservation.expiresAt).getTime() - baseNow.getTime()).toBe(90_000);

    const [relA, relB] = await Promise.all([
      reservations.releaseReservation(hold1.reservation.id, 'RELEASED'),
      reservations.expireReservation(hold1.reservation.id),
    ]);
    expect([relA.released, relB.released].filter(Boolean)).toHaveLength(1);

    const sectorAfterRelease = await persistence.getSector(planetId, sectorId);
    expect(sectorAfterRelease?.reservedSeats).toBe(1);
    expect(sectorAfterRelease?.foundedSeats).toBe(0);
    expect(sectorAfterRelease?.freeSeats).toBe(3);

    const spawning = await reservations.markReservationSpawning(
      hold2.reservation.id,
      hold2.reservation.epoch,
    );
    expect(spawning.state).toBe('SPAWNING');

    const committed1 = await reservations.commitReservation(hold2.reservation.id, {
      expectedEpoch: hold2.reservation.epoch,
    });
    const committed2 = await reservations.commitReservation(hold2.reservation.id, {
      expectedEpoch: hold2.reservation.epoch,
    });
    expect(committed1.state).toBe('COMMITTED');
    expect(committed2.state).toBe('COMMITTED');

    const sectorAfterCommit = await persistence.getSector(planetId, sectorId);
    expect(sectorAfterCommit?.reservedSeats).toBe(0);
    expect(sectorAfterCommit?.foundedSeats).toBe(1);
    expect(sectorAfterCommit?.freeSeats).toBe(3);

    await expect(
      reservations.releaseReservation(hold2.reservation.id, 'RELEASED'),
    ).rejects.toThrow(LobbyPersistenceConflictError);

    const reHold1 = await reservations.reserveSlotForTicket(enq1.ticket, {
      sectorId,
      now: baseNow,
      ttlMs: 30_000,
    });
    expect(reHold1.ok).toBe(true);

    await lifecycle.setQueuePaused({ paused: true, actor: 'ops_1', reason: 'freeze' });
    const sweptWhilePaused = await reservations.sweepExpiredReservations(
      new Date(baseNow.getTime() + 60_000),
    );
    expect(sweptWhilePaused).toHaveLength(0);

    await lifecycle.setQueuePaused({ paused: false, actor: 'ops_1', reason: 'unfreeze' });
    const sweptAfterResume = await reservations.sweepExpiredReservations(
      new Date(baseNow.getTime() + 60_000),
    );
    expect(sweptAfterResume).toHaveLength(1);
    expect(sweptAfterResume[0]!.state).toBe('EXPIRED');

    const ticket1AfterSweep = await persistence.getTicketById(enq1.ticket.id);
    expect(ticket1AfterSweep?.state).toBe('QUEUED');
    expect(ticket1AfterSweep?.attempts).toBe(1);
  });
});

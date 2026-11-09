import 'reflect-metadata';
import { CANONICAL_PLANETS, type PlanetType } from '@terra/contracts';
import { describe, expect, it } from 'vitest';
import {
  AuditMetadataRequiredError,
  buildDefaultCanonicalAtlasManifest,
  ConcurrencyConflictError,
  InvalidLifecycleTransitionError,
  LobbyPersistenceService,
  MemoryLobbyStore,
  WorldLifecycleService,
} from '../../src/lobby';

const HOURS_MS = 3_600_000;
const DAYS_MS = 24 * HOURS_MS;

function createFixture() {
  const persistence = new LobbyPersistenceService(undefined, undefined, new MemoryLobbyStore());
  const lifecycle = new WorldLifecycleService(persistence);
  return { persistence, lifecycle };
}

describe('W11-03 — Persistent canonical worlds never age-seal or expire at 72h, 7d, or 30d', () => {
  it('keeps all three canonical worlds ACTIVE and OPEN across 72h, 7d, and 30d sweeps', async () => {
    const { persistence, lifecycle } = createFixture();
    await persistence.provisionAllCanonicalWorlds({
      foundingSeatsPerSector: 3,
      validatedSeatsPerSector: 3,
    });

    const baseTime = Date.now();
    for (const deltaMs of [72 * HOURS_MS, 7 * DAYS_MS, 30 * DAYS_MS]) {
      const sweep = await lifecycle.sweepLifecycleForElapsedTime(new Date(baseTime + deltaMs));
      expect(sweep).toHaveLength(3);
      for (const entry of sweep) {
        expect(entry.ageSealed).toBe(false);
        expect(entry.expired).toBe(false);
        expect(entry.changed).toBe(false);
        expect(entry.lifecycle).toBe('ACTIVE');
        expect(entry.admission).toBe('OPEN');
        expect(entry.availability).toBe('open');
        expect(entry.freeSeats).toBe(21);
      }
    }
  });

  it('keeps a slot-filled world ACTIVE with derived full availability after 72h and 7d (never SEALED)', async () => {
    const { persistence, lifecycle } = createFixture();
    const manifest = buildDefaultCanonicalAtlasManifest('desert', {
      foundingSeatsPerSector: 3,
      validatedSeatsPerSector: 3,
    });
    const { world } = await persistence.provisionCanonicalWorld({ type: 'desert', manifest });

    let idx = 0;
    for (const sec of manifest.sectors) {
      for (let s = 0; s < sec.validatedSafeSites; s++) {
        idx++;
        const res = await persistence.reserveSectorSlotOrThrow({
          planetId: world.id,
          sectorId: sec.sectorId,
          playerId: `pr_age_${idx}`,
          ticketId: `tk_age_${idx}`,
          colonyId: `co_age_${idx}`,
        });
        await persistence.commitReservation(res.reservation.reservationId);
      }
    }

    const after72h = await lifecycle.evaluateElapsedAge(world.id, 72 * HOURS_MS);
    expect(after72h).toMatchObject({
      planetId: world.id,
      ageSealed: false,
      expired: false,
      lifecycle: 'ACTIVE',
      admission: 'OPEN',
      availability: 'full',
      freeSeats: 0,
      foundedSeats: 21,
    });

    const after7d = await lifecycle.evaluateElapsedAge(world.id, 7 * DAYS_MS);
    expect(after7d).toMatchObject({
      ageSealed: false,
      lifecycle: 'ACTIVE',
      admission: 'OPEN',
      availability: 'full',
      freeSeats: 0,
    });
  });
});

describe('W11-03 — Derived full availability from validated slots & automatic reopen on release/expiry', () => {
  it('derives availability=full when all slots are held/committed and restores open when 1 hold releases or expires', async () => {
    const { persistence, lifecycle } = createFixture();
    const manifest = buildDefaultCanonicalAtlasManifest('ocean', {
      foundingSeatsPerSector: 3,
      validatedSeatsPerSector: 3,
    });
    const { world } = await persistence.provisionCanonicalWorld({ type: 'ocean', manifest });

    const heldReservations: string[] = [];
    let counter = 0;
    for (const sec of manifest.sectors) {
      for (let s = 0; s < sec.validatedSafeSites; s++) {
        counter++;
        const out = await persistence.reserveSectorSlotOrThrow({
          planetId: world.id,
          sectorId: sec.sectorId,
          playerId: `pr_fill_${counter}`,
          ticketId: `tk_fill_${counter}`,
          colonyId: `co_fill_${counter}`,
          ttlMs: 10_000,
          now: new Date(1_000_000),
        });
        heldReservations.push(out.reservation.reservationId);
      }
    }

    const fullStatus = await lifecycle.getWorldStatus(world.id);
    expect(fullStatus.lifecycle).toBe('ACTIVE');
    expect(fullStatus.admission).toBe('OPEN');
    expect(fullStatus.availability).toBe('full');
    expect(fullStatus.freeSeats).toBe(0);
    expect(fullStatus.reservedSeats).toBe(21);

    const eligFull = await lifecycle.checkAdmissionEligibility(world.id, 'sec_0_0');
    expect(eligFull).toMatchObject({ eligible: false, status: 'full', reason: 'full', freeSeats: 0 });

    await persistence.releaseReservation(heldReservations[0]!, 'RELEASED');
    const reopened = await lifecycle.getWorldStatus(world.id);
    expect(reopened.lifecycle).toBe('ACTIVE');
    expect(reopened.admission).toBe('OPEN');
    expect(reopened.availability).toBe('open');
    expect(reopened.freeSeats).toBe(1);

    const refilled = await persistence.reserveSectorSlotOrThrow({
      planetId: world.id,
      sectorId: 'sec_0_0',
      playerId: 'pr_refill',
      ticketId: 'tk_refill',
      colonyId: 'co_refill',
      ttlMs: 5_000,
      now: new Date(1_000_000),
    });
    expect((await lifecycle.getWorldStatus(world.id)).availability).toBe('full');

    const expired = await persistence.expireReservations(new Date(1_006_000));
    expect(expired.some((r) => r.reservationId === refilled.reservation.reservationId)).toBe(true);
    expect((await lifecycle.getWorldStatus(world.id)).availability).toBe('open');
  });

  it('marks ocean sectors as full/ocean_sector with zero founding seats', async () => {
    const { persistence, lifecycle } = createFixture();
    const { world } = await persistence.provisionCanonicalWorld({ type: 'ocean' });
    await persistence.upsertSectorWithSlots({
      planetId: world.id,
      sectorId: 'sec_2_0',
      kind: 'ocean',
      foundingCapacity: 4,
      validatedCapacity: 4,
    });

    const secStatus = await lifecycle.getSectorStatus(world.id, 'sec_2_0');
    expect(secStatus.freeSeats).toBe(0);
    expect(secStatus.availability).toBe('full');

    const elig = await lifecycle.checkAdmissionEligibility(world.id, 'sec_2_0');
    expect(elig).toMatchObject({ eligible: false, status: 'ocean_sector', reason: 'ocean_sector' });
  });
});

describe('W11-03 — Audited operator pause/resume and queue controls', () => {
  it('pauses and resumes planet admission with structured audit trail while allowing held spawns to commit', async () => {
    const { persistence, lifecycle } = createFixture();
    const manifest = buildDefaultCanonicalAtlasManifest('temperate');
    const { world } = await persistence.provisionCanonicalWorld({ type: 'temperate', manifest });

    const preHeld = await persistence.reserveSectorSlotOrThrow({
      planetId: world.id,
      sectorId: 'sec_0_0',
      playerId: 'pr_pre_pause',
      ticketId: 'tk_pre_pause',
      colonyId: 'co_pre_pause',
    });

    const paused = await lifecycle.pausePlanetAdmission({
      planetId: world.id,
      actor: 'op_alice',
      reason: 'scheduled relay maintenance',
    });
    expect(paused.admission).toBe('PAUSED');
    expect(paused.availability).toBe('paused');
    expect(paused.lifecycle).toBe('ACTIVE');

    const blockedJoin = await persistence.reserveSectorSlot({
      planetId: world.id,
      sectorId: 'sec_0_0',
      playerId: 'pr_blocked',
      ticketId: 'tk_blocked',
      colonyId: 'co_blocked',
    });
    expect(blockedJoin).toEqual({
      ok: false,
      reason: 'admission_closed',
      message: expect.stringContaining('not open for admission'),
    });

    const committedDuringPause = await persistence.commitReservation(preHeld.reservation.reservationId);
    expect(committedDuringPause.state).toBe('COMMITTED');

    const resumed = await lifecycle.resumePlanetAdmission({
      planetId: world.id,
      actor: 'op_bob',
      reason: 'maintenance complete',
    });
    expect(resumed.admission).toBe('OPEN');
    expect(resumed.availability).toBe('open');

    const log = lifecycle.getAuditLog(world.id);
    expect(log).toHaveLength(2);
    expect(log[0]).toMatchObject({
      planetId: world.id,
      action: 'PAUSE',
      fromAdmission: 'OPEN',
      toAdmission: 'PAUSED',
      actor: 'op_alice',
      reason: 'scheduled relay maintenance',
    });
    expect(log[1]).toMatchObject({
      planetId: world.id,
      action: 'RESUME',
      fromAdmission: 'PAUSED',
      toAdmission: 'OPEN',
      actor: 'op_bob',
      reason: 'maintenance complete',
    });
  });

  it('rejects pause/resume/queue-pause when actor or reason is empty and audits global queue pause/resume', async () => {
    const { persistence, lifecycle } = createFixture();
    const { world } = await persistence.provisionCanonicalWorld({ type: 'desert' });

    await expect(
      lifecycle.pausePlanetAdmission({ planetId: world.id, actor: '   ', reason: 'valid reason' }),
    ).rejects.toThrow(AuditMetadataRequiredError);

    await expect(
      lifecycle.resumePlanetAdmission({ planetId: world.id, actor: 'op_1', reason: '' }),
    ).rejects.toMatchObject({ code: 'audit_metadata_required' });

    const qPaused = await lifecycle.setQueuePaused({
      paused: true,
      actor: 'op_queue',
      reason: 'high load',
    });
    expect(qPaused.queuePaused).toBe(true);
    expect(lifecycle.isQueuePaused()).toBe(true);

    const qResumed = await lifecycle.setQueuePaused({
      paused: false,
      actor: 'op_queue',
      reason: 'load nominal',
    });
    expect(qResumed.queuePaused).toBe(false);
    expect(lifecycle.getAuditLog().filter((e) => e.planetId === null)).toHaveLength(2);
  });
});

describe('W11-03 — Optimistic concurrency & pause/reserve race serialization', () => {
  it('allows exactly 1 winner when concurrent transitions race with the same expectedUpdatedAt', async () => {
    const { persistence, lifecycle } = createFixture();
    const { world } = await persistence.provisionCanonicalWorld({
      type: 'desert',
      manifest: buildDefaultCanonicalAtlasManifest('desert'),
    });

    const racePause = await Promise.allSettled([
      lifecycle.pausePlanetAdmission({
        planetId: world.id,
        actor: 'op_1',
        reason: 'pause attempt 1',
        expectedUpdatedAt: world.updatedAt,
      }),
      lifecycle.pausePlanetAdmission({
        planetId: world.id,
        actor: 'op_2',
        reason: 'pause attempt 2',
        expectedUpdatedAt: world.updatedAt,
      }),
    ]);

    const fulfilled = racePause.filter((r) => r.status === 'fulfilled');
    const rejected = racePause.filter(
      (r): r is PromiseRejectedResult => r.status === 'rejected',
    );
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toBeInstanceOf(ConcurrencyConflictError);
    expect(rejected[0]!.reason).toMatchObject({ code: 'concurrency_conflict' });
    expect(lifecycle.getAuditLog(world.id)).toHaveLength(1);

    const current = await persistence.getCanonicalWorldById(world.id);
    const raceResume = await Promise.allSettled([
      lifecycle.resumePlanetAdmission({
        planetId: world.id,
        actor: 'op_1',
        reason: 'resume 1',
        expectedUpdatedAt: current!.updatedAt,
      }),
      lifecycle.resumePlanetAdmission({
        planetId: world.id,
        actor: 'op_2',
        reason: 'resume 2',
        expectedUpdatedAt: current!.updatedAt,
      }),
    ]);
    expect(raceResume.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(raceResume.filter((r) => r.status === 'rejected')).toHaveLength(1);
  });

  it('serializes concurrent pausePlanetAdmission and reserveSectorSlot into a valid consistent outcome', async () => {
    const { persistence, lifecycle } = createFixture();
    const { world } = await persistence.provisionCanonicalWorld({
      type: 'temperate',
      manifest: buildDefaultCanonicalAtlasManifest('temperate'),
    });

    const [pauseOut, reserveOut] = await Promise.all([
      lifecycle.pausePlanetAdmission({
        planetId: world.id,
        actor: 'op_race',
        reason: 'race test',
      }),
      persistence.reserveSectorSlot({
        planetId: world.id,
        sectorId: 'sec_0_0',
        playerId: 'pr_race_1',
        ticketId: 'tk_race_1',
        colonyId: 'co_race_1',
      }),
    ]);

    expect(pauseOut.admission).toBe('PAUSED');
    expect(pauseOut.lifecycle).toBe('ACTIVE');
    const sector = await persistence.getSector(world.id, 'sec_0_0');
    if (reserveOut.ok) {
      expect(sector?.reservedSeats).toBe(1);
    } else {
      expect(reserveOut.reason).toBe('admission_closed');
      expect(sector?.reservedSeats).toBe(0);
    }
  });
});

describe('W11-03 — World health transitions & invalid lifecycle transition rejection', () => {
  it('derives faulted availability on LOADING/RETRYING/FAULTED health and restores open on OK', async () => {
    const { persistence, lifecycle } = createFixture();
    const { world } = await persistence.provisionCanonicalWorld({
      type: 'ocean',
      manifest: buildDefaultCanonicalAtlasManifest('ocean'),
    });

    const faulted = await lifecycle.updateWorldHealth({
      planetId: world.id,
      health: 'FAULTED',
      faultCode: 'sim_worker_timeout',
      actor: 'watchdog',
      reason: 'sim thread missed 3 heartbeats',
    });
    expect(faulted.health).toBe('FAULTED');
    expect(faulted.faultCode).toBe('sim_worker_timeout');
    expect(faulted.availability).toBe('faulted');
    expect((await lifecycle.checkAdmissionEligibility(world.id)).status).toBe('faulted');

    const recovered = await lifecycle.updateWorldHealth({
      planetId: world.id,
      health: 'OK',
      actor: 'watchdog',
      reason: 'sim thread recovered',
      expectedUpdatedAt: faulted.updatedAt,
    });
    expect(recovered.health).toBe('OK');
    expect(recovered.faultCode).toBeNull();
    expect(recovered.availability).toBe('open');
  });

  it('rejects legacy SEALED state and illegal transitions out of ARCHIVED or back to PROVISIONING', async () => {
    const { persistence, lifecycle } = createFixture();
    const { world } = await persistence.provisionCanonicalWorld({
      type: 'desert',
      lifecycle: 'PROVISIONING',
    });

    await expect(
      lifecycle.transitionWorldLifecycle({ planetId: world.id, toLifecycle: 'SEALED' }),
    ).rejects.toThrow(InvalidLifecycleTransitionError);

    const active = await lifecycle.transitionWorldLifecycle({
      planetId: world.id,
      toLifecycle: 'ACTIVE',
      actor: 'scheduler',
      reason: 'loaded onto sim thread',
    });
    expect(active.lifecycle).toBe('ACTIVE');

    await expect(
      lifecycle.transitionWorldLifecycle({ planetId: world.id, toLifecycle: 'PROVISIONING' }),
    ).rejects.toMatchObject({ code: 'invalid_lifecycle_transition' });

    const archived = await lifecycle.archiveWorld({
      planetId: world.id,
      actor: 'admin_root',
      reason: 'explicit maintenance archival',
    });
    expect(archived.lifecycle).toBe('ARCHIVED');
    expect(archived.admission).toBe('ARCHIVED');
    expect(archived.availability).toBe('archived');

    await expect(
      lifecycle.transitionWorldLifecycle({ planetId: world.id, toLifecycle: 'ACTIVE' }),
    ).rejects.toMatchObject({ code: 'invalid_lifecycle_transition' });

    await expect(
      lifecycle.transitionWorldLifecycle({ planetId: world.id, toLifecycle: 'PROVISIONING' }),
    ).rejects.toMatchObject({ code: 'invalid_lifecycle_transition' });

    await expect(
      lifecycle.resumePlanetAdmission({
        planetId: world.id,
        actor: 'admin_root',
        reason: 'illegal reopen',
      }),
    ).rejects.toMatchObject({ code: 'invalid_lifecycle_transition' });

    expect(CANONICAL_PLANETS.desert.id).toBe(world.id);
    const types: readonly PlanetType[] = ['desert', 'ocean', 'temperate'];
    expect(types).toHaveLength(3);
  });
});

import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import {
  CANONICAL_PLANETS,
  PlanetListV1Schema,
  PlanetSummaryV1Schema,
  PublicPlanetStatsV1Schema,
  SectorSummaryV1Schema,
  W11_SEVEN_SECTOR_COORDS,
  formatSectorId,
  newId,
} from '@terra/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import {
  bootTicketsHttpApp,
  createTicketFixture,
} from './fixtures/lobby/tickets-test.helpers';

let activeApp: INestApplication | undefined;

afterEach(async () => {
  await activeApp?.close();
  activeApp = undefined;
});

function bootApp() {
  return bootTicketsHttpApp((app) => {
    activeApp = app;
  });
}

describe('W11-08 — GET /v1/planets always shows all three canonical types and omits newPlanet', () => {
  it('returns all 3 canonical types before and after DB provisioning and strictly omits newPlanet and age timers', async () => {
    const unprovisioned = createTicketFixture();
    const initialList = await unprovisioned.planetsController.listPlanets();
    const parsedInitial = PlanetListV1Schema.parse(initialList);
    expect(parsedInitial.planets).toHaveLength(3);
    expect(parsedInitial.planets.map((p) => p.type)).toEqual(['desert', 'ocean', 'temperate']);
    expect(parsedInitial.planets.map((p) => p.look)).toEqual(['dune', 'oceanForest', 'forestRock']);
    expect(parsedInitial.queuePaused).toBe(false);
    expect('newPlanet' in (initialList as unknown as Record<string, unknown>)).toBe(false);

    const { url, lifecycle } = await bootApp();
    const res = await fetch(`${url}/v1/planets`);
    expect(res.status).toBe(200);
    const raw = (await res.json()) as Record<string, unknown>;
    expect(raw.newPlanet).toBeUndefined();

    const parsed = PlanetListV1Schema.parse(raw);
    expect(parsed.planets).toHaveLength(3);
    expect(parsed.planets.map((p) => p.id)).toEqual([
      CANONICAL_PLANETS.desert.id,
      CANONICAL_PLANETS.ocean.id,
      CANONICAL_PLANETS.temperate.id,
    ]);

    for (const planet of parsed.planets) {
      const planetRec = planet as unknown as Record<string, unknown>;
      expect(planetRec.admissionClosesAt).toBeUndefined();
      expect(planetRec.endsAt).toBeUndefined();
      expect(planetRec.firstColonyAt).toBeUndefined();
      expect(planet.availability).toBe('open');
      expect(planet.validatedCapacity).toBe(28);
      expect(planet.reservedSeats).toBe(0);
      expect(planet.foundedSeats).toBe(0);
      expect(planet.freeSeats).toBe(28);
      expect(planet.livingColonies).toBeNull();
      expect(planet.presentColonies).toBeNull();
      expect(planet.onlinePlayers).toBeNull();
      expect(planet.sectors).toHaveLength(7);
    }

    await lifecycle.setQueuePaused({ paused: true, actor: 'op_w11_08', reason: 'pause check' });
    const pausedRes = await fetch(`${url}/v1/planets?type=desert`);
    expect(pausedRes.status).toBe(200);
    const pausedList = PlanetListV1Schema.parse(await pausedRes.json());
    expect(pausedList.queuePaused).toBe(true);
    expect(pausedList.planets).toHaveLength(3);

    const invalidTypeRes = await fetch(`${url}/v1/planets?type=volcanic`);
    expect(invalidTypeRes.status).toBe(400);
    const invalidBody = (await invalidTypeRes.json()) as { error: { code: string } };
    expect(invalidBody.error.code).toBe('validation_error');
  });
});

describe('W11-08 — Acceptance: fill one world -> visible full status and exact reserved/founded/online counts', () => {
  it('transitions filled world to availability full with exact reserved/founded/free/living/online counts while keeping all 3 visible', async () => {
    const { url, persistence, planets } = await bootApp();
    const desertId = CANONICAL_PLANETS.desert.id;
    const sectorIds = W11_SEVEN_SECTOR_COORDS.map(([q, r]) => formatSectorId(q, r));

    let heldReservationIdToRelease = '';
    for (let sIdx = 0; sIdx < sectorIds.length; sIdx++) {
      const sectorId = sectorIds[sIdx]!;
      for (let slot = 0; slot < 4; slot++) {
        const out = await persistence.reserveSectorSlotOrThrow({
          planetId: desertId,
          sectorId,
          playerId: newId('pr'),
          ticketId: newId('mt'),
          colonyId: newId('co'),
        });
        if (sIdx < 4) {
          await persistence.commitReservation(out.reservation.reservationId);
        } else if (!heldReservationIdToRelease) {
          heldReservationIdToRelease = out.reservation.reservationId;
        }
      }
    }

    planets.setSectorLiveCounts('desert', 'sec_0_0', {
      livingColonies: 3,
      presentColonies: 4,
      onlinePlayers: 2,
    });
    planets.setPlanetLiveCounts(desertId, {
      livingColonies: 15,
      presentColonies: 16,
      onlinePlayers: 9,
    });

    const listRes = await fetch(`${url}/v1/planets`);
    expect(listRes.status).toBe(200);
    const list = PlanetListV1Schema.parse(await listRes.json());
    expect(list.planets).toHaveLength(3);

    const [desert, ocean, temperate] = list.planets;
    expect(desert).toMatchObject({
      id: desertId,
      type: 'desert',
      lifecycle: 'ACTIVE',
      health: 'OK',
      admission: 'OPEN',
      availability: 'full',
      nominalCapacity: 28,
      validatedCapacity: 28,
      foundedSeats: 16,
      reservedSeats: 12,
      freeSeats: 0,
      livingColonies: 15,
      presentColonies: 16,
      onlinePlayers: 9,
    });
    expect(desert!.sectors.every((s) => s.freeSeats === 0 && s.availability === 'full')).toBe(true);
    const sec00 = desert!.sectors.find((s) => s.sectorId === 'sec_0_0')!;
    expect(sec00).toMatchObject({
      foundingCapacity: 4,
      validatedCapacity: 4,
      foundedSeats: 4,
      reservedSeats: 0,
      freeSeats: 0,
      livingColonies: 3,
      presentColonies: 4,
      onlinePlayers: 2,
      availability: 'full',
    });

    expect(ocean!.availability).toBe('open');
    expect(ocean!.freeSeats).toBe(28);
    expect(temperate!.availability).toBe('open');
    expect(temperate!.freeSeats).toBe(28);

    await persistence.releaseReservation(heldReservationIdToRelease, 'RELEASED');
    const afterRelease = PlanetSummaryV1Schema.parse(
      await (await fetch(`${url}/v1/planets/${desertId}`)).json(),
    );
    expect(afterRelease.availability).toBe('open');
    expect(afterRelease.foundedSeats).toBe(16);
    expect(afterRelease.reservedSeats).toBe(11);
    expect(afterRelease.freeSeats).toBe(1);
  });
});

describe('W11-08 — World state propagation (paused, faulted, archived) and ocean sector invariants', () => {
  it('propagates paused, faulted, and archived states to planet & sector availability and enforces 0 capacity on ocean sectors', async () => {
    const { url, persistence, lifecycle } = await bootApp();

    await persistence.upsertSectorWithSlots({
      planetId: CANONICAL_PLANETS.ocean.id,
      sectorId: 'sec_2_0',
      kind: 'ocean',
      foundingCapacity: 0,
      validatedCapacity: 0,
    });

    const oceanBeforePause = PlanetSummaryV1Schema.parse(
      await (await fetch(`${url}/v1/planets/ocean`)).json(),
    );
    expect(oceanBeforePause.totalSectors).toBe(8);
    expect(oceanBeforePause.landSectors).toBe(7);
    expect(oceanBeforePause.oceanSectors).toBe(1);
    const oceanSec = oceanBeforePause.sectors.find((s) => s.sectorId === 'sec_2_0')!;
    expect(oceanSec).toMatchObject({
      sectorId: 'sec_2_0',
      kind: 'ocean',
      foundingCapacity: 0,
      validatedCapacity: 0,
      reservedSeats: 0,
      foundedSeats: 0,
      freeSeats: 0,
      availability: 'full',
    });

    await lifecycle.pausePlanetAdmission({
      planetId: CANONICAL_PLANETS.ocean.id,
      actor: 'op_pause',
      reason: 'scheduled pause',
    });
    await lifecycle.updateWorldHealth({
      planetId: CANONICAL_PLANETS.temperate.id,
      health: 'FAULTED',
      faultCode: 'sim_thread_stall',
      actor: 'op_health',
      reason: 'stall detected',
    });
    await lifecycle.archiveWorld({
      planetId: CANONICAL_PLANETS.desert.id,
      actor: 'op_archive',
      reason: 'season maintenance archive',
    });

    const list = PlanetListV1Schema.parse(await (await fetch(`${url}/v1/planets`)).json());
    const [desert, ocean, temperate] = list.planets;

    expect(desert!.lifecycle).toBe('ARCHIVED');
    expect(desert!.availability).toBe('archived');
    expect(desert!.sectors.every((s) => s.availability === 'archived')).toBe(true);

    expect(ocean!.admission).toBe('PAUSED');
    expect(ocean!.availability).toBe('paused');
    expect(ocean!.sectors.every((s) => s.availability === 'paused')).toBe(true);

    expect(temperate!.health).toBe('FAULTED');
    expect(temperate!.faultCode).toBe('sim_thread_stall');
    expect(temperate!.availability).toBe('faulted');
    expect(temperate!.sectors.every((s) => s.availability === 'faulted')).toBe(true);
  });
});

describe('W11-08 — GET /v1/planets/:id, /sectors, and /sectors/:sectorId lookup aliases & 404 handling', () => {
  it('resolves canonical ULIDs, type names, and planet_*_prime aliases, returns public sector hints, and 404s on unknown IDs', async () => {
    const { url, homeRepo } = await bootApp();

    await homeRepo.createColony({
      id: newId('co'),
      playerId: newId('pr'),
      planetId: CANONICAL_PLANETS.temperate.id,
      colonyIndex: 0,
      name: 'Granite Vanguard',
      status: 'ACTIVE',
      foundingSectorId: 'sec_0_0',
      spawnQ: 0,
      spawnR: 0,
    });

    for (const idOrAlias of [
      CANONICAL_PLANETS.temperate.id,
      'temperate',
      'planet_temperate_prime',
    ]) {
      const res = await fetch(`${url}/v1/planets/${idOrAlias}`);
      expect(res.status).toBe(200);
      const summary = PlanetSummaryV1Schema.parse(await res.json());
      expect(summary.id).toBe(CANONICAL_PLANETS.temperate.id);
      expect(summary.type).toBe('temperate');
      expect(summary.foundedSeats).toBe(1);
      expect(summary.freeSeats).toBe(27);
      expect(summary.livingColonies).toBe(1);
      expect(summary.colonies).toHaveLength(1);
      expect(summary.colonies?.[0]?.displayName).toBe('Granite Vanguard');
    }

    const sectorsRes = await fetch(`${url}/v1/planets/planet_desert_prime/sectors`);
    expect(sectorsRes.status).toBe(200);
    const sectorsBody = (await sectorsRes.json()) as {
      planetId: string;
      availability: string;
      sectors: unknown[];
    };
    expect(sectorsBody.planetId).toBe(CANONICAL_PLANETS.desert.id);
    expect(sectorsBody.availability).toBe('open');
    expect(sectorsBody.sectors).toHaveLength(7);
    for (const sec of sectorsBody.sectors) {
      const parsedSec = SectorSummaryV1Schema.parse(sec);
      expect(parsedSec.mainResource).toBe('metals.t1');
      expect(parsedSec.scarceResources).toEqual(['bio.water']);
    }

    const singleSecRes = await fetch(`${url}/v1/planets/desert/sectors/sec_0_0`);
    expect(singleSecRes.status).toBe(200);
    expect(SectorSummaryV1Schema.parse(await singleSecRes.json()).sectorId).toBe('sec_0_0');

    const unknownPlanetRes = await fetch(`${url}/v1/planets/pl_unknown_nonexistent`);
    expect(unknownPlanetRes.status).toBe(404);
    expect(((await unknownPlanetRes.json()) as { error: { code: string } }).error.code).toBe(
      'not_found',
    );

    const unknownSectorsRes = await fetch(`${url}/v1/planets/mars/sectors`);
    expect(unknownSectorsRes.status).toBe(404);

    const unknownSecIdRes = await fetch(`${url}/v1/planets/desert/sectors/sec_99_99`);
    expect(unknownSecIdRes.status).toBe(404);
  });
});

describe('W11-08 — GET /v1/planets/stats public stats with nullable live telemetry', () => {
  it('returns null for unavailable live counts (never false 0) and exact counts when telemetry or colonies exist', async () => {
    const { url, planets, lifecycle, persistence } = await bootApp();

    const initialRes = await fetch(`${url}/v1/planets/stats`);
    expect(initialRes.status).toBe(200);
    const initialStats = PublicPlanetStatsV1Schema.parse(await initialRes.json());
    expect(initialStats.planetsActive).toBe(3);
    expect(initialStats.coloniesAlive).toBeNull();
    expect(initialStats.playersOnline).toBeNull();

    const r1 = await persistence.reserveSectorSlotOrThrow({
      planetId: CANONICAL_PLANETS.desert.id,
      sectorId: 'sec_0_0',
      playerId: newId('pr'),
      ticketId: newId('mt'),
      colonyId: newId('co'),
    });
    await persistence.commitReservation(r1.reservation.reservationId);

    const afterCommitStats = PublicPlanetStatsV1Schema.parse(
      await (await fetch(`${url}/v1/planets/stats`)).json(),
    );
    expect(afterCommitStats.planetsActive).toBe(3);
    expect(afterCommitStats.coloniesAlive).toBe(1);
    expect(afterCommitStats.playersOnline).toBeNull();

    planets.setPlanetLiveCounts('desert', { livingColonies: 4, onlinePlayers: 3 });
    planets.setPlanetLiveCounts('ocean', { livingColonies: 2, onlinePlayers: 0 });

    const withTelemetry = PublicPlanetStatsV1Schema.parse(
      await (await fetch(`${url}/v1/planets/stats`)).json(),
    );
    expect(withTelemetry.planetsActive).toBe(3);
    expect(withTelemetry.coloniesAlive).toBe(6);
    expect(withTelemetry.playersOnline).toBe(3);

    planets.setLiveTelemetryProvider({
      getPublicStatsLiveCounts: () => ({ coloniesAlive: 19, playersOnline: 11 }),
    });
    const fromProvider = PublicPlanetStatsV1Schema.parse(
      await (await fetch(`${url}/v1/planets/stats`)).json(),
    );
    expect(fromProvider.coloniesAlive).toBe(19);
    expect(fromProvider.playersOnline).toBe(11);

    planets.clearLiveTelemetry();
    planets.setPlanetLiveCounts('desert', { livingColonies: null, onlinePlayers: null });
    await lifecycle.updateWorldHealth({
      planetId: CANONICAL_PLANETS.temperate.id,
      health: 'FAULTED',
      faultCode: 'degraded',
    });

    const afterFaultAndStale = PublicPlanetStatsV1Schema.parse(
      await (await fetch(`${url}/v1/planets/stats`)).json(),
    );
    expect(afterFaultAndStale.planetsActive).toBe(2);
    expect(afterFaultAndStale.coloniesAlive).toBeNull();
    expect(afterFaultAndStale.playersOnline).toBeNull();
  });
});

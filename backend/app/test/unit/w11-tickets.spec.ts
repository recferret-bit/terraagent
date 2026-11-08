import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import {
  CANONICAL_PLANETS,
  HomeV1Schema,
  MatchTicketV1Schema,
  newId,
  type MatchTicketV1,
} from '@terra/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { buildDefaultCanonicalAtlasManifest } from '../../src/lobby';
import {
  bootTicketsHttpApp,
  createTicketFixture,
  registerGuest,
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

describe('W11-10 — 20 concurrent identical POST /v1/match/tickets idempotency', () => {
  it('creates exactly 1 ticket across 20 concurrent identical service/controller calls (with and without Idempotency-Key)', async () => {
    const { persistence, controller } = createTicketFixture();
    await persistence.provisionAllCanonicalWorlds({
      foundingSeatsPerSector: 4,
      validatedSeatsPerSector: 4,
    });

    const playerA = { id: newId('pr'), handle: 'RacerA' };
    const resultsNoKey = await Promise.all(
      Array.from({ length: 20 }, () =>
        controller.enqueueTicket(
          { mode: 'JOIN_PLANET', planetType: 'desert', sectorId: 'sec_0_0' },
          playerA,
        ),
      ),
    );

    expect(resultsNoKey).toHaveLength(20);
    const uniqueIdsNoKey = new Set(resultsNoKey.map((t) => t.id));
    expect(uniqueIdsNoKey.size).toBe(1);
    const firstTicket = MatchTicketV1Schema.parse(resultsNoKey[0]);
    expect(firstTicket.playerId).toBe(playerA.id);
    expect(firstTicket.planetId).toBe(CANONICAL_PLANETS.desert.id);
    expect(firstTicket.sectorIntent).toEqual({ kind: 'chosen', sectorId: 'sec_0_0' });

    const playerB = { id: newId('pr'), handle: 'RacerB' };
    const resultsWithKey = await Promise.all(
      Array.from({ length: 20 }, () =>
        controller.enqueueTicket(
          { mode: 'JOIN_PLANET', planetType: 'ocean', autoSector: true },
          playerB,
          'idem-key-ocean-20',
        ),
      ),
    );
    expect(new Set(resultsWithKey.map((t) => t.id)).size).toBe(1);
    expect(resultsWithKey[0]!.sectorIntent).toEqual({ kind: 'auto' });

    const allTickets = await persistence.listTickets();
    expect(allTickets).toHaveLength(2);
  });

  it('creates 1 ticket in persistence when 20 concurrent HTTP POST /v1/match/tickets requests fire', async () => {
    const { url, persistence } = await bootApp();
    const guest = await registerGuest(url, 'w11-10-guest-secret-concurrent-20', 'HttpRacer');

    const responses = await Promise.all(
      Array.from({ length: 20 }, () =>
        fetch(`${url}/v1/match/tickets`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${guest.accessToken}`,
            'content-type': 'application/json',
            'idempotency-key': 'http-20-race-key',
          },
          body: JSON.stringify({
            mode: 'JOIN_PLANET',
            planetType: 'desert',
            sectorId: 'sec_0_0',
          }),
        }),
      ),
    );

    const bodies: MatchTicketV1[] = [];
    for (const res of responses) {
      expect([200, 201]).toContain(res.status);
      bodies.push(MatchTicketV1Schema.parse(await res.json()));
    }

    const uniqueTicketIds = new Set(bodies.map((b) => b.id));
    expect(uniqueTicketIds.size).toBe(1);

    const persistedForPlayer = (await persistence.listTickets()).filter(
      (t) => t.playerId === guest.player.id,
    );
    expect(persistedForPlayer).toHaveLength(1);
    expect(persistedForPlayer[0]!.id).toBe(bodies[0]!.id);
  });
});

describe('W11-10 — Live active colony check (409 already_has_colony + home)', () => {
  it('rejects a player who has an active colony with 409 already_has_colony and ACTIVE home summary', async () => {
    const { url, homeRepo, tickets } = await bootApp();
    const guest = await registerGuest(url, 'w11-10-active-colony-secret-01', 'ColonistLive');

    await homeRepo.createColony({
      id: newId('co'),
      playerId: guest.player.id,
      planetId: CANONICAL_PLANETS.desert.id,
      colonyIndex: 0,
      name: 'Kharon Alpha',
      color: 0,
      status: 'ACTIVE',
      spawnQ: 4,
      spawnR: -2,
    });

    await expect(
      tickets.enqueueTicket(guest.player.id, {
        mode: 'JOIN_PLANET',
        planetType: 'ocean',
        autoSector: true,
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: 'already_has_colony',
      home: {
        state: 'ACTIVE',
        colony: {
          playerId: guest.player.id,
          planetId: CANONICAL_PLANETS.desert.id,
          state: 'ACTIVE',
        },
        planet: {
          id: CANONICAL_PLANETS.desert.id,
          type: 'desert',
        },
      },
    });

    const res = await fetch(`${url}/v1/match/tickets`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${guest.accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        mode: 'JOIN_PLANET',
        planetType: 'desert',
        sectorId: 'sec_0_0',
      }),
    });

    expect(res.status).toBe(409);
    const body = (await res.json()) as {
      code: string;
      home: unknown;
      error: { code: string; details: { home: unknown } };
    };
    expect(body.error.code).toBe('already_has_colony');
    expect(body.code).toBe('already_has_colony');
    const parsedHome = HomeV1Schema.parse(body.home);
    expect(parsedHome.state).toBe('ACTIVE');
    expect(body.error.details.home).toEqual(body.home);
  });
});

describe('W11-10 — Live active colony check from committed SectorReservation', () => {
  it('also detects an active colony committed via SectorReservation in LobbyPersistenceService', async () => {
    const { persistence, tickets } = createTicketFixture();
    const { world } = await persistence.provisionCanonicalWorld({
      type: 'temperate',
      manifest: buildDefaultCanonicalAtlasManifest('temperate'),
    });
    const playerId = newId('pr');
    const reserved = await persistence.reserveSectorSlotOrThrow({
      planetId: world.id,
      sectorId: 'sec_0_0',
      playerId,
      ticketId: newId('mt'),
      colonyId: newId('co'),
    });
    await persistence.commitReservation(reserved.reservation.reservationId);

    await expect(
      tickets.enqueueTicket(playerId, {
        mode: 'JOIN_PLANET',
        planetType: 'temperate',
        sectorId: 'sec_1_0',
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: 'already_has_colony',
      home: {
        state: 'ACTIVE',
        colony: {
          id: reserved.reservation.colonyId,
          planetId: world.id,
          foundingSectorId: 'sec_0_0',
        },
      },
    });
  });
});

describe('W11-10 — Sector placement intent (chosen vs auto) & alternativeSectors on full sector', () => {
  it('preserves explicit chosen vs auto sectorIntent and populates alternativeSectors when chosen land sector has 0 free seats', async () => {
    const { persistence, tickets } = createTicketFixture();
    const manifest = buildDefaultCanonicalAtlasManifest('desert', {
      foundingSeatsPerSector: 3,
      validatedSeatsPerSector: 3,
    });
    const { world } = await persistence.provisionCanonicalWorld({ type: 'desert', manifest });
    await persistence.provisionCanonicalWorld({
      type: 'ocean',
      manifest: buildDefaultCanonicalAtlasManifest('ocean'),
    });
    await persistence.upsertSectorWithSlots({
      planetId: world.id,
      sectorId: 'sec_2_0',
      kind: 'ocean',
      foundingCapacity: 0,
      validatedCapacity: 0,
    });

    const chosenOpen = await tickets.enqueueTicket(newId('pr'), {
      mode: 'JOIN_PLANET',
      planetType: 'desert',
      sectorId: 'sec_0_0',
    });
    expect(chosenOpen.sectorIntent).toEqual({ kind: 'chosen', sectorId: 'sec_0_0' });
    expect(chosenOpen.alternativeSectors).toEqual([]);

    const autoTicket = await tickets.enqueueTicket(newId('pr'), {
      mode: 'JOIN_PLANET',
      planetType: 'ocean',
      autoSector: true,
    });
    expect(autoTicket.sectorIntent).toEqual({ kind: 'auto' });
    expect(autoTicket.planetId).toBe(CANONICAL_PLANETS.ocean.id);

    for (let i = 0; i < 3; i++) {
      await persistence.reserveSectorSlotOrThrow({
        planetId: world.id,
        sectorId: 'sec_0_0',
        playerId: newId('pr'),
        ticketId: newId('mt'),
        colonyId: newId('co'),
      });
    }

    const latePlayerId = newId('pr');
    const chosenFull = await tickets.enqueueTicket(latePlayerId, {
      mode: 'JOIN_PLANET',
      planetType: 'desert',
      sectorId: 'sec_0_0',
    });
    expect(chosenFull.sectorIntent).toEqual({ kind: 'chosen', sectorId: 'sec_0_0' });
    expect(chosenFull.alternativeSectors).toEqual([
      'sec_-1_0',
      'sec_-1_1',
      'sec_0_-1',
      'sec_0_1',
      'sec_1_-1',
      'sec_1_0',
    ]);
    expect(chosenFull.alternativeSectors).not.toContain('sec_0_0');
    expect(chosenFull.alternativeSectors).not.toContain('sec_2_0');

    const fetched = await tickets.getTicket(chosenFull.id, latePlayerId);
    expect(fetched.alternativeSectors).toEqual(chosenFull.alternativeSectors);
  });
});

describe('W11-10 — Mode validation, ocean sector rejection, queue pause & conflicting intent', () => {
  it('rejects NEW_PLANET (400 unsupported_mode), same-planet TRANSFER (400 same_planet_transfer), and ocean sector (400 sector_not_land)', async () => {
    const { url, persistence, lifecycle } = await bootApp();
    await persistence.upsertSectorWithSlots({
      planetId: CANONICAL_PLANETS.ocean.id,
      sectorId: 'sec_2_0',
      kind: 'ocean',
      foundingCapacity: 0,
      validatedCapacity: 0,
    });

    const guest = await registerGuest(url, 'w11-10-validation-secret-01', 'Validator');
    const postTicket = async (payload: unknown) => {
      const r = await fetch(`${url}/v1/match/tickets`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${guest.accessToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      return { status: r.status, body: (await r.json()) as { error: { code: string } } };
    };

    const newPlanetRes = await postTicket({ mode: 'NEW_PLANET', planetType: 'desert' });
    expect(newPlanetRes.status).toBe(400);
    expect(newPlanetRes.body.error.code).toBe('unsupported_mode');

    const sameTransferRes = await postTicket({
      mode: 'TRANSFER',
      planetType: 'desert',
      sourcePlanetId: CANONICAL_PLANETS.desert.id,
    });
    expect(sameTransferRes.status).toBe(400);
    expect(sameTransferRes.body.error.code).toBe('same_planet_transfer');

    const oceanSecRes = await postTicket({
      mode: 'JOIN_PLANET',
      planetType: 'ocean',
      sectorId: 'sec_2_0',
    });
    expect(oceanSecRes.status).toBe(400);
    expect(oceanSecRes.body.error.code).toBe('sector_not_land');

    await lifecycle.setQueuePaused({ paused: true, actor: 'op_test', reason: 'maintenance' });
    const pausedRes = await postTicket({
      mode: 'JOIN_PLANET',
      planetType: 'desert',
      sectorId: 'sec_0_0',
    });
    expect(pausedRes.status).toBe(409);
    expect(pausedRes.body.error.code).toBe('queue_paused');
    await lifecycle.setQueuePaused({ paused: false, actor: 'op_test', reason: 'resume' });

    const validRes = await postTicket({
      mode: 'JOIN_PLANET',
      planetType: 'desert',
      sectorId: 'sec_0_0',
    });
    expect(validRes.status).toBe(200);

    const conflictingRes = await postTicket({
      mode: 'JOIN_PLANET',
      planetType: 'temperate',
      sectorId: 'sec_0_0',
    });
    expect(conflictingRes.status).toBe(409);
    expect(conflictingRes.body.error.code).toBe('already_queued');
  });
});

describe('W11-10 — Ticket ownership enforcement (403) & idempotent cancellation releasing reservations', () => {
  it('blocks player B from viewing or cancelling player A ticket (403) and releases held slot on cancel', async () => {
    const { url, persistence } = await bootApp();
    const guestA = await registerGuest(url, 'w11-10-owner-secret-a', 'OwnerA');
    const guestB = await registerGuest(url, 'w11-10-owner-secret-b', 'IntruderB');

    const createRes = await fetch(`${url}/v1/match/tickets`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${guestA.accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        mode: 'JOIN_PLANET',
        planetType: 'desert',
        sectorId: 'sec_0_0',
      }),
    });
    expect(createRes.status).toBe(200);
    const ticketA = MatchTicketV1Schema.parse(await createRes.json());

    const reserved = await persistence.reserveSectorSlotOrThrow({
      planetId: CANONICAL_PLANETS.desert.id,
      sectorId: 'sec_0_0',
      playerId: guestA.player.id,
      ticketId: ticketA.id,
      colonyId: ticketA.colonyId,
    });
    expect((await persistence.getSector(CANONICAL_PLANETS.desert.id, 'sec_0_0'))?.reservedSeats).toBe(1);

    const viewByB = await fetch(`${url}/v1/match/tickets/${ticketA.id}`, {
      headers: { authorization: `Bearer ${guestB.accessToken}` },
    });
    expect(viewByB.status).toBe(403);
    expect(((await viewByB.json()) as { error: { code: string } }).error.code).toBe('forbidden');

    const cancelByB = await fetch(`${url}/v1/match/tickets/${ticketA.id}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${guestB.accessToken}` },
    });
    expect(cancelByB.status).toBe(403);

    const cancel1 = await fetch(`${url}/v1/match/tickets/${ticketA.id}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${guestA.accessToken}` },
    });
    expect(cancel1.status).toBe(200);
    expect(MatchTicketV1Schema.parse(await cancel1.json()).state).toBe('CANCELLED');

    const sectorAfter = await persistence.getSector(CANONICAL_PLANETS.desert.id, 'sec_0_0');
    expect(sectorAfter?.reservedSeats).toBe(0);
    expect(sectorAfter?.freeSeats).toBe(4);
    const resAfter = await persistence.getReservationById(reserved.reservation.reservationId);
    expect(resAfter?.state).toBe('RELEASED');

    const cancel2 = await fetch(`${url}/v1/match/tickets/${ticketA.id}/cancel`, {
      method: 'POST',
      headers: { authorization: `Bearer ${guestA.accessToken}` },
    });
    expect(cancel2.status).toBe(200);
    expect(MatchTicketV1Schema.parse(await cancel2.json()).state).toBe('CANCELLED');
    expect((await persistence.getSector(CANONICAL_PLANETS.desert.id, 'sec_0_0'))?.reservedSeats).toBe(0);
  });

  it('rejects cancelling an already ASSIGNED ticket with 409 conflict', async () => {
    const { persistence, tickets } = createTicketFixture();
    const { world } = await persistence.provisionCanonicalWorld({
      type: 'desert',
      manifest: buildDefaultCanonicalAtlasManifest('desert'),
    });
    const playerId = newId('pr');
    const created = await tickets.enqueueTicket(playerId, {
      mode: 'JOIN_PLANET',
      planetType: 'desert',
      sectorId: 'sec_0_0',
    });
    const res = await persistence.reserveSectorSlotOrThrow({
      planetId: world.id,
      sectorId: 'sec_0_0',
      playerId,
      ticketId: created.id,
      colonyId: created.colonyId,
    });
    await persistence.commitReservation(res.reservation.reservationId);

    await expect(tickets.cancelTicket(created.id, playerId)).rejects.toMatchObject({
      status: 409,
      code: 'conflict',
    });
  });
});

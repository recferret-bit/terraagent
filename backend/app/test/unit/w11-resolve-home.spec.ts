import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import {
  CANONICAL_PLANETS,
  HomeResponseSchema,
  HomeV1Schema,
  MatchTicketV1Schema,
  newId,
  parseCommandArgs,
  type HomeResponse,
} from '@terra/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { createSpawnColonyCommand, toColonySummary } from '../../src/core/home';
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

async function getHomeHttp(
  url: string,
  accessToken: string,
  query = '',
): Promise<{ readonly status: number; readonly raw: Record<string, unknown>; readonly body?: HomeResponse }> {
  const res = await fetch(`${url}/v1/me/home${query}`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  const raw = (await res.json()) as Record<string, unknown>;
  if (res.status !== 200) return { status: res.status, raw };
  return { status: res.status, raw, body: HomeResponseSchema.parse(raw) };
}

describe('W11-20 — NEW player reload via resolveHome (GET /v1/me/home?resolve=1)', () => {
  it('returns state NEW with all 3 canonical worlds, newPlanetTypes [], and passes HomeV1Schema', async () => {
    const { url, lifecycle } = await bootApp();
    const guest = await registerGuest(url, 'w11-20-new-guest-secret-01', 'NewExplorer');

    const first = await getHomeHttp(url, guest.accessToken, '?resolve=1');
    expect(first.status).toBe(200);
    const parsedV1 = HomeV1Schema.parse(first.raw);
    expect(parsedV1.state).toBe('NEW');
    if (parsedV1.state !== 'NEW' || first.body?.state !== 'NEW') {
      throw new Error('expected NEW home state');
    }

    expect(first.body.newPlanetTypes).toEqual([]);
    expect(first.body.queuePaused).toBe(false);
    expect(parsedV1.planets).toHaveLength(3);
    expect(parsedV1.planets.map((p) => p.type)).toEqual(['desert', 'ocean', 'temperate']);
    expect(parsedV1.planets.map((p) => p.id)).toEqual([
      CANONICAL_PLANETS.desert.id,
      CANONICAL_PLANETS.ocean.id,
      CANONICAL_PLANETS.temperate.id,
    ]);
    for (const planet of parsedV1.planets) {
      expect(planet.availability).toBe('open');
      expect(planet.validatedCapacity).toBe(28);
      expect(planet.freeSeats).toBe(28);
      expect(planet.sectors.length).toBeGreaterThanOrEqual(7);
    }

    await lifecycle.setQueuePaused({ paused: true, actor: 'op_1', reason: 'test pause' });
    const second = await getHomeHttp(url, guest.accessToken, '?mode=lobby');
    expect(second.status).toBe(200);
    expect(second.body?.state).toBe('NEW');
    if (second.body?.state === 'NEW') {
      expect(second.body.queuePaused).toBe(true);
    }
  });
});

describe('W11-20 — QUEUED player reload (chosen vs auto sector intent & reservation state)', () => {
  it('returns state QUEUED on both GET /v1/me/home and ?resolve=1 with exact ticket and sectorIntent', async () => {
    const { url, persistence } = await bootApp();
    const guestChosen = await registerGuest(url, 'w11-20-queued-chosen-secret-01', 'QueuedChosen');
    const guestAuto = await registerGuest(url, 'w11-20-queued-auto-secret-02', 'QueuedAuto');

    for (let i = 0; i < 4; i++) {
      await persistence.reserveSectorSlotOrThrow({
        planetId: CANONICAL_PLANETS.desert.id,
        sectorId: 'sec_0_0',
        playerId: newId('pr'),
        ticketId: newId('mt'),
        colonyId: newId('co'),
      });
    }

    const postChosen = await fetch(`${url}/v1/match/tickets`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${guestChosen.accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        mode: 'JOIN_PLANET',
        planetType: 'desert',
        sectorId: 'sec_0_0',
      }),
    });
    expect(postChosen.status).toBe(200);
    const ticketChosen = MatchTicketV1Schema.parse(await postChosen.json());

    const reloadDefault = await getHomeHttp(url, guestChosen.accessToken);
    const reloadResolve = await getHomeHttp(url, guestChosen.accessToken, '?resolve=1');
    expect(reloadDefault.status).toBe(200);
    expect(reloadResolve.status).toBe(200);

    const queuedV1 = HomeV1Schema.parse(reloadDefault.raw);
    expect(queuedV1).toEqual(HomeV1Schema.parse(reloadResolve.raw));
    expect(queuedV1).toMatchObject({
      state: 'QUEUED',
      ticketId: ticketChosen.id,
      ticketState: 'QUEUED',
      planetId: CANONICAL_PLANETS.desert.id,
      planetType: 'desert',
      sectorIntent: { kind: 'chosen', sectorId: 'sec_0_0' },
      reservedSectorId: null,
      alternativeSectors: ['sec_-1_0', 'sec_-1_1', 'sec_0_-1', 'sec_0_1', 'sec_1_-1', 'sec_1_0'],
      position: 0,
      etaS: 0,
    });

    const postAuto = await fetch(`${url}/v1/match/tickets`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${guestAuto.accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        mode: 'JOIN_PLANET',
        planetType: 'ocean',
        autoSector: true,
      }),
    });
    const ticketAuto = MatchTicketV1Schema.parse(await postAuto.json());
    await persistence.reserveSectorSlotOrThrow({
      planetId: CANONICAL_PLANETS.ocean.id,
      sectorId: 'sec_1_0',
      playerId: guestAuto.player.id,
      ticketId: ticketAuto.id,
      colonyId: ticketAuto.colonyId,
    });

    const reloadReserved = await getHomeHttp(url, guestAuto.accessToken, '?resolve=1');
    const reservedV1 = HomeV1Schema.parse(reloadReserved.raw);
    expect(reservedV1).toMatchObject({
      state: 'QUEUED',
      ticketId: ticketAuto.id,
      ticketState: 'RESERVED',
      planetId: CANONICAL_PLANETS.ocean.id,
      planetType: 'ocean',
      sectorIntent: { kind: 'auto' },
      reservedSectorId: 'sec_1_0',
    });

    await fetch(`${url}/v1/match/tickets/${ticketAuto.id}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${guestAuto.accessToken}` },
    });
    const afterCancel = await getHomeHttp(url, guestAuto.accessToken, '?resolve=1');
    expect(afterCancel.body?.state).toBe('NEW');
  });
});

describe('W11-20 — ACTIVE player reload, canonical planet/sector context & resumeColony auth', () => {
  it('returns ACTIVE with foundingSectorId, landingSlotId, and canonical planet summary, and rejects unauthorized resume', async () => {
    const { url, homeRepo, persistence } = await bootApp();
    const owner = await registerGuest(url, 'w11-20-active-owner-secret-01', 'FounderAlpha');
    const stranger = await registerGuest(url, 'w11-20-active-stranger-secret-02', 'StrangerBeta');

    const { colony } = await homeRepo.createColony({
      id: newId('co'),
      playerId: owner.player.id,
      planetId: CANONICAL_PLANETS.temperate.id,
      colonyIndex: 2,
      name: 'Granite Bastion',
      color: 2,
      status: 'ACTIVE',
      foundingSectorId: 'sec_1_-1',
      landingSlotId: 'slot_sec_1_-1_2',
      spawnQ: 37,
      spawnR: -37,
    });

    const summary = toColonySummary(colony);
    expect(summary.foundingSectorId).toBe('sec_1_-1');
    expect(summary.landingSlotId).toBe('slot_sec_1_-1_2');

    const spawnCmd = createSpawnColonyCommand({
      player: { id: owner.player.id, handle: 'FounderAlpha' },
      colony,
      planet: (await homeRepo.findPlanetById(CANONICAL_PLANETS.temperate.id))!,
      slot: { index: 2, q: 37, r: -37, sectorId: 'sec_1_-1', landingSlotId: 'slot_sec_1_-1_2' },
    });
    expect(parseCommandArgs('system.spawnColony', spawnCmd.args).success).toBe(true);
    expect(spawnCmd.args).toMatchObject({
      colonyId: colony.id,
      sectorId: 'sec_1_-1',
      landingSlotId: 'slot_sec_1_-1_2',
    });

    for (const query of ['', '?resolve=1', `?colonyId=${colony.id}`]) {
      const res = await getHomeHttp(url, owner.accessToken, query);
      expect(res.status).toBe(200);
      const activeV1 = HomeV1Schema.parse(res.raw);
      expect(activeV1.state).toBe('ACTIVE');
      if (activeV1.state !== 'ACTIVE') throw new Error('expected ACTIVE');
      expect(activeV1.colony).toMatchObject({
        id: colony.id,
        playerId: owner.player.id,
        planetId: CANONICAL_PLANETS.temperate.id,
        colonyIndex: 2,
        foundingSectorId: 'sec_1_-1',
        landingSlotId: 'slot_sec_1_-1_2',
        spawnQ: 37,
        spawnR: -37,
      });
      expect(activeV1.planet).toMatchObject({
        id: CANONICAL_PLANETS.temperate.id,
        name: 'Granite Hollow',
        type: 'temperate',
        look: 'forestRock',
        lifecycle: 'ACTIVE',
        availability: 'open',
      });
    }

    const unauthorized = await getHomeHttp(url, stranger.accessToken, `?colonyId=${colony.id}`);
    expect(unauthorized.status).toBe(404);
    expect(unauthorized.raw.errorCode).toBe('COLONY_UNAVAILABLE');

    const committedPlayer = await registerGuest(url, 'w11-20-committed-res-secret-03', 'CommittedPilot');
    const reserved = await persistence.reserveSectorSlotOrThrow({
      planetId: CANONICAL_PLANETS.desert.id,
      sectorId: 'sec_0_1',
      playerId: committedPlayer.player.id,
      ticketId: newId('mt'),
      colonyId: newId('co'),
    });
    await persistence.commitReservation(reserved.reservation.reservationId);

    const committedReload = await getHomeHttp(url, committedPlayer.accessToken, '?resolve=1');
    const committedV1 = HomeV1Schema.parse(committedReload.raw);
    expect(committedV1).toMatchObject({
      state: 'ACTIVE',
      colony: {
        id: reserved.reservation.colonyId,
        planetId: CANONICAL_PLANETS.desert.id,
        foundingSectorId: 'sec_0_1',
        landingSlotId: reserved.reservation.landingSlotId,
      },
    });
  });
});

describe('W11-20 — ELIMINATED & PLANET_ENDED recaps and POST /v1/me/home/recap-seen transition to NEW', () => {
  it('returns ELIMINATED and PLANET_ENDED with foundingSectorId and transitions to NEW after recap-seen', async () => {
    const { url, homeRepo, lifecycle } = await bootApp();
    const elimGuest = await registerGuest(url, 'w11-20-elim-secret-01', 'FallenColonist');
    const endedGuest = await registerGuest(url, 'w11-20-ended-secret-02', 'ArchivedColonist');

    const { colony: elimColony } = await homeRepo.createColony({
      id: newId('co'),
      playerId: elimGuest.player.id,
      planetId: CANONICAL_PLANETS.desert.id,
      colonyIndex: 0,
      name: 'Fallen Outpost',
      status: 'ELIMINATED',
      foundingSectorId: 'sec_-1_1',
      landingSlotId: 'slot_sec_-1_1_0',
      spawnQ: -37,
      spawnR: 37,
    });

    const elimReload = await getHomeHttp(url, elimGuest.accessToken, '?resolve=1');
    expect(elimReload.status).toBe(200);
    const elimV1 = HomeV1Schema.parse(elimReload.raw);
    expect(elimV1).toMatchObject({
      state: 'ELIMINATED',
      recap: {
        colonyId: elimColony.id,
        planetId: CANONICAL_PLANETS.desert.id,
        foundingSectorId: 'sec_-1_1',
      },
      recapSeen: false,
    });
    if (elimV1.state === 'ELIMINATED') {
      expect(elimV1.planets).toHaveLength(3);
    }

    const seenRes = await fetch(`${url}/v1/me/home/recap-seen`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${elimGuest.accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ colonyId: elimColony.id }),
    });
    expect(seenRes.status).toBe(200);
    const afterSeen = HomeV1Schema.parse(await seenRes.json());
    expect(afterSeen.state).toBe('NEW');

    const subsequentReload = await getHomeHttp(url, elimGuest.accessToken, '?resolve=1');
    expect(subsequentReload.body?.state).toBe('NEW');

    const { colony: endedColony } = await homeRepo.createColony({
      id: newId('co'),
      playerId: endedGuest.player.id,
      planetId: CANONICAL_PLANETS.ocean.id,
      colonyIndex: 1,
      name: 'Thalassa Haven',
      status: 'ACTIVE',
      foundingSectorId: 'sec_0_-1',
      landingSlotId: 'slot_sec_0_-1_1',
      spawnQ: 0,
      spawnR: -37,
    });
    await lifecycle.archiveWorld({
      planetId: CANONICAL_PLANETS.ocean.id,
      actor: 'admin_test',
      reason: 'explicit archival test',
    });

    const endedReload = await getHomeHttp(url, endedGuest.accessToken, '?resolve=1');
    const endedV1 = HomeV1Schema.parse(endedReload.raw);
    expect(endedV1).toMatchObject({
      state: 'PLANET_ENDED',
      results: {
        colonyId: endedColony.id,
        planetId: CANONICAL_PLANETS.ocean.id,
        foundingSectorId: 'sec_0_-1',
      },
      recapSeen: false,
    });

    const endedSeenRes = await fetch(`${url}/v1/me/home/recap-seen`, {
      method: 'POST',
      headers: { authorization: `Bearer ${endedGuest.accessToken}` },
    });
    expect(endedSeenRes.status).toBe(200);
    expect(HomeV1Schema.parse(await endedSeenRes.json()).state).toBe('NEW');
  });
});

describe('W11-20 — Direct HomeService.resolveHome state machine progression', () => {
  it('supports direct HomeService.resolveHome unit calls across NEW -> QUEUED -> ACTIVE -> ELIMINATED -> NEW', async () => {
    const { persistence, homeRepo, homeService, tickets } = createTicketFixture();
    await persistence.provisionAllCanonicalWorlds();
    const player = { id: newId('pr'), handle: 'UnitPilot' };

    const step1 = await homeService.resolveHome(player);
    expect(step1.state).toBe('NEW');

    const ticket = await tickets.enqueueTicket(player.id, {
      mode: 'JOIN_PLANET',
      planetType: 'desert',
      sectorId: 'sec_0_0',
    });
    const step2 = await homeService.resolveHome(player);
    expect(step2).toMatchObject({ state: 'QUEUED', ticketId: ticket.id });

    await tickets.cancelTicket(ticket.id, player.id);
    const { colony } = await homeRepo.createColony({
      id: ticket.colonyId,
      playerId: player.id,
      planetId: CANONICAL_PLANETS.desert.id,
      colonyIndex: 0,
      name: 'Kharon One',
      status: 'ACTIVE',
      foundingSectorId: 'sec_0_0',
      landingSlotId: 'slot_sec_0_0_0',
      spawnQ: 0,
      spawnR: 0,
    });

    const step3 = await homeService.resolveHome(player);
    expect(step3).toMatchObject({
      state: 'ACTIVE',
      colony: { id: colony.id, foundingSectorId: 'sec_0_0', landingSlotId: 'slot_sec_0_0_0' },
    });

    await homeService.setColonyStatus(colony.id, 'ELIMINATED');
    const step4 = await homeService.resolveHome(player);
    expect(step4).toMatchObject({
      state: 'ELIMINATED',
      recap: { colonyId: colony.id, foundingSectorId: 'sec_0_0' },
      recapSeen: false,
    });

    await homeService.markRecapSeen(player.id, colony.id);
    const step5 = await homeService.resolveHome(player);
    expect(step5.state).toBe('NEW');
  });
});

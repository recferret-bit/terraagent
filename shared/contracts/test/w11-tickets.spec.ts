import { describe, expect, it } from 'vitest';
import {
  CANONICAL_PLANETS,
  EnqueueTicketRequestV1Schema,
  HomeResponse,
  HomeV1Schema,
  MAP_LAYER_IDS,
  MAP_LAYER_META,
  MatchTicketV1Schema,
  PARTY_MAX_MEMBERS,
  PartyV1Schema,
  REST_ERROR_CODES,
  SectorReservationV1Schema,
  parseCommandArgs,
  parseMatchTicketRequest,
} from '../src';
import { NOW_ISO, makePlanetSummaryFixture } from './w11-contracts.spec';

const SAMPLE_PLAYER_ID = 'pr_01ARZ3NDEKTSV4RRFFQ69G5FAV';
const SAMPLE_COLONY_ID = 'co_01ARZ3NDEKTSV4RRFFQ69G5FAV';

describe('W11-01 · Ticket request validation and NEW_PLANET rejection', () => {
  it('rejects NEW_PLANET and same-planet TRANSFER and normalizes sector placement intent', () => {
    expect(parseMatchTicketRequest({ mode: 'NEW_PLANET', planetType: 'desert' })).toEqual({
      ok: false,
      errorCode: 'unsupported_mode',
      message: expect.stringContaining('NEW_PLANET'),
    });
    expect(EnqueueTicketRequestV1Schema.safeParse({ mode: 'NEW_PLANET', planetType: 'desert' }).success).toBe(false);
    expect(parseMatchTicketRequest({ mode: 'JOIN_PLANET', planetId: CANONICAL_PLANETS.desert.id }).ok).toBe(false);

    expect(
      parseMatchTicketRequest({ mode: 'JOIN_PLANET', planetId: CANONICAL_PLANETS.desert.id, sectorId: 'sec_0_0' }),
    ).toEqual({
      ok: true,
      value: {
        mode: 'JOIN_PLANET',
        planetId: CANONICAL_PLANETS.desert.id,
        planetType: 'desert',
        sectorIntent: { kind: 'chosen', sectorId: 'sec_0_0' },
      },
    });
    expect(parseMatchTicketRequest({ mode: 'JOIN_PLANET', planetType: 'ocean', autoSector: true })).toEqual({
      ok: true,
      value: {
        mode: 'JOIN_PLANET',
        planetId: CANONICAL_PLANETS.ocean.id,
        planetType: 'ocean',
        sectorIntent: { kind: 'auto' },
      },
    });
    expect(
      parseMatchTicketRequest({
        mode: 'TRANSFER',
        planetId: CANONICAL_PLANETS.desert.id,
        sourcePlanetId: CANONICAL_PLANETS.desert.id,
        autoSector: true,
      }).ok,
    ).toBe(false);
    expect(
      parseMatchTicketRequest({
        mode: 'TRANSFER',
        planetId: CANONICAL_PLANETS.temperate.id,
        sourcePlanetId: CANONICAL_PLANETS.desert.id,
        sectorId: 'sec_1_-1',
      }).ok,
    ).toBe(true);
  });
});

describe('W11-01 · Reservations, Parties, HomeV1, and spawnColony args', () => {
  it('validates SectorReservationV1, MatchTicketV1, and PartyV1 (cap 5)', () => {
    expect(
      SectorReservationV1Schema.parse({
        reservationId: 'res_01',
        ticketId: 'mt_01ARZ3NDEKTSV4RRFFQ69G5FAV',
        colonyId: SAMPLE_COLONY_ID,
        playerId: SAMPLE_PLAYER_ID,
        planetId: CANONICAL_PLANETS.desert.id,
        sectorId: 'sec_0_0',
        landingSlotId: 'slot_sec_0_0_2',
        slotIndex: 2,
        q: 8,
        r: 0,
        epoch: 1,
        expiresAt: NOW_ISO,
        state: 'HELD',
      }).landingSlotId,
    ).toBe('slot_sec_0_0_2');

    expect(
      MatchTicketV1Schema.parse({
        id: 'mt_01ARZ3NDEKTSV4RRFFQ69G5FAV',
        playerId: SAMPLE_PLAYER_ID,
        mode: 'JOIN_PLANET',
        planetId: CANONICAL_PLANETS.desert.id,
        planetType: 'desert',
        sectorIntent: { kind: 'chosen', sectorId: 'sec_0_0' },
        state: 'RESERVED',
        priority: 0,
        position: 0,
        etaS: 5,
        colonyId: SAMPLE_COLONY_ID,
        reservedPlanetId: CANONICAL_PLANETS.desert.id,
        reservedSectorId: 'sec_0_0',
        reservedLandingSlotId: 'slot_sec_0_0_2',
        reservationEpoch: 1,
        reservationExpiresAt: NOW_ISO,
        attempts: 1,
        failureCode: null,
        createdAt: NOW_ISO,
        updatedAt: NOW_ISO,
      }).reservedSectorId,
    ).toBe('sec_0_0');

    expect(PARTY_MAX_MEMBERS).toBe(5);
    const makeMember = (i: number) => ({ playerId: SAMPLE_PLAYER_ID, handle: `Pilot-${i}`, joinedAt: NOW_ISO });
    expect(
      PartyV1Schema.safeParse({
        id: 'pt_01',
        code: 'TERRA5',
        leaderId: SAMPLE_PLAYER_ID,
        planetId: CANONICAL_PLANETS.desert.id,
        sectorIntent: { kind: 'chosen', sectorId: 'sec_0_0' },
        state: 'OPEN',
        members: [0, 1, 2, 3, 4].map(makeMember),
        createdAt: NOW_ISO,
        updatedAt: NOW_ISO,
      }).success,
    ).toBe(true);
    expect(
      PartyV1Schema.safeParse({
        id: 'pt_01',
        code: 'TERRA6',
        leaderId: SAMPLE_PLAYER_ID,
        planetId: CANONICAL_PLANETS.desert.id,
        sectorIntent: { kind: 'chosen', sectorId: 'sec_0_0' },
        state: 'OPEN',
        members: [0, 1, 2, 3, 4, 5].map(makeMember),
        createdAt: NOW_ISO,
        updatedAt: NOW_ISO,
      }).success,
    ).toBe(false);
  });
});

describe('W11-01 · HomeV1, sectors map layer, and spawnColony args', () => {
  it('validates HomeV1, HomeResponse, sectors map layer, and spawnColony command', () => {
    const desert = makePlanetSummaryFixture('desert');
    const ocean = makePlanetSummaryFixture('ocean');
    const temperate = makePlanetSummaryFixture('temperate');
    const queuedHome = HomeV1Schema.parse({
      state: 'QUEUED',
      ticketId: 'mt_01ARZ3NDEKTSV4RRFFQ69G5FAV',
      ticketState: 'QUEUED',
      planetId: desert.id,
      planetType: 'desert',
      sectorIntent: { kind: 'chosen', sectorId: 'sec_0_0' },
      alternativeSectors: ['sec_1_0', 'sec_0_1'],
      position: 1,
      etaS: 12,
    });
    expect(HomeResponse.safeParse(queuedHome).success).toBe(true);
    expect(HomeV1Schema.parse({ state: 'NEW', planets: [desert, ocean, temperate] }).state).toBe('NEW');
    expect(MAP_LAYER_IDS).toContain('sectors');
    expect(MAP_LAYER_META.sectors.wave).toBe('W11');
    expect(REST_ERROR_CODES).toContain('unsupported_mode');
    expect(
      parseCommandArgs('system.spawnColony', {
        colonyId: SAMPLE_COLONY_ID,
        name: 'Alpha Base',
        sectorId: 'sec_0_0',
        landingSlotId: 'slot_sec_0_0_0',
        q: 0,
        r: 0,
      }).success,
    ).toBe(true);
  });
});

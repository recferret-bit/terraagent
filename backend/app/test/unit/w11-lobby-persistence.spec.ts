import 'reflect-metadata';
import {
  CANONICAL_PLANETS,
  PARTY_MAX_MEMBERS,
  type PlanetType,
} from '@terra/contracts';
import { describe, expect, it } from 'vitest';
import {
  buildDefaultCanonicalAtlasManifest,
  LobbyPersistenceConflictError,
  LobbyPersistenceService,
  MemoryLobbyStore,
} from '../../src/lobby';

function createService(): LobbyPersistenceService {
  return new LobbyPersistenceService(undefined, undefined, new MemoryLobbyStore());
}

describe('W11-02 — Canonical planet type uniqueness & concurrent provisioning', () => {
  it('provisions at most one canonical world per PlanetType across 30 concurrent calls (10 per type)', async () => {
    const svc = createService();
    const types: readonly PlanetType[] = ['desert', 'ocean', 'temperate'];
    const tasks = types.flatMap((type) =>
      Array.from({ length: 10 }, () =>
        svc.provisionCanonicalWorld({
          type,
          manifest: buildDefaultCanonicalAtlasManifest(type),
        }),
      ),
    );
    const results = await Promise.all(tasks);
    expect(results).toHaveLength(30);

    for (const type of types) {
      const forType = results.filter((r) => r.world.canonicalType === type);
      expect(forType).toHaveLength(10);
      expect(forType.filter((r) => r.created)).toHaveLength(1);
      const uniqueIds = new Set(forType.map((r) => r.world.id));
      expect([...uniqueIds]).toEqual([CANONICAL_PLANETS[type].id]);
    }

    const allWorlds = await svc.listCanonicalWorlds();
    expect(allWorlds.map((w) => [w.canonicalType, w.id, w.look])).toEqual([
      ['desert', CANONICAL_PLANETS.desert.id, 'dune'],
      ['ocean', CANONICAL_PLANETS.ocean.id, 'oceanForest'],
      ['temperate', CANONICAL_PLANETS.temperate.id, 'forestRock'],
    ]);
  });

  it('rejects non-canonical IDs, mismatched looks, or conflicting seeds for an existing canonical type', async () => {
    const svc = createService();
    await svc.provisionCanonicalWorld({ type: 'desert' });

    await expect(
      svc.provisionCanonicalWorld({ type: 'desert', id: 'pl_01JROGUE000000000000000000' }),
    ).rejects.toMatchObject({
      code: 'canonical_type_conflict',
    });

    await expect(
      svc.provisionCanonicalWorld({ type: 'desert', look: 'oceanForest' }),
    ).rejects.toMatchObject({
      code: 'canonical_type_conflict',
    });

    await expect(
      svc.provisionCanonicalWorld({ type: 'desert', seed: 'mutated-seed-v2' }),
    ).rejects.toMatchObject({
      code: 'canonical_type_conflict',
    });
  });
});

describe('W11-02 — Immutable atlas versions', () => {
  it('pins (planetId, atlasVersion) idempotently on identical manifest and rejects any hash/config mutation', async () => {
    const svc = createService();
    const manifestV1 = buildDefaultCanonicalAtlasManifest('temperate', { atlasVersion: 1 });
    await svc.provisionCanonicalWorld({ type: 'temperate', manifest: manifestV1 });

    const secondSave = await svc.pinAtlasVersion(manifestV1);
    expect(secondSave.created).toBe(false);
    expect(secondSave.record.atlasHash).toBe(manifestV1.atlasHash);

    const mutatedHash = { ...manifestV1, atlasHash: 'tampered-atlas-hash-999' };
    await expect(svc.pinAtlasVersion(mutatedHash)).rejects.toMatchObject({
      code: 'atlas_version_immutable',
    });

    const mutatedConfig = { ...manifestV1, configHash: 'tampered-config-hash-999' };
    await expect(svc.pinAtlasVersion(mutatedConfig)).rejects.toMatchObject({
      code: 'atlas_version_immutable',
    });

    const manifestV2 = buildDefaultCanonicalAtlasManifest('temperate', {
      atlasVersion: 2,
      configVersion: 2,
    });
    const savedV2 = await svc.pinAtlasVersion(manifestV2);
    expect(savedV2.created).toBe(true);

    const versions = await svc.listAtlasVersions(CANONICAL_PLANETS.temperate.id);
    expect(versions.map((v) => v.atlasVersion)).toEqual([1, 2]);
    expect(versions[0]!.atlasHash).toBe(manifestV1.atlasHash);
    expect(versions[1]!.atlasHash).toBe(manifestV2.atlasHash);
  });
});

describe('W11-02 — Concurrent sector slot reservations & capacity invariants', () => {
  it('serializes 12 concurrent callers against a validatedCapacity=4 sector with zero duplicate slots or overbooking', async () => {
    const svc = createService();
    const manifest = buildDefaultCanonicalAtlasManifest('desert', {
      foundingSeatsPerSector: 4,
      validatedSeatsPerSector: 4,
    });
    const { world } = await svc.provisionCanonicalWorld({ type: 'desert', manifest });

    const outcomes = await Promise.all(
      Array.from({ length: 12 }, (_, idx) =>
        svc.reserveSectorSlot({
          planetId: world.id,
          sectorId: 'sec_0_0',
          playerId: `pr_racer_${idx}`,
          ticketId: `tk_racer_${idx}`,
          colonyId: `co_racer_${idx}`,
        }),
      ),
    );

    const succeeded = outcomes.filter((o): o is Extract<typeof o, { ok: true }> => o.ok);
    const rejected = outcomes.filter((o): o is Extract<typeof o, { ok: false }> => !o.ok);
    expect(succeeded).toHaveLength(4);
    expect(rejected).toHaveLength(8);
    expect(rejected.every((r) => r.reason === 'sector_full')).toBe(true);

    const assignedSlotIds = succeeded.map((s) => s.reservation.landingSlotId).sort();
    expect(assignedSlotIds).toEqual([
      'slot_sec_0_0_0',
      'slot_sec_0_0_1',
      'slot_sec_0_0_2',
      'slot_sec_0_0_3',
    ]);

    const sector = await svc.getSector(world.id, 'sec_0_0');
    expect(sector).toMatchObject({
      foundingCapacity: 4,
      validatedCapacity: 4,
      reservedSeats: 4,
      foundedSeats: 0,
      freeSeats: 0,
    });
  });

  it('serializes 12 concurrent callers targeting the exact same landingSlotId so only 1 wins', async () => {
    const svc = createService();
    const manifest = buildDefaultCanonicalAtlasManifest('ocean', {
      foundingSeatsPerSector: 4,
      validatedSeatsPerSector: 4,
    });
    const { world } = await svc.provisionCanonicalWorld({ type: 'ocean', manifest });

    const outcomes = await Promise.all(
      Array.from({ length: 12 }, (_, idx) =>
        svc.reserveSectorSlot({
          planetId: world.id,
          sectorId: 'sec_0_0',
          landingSlotId: 'slot_sec_0_0_0',
          playerId: `pr_same_slot_${idx}`,
          ticketId: `tk_same_slot_${idx}`,
          colonyId: `co_same_slot_${idx}`,
        }),
      ),
    );

    const succeeded = outcomes.filter((o): o is Extract<typeof o, { ok: true }> => o.ok);
    const rejected = outcomes.filter((o): o is Extract<typeof o, { ok: false }> => !o.ok);
    expect(succeeded).toHaveLength(1);
    expect(rejected).toHaveLength(11);
    expect(rejected.every((r) => r.reason === 'slot_taken')).toBe(true);

    const sector = await svc.getSector(world.id, 'sec_0_0');
    expect(sector).toMatchObject({ reservedSeats: 1, foundedSeats: 0, freeSeats: 3 });
  });
});

describe('W11-02 — Reservation lifecycle, epoch fencing & founded seat retention', () => {
  it('commits, releases idempotently, fences epochs, and retains committed founded seats', async () => {
    const svc = createService();
    const { world } = await svc.provisionCanonicalWorld({
      type: 'temperate',
      manifest: buildDefaultCanonicalAtlasManifest('temperate'),
    });

    const first = await svc.reserveSectorSlotOrThrow({
      planetId: world.id,
      sectorId: 'sec_0_0',
      playerId: 'pr_1',
      ticketId: 'tk_1',
      colonyId: 'co_1',
    });
    expect(first.reservation.epoch).toBe(1);

    const released1 = await svc.releaseReservation(first.reservation.reservationId, 'RELEASED');
    const released2 = await svc.releaseReservation(first.reservation.reservationId, 'RELEASED');
    expect(released1.released).toBe(true);
    expect(released2.released).toBe(false);
    expect((await svc.getSector(world.id, 'sec_0_0'))?.reservedSeats).toBe(0);

    const second = await svc.reserveSectorSlotOrThrow({
      planetId: world.id,
      sectorId: 'sec_0_0',
      landingSlotId: first.reservation.landingSlotId,
      playerId: 'pr_2',
      ticketId: 'tk_2',
      colonyId: 'co_2',
    });
    expect(second.reservation.epoch).toBe(2);

    await expect(svc.commitReservation(second.reservation.reservationId, 1)).rejects.toMatchObject({
      code: 'reservation_fenced',
    });

    const committed = await svc.commitReservation(second.reservation.reservationId, 2);
    expect(committed.state).toBe('COMMITTED');
    expect(await svc.getSector(world.id, 'sec_0_0')).toMatchObject({
      reservedSeats: 0,
      foundedSeats: 1,
      freeSeats: 3,
    });

    await expect(svc.releaseReservation(second.reservation.reservationId)).rejects.toMatchObject({
      code: 'reservation_fenced',
    });
  });
});

describe('W11-02 — Matchmaking tickets & 5-member party persistence', () => {
  it('deduplicates identical ticket intents, rejects NEW_PLANET and conflicting open tickets', async () => {
    const svc = createService();
    await expect(
      svc.enqueueTicket({
        playerId: 'pr_tk_1',
        request: { mode: 'NEW_PLANET', planetType: 'desert' },
      }),
    ).rejects.toMatchObject({ code: 'unsupported_mode' });

    const concurrentSame = await Promise.all(
      Array.from({ length: 10 }, () =>
        svc.enqueueTicket({
          playerId: 'pr_tk_1',
          request: {
            mode: 'JOIN_PLANET',
            planetId: CANONICAL_PLANETS.desert.id,
            sectorId: 'sec_0_0',
          },
        }),
      ),
    );
    expect(concurrentSame.filter((r) => r.created)).toHaveLength(1);
    expect(new Set(concurrentSame.map((r) => r.ticket.id)).size).toBe(1);

    await expect(
      svc.enqueueTicket({
        playerId: 'pr_tk_1',
        request: {
          mode: 'JOIN_PLANET',
          planetId: CANONICAL_PLANETS.ocean.id,
          sectorId: 'sec_0_0',
        },
      }),
    ).rejects.toMatchObject({ code: 'ticket_open' });
  });

  it('enforces PARTY_MAX_MEMBERS = 5, rejects the 6th member with party_full, and promotes leader on leave', async () => {
    const svc = createService();
    const party = await svc.createParty({
      leaderId: 'pr_leader',
      leaderHandle: 'Leader',
      planetId: CANONICAL_PLANETS.desert.id,
      sectorIntent: { kind: 'chosen', sectorId: 'sec_0_0' },
    });
    expect(party.members).toHaveLength(1);

    for (let i = 2; i <= PARTY_MAX_MEMBERS; i++) {
      const updated = await svc.joinParty({
        partyIdOrCode: party.code,
        playerId: `pr_member_${i}`,
        handle: `Member ${i}`,
      });
      expect(updated.members).toHaveLength(i);
    }

    await expect(
      svc.joinParty({
        partyIdOrCode: party.id,
        playerId: 'pr_member_6',
        handle: 'Sixth Wheel',
      }),
    ).rejects.toThrow(LobbyPersistenceConflictError);

    await expect(
      svc.joinParty({
        partyIdOrCode: party.id,
        playerId: 'pr_member_6',
        handle: 'Sixth Wheel',
      }),
    ).rejects.toMatchObject({ code: 'party_full' });

    const afterLeaderLeaves = await svc.leaveParty({
      partyId: party.id,
      playerId: 'pr_leader',
    });
    expect(afterLeaderLeaves.leaderId).toBe('pr_member_2');
    expect(afterLeaderLeaves.members).toHaveLength(4);
  });
});

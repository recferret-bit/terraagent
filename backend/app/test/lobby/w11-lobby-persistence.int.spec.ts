import 'reflect-metadata';
import { CANONICAL_PLANETS, PARTY_MAX_MEMBERS } from '@terra/contracts';
import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  buildDefaultCanonicalAtlasManifest,
  ConcurrencyConflictError,
  LobbyPersistenceService,
  PrismaLobbyStore,
  WorldLifecycleService,
} from '../../src/lobby';

let db: TestDatabase;
beforeAll(async () => {
  db = await createTestDatabase();
});
afterAll(async () => {
  await db?.drop();
});

describe('W11-02 — PrismaLobbyStore on PostgreSQL', () => {
  it('enforces canonical type uniqueness, immutable atlas versions, atomic slot reservations, and 5-member parties in Postgres', async () => {
    const svc = new LobbyPersistenceService(db.prisma, undefined, new PrismaLobbyStore(db.prisma));

    // 1. Concurrent canonical world provisioning in Postgres
    const desertManifest = buildDefaultCanonicalAtlasManifest('desert', {
      foundingSeatsPerSector: 4,
      validatedSeatsPerSector: 4,
    });
    const concurrentProvision = await Promise.all(
      Array.from({ length: 8 }, () =>
        svc.provisionCanonicalWorld({ type: 'desert', manifest: desertManifest }),
      ),
    );
    expect(concurrentProvision.filter((r) => r.created)).toHaveLength(1);
    expect(
      await db.prisma.planet.count({ where: { canonicalType: 'desert' } }),
    ).toBe(1);

    // 2. Immutable atlas version check in Postgres
    await expect(
      svc.pinAtlasVersion({ ...desertManifest, atlasHash: 'mutated-hash' }),
    ).rejects.toMatchObject({ code: 'atlas_version_immutable' });

    // 3. Concurrent slot reservations in Postgres (10 callers for 4 seats in sec_0_0)
    const outcomes = await Promise.all(
      Array.from({ length: 10 }, (_, idx) =>
        svc.reserveSectorSlot({
          planetId: CANONICAL_PLANETS.desert.id,
          sectorId: 'sec_0_0',
          playerId: `pr_pg_${idx}`,
          ticketId: `tk_pg_${idx}`,
          colonyId: `co_pg_${idx}`,
        }),
      ),
    );
    const won = outcomes.filter((o) => o.ok);
    const full = outcomes.filter((o) => !o.ok);
    expect(won).toHaveLength(4);
    expect(full).toHaveLength(6);

    const sector = await svc.getSector(CANONICAL_PLANETS.desert.id, 'sec_0_0');
    expect(sector).toMatchObject({
      validatedCapacity: 4,
      reservedSeats: 4,
      foundedSeats: 0,
      freeSeats: 0,
    });

    // 4. Ticket & Party persistence in Postgres
    const tk = await svc.enqueueTicket({
      playerId: 'pr_pg_tk',
      idempotencyKey: 'idem-pg-1',
      request: {
        mode: 'JOIN_PLANET',
        planetId: CANONICAL_PLANETS.desert.id,
        sectorId: 'sec_0_0',
      },
    });
    expect(tk.created).toBe(true);
    const tkDup = await svc.enqueueTicket({
      playerId: 'pr_pg_tk',
      idempotencyKey: 'idem-pg-1',
      request: {
        mode: 'JOIN_PLANET',
        planetId: CANONICAL_PLANETS.desert.id,
        sectorId: 'sec_0_0',
      },
    });
    expect(tkDup.created).toBe(false);
    expect(tkDup.ticket.id).toBe(tk.ticket.id);

    const party = await svc.createParty({
      leaderId: 'pr_pg_leader',
      leaderHandle: 'PG Leader',
    });
    for (let i = 2; i <= PARTY_MAX_MEMBERS; i++) {
      await svc.joinParty({
        partyIdOrCode: party.code,
        playerId: `pr_pg_m_${i}`,
        handle: `PG Member ${i}`,
      });
    }
    await expect(
      svc.joinParty({
        partyIdOrCode: party.code,
        playerId: 'pr_pg_m_6',
        handle: 'PG Member 6',
      }),
    ).rejects.toMatchObject({ code: 'party_full' });
  });
});

describe('W11-03 — WorldLifecycleService & PrismaLobbyStore on PostgreSQL', () => {
  it('enforces W11-03 optimistic concurrency, audited pause/resume, and no age-sealing on PostgreSQL', async () => {
    const svc = new LobbyPersistenceService(db.prisma, undefined, new PrismaLobbyStore(db.prisma));
    const lifecycle = new WorldLifecycleService(svc);

    const oceanManifest = buildDefaultCanonicalAtlasManifest('ocean', {
      foundingSeatsPerSector: 3,
      validatedSeatsPerSector: 3,
    });
    const { world } = await svc.provisionCanonicalWorld({ type: 'ocean', manifest: oceanManifest });

    const racePause = await Promise.allSettled([
      lifecycle.pausePlanetAdmission({
        planetId: world.id,
        actor: 'pg_op_1',
        reason: 'pg race 1',
        expectedUpdatedAt: world.updatedAt,
      }),
      lifecycle.pausePlanetAdmission({
        planetId: world.id,
        actor: 'pg_op_2',
        reason: 'pg race 2',
        expectedUpdatedAt: world.updatedAt,
      }),
    ]);
    expect(racePause.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = racePause.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toBeInstanceOf(ConcurrencyConflictError);

    const resumed = await lifecycle.resumePlanetAdmission({
      planetId: world.id,
      actor: 'pg_op_1',
      reason: 'pg resume',
    });
    expect(resumed.admission).toBe('OPEN');
    expect(resumed.availability).toBe('open');

    const age7d = await lifecycle.evaluateElapsedAge(world.id, 7 * 24 * 3_600_000);
    expect(age7d).toMatchObject({
      ageSealed: false,
      expired: false,
      lifecycle: 'ACTIVE',
      admission: 'OPEN',
      availability: 'open',
    });
  });
});

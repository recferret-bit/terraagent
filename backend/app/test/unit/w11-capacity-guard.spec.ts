import 'reflect-metadata';
import {
  CANONICAL_PLANET_IDS,
  CANONICAL_PLANETS,
  newId,
  type PlanetType,
} from '@terra/contracts';
import { buildAtlasManifest, buildDefaultAtlasConfig } from '@terra/sim';
import { describe, expect, it } from 'vitest';
import { MetricsRegistry } from '../../src/core/metrics.registry';
import {
  assertCanonicalWorldIdentity,
  assertWorldProvisionBudget,
  buildDefaultCanonicalAtlasManifest,
  CANONICAL_WORLDS_CAP,
  CanonicalCapacityGuardService,
  CanonicalWorldProvisioningService,
  CapacityGuardError,
  LobbyPersistenceService,
  MatchmakerService,
  MemoryLobbyStore,
  MM_CAPACITY_BLOCKED_METRIC,
  PlanetsService,
  SectorReservationService,
  validateWorldProvisionBudget,
  WARM_POOL_ENABLED,
  WARM_POOL_PER_TYPE,
  WorldLifecycleService,
} from '../../src/lobby';

async function createCapacityGuardFixture(foundingSeatsPerSector = 4) {
  const persistence = new LobbyPersistenceService(undefined, undefined, new MemoryLobbyStore());
  const lifecycle = new WorldLifecycleService(persistence);
  const reservations = new SectorReservationService(persistence, lifecycle);
  const matchmaker = new MatchmakerService(persistence, reservations, lifecycle);
  const metrics = new MetricsRegistry();
  const capacityGuard = new CanonicalCapacityGuardService(
    persistence,
    lifecycle,
    matchmaker,
    metrics,
  );
  const planets = new PlanetsService(persistence, lifecycle);
  const provisioning = new CanonicalWorldProvisioningService(persistence, lifecycle);

  await persistence.provisionAllCanonicalWorlds({
    foundingSeatsPerSector,
    validatedSeatsPerSector: foundingSeatsPerSector,
  });

  return {
    persistence,
    lifecycle,
    reservations,
    matchmaker,
    metrics,
    capacityGuard,
    planets,
    provisioning,
  };
}

async function fillPlanetSlots(
  persistence: LobbyPersistenceService,
  matchmaker: MatchmakerService,
  type: PlanetType,
  count: number,
  commitCount = 0,
) {
  const reservations = [];
  for (let i = 0; i < count; i++) {
    const { ticket } = await persistence.enqueueTicket({
      id: `tk_fill_${type}_${i}`,
      playerId: newId('pr'),
      colonyId: newId('co'),
      request: {
        mode: 'JOIN_PLANET',
        planetType: type,
        sectorIntent: { mode: 'auto' },
      },
    });
    const res = await matchmaker.processTicket(ticket);
    expect(res.outcome).toBe('reserved');
    if (res.reservation && i < commitCount) {
      await persistence.commitReservation(res.reservation.reservationId);
    }
    if (res.reservation) reservations.push(res.reservation);
  }
  return reservations;
}

async function enqueueExcessClusterDemand(persistence: LobbyPersistenceService) {
  await persistence.enqueueTicket({
    id: 'tk_excess_desert_auto_1',
    playerId: newId('pr'),
    request: { mode: 'JOIN_PLANET', planetType: 'desert', sectorIntent: { mode: 'auto' } },
  });
  await persistence.enqueueTicket({
    id: 'tk_excess_desert_chosen_2',
    playerId: newId('pr'),
    request: { mode: 'JOIN_PLANET', planetType: 'desert', sectorId: 'sec_0_0' },
  });
  await persistence.enqueueTicket({
    id: 'tk_excess_ocean_auto_3',
    playerId: newId('pr'),
    request: { mode: 'JOIN_PLANET', planetType: 'ocean', sectorIntent: { mode: 'auto' } },
  });
  await persistence.enqueueTicket({
    id: 'tk_excess_temperate_chosen_4',
    playerId: newId('pr'),
    request: { mode: 'JOIN_PLANET', planetType: 'temperate', sectorId: 'sec_1_0' },
  });
  await persistence.enqueueTicket({
    id: 'tk_excess_transfer_ocean_5',
    playerId: newId('pr'),
    transferCarry: {
      sourcePlanetId: CANONICAL_PLANETS.desert.id,
      sourceColonyId: 'col_desert_01',
      carryOver: { metals: 100 },
    },
    request: {
      mode: 'TRANSFER',
      planetType: 'ocean',
      sectorIntent: { mode: 'auto' },
      sourcePlanetId: CANONICAL_PLANETS.desert.id,
      sourceColonyId: 'col_desert_01',
    },
  });
}

describe('W11-15 — Acceptance: Exhaust all slots → queued demand and exactly three canonical identities', () => {
  it('exhausts all 84 safe landing slots across desert, ocean, and temperate (X=4, 28/world), keeps excess demand QUEUED, increments capacityBlockedTotal, and maintains strictly 3 canonical worlds', async () => {
    const { persistence, matchmaker, capacityGuard, planets, metrics } =
      await createCapacityGuardFixture(4);

    const initialSnap = await capacityGuard.getCapacitySnapshot();
    expect(initialSnap).toMatchObject({
      canonicalWorldsCount: 3,
      maxCanonicalWorlds: 3,
      warmPoolEnabled: false,
      warmPoolCount: 0,
      overflowWorldsCount: 0,
      totalNominalCapacity: 84,
      totalValidatedSafeSites: 84,
      totalReservedSeats: 0,
      totalFoundedSeats: 0,
      totalFreeSeats: 84,
      queuedTicketsCount: 0,
      capacityBlockedTotal: 0,
      allSlotsExhausted: false,
    });

    await fillPlanetSlots(persistence, matchmaker, 'desert', 28, 10);
    await fillPlanetSlots(persistence, matchmaker, 'ocean', 28, 12);
    await fillPlanetSlots(persistence, matchmaker, 'temperate', 28, 8);

    const fullSnap = await capacityGuard.evaluateClusterCapacity();
    expect(fullSnap).toMatchObject({
      canonicalWorldsCount: 3,
      totalNominalCapacity: 84,
      totalValidatedSafeSites: 84,
      totalFoundedSeats: 30,
      totalReservedSeats: 54,
      totalTakenSeats: 84,
      totalFreeSeats: 0,
      queuedTicketsCount: 0,
      capacityBlockedTotal: 0,
      allSlotsExhausted: true,
    });

    await enqueueExcessClusterDemand(persistence);

    const tickResult = await capacityGuard.runGuardedMatchmakerTick(matchmaker);
    expect(tickResult).toMatchObject({
      reserved: 0,
      queued: 5,
      transferPending: 1,
      capacityBlockedInTick: 5,
      capacityBlockedTotal: 5,
      canonicalWorldsCount: 3,
      warmPoolCreated: 0,
      overflowWorldsCreated: 0,
    });

    expect(tickResult.capacity).toMatchObject({
      canonicalWorldsCount: 3,
      canonicalPlanetIds: CANONICAL_PLANET_IDS,
      totalValidatedSafeSites: 84,
      totalFoundedSeats: 30,
      totalReservedSeats: 54,
      totalFreeSeats: 0,
      queuedTicketsCount: 5,
      queuedDemand: 5,
      capacityBlockedTotal: 5,
      mm_capacity_blocked_total: 5,
      capacityBlockedByPlanet: {
        desert: 2,
        ocean: 2,
        temperate: 1,
        [CANONICAL_PLANETS.desert.id]: 2,
        [CANONICAL_PLANETS.ocean.id]: 2,
        [CANONICAL_PLANETS.temperate.id]: 1,
      },
    });

    expect((await persistence.listCanonicalWorlds()).map((w) => w.id)).toEqual([
      ...CANONICAL_PLANET_IDS,
    ]);
    const planetList = await planets.listPlanets();
    expect(planetList.planets).toHaveLength(3);
    expect(planetList.planets.every((p) => p.availability === 'full' && p.freeSeats === 0)).toBe(
      true,
    );
    expect(await metrics.render()).toContain(`${MM_CAPACITY_BLOCKED_METRIC} 5`);
  });
});

describe('W11-15 — Single-planet exhaustion & slot release recovery', () => {
  it('tracks single-planet exhaustion and assigns the next queued ticket when 1 reservation releases', async () => {
    const { persistence, matchmaker, capacityGuard } = await createCapacityGuardFixture(1);
    const heldOnDesert = await fillPlanetSlots(persistence, matchmaker, 'desert', 7, 0);

    const { ticket: waiting1 } = await persistence.enqueueTicket({
      id: 'tk_wait_desert_1',
      playerId: newId('pr'),
      priority: 5,
      request: { mode: 'JOIN_PLANET', planetType: 'desert', sectorIntent: { mode: 'auto' } },
    });
    const { ticket: waiting2 } = await persistence.enqueueTicket({
      id: 'tk_wait_desert_2',
      playerId: newId('pr'),
      priority: 1,
      request: { mode: 'JOIN_PLANET', planetType: 'desert', sectorIntent: { mode: 'auto' } },
    });

    const blockedTick = await capacityGuard.runGuardedMatchmakerTick();
    expect(blockedTick.reserved).toBe(0);
    expect(blockedTick.queued).toBe(2);
    expect(blockedTick.capacityBlockedInTick).toBe(2);
    expect(blockedTick.capacity.byPlanet.desert.isFull).toBe(true);
    expect(blockedTick.capacity.byPlanet.desert.freeSeats).toBe(0);
    expect(blockedTick.capacity.byPlanet.desert.queuedTicketsCount).toBe(2);
    expect(blockedTick.capacity.byPlanet.ocean.freeSeats).toBe(7);

    await persistence.cancelTicket(heldOnDesert[0]!.ticketId, heldOnDesert[0]!.playerId);

    const recoveryTick = await capacityGuard.runGuardedMatchmakerTick();
    expect(recoveryTick.reserved).toBe(1);
    expect(recoveryTick.reservedTickets[0]?.id).toBe(waiting1.id);
    expect(recoveryTick.queued).toBe(1);
    expect(recoveryTick.queuedTickets[0]?.id).toBe(waiting2.id);
    expect(recoveryTick.capacityBlockedInTick).toBe(1);
    expect(recoveryTick.capacityBlockedTotal).toBe(3);
    expect(recoveryTick.canonicalWorldsCount).toBe(3);
  });
});

describe('W11-15 — Warm-pool & non-canonical world rejection (MM-42..44)', () => {
  it('disables warm-pool operations and rejects non-canonical, overflow, or 4th worlds before allocation', async () => {
    const { capacityGuard, provisioning } = await createCapacityGuardFixture(4);

    expect(WARM_POOL_ENABLED).toBe(false);
    expect(WARM_POOL_PER_TYPE).toBe(0);
    expect(CANONICAL_WORLDS_CAP).toBe(3);

    expect(() => capacityGuard.provisionWarmPoolWorld({ type: 'desert' })).toThrow(
      CapacityGuardError,
    );
    expect(() => capacityGuard.provisionWarmPoolWorld({ type: 'desert' })).toThrow(
      /warm_pool_disabled/,
    );
    expect(() => capacityGuard.topUpWarmPool()).toThrow(/warm_pool_disabled/);
    expect(() => capacityGuard.trimWarmPool()).toThrow(/warm_pool_disabled/);
    expect(() =>
      assertCanonicalWorldIdentity({ type: 'desert', source: 'warm_pool' }),
    ).toThrow(/warm_pool_disabled/);
    expect(() =>
      assertCanonicalWorldIdentity({ type: 'ocean', warmPool: true }),
    ).toThrow(/warm_pool_disabled/);
    expect(() => assertCanonicalWorldIdentity('warm_pool_desert_01')).toThrow(
      /warm_pool_disabled/,
    );

    expect(() => capacityGuard.createOverflowWorld({ type: 'desert' })).toThrow(
      /non_canonical_world_forbidden/,
    );
    expect(() => capacityGuard.provisionOverflowWorld({ type: 'temperate' })).toThrow(
      /non_canonical_world_forbidden/,
    );
    expect(() =>
      assertCanonicalWorldIdentity({ type: 'desert', isOverflow: true }),
    ).toThrow(/non_canonical_world_forbidden/);
    expect(() =>
      assertCanonicalWorldIdentity({ type: 'desert', source: 'on_demand' }),
    ).toThrow(/non_canonical_world_forbidden/);
    expect(() =>
      assertCanonicalWorldIdentity({ type: 'desert', worldIndex: 3 }),
    ).toThrow(/non_canonical_world_forbidden/);
    expect(() => assertCanonicalWorldIdentity('volcanic')).toThrow(
      /non_canonical_world_forbidden/,
    );
    expect(() => assertCanonicalWorldIdentity('pl_01JFOURTHWORLD000000000000')).toThrow(
      /non_canonical_world_forbidden/,
    );
    expect(() =>
      assertCanonicalWorldIdentity({ type: 'desert', id: CANONICAL_PLANETS.ocean.id }),
    ).toThrow(/non_canonical_world_forbidden/);

    await expect(
      capacityGuard.guardWorldProvisioning({
        type: 'desert',
        id: 'pl_01JOVERFLOW000000000000000',
      }),
    ).rejects.toMatchObject({ code: 'non_canonical_world_forbidden' });

    await expect(
      provisioning.provisionCanonicalWorld('pl_01JOVERFLOW000000000000000'),
    ).rejects.toMatchObject({ code: 'canonical_type_conflict' });
  });
});

describe('W11-15 — Small-atlas rollout & safe-site budget validation before allocation', () => {
  it('validates small-atlas rollout and safe-site budgets before allocation and rejects oversized configs', async () => {
    const { capacityGuard, provisioning, persistence } = await createCapacityGuardFixture(4);

    for (const seats of [3, 4, 5] as const) {
      const validManifest = buildDefaultCanonicalAtlasManifest('desert', {
        foundingSeatsPerSector: seats,
        validatedSeatsPerSector: seats,
      });
      const check = capacityGuard.validateWorldProvisionBudget(validManifest);
      expect(check.ok).toBe(true);
      expect(check.planetId).toBe(CANONICAL_PLANETS.desert.id);
      expect(check.observed.nominalCapacity).toBe(7 * seats);
      expect(check.observed.validatedSafeSites).toBe(7 * seats);
    }

    const overSeatsConfig = buildDefaultAtlasConfig({
      planetType: 'desert',
      sectorRadius: 48,
      foundingSeatsPerSector: 6,
    });
    const overSeatsCheck = validateWorldProvisionBudget(overSeatsConfig);
    expect(overSeatsCheck.ok).toBe(false);
    expect(overSeatsCheck.code).toBe('rollout_limit_exceeded');
    expect(overSeatsCheck.violations.map((v) => v.field)).toContain('maxFoundingSeatsPerSector');

    const overRadiusConfig = buildDefaultAtlasConfig({
      planetType: 'ocean',
      sectorRadius: 52,
      foundingSeatsPerSector: 4,
    });
    const overRadiusCheck = validateWorldProvisionBudget(overRadiusConfig);
    expect(overRadiusCheck.ok).toBe(false);
    expect(overRadiusCheck.code).toBe('rollout_limit_exceeded');
    expect(overRadiusCheck.violations.map((v) => v.field)).toContain('maxSectorRadius');

    const overValidatedCheck = validateWorldProvisionBudget({
      type: 'temperate',
      foundingSeatsPerSector: 4,
      validatedSeatsPerSector: 5,
    });
    expect(overValidatedCheck.ok).toBe(false);
    expect(overValidatedCheck.code).toBe('safe_site_budget_exceeded');
    expect(overValidatedCheck.violations.map((v) => v.field)).toContain(
      'validatedSafeSitesExceedsFoundingCapacity',
    );

    const oceanSafeSiteCheck = validateWorldProvisionBudget({
      type: 'ocean',
      sectors: [
        { sectorId: 'sec_0_0', kind: 'land', foundingCapacity: 4, validatedSafeSites: 4 },
        { sectorId: 'sec_2_0', kind: 'ocean', foundingCapacity: 2, validatedSafeSites: 2 },
      ],
    });
    expect(oceanSafeSiteCheck.ok).toBe(false);
    expect(oceanSafeSiteCheck.violations.map((v) => v.field)).toContain('oceanSectorSafeSites');

    expect(() =>
      assertWorldProvisionBudget({ type: 'desert', totalSectors: 25, landSectors: 10 }),
    ).toThrow(CapacityGuardError);

    const oversizedManifest = buildAtlasManifest(overSeatsConfig);
    await expect(
      capacityGuard.provisionGuardedCanonicalWorld({ type: 'desert', manifest: oversizedManifest }),
    ).rejects.toMatchObject({ code: 'rollout_limit_exceeded' });
    await expect(
      persistence.provisionCanonicalWorld({ type: 'desert', manifest: oversizedManifest }),
    ).rejects.toMatchObject({ code: 'rollout_limit_exceeded' });
    await expect(
      provisioning.provisionCanonicalWorld('desert', { forceReload: true, foundingSeatsPerSector: 6 }),
    ).rejects.toMatchObject({ code: 'rollout_limit_exceeded' });
  });

  it('evaluates individual ticket capacity via evaluateTicketCapacity without double-counting ProcessTicketResult', async () => {
    const { persistence, matchmaker, capacityGuard } = await createCapacityGuardFixture(1);
    await fillPlanetSlots(persistence, matchmaker, 'temperate', 7, 7);

    const { ticket } = await persistence.enqueueTicket({
      id: 'tk_eval_single',
      playerId: newId('pr'),
      request: { mode: 'JOIN_PLANET', planetType: 'temperate', sectorId: 'sec_0_0' },
    });

    const directEval = await capacityGuard.evaluateTicketCapacity(ticket);
    expect(directEval.blocked).toBe(true);
    expect(directEval.freeSeats).toBe(0);
    expect(directEval.capacityBlockedTotal).toBe(1);

    const procResult = await matchmaker.processTicket(ticket);
    expect(procResult.outcome).toBe('queued_chosen_sector_full');
    expect(capacityGuard.getCapacityBlockedTotal()).toBe(2);

    const dedupedEval = await capacityGuard.evaluateTicketCapacity(procResult);
    expect(dedupedEval.blocked).toBe(true);
    expect(dedupedEval.capacityBlockedTotal).toBe(2);
  });
});

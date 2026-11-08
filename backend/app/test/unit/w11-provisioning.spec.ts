import 'reflect-metadata';
import {
  AtlasManifestV1Schema,
  CANONICAL_PLANETS,
  PlanetListV1Schema,
  PublicPlanetStatsV1Schema,
  type PlanetType,
} from '@terra/contracts';
import { describe, expect, it } from 'vitest';
import { HomeRepository } from '../../src/core/home/home.repository';
import {
  CanonicalWorldProvisioningService,
  InvalidLifecycleTransitionError,
  LobbyPersistenceConflictError,
  LobbyPersistenceService,
  MemoryLobbyStore,
  PlanetsService,
  WorldLifecycleService,
  type CanonicalWorldLoadRequest,
  type ProvisionAllCanonicalWorldsResult,
} from '../../src/lobby';

function createProvisioningFixture() {
  const persistence = new LobbyPersistenceService(undefined, undefined, new MemoryLobbyStore());
  const lifecycle = new WorldLifecycleService(persistence);
  const homeRepo = new HomeRepository();
  const planets = new PlanetsService(persistence, lifecycle, homeRepo);
  const provisioning = new CanonicalWorldProvisioningService(persistence, lifecycle, homeRepo);
  return {
    persistence,
    lifecycle,
    homeRepo,
    planets,
    provisioning,
  };
}

async function assertProvisionedWorldState(
  fixture: ReturnType<typeof createProvisioningFixture>,
  initial: ProvisionAllCanonicalWorldsResult,
  type: PlanetType,
) {
  const { persistence, homeRepo } = fixture;
  const canonical = CANONICAL_PLANETS[type];
  const outcome = initial.byType[type]!;
  expect(outcome).toBeDefined();
  expect(outcome).toMatchObject({
    ok: true,
    created: true,
    planetId: canonical.id,
    type,
    look: canonical.look,
    lifecycle: 'ACTIVE',
    health: 'OK',
    admission: 'OPEN',
    availability: 'open',
    faultCode: null,
    retryCount: 0,
    placementAttempts: 1,
    attemptsUsed: 1,
    attemptedPlanetIds: [canonical.id],
    healthHistory: ['LOADING', 'OK'],
    loaded: true,
  });

  const parsedManifest = AtlasManifestV1Schema.parse(outcome.manifest);
  expect(parsedManifest).toMatchObject({
    planetId: canonical.id,
    planetType: type,
    totalSectors: 19,
    landSectors: 7,
    oceanSectors: 12,
    nominalCapacity: 28,
    validatedCapacity: 28,
  });

  const pinned = await persistence.getAtlasVersion(canonical.id, 1);
  expect(pinned?.atlasHash).toBe(parsedManifest.atlasHash);
  expect(pinned?.configHash).toBe(parsedManifest.configHash);

  const persistedSectors = await persistence.listSectors(canonical.id);
  expect(persistedSectors).toHaveLength(19);
  expect(persistedSectors.filter((s) => s.kind === 'land')).toHaveLength(7);
  expect(persistedSectors.filter((s) => s.kind === 'ocean')).toHaveLength(12);
  expect(await persistence.listLandingSlots(canonical.id)).toHaveLength(28);

  const mirroredHomePlanet = await homeRepo.findPlanetById(canonical.id);
  expect(mirroredHomePlanet).toMatchObject({
    id: canonical.id,
    type,
    status: 'ACTIVE',
    capacity: 28,
  });
}

describe('W11-06 — Boot & provision the three canonical worlds with pinned 19-sector small-atlas manifests', () => {
  it('provisions desert, ocean, and temperate with 19 sectors (7 land, 12 ocean), transitions all 3 to ACTIVE + OK + OPEN, and is idempotent on repeat and concurrent calls', async () => {
    const fixture = createProvisioningFixture();
    const { persistence, lifecycle, planets, provisioning } = fixture;

    const loadCalls: CanonicalWorldLoadRequest[] = [];
    provisioning.setSimLoader(async (req) => {
      loadCalls.push(req);
      return { tick: 0, thread: req.attempt };
    });

    const initial = await provisioning.provisionAllCanonicalWorlds();
    expect(initial).toHaveLength(3);
    expect(initial.allOk).toBe(true);
    expect(initial.active).toHaveLength(3);
    expect(initial.faulted).toHaveLength(0);
    expect(loadCalls).toHaveLength(3);

    for (const type of ['desert', 'ocean', 'temperate'] as const) {
      await assertProvisionedWorldState(fixture, initial, type);
    }

    const listV1 = PlanetListV1Schema.parse(await planets.listPlanets());
    expect(listV1.planets).toHaveLength(3);
    for (const summary of listV1.planets) {
      expect(summary).toMatchObject({
        lifecycle: 'ACTIVE',
        health: 'OK',
        admission: 'OPEN',
        availability: 'open',
        totalSectors: 19,
        landSectors: 7,
        oceanSectors: 12,
        validatedCapacity: 28,
        freeSeats: 28,
      });
    }

    const secondRun = await provisioning.provisionAllCanonicalWorlds();
    expect(secondRun).toHaveLength(3);
    expect(secondRun.every((r) => r.ok && !r.created && r.attemptsUsed === 0)).toBe(true);
    expect(loadCalls).toHaveLength(3);

    const concurrentCalls = await Promise.all(
      Array.from({ length: 6 }, () => provisioning.provisionAllCanonicalWorlds()),
    );
    expect(concurrentCalls).toHaveLength(6);
    const allPersisted = await persistence.listCanonicalWorlds();
    expect(allPersisted.map((w) => w.id)).toEqual([
      CANONICAL_PLANETS.desert.id,
      CANONICAL_PLANETS.ocean.id,
      CANONICAL_PLANETS.temperate.id,
    ]);
    expect((await lifecycle.listWorldStatuses()).every((s) => s.availability === 'open')).toBe(true);
  });
});

async function assertOceanFaultIsolation(
  fixture: ReturnType<typeof createProvisioningFixture>,
  bootResult: ProvisionAllCanonicalWorldsResult,
) {
  const { persistence, lifecycle, planets } = fixture;
  const oceanOutcome = bootResult.byType.ocean!;
  expect(oceanOutcome).toMatchObject({
    ok: false,
    planetId: CANONICAL_PLANETS.ocean.id,
    lifecycle: 'PROVISIONING',
    health: 'FAULTED',
    availability: 'faulted',
    faultCode: 'provision_load_failed',
    retryCount: 3,
    placementAttempts: 3,
    attemptsUsed: 3,
    attemptedPlanetIds: [
      CANONICAL_PLANETS.ocean.id,
      CANONICAL_PLANETS.ocean.id,
      CANONICAL_PLANETS.ocean.id,
    ],
    healthHistory: ['LOADING', 'RETRYING', 'RETRYING', 'FAULTED'],
  });

  const persistedWorlds = await persistence.listCanonicalWorlds();
  expect(persistedWorlds.map((w) => w.id)).toEqual([
    CANONICAL_PLANETS.desert.id,
    CANONICAL_PLANETS.ocean.id,
    CANONICAL_PLANETS.temperate.id,
  ]);

  const planetListAfterFault = PlanetListV1Schema.parse(await planets.listPlanets());
  expect(planetListAfterFault.planets).toHaveLength(3);
  const [desertSummary, oceanSummary, temperateSummary] = planetListAfterFault.planets;

  expect(desertSummary).toMatchObject({
    id: CANONICAL_PLANETS.desert.id,
    type: 'desert',
    lifecycle: 'ACTIVE',
    health: 'OK',
    admission: 'OPEN',
    availability: 'open',
    freeSeats: 28,
  });
  expect(oceanSummary).toMatchObject({
    id: CANONICAL_PLANETS.ocean.id,
    type: 'ocean',
    lifecycle: 'PROVISIONING',
    health: 'FAULTED',
    admission: 'OPEN',
    availability: 'faulted',
    faultCode: 'provision_load_failed',
  });
  expect(oceanSummary!.sectors.every((s) => s.availability === 'faulted')).toBe(true);
  expect(temperateSummary).toMatchObject({
    id: CANONICAL_PLANETS.temperate.id,
    type: 'temperate',
    lifecycle: 'ACTIVE',
    health: 'OK',
    admission: 'OPEN',
    availability: 'open',
    freeSeats: 28,
  });

  const statsDuringFault = PublicPlanetStatsV1Schema.parse(await planets.getPublicStats());
  expect(statsDuringFault.planetsActive).toBe(2);

  const oceanEligibility = await lifecycle.checkAdmissionEligibility(
    CANONICAL_PLANETS.ocean.id,
    'sec_0_0',
  );
  expect(oceanEligibility).toMatchObject({
    eligible: false,
    status: 'faulted',
    reason: 'faulted',
    health: 'FAULTED',
    availability: 'faulted',
  });
}

describe('W11-06 — Acceptance: fail loading -> visible fault, retry same ID instead of new instance, and heal on retryFaultedWorld', () => {
  it('retries the exact same canonical planetId on loader failure, marks only the failed world FAULTED while the other 2 stay ACTIVE/open, and recovers the same ID on retryFaultedWorld', async () => {
    const fixture = createProvisioningFixture();
    const { persistence, planets, provisioning } = fixture;

    let oceanShouldFail = true;
    const observedAttempts: {
      readonly planetId: string;
      readonly type: PlanetType;
      readonly attempt: number;
      readonly healthDuringCall: string | undefined;
    }[] = [];

    provisioning.setSimLoader(async (req) => {
      const currentWorld = await persistence.getCanonicalWorldById(req.planetId);
      observedAttempts.push({
        planetId: req.planetId,
        type: req.type,
        attempt: req.attempt,
        healthDuringCall: currentWorld?.health,
      });
      if (req.type === 'ocean' && oceanShouldFail) {
        const err = new Error('sim worker failed to allocate ocean sector buffers') as Error & {
          code?: string;
        };
        err.code = 'provision_load_failed';
        throw err;
      }
      return { tick: 12 };
    });

    const bootResult = await provisioning.provisionAllCanonicalWorlds({ maxRetries: 3 });
    expect(bootResult.allOk).toBe(false);
    expect(bootResult.active.map((w) => w.type)).toEqual(['desert', 'temperate']);
    expect(bootResult.faulted.map((w) => w.type)).toEqual(['ocean']);

    expect(observedAttempts.filter((a) => a.type === 'ocean')).toEqual([
      { planetId: CANONICAL_PLANETS.ocean.id, type: 'ocean', attempt: 1, healthDuringCall: 'LOADING' },
      { planetId: CANONICAL_PLANETS.ocean.id, type: 'ocean', attempt: 2, healthDuringCall: 'RETRYING' },
      { planetId: CANONICAL_PLANETS.ocean.id, type: 'ocean', attempt: 3, healthDuringCall: 'RETRYING' },
    ]);

    await assertOceanFaultIsolation(fixture, bootResult);

    oceanShouldFail = false;
    const recovered = await provisioning.retryFaultedWorld('planet_ocean_prime', 'op_recovery');
    expect(recovered).toMatchObject({
      ok: true,
      created: false,
      planetId: CANONICAL_PLANETS.ocean.id,
      lifecycle: 'ACTIVE',
      health: 'OK',
      admission: 'OPEN',
      availability: 'open',
      faultCode: null,
      retryCount: 0,
      placementAttempts: 4,
      attemptsUsed: 1,
      tick: 12,
      attemptedPlanetIds: [CANONICAL_PLANETS.ocean.id],
    });

    const worldsAfterRecovery = await persistence.listCanonicalWorlds();
    expect(worldsAfterRecovery.map((w) => w.id)).toEqual([
      CANONICAL_PLANETS.desert.id,
      CANONICAL_PLANETS.ocean.id,
      CANONICAL_PLANETS.temperate.id,
    ]);

    const listAfterRecovery = PlanetListV1Schema.parse(await planets.listPlanets());
    expect(listAfterRecovery.planets.every((p) => p.availability === 'open' && !p.faultCode)).toBe(
      true,
    );
    const statsAfterRecovery = PublicPlanetStatsV1Schema.parse(await planets.getPublicStats());
    expect(statsAfterRecovery.planetsActive).toBe(3);
  });
});

describe('W11-06 — Transient retry recovery within maxRetries, timeout handling & guardrails', () => {
  it('succeeds on retry #2 when transient loader errors heal before maxRetries is reached', async () => {
    const { provisioning, persistence } = createProvisioningFixture();

    let desertFailuresRemaining = 2;
    provisioning.setSimLoader(async (req) => {
      if (req.type === 'desert' && desertFailuresRemaining > 0) {
        desertFailuresRemaining--;
        throw new Error('transient thread busy');
      }
      return { tick: 7 };
    });

    const outcome = await provisioning.provisionCanonicalWorld('desert', { maxRetries: 3 });
    expect(outcome).toMatchObject({
      ok: true,
      planetId: CANONICAL_PLANETS.desert.id,
      lifecycle: 'ACTIVE',
      health: 'OK',
      availability: 'open',
      faultCode: null,
      retryCount: 2,
      placementAttempts: 3,
      attemptsUsed: 3,
      healthHistory: ['LOADING', 'RETRYING', 'RETRYING', 'OK'],
      attemptedPlanetIds: [
        CANONICAL_PLANETS.desert.id,
        CANONICAL_PLANETS.desert.id,
        CANONICAL_PLANETS.desert.id,
      ],
    });
    expect(await persistence.listCanonicalWorlds()).toHaveLength(1);
  });

  it('times out hung sim-thread loads and faults with provision_load_timeout after bounded retries', async () => {
    const { provisioning } = createProvisioningFixture();

    provisioning.setSimLoader(
      () =>
        new Promise<number>((resolve) => {
          setTimeout(() => resolve(0), 250);
        }),
    );

    const outcome = await provisioning.provisionCanonicalWorld('temperate', {
      maxRetries: 2,
      loadTimeoutMs: 20,
    });
    expect(outcome).toMatchObject({
      ok: false,
      planetId: CANONICAL_PLANETS.temperate.id,
      health: 'FAULTED',
      availability: 'faulted',
      faultCode: 'provision_load_timeout',
      retryCount: 2,
      placementAttempts: 2,
      healthHistory: ['LOADING', 'RETRYING', 'FAULTED'],
    });
  });

  it('rejects non-canonical planet types or rogue IDs and refuses to replace an ARCHIVED canonical world', async () => {
    const { provisioning, lifecycle } = createProvisioningFixture();

    await expect(provisioning.provisionCanonicalWorld('volcanic')).rejects.toThrow(
      LobbyPersistenceConflictError,
    );
    await expect(
      provisioning.provisionCanonicalWorld('pl_01JROGUEPLANET000000000000'),
    ).rejects.toMatchObject({
      code: 'canonical_type_conflict',
    });

    const desert = await provisioning.provisionCanonicalWorld('desert');
    expect(desert.ok).toBe(true);

    await lifecycle.archiveWorld({
      planetId: CANONICAL_PLANETS.desert.id,
      actor: 'admin_test',
      reason: 'explicit archival test',
    });

    await expect(provisioning.provisionCanonicalWorld('desert')).rejects.toThrow(
      InvalidLifecycleTransitionError,
    );
    await expect(provisioning.retryFaultedWorld('desert')).rejects.toMatchObject({
      code: 'invalid_lifecycle_transition',
    });
  });
});

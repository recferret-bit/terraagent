import 'reflect-metadata';
import {
  AtlasManifestV1Schema,
  CANONICAL_PLANETS,
  PlanetListV1Schema,
  newId,
  type PlanetType,
  type SectorId,
} from '@terra/contracts';
import {
  createAtlasPlanetState,
  createPlanet,
  getAtlasBlob,
  isAtlasSaveState,
  saveAtlasWorldSnapshot,
  spawnColonyLanding,
} from '@terra/sim';
import { describe, expect, it } from 'vitest';
import { HomeRepository } from '../../src/core/home/home.repository';
import {
  CanonicalWorldProvisioningService,
  CanonicalWorldRecoveryService,
  IncompatibleAtlasSaveError,
  LobbyPersistenceService,
  MemoryLobbyStore,
  PlanetsService,
  SectorReservationService,
  WorldLifecycleService,
  type CanonicalWorldLoadRequest,
  type RecoverCanonicalWorldsReport,
} from '../../src/lobby';

function createRecoveryFixture() {
  const persistence = new LobbyPersistenceService(undefined, undefined, new MemoryLobbyStore());
  const lifecycle = new WorldLifecycleService(persistence);
  const homeRepo = new HomeRepository();
  const reservations = new SectorReservationService(persistence, lifecycle);
  const planets = new PlanetsService(persistence, lifecycle, homeRepo);
  const provisioning = new CanonicalWorldProvisioningService(persistence, lifecycle, homeRepo);
  const recovery = new CanonicalWorldRecoveryService(
    persistence,
    lifecycle,
    provisioning,
    homeRepo,
  );
  return { persistence, lifecycle, homeRepo, reservations, planets, provisioning, recovery };
}

async function seedFoundedColony(
  fixture: ReturnType<typeof createRecoveryFixture>,
  planetId: string,
  sectorId: SectorId,
  colonyId: string,
  playerId: string,
  colonyIndex: number,
  name: string,
) {
  const { persistence, homeRepo } = fixture;
  const reserved = await persistence.reserveSectorSlotOrThrow({
    planetId,
    sectorId,
    playerId,
    ticketId: `tk_${colonyId}`,
    colonyId,
  });
  await persistence.commitReservation(reserved.reservation.reservationId);
  await homeRepo.createColony({
    id: colonyId,
    playerId,
    planetId,
    colonyIndex,
    name,
    status: 'ACTIVE',
    foundingSectorId: sectorId,
    landingSlotId: reserved.slot.landingSlotId,
    spawnQ: reserved.slot.q,
    spawnR: reserved.slot.r,
  });
  return reserved;
}

async function setupOccupiedWorldsBeforeRestart(fixture: ReturnType<typeof createRecoveryFixture>) {
  const { persistence, lifecycle, recovery } = fixture;
  const initialBoot = await recovery.recoverOrProvisionCanonicalWorlds({
    foundingSeatsPerSector: 4,
  });
  expect(initialBoot.allOk).toBe(true);
  expect(initialBoot.provisioned).toHaveLength(3);

  const desertId = CANONICAL_PLANETS.desert.id;
  const oceanId = CANONICAL_PLANETS.ocean.id;
  const temperateId = CANONICAL_PLANETS.temperate.id;

  await seedFoundedColony(fixture, desertId, 'sec_0_0', 'col_desert_alpha', 'pr_desert_alpha', 0, 'Dune Alpha');
  await seedFoundedColony(fixture, desertId, 'sec_0_0', 'col_desert_beta', 'pr_desert_beta', 1, 'Dune Beta');
  await seedFoundedColony(fixture, desertId, 'sec_1_0', 'col_desert_gamma', 'pr_desert_gamma', 2, 'Dune Gamma');

  const heldReservation = await persistence.reserveSectorSlotOrThrow({
    planetId: desertId,
    sectorId: 'sec_0_0',
    playerId: 'pr_desert_hold',
    ticketId: 'tk_desert_hold',
    colonyId: 'col_desert_hold',
  });

  await seedFoundedColony(fixture, oceanId, 'sec_0_0', 'col_ocean_pelagic', 'pr_ocean_pelagic', 0, 'Pelagic Prime');
  await seedFoundedColony(fixture, temperateId, 'sec_0_1', 'col_temp_grove', 'pr_temp_grove', 0, 'Granite Grove');

  await lifecycle.pausePlanetAdmission({
    planetId: oceanId,
    actor: 'op_release_mgr',
    reason: 'scheduled ocean maintenance',
  });

  return { initialBoot, heldReservation };
}

function assertRestartReportInvariants(
  report: RecoverCanonicalWorldsReport,
  baseline: RecoverCanonicalWorldsReport,
  heldReservationId: string,
) {
  expect(report.allOk).toBe(true);
  expect(report).toHaveLength(3);
  expect(report.resumed).toHaveLength(3);
  expect(report.provisioned).toHaveLength(0);
  expect(report.planetIds).toEqual([
    CANONICAL_PLANETS.desert.id,
    CANONICAL_PLANETS.ocean.id,
    CANONICAL_PLANETS.temperate.id,
  ]);

  for (const type of ['desert', 'ocean', 'temperate'] as const) {
    const cur = report.byType[type]!;
    const orig = baseline.byType[type]!;
    expect(cur.planetId).toBe(CANONICAL_PLANETS[type].id);
    expect(cur).toMatchObject({ action: 'resumed_active', resumed: true, created: false, loaded: true });
    const parsedManifest = AtlasManifestV1Schema.parse(cur.manifest);
    expect(parsedManifest.atlasHash).toBe(orig.manifest.atlasHash);
    expect(parsedManifest.configHash).toBe(orig.manifest.configHash);
    expect(parsedManifest.resourceProfileHash).toBe(orig.manifest.resourceProfileHash);
    expect(parsedManifest.seed).toBe(orig.manifest.seed);
    expect(parsedManifest.foundingSeatsPerSector).toBe(4);
    expect(parsedManifest.validatedCapacity).toBe(28);
  }

  const desert = report.byType.desert!;
  expect(desert).toMatchObject({
    admission: 'OPEN',
    availability: 'open',
    foundedSeats: 3,
    reservedSeats: 1,
    freeSeats: 24,
  });
  expect(desert.colonies.map((c) => c.id).sort()).toEqual([
    'col_desert_alpha',
    'col_desert_beta',
    'col_desert_gamma',
  ]);
  expect(desert.reservations.find((r) => r.reservationId === heldReservationId)?.state).toBe('HELD');
  expect(desert.sectors.find((s) => s.sectorId === 'sec_0_0')).toMatchObject({
    foundingCapacity: 4,
    validatedCapacity: 4,
    foundedSeats: 2,
    reservedSeats: 1,
    freeSeats: 1,
  });
  expect(desert.sectors.find((s) => s.sectorId === 'sec_1_0')).toMatchObject({
    foundingCapacity: 4,
    validatedCapacity: 4,
    foundedSeats: 1,
    reservedSeats: 0,
    freeSeats: 3,
  });

  expect(report.byType.ocean!).toMatchObject({
    lifecycle: 'ACTIVE',
    health: 'OK',
    admission: 'PAUSED',
    availability: 'paused',
    foundedSeats: 1,
    reservedSeats: 0,
    freeSeats: 27,
  });
  expect(report.byType.ocean!.colonies.map((c) => c.id)).toEqual(['col_ocean_pelagic']);
  expect(report.byType.temperate!.colonies.map((c) => c.id)).toEqual(['col_temp_grove']);
}

async function seedLegacyDevWorlds(homeRepo: HomeRepository): Promise<Uint8Array> {
  const legacyDev = createPlanet({
    id: 'pl_dev',
    seed: 'legacy-dev-seed-01',
    type: 'temperate',
    planetType: 'desert',
    radius: 8,
  });
  spawnColonyLanding(legacyDev, {
    colonyId: 0,
    colonyIdStr: 'co_dev_pioneer',
    playerId: 'pr_dev_pioneer',
    handle: 'DevPioneer',
    tick: 15,
  });
  const rawDevSnapshot = saveAtlasWorldSnapshot(legacyDev);
  expect(isAtlasSaveState(rawDevSnapshot)).toBe(false);

  await homeRepo.upsertDevPlanet('pl_dev', {
    name: 'Dev Planet',
    type: 'desert',
    seed: 'legacy-dev-seed-01',
    state: 'ACTIVE',
    capacity: 4,
  });
  await homeRepo.createColony({
    id: 'co_dev_pioneer',
    playerId: 'pr_dev_pioneer',
    planetId: 'pl_dev',
    colonyIndex: 0,
    name: 'DevPioneer',
    status: 'ACTIVE',
    spawnQ: 0,
    spawnR: 0,
  });
  await homeRepo.upsertDevPlanet('pl_dev_ocean', {
    name: 'Dev Planet (ocean)',
    type: 'ocean',
    seed: 'legacy-dev-ocean-seed',
    state: 'ACTIVE',
    capacity: 4,
  });
  await homeRepo.createColony({
    id: 'co_dev_ocean_01',
    playerId: 'pr_dev_ocean_01',
    planetId: 'pl_dev_ocean',
    colonyIndex: 0,
    name: 'OceanDevColony',
    status: 'ACTIVE',
    spawnQ: 2,
    spawnR: -1,
  });
  return rawDevSnapshot;
}

describe('W11-07 — Acceptance: Restart twice → same three IDs, colonies, sectors and admission state', () => {
  it('preserves exact canonical planetIds, pinned AtlasManifestV1 hashes, founded colonies, held reservations, sector counts, and PAUSED admission across two consecutive restarts with changed runtime config', async () => {
    const fixture = createRecoveryFixture();
    const { persistence, lifecycle, homeRepo, planets } = fixture;
    const { initialBoot, heldReservation } = await setupOccupiedWorldsBeforeRestart(fixture);

    const changedRuntimeOptions = {
      foundingSeatsPerSector: 5,
      seed: 'runtime-changed-seed-after-deploy-999',
      resourceProfileId: 'runtime-changed-profile-v99',
      sectorRadius: 30,
    };

    const restart1Recovery = new CanonicalWorldRecoveryService(
      persistence,
      lifecycle,
      new CanonicalWorldProvisioningService(persistence, lifecycle, homeRepo),
      homeRepo,
    );
    const restart1Report = await restart1Recovery.recoverOrProvisionCanonicalWorlds(changedRuntimeOptions);
    assertRestartReportInvariants(restart1Report, initialBoot, heldReservation.reservation.reservationId);

    const restart2Recovery = new CanonicalWorldRecoveryService(
      persistence,
      lifecycle,
      new CanonicalWorldProvisioningService(persistence, lifecycle, homeRepo),
      homeRepo,
    );
    const restart2Report = await restart2Recovery.recoverOrProvisionCanonicalWorlds(changedRuntimeOptions);
    assertRestartReportInvariants(restart2Report, initialBoot, heldReservation.reservation.reservationId);

    expect(restart2Report.planetIds).toEqual(restart1Report.planetIds);
    for (const type of ['desert', 'ocean', 'temperate'] as const) {
      expect(restart2Report.byType[type]!.manifest).toEqual(restart1Report.byType[type]!.manifest);
      expect(restart2Report.byType[type]!.sectors).toEqual(restart1Report.byType[type]!.sectors);
      expect(restart2Report.byType[type]!.colonies).toEqual(restart1Report.byType[type]!.colonies);
      expect(restart2Report.byType[type]!.admission).toBe(restart1Report.byType[type]!.admission);
    }

    const planetList = PlanetListV1Schema.parse(await planets.listPlanets());
    expect(planetList.planets.map((p) => p.id)).toEqual([
      CANONICAL_PLANETS.desert.id,
      CANONICAL_PLANETS.ocean.id,
      CANONICAL_PLANETS.temperate.id,
    ]);
    expect(planetList.planets.find((p) => p.type === 'ocean')?.admission).toBe('PAUSED');
  });
});

describe('W11-07 — Preserve existing dev saves explicitly alongside canonical worlds', () => {
  it('resumes the 3 canonical worlds and explicitly preserves pl_dev and pl_dev_ocean saves + colonies without converting them into canonical worlds or wiping them', async () => {
    const fixture = createRecoveryFixture();
    const { persistence, homeRepo, planets, recovery } = fixture;
    const rawDevSnapshot = await seedLegacyDevWorlds(homeRepo);

    const report1 = await recovery.recoverOrProvisionCanonicalWorlds({ snapshots: { pl_dev: rawDevSnapshot } });
    const report2 = await recovery.recoverOrProvisionCanonicalWorlds({ snapshots: { pl_dev: rawDevSnapshot } });

    for (const report of [report1, report2]) {
      expect(report.allOk).toBe(true);
      expect(report.planetIds).toEqual([
        CANONICAL_PLANETS.desert.id,
        CANONICAL_PLANETS.ocean.id,
        CANONICAL_PLANETS.temperate.id,
      ]);
      expect(report.preservedDevPlanetIds).toEqual(['pl_dev', 'pl_dev_ocean']);
      expect(report.separateDevWorlds.find((d) => d.planetId === 'pl_dev')).toMatchObject({
        planetId: 'pl_dev',
        devPlanetType: 'desert',
        isCanonical: false,
        isAtlasSave: false,
        legacyCompatibility: true,
        preserved: true,
        convertedToCanonical: false,
        wiped: false,
        hasSnapshot: true,
        colonyCount: 1,
        colonyIds: ['co_dev_pioneer'],
      });
      expect(report.separateDevWorlds.find((d) => d.planetId === 'pl_dev_ocean')).toMatchObject({
        planetId: 'pl_dev_ocean',
        devPlanetType: 'ocean',
        isCanonical: false,
        preserved: true,
        convertedToCanonical: false,
        wiped: false,
        colonyIds: ['co_dev_ocean_01'],
      });
    }

    expect(await persistence.getCanonicalWorldById('pl_dev')).toBeNull();
    expect((await homeRepo.listColoniesByPlanetId('pl_dev')).map((c) => c.id)).toEqual(['co_dev_pioneer']);
    const publicList = PlanetListV1Schema.parse(await planets.listPlanets());
    expect(publicList.planets.map((p) => p.id)).not.toContain('pl_dev');
  });
});

describe('W11-07 — Archived world & interrupted provisioning recovery across restarts', () => {
  it('keeps an ARCHIVED canonical world ARCHIVED and unloaded across restarts without spawning a replacement, and resumes an interrupted PROVISIONING world with its same canonical ID', async () => {
    const fixture = createRecoveryFixture();
    const { persistence, lifecycle, provisioning, recovery } = fixture;
    const loadRequests: CanonicalWorldLoadRequest[] = [];
    let failTemperateDuringInitialBoot = true;

    recovery.setSimLoader(async (req) => {
      loadRequests.push(req);
      if (req.type === 'temperate' && failTemperateDuringInitialBoot) {
        throw Object.assign(new Error('interrupted during initial boot'), { code: 'provision_load_retrying' });
      }
      return { tick: 33 };
    });

    const initial = await provisioning.provisionAllCanonicalWorlds({ maxRetries: 1 });
    expect(initial.byType.temperate?.lifecycle).toBe('PROVISIONING');

    await lifecycle.archiveWorld({
      planetId: CANONICAL_PLANETS.desert.id,
      actor: 'op_archiver',
      reason: 'explicit maintenance archival before restart',
    });
    await lifecycle.updateWorldHealth({
      planetId: CANONICAL_PLANETS.temperate.id,
      health: 'RETRYING',
      faultCode: 'provision_load_retrying',
      retryCount: 1,
      placementAttempts: 1,
      actor: 'system:boot',
      reason: 'interrupted mid-retry before restart',
    });

    failTemperateDuringInitialBoot = false;
    loadRequests.length = 0;

    const restart1 = await recovery.recoverOrProvisionCanonicalWorlds();
    expect(restart1.allOk).toBe(true);
    expect(restart1.byType.desert).toMatchObject({
      ok: true,
      action: 'archived_kept',
      planetId: CANONICAL_PLANETS.desert.id,
      lifecycle: 'ARCHIVED',
      admission: 'ARCHIVED',
      availability: 'archived',
      archived: true,
      resumed: false,
      loaded: false,
    });
    expect(provisioning.isWorldLoaded('desert')).toBe(false);
    expect(loadRequests.some((r) => r.type === 'desert')).toBe(false);

    expect(restart1.byType.temperate).toMatchObject({
      ok: true,
      action: 'resumed_provisioning',
      planetId: CANONICAL_PLANETS.temperate.id,
      lifecycle: 'ACTIVE',
      health: 'OK',
      resumed: true,
      resumedFromProvisioning: true,
      previousLifecycle: 'PROVISIONING',
      previousHealth: 'RETRYING',
      loaded: true,
      tick: 33,
    });

    const restart2 = await recovery.recoverOrProvisionCanonicalWorlds();
    expect(restart2.byType.desert?.action).toBe('archived_kept');
    expect(restart2.byType.desert?.loaded).toBe(false);
    expect(restart2.byType.temperate?.action).toBe('resumed_active');
    expect(await persistence.listCanonicalWorlds()).toHaveLength(3);
  });
});

describe('W11-07 — Snapshot restoration & incompatible save hold during recovery', () => {
  it('restores sim state and reconciles founded colonies from a canonical world snapshot, and holds without reset when W11 flag is disabled', async () => {
    const { recovery } = createRecoveryFixture();
    const desertCanonical = CANONICAL_PLANETS.desert;
    const atlasState = createAtlasPlanetState({
      planetId: desertCanonical.id,
      planetType: 'desert',
      seed: desertCanonical.seed,
    });
    atlasState.meta.tick = 180;
    const slot0 = getAtlasBlob(atlasState)!.safeLandingSlots.find((s) => s.sectorId === 'sec_0_0')!;
    spawnColonyLanding(atlasState, {
      colonyId: 0,
      colonyIdStr: 'col_snap_desert_0',
      playerId: 'pr_snap_desert_0',
      handle: 'SnapFounder',
      sectorId: 'sec_0_0',
      landingSlotId: slot0.slotId,
      q: slot0.q,
      r: slot0.r,
      tick: 25,
    });
    const rawAtlasSnap = saveAtlasWorldSnapshot(atlasState);

    const resumed = await recovery.resumeCanonicalWorld('desert', {
      snapshots: { [desertCanonical.id]: rawAtlasSnap },
      flags: ['W00', 'W01', 'W04', 'W05', 'W11'],
    });
    expect(resumed).toMatchObject({ ok: true, restoredFromSnapshot: true, tick: 180, foundedSeats: 1 });
    expect(resumed.colonies.map((c) => c.id)).toEqual(['col_snap_desert_0']);

    const heldOutcome = await recovery.resumeCanonicalWorld('desert', {
      snapshots: { [desertCanonical.id]: rawAtlasSnap },
      flags: ['W00', 'W01'],
    });
    expect(heldOutcome).toMatchObject({ ok: false, action: 'held_incompatible_save', loaded: false });
    expect(heldOutcome.error).toContain('w11_flag_required');

    await expect(
      recovery.resumeCanonicalWorld('desert', {
        snapshots: { [desertCanonical.id]: rawAtlasSnap },
        flags: ['W00', 'W01'],
        throwOnIncompatibleSave: true,
      }),
    ).rejects.toThrow(IncompatibleAtlasSaveError);
  });

  it('provisions only missing canonical worlds when 2 of 3 already exist in persistence', async () => {
    const { recovery } = createRecoveryFixture();
    await recovery.resumeCanonicalWorld('desert');
    await recovery.resumeCanonicalWorld('ocean');
    const report = await recovery.recoverOrProvisionCanonicalWorlds();
    expect(report.resumed.map((w) => w.type)).toEqual(['desert', 'ocean']);
    expect(report.provisioned.map((w) => w.type)).toEqual(['temperate']);
    expect(newId('co')).toMatch(/^co_/);
    expect((['desert', 'ocean', 'temperate'] as readonly PlanetType[]).every((t) => Boolean(report.byType[t]))).toBe(true);
  });
});

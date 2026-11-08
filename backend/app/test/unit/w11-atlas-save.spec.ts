import { CANONICAL_PLANETS, parseWaves, type SectorId } from '@terra/contracts';
import {
  claimTerritoryRadius,
  computeAtlasSectorColonyMetrics,
  countExploredTilesBySector,
  createAtlasPlanetState,
  createPlanet,
  DEPOSIT,
  ENTITY_KIND,
  ENTITY_STATE,
  ensureColonyRecord,
  executeCrossSectorTerraformOp,
  exploredSectorIdsForColony,
  extractPinnedAtlasManifest,
  GEN_VERSION,
  getAtlasBlob,
  globalTileToSector,
  hexIndex,
  IncompatibleAtlasSaveError,
  insertRow,
  isAtlasSaveState,
  isColonyTileExplored,
  markTileExplored,
  PREP,
  recordAtlasColonyFounding,
  restore,
  restoreAtlasWorldSnapshot,
  rowOf,
  saveAtlasWorldSnapshot,
  setField,
  setTileOwner,
  spawnColonyLanding,
  TERRAIN,
  validateAtlasSaveCompatibility,
  type PlanetState,
} from '@terra/sim';
import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { MetricsRegistry } from '../../src/core/metrics.registry';
import type { AppEnv } from '../../src/core/tokens';
import { FlagsService } from '../../src/flags/flags.service';
import type { GamePlanets } from '../../src/game/game-planets.service';
import { atlasSnapshotVerdict, devSnapshotVerdict } from '../../src/game/persistence/dev-planet-verdict';
import type { SnapshotStore } from '../../src/game/persistence/snapshot-store';
import { PlanetHeldError, SnapshotService } from '../../src/game/persistence/snapshot.service';

interface OccupiedBoundaryFixture {
  readonly state: PlanetState;
  readonly seamStraddleBuildingId: number;
  readonly seamUnitId: number;
  readonly seamTiles: ReadonlyArray<{ readonly q: number; readonly r: number; readonly sectorId: SectorId }>;
  readonly wideOwnerTileIdx: number;
  readonly wideOwnerEntityId: number;
  readonly highColonyExploredTileIdx: number;
}

function placeStructure(
  state: PlanetState,
  owner: number,
  kind: number,
  q: number,
  r: number,
  w = 2,
  d = 2,
  hp = 600,
): number {
  const id = state.meta.nextEntityId++;
  const row = insertRow(state.entities, id, state.meta.tick);
  const cols = state.entities.cols;
  cols.kind[row] = kind;
  cols.owner[row] = owner;
  cols.q[row] = q;
  cols.r[row] = r;
  cols.x[row] = q;
  cols.y[row] = r;
  cols.footprintW[row] = w;
  cols.footprintD[row] = d;
  cols.hp[row] = hp;
  cols.hpMax[row] = hp;
  cols.state[row] = ENTITY_STATE.active;
  return id;
}

function seedThreeSectorFoundings(state: PlanetState): void {
  const blob = getAtlasBlob(state)!;
  const targets: ReadonlyArray<{ idx: number; sec: SectorId; id: string; handle: string }> = [
    { idx: 0, sec: 'sec_0_0', id: 'co_alpha_sec00', handle: 'Alpha' },
    { idx: 1, sec: 'sec_1_0', id: 'co_beta_sec10', handle: 'Beta' },
    { idx: 2, sec: 'sec_0_1', id: 'co_gamma_sec01', handle: 'Gamma' },
  ];
  for (const t of targets) {
    const slot = blob.safeLandingSlots.find((s) => s.sectorId === t.sec)!;
    const res = spawnColonyLanding(state, {
      colonyId: t.idx,
      colonyIdStr: t.id,
      playerId: `pr_${t.handle.toLowerCase()}`,
      handle: t.handle,
      sectorId: t.sec,
      landingSlotId: slot.slotId,
      q: slot.q,
      r: slot.r,
      tick: (t.idx + 1) * 10,
    });
    expect(res.ok).toBe(true);
  }
}

let cachedBaseAtlasSnapshot: Uint8Array | null = null;

function createFreshCanonicalAtlasState(): PlanetState {
  if (!cachedBaseAtlasSnapshot) {
    const canonical = CANONICAL_PLANETS.temperate;
    const base = createAtlasPlanetState({
      planetId: canonical.id,
      planetType: canonical.type,
      seed: canonical.seed,
    });
    cachedBaseAtlasSnapshot = saveAtlasWorldSnapshot(base);
  }
  return restore(cachedBaseAtlasSnapshot);
}

function buildOccupiedBoundaryFixture(): OccupiedBoundaryFixture {
  const state = createFreshCanonicalAtlasState();
  state.meta.tick = 420;
  seedThreeSectorFoundings(state);

  const blob = getAtlasBlob(state)!;
  const seamStraddleBuildingId = placeStructure(state, 0, ENTITY_KIND.commandHub, 24, 0, 3, 3, 900);
  const seamUnitId = placeStructure(state, 0, ENTITY_KIND.worker, 26, -1, 1, 1, 220);

  const tfRes = executeCrossSectorTerraformOp(state, {
    q: 24,
    r: 0,
    op: 'flatten',
    targetHeightM: 1.75,
    colonyId: 0,
    tick: 250,
  });
  expect(tfRes.straddlesSectorSeam).toBe(true);

  const hex = hexIndex(state.grid.radius);
  const seamCoords = [
    { q: 24, r: 0 },
    { q: 25, r: 0 },
    { q: 24, r: 1 },
  ] as const;
  const seamTiles = seamCoords.map(({ q, r }, idx) => {
    const tIdx = hex.indexOf(q, r);
    state.grid.layers.terrain[tIdx] = TERRAIN.flat;
    state.grid.layers.prep[tIdx] = PREP.prepared;
    state.grid.layers.height[tIdx] = Math.fround(1.75 + idx * 0.125);
    state.grid.layers.deposit[tIdx] = idx === 1 ? DEPOSIT.metals : DEPOSIT.none;
    state.grid.layers.richness[tIdx] = Math.fround(idx === 1 ? 0.85 : 0);
    setTileOwner(state.grid, tIdx, 0, 300);
    return { q, r, sectorId: globalTileToSector(q, r, blob.sectorRadius).sectorId };
  });

  claimTerritoryRadius(state, { colonyId: 0, q: 25, r: 0, radius: 2, tick: 310 });
  const slotSec0m1 = blob.safeLandingSlots.find((s) => s.sectorId === 'sec_0_-1')!;
  recordAtlasColonyFounding(state, 2251, slotSec0m1.q, slotSec0m1.r, 315);
  const wideOwnerTileIdx = hex.indexOf(27, -2);
  setTileOwner(state.grid, wideOwnerTileIdx, 2251, 320);

  const wideOwnerEntityId = state.meta.nextEntityId++;
  const wideRow = insertRow(state.entities, wideOwnerEntityId, 325);
  state.entities.cols.kind[wideRow] = ENTITY_KIND.worker;
  setField(state.entities, wideRow, 'owner', 2251, 325);
  state.entities.cols.q[wideRow] = 27;
  state.entities.cols.r[wideRow] = -2;

  const slotSecm10 = blob.safeLandingSlots.find((s) => s.sectorId === 'sec_-1_0')!;
  ensureColonyRecord(state, 9, 330);
  state.colonies[9]!.foundingSectorId = 'sec_-1_0';
  const highColonyExploredTileIdx = hex.indexOf(slotSecm10.q, slotSecm10.r);
  markTileExplored(state.grid, highColonyExploredTileIdx, 9, 340);
  markTileExplored(state.grid, hex.indexOf(26, -1), 0, 345);

  return {
    state,
    seamStraddleBuildingId,
    seamUnitId,
    seamTiles,
    wideOwnerTileIdx,
    wideOwnerEntityId,
    highColonyExploredTileIdx,
  };
}

function createFakeSnapshotHarness(
  snaps: Readonly<Record<string, Uint8Array>>,
  taWaves: string,
) {
  const wiped: string[] = [];
  const loaded: Record<string, Uint8Array> = {};
  const errorLogs: Array<Record<string, unknown>> = [];
  const store = {
    livePlanetIds: async () => Object.keys(snaps),
    latest: async (id: string) => (snaps[id] ? { raw: snaps[id]!, savedAt: new Date(1_000) } : null),
    hasSnapshots: async (id: string) => Boolean(snaps[id]),
    wipePlanet: async (id: string) => {
      wiped.push(id);
    },
  } as unknown as SnapshotStore;
  const planets = {
    onPlanetLoaded: () => () => {},
    onPlanetUnloaded: () => () => {},
    onPlanetSnapshot: () => () => {},
    loadedIds: () => Object.keys(loaded),
    isLoaded: (id: string) => id in loaded,
    requestSnapshot: () => {},
    markScenarioColonyPlanet: () => {},
    ensureLoaded: async (id: string) => {
      loaded[id] = new Uint8Array();
    },
    load: async (id: string, opts?: { snapshot?: Uint8Array }) => {
      loaded[id] = opts?.snapshot ?? new Uint8Array();
      return opts?.snapshot ? restore(opts.snapshot).meta.tick : 0;
    },
  } as unknown as GamePlanets;
  const env = { SNAPSHOTS: 'on', SNAPSHOT_EVERY_S: 60, TA_WAVES: taWaves } as unknown as AppEnv;
  const logger = {
    child: () => logger,
    info: () => {},
    warn: () => {},
    debug: () => {},
    error: (obj: Record<string, unknown>) => {
      errorLogs.push(obj);
    },
  } as unknown as pino.Logger;
  const svc = new SnapshotService(
    planets,
    store,
    new MetricsRegistry(),
    env,
    logger,
    undefined,
    undefined,
    undefined,
    new FlagsService(env),
  );
  return { svc, wiped, loaded, errorLogs };
}

function assertRestoredBoundaryState(
  fixture: OccupiedBoundaryFixture,
  restored: PlanetState,
): void {
  const { state } = fixture;
  expect(restored.colonies[0]?.foundingSectorId).toBe('sec_0_0');
  expect(restored.colonies[0]?.landingSlotId).toMatch(/^slot_sec_0_0_\d+$/);
  expect(restored.colonies[1]?.foundingSectorId).toBe('sec_1_0');
  expect(restored.colonies[1]?.landingSlotId).toMatch(/^slot_sec_1_0_\d+$/);
  expect(restored.colonies[2]?.foundingSectorId).toBe('sec_0_1');
  expect(restored.colonies[2]?.landingSlotId).toMatch(/^slot_sec_0_1_\d+$/);

  expect(restored.meta.nextEntityId).toBe(state.meta.nextEntityId);
  expect(restored.entities.count).toBe(state.entities.count);
  const hubRow = rowOf(restored.entities, fixture.seamStraddleBuildingId);
  expect(hubRow).toBeGreaterThanOrEqual(0);
  expect(restored.entities.cols.kind[hubRow]).toBe(ENTITY_KIND.commandHub);
  expect(restored.entities.cols.owner[hubRow]).toBe(0);
  expect(restored.entities.cols.q[hubRow]).toBe(24);
  expect(restored.entities.cols.r[hubRow]).toBe(0);
  expect(restored.entities.cols.footprintW[hubRow]).toBe(3);
  expect(restored.entities.cols.footprintD[hubRow]).toBe(3);

  const workerRow = rowOf(restored.entities, fixture.seamUnitId);
  expect(workerRow).toBeGreaterThanOrEqual(0);
  expect(restored.entities.cols.kind[workerRow]).toBe(ENTITY_KIND.worker);
  expect(restored.entities.cols.q[workerRow]).toBe(26);
  expect(restored.entities.cols.r[workerRow]).toBe(-1);

  const hex = hexIndex(restored.grid.radius);
  expect(new Set(fixture.seamTiles.map((t) => t.sectorId)).size).toBeGreaterThanOrEqual(2);
  fixture.seamTiles.forEach((tile, idx) => {
    const tIdx = hex.indexOf(tile.q, tile.r);
    expect(restored.grid.layers.terrain[tIdx]).toBe(TERRAIN.flat);
    expect(restored.grid.layers.prep[tIdx]).toBe(PREP.prepared);
    expect(restored.grid.layers.height[tIdx]).toBeCloseTo(1.75 + idx * 0.125, 5);
    expect(restored.grid.layers.deposit[tIdx]).toBe(idx === 1 ? DEPOSIT.metals : DEPOSIT.none);
    expect(restored.grid.layers.owner[tIdx]).toBe(0);
  });

  expect(restored.grid.layers.owner).toBeInstanceOf(Int16Array);
  expect(restored.entities.cols.owner).toBeInstanceOf(Int16Array);
  expect(restored.grid.layers.owner[fixture.wideOwnerTileIdx]).toBe(2251);
  const wideRow = rowOf(restored.entities, fixture.wideOwnerEntityId);
  expect(restored.entities.cols.owner[wideRow]).toBe(2251);

  expect(isColonyTileExplored(restored.grid, fixture.highColonyExploredTileIdx, 9)).toBe(true);
  expect(isColonyTileExplored(restored.grid, fixture.highColonyExploredTileIdx, 1)).toBe(false);
}

describe('W11-40 — Small-atlas save & restore round-trip across sector boundaries', () => {
  it('restarts occupied boundary fixture -> preserves pinned manifest, entities, seam terrain edits, wide ownership, and exploration', async () => {
    const fixture = buildOccupiedBoundaryFixture();
    const { state } = fixture;
    expect(isAtlasSaveState(state)).toBe(true);

    const manifestBefore = extractPinnedAtlasManifest(state)!;
    const metricsBefore = computeAtlasSectorColonyMetrics(state);
    const exploredCol0Before = exploredSectorIdsForColony(state, 0);
    const exploredCol9Before = countExploredTilesBySector(state, 9);

    const rawSnapshot = saveAtlasWorldSnapshot(state);
    expect(isAtlasSaveState(rawSnapshot)).toBe(true);

    const restored = restoreAtlasWorldSnapshot(rawSnapshot, {
      flags: ['W00', 'W01', 'W04', 'W05', 'W11'],
      expectedAtlasHash: manifestBefore.atlasHash,
      expectedConfigHash: manifestBefore.configHash,
      clientSupportsAtlas: true,
    });

    expect(isAtlasSaveState(restored)).toBe(true);
    expect(extractPinnedAtlasManifest(restored)).toEqual(manifestBefore);
    expect(getAtlasBlob(restored)?.sectors).toHaveLength(19);

    const metricsAfter = computeAtlasSectorColonyMetrics(restored);
    expect(metricsAfter.totalFoundedSeats).toBe(metricsBefore.totalFoundedSeats);
    expect(metricsAfter.totalFreeSeats).toBe(metricsBefore.totalFreeSeats);
    expect(metricsAfter.foundingSectorByColony).toEqual(metricsBefore.foundingSectorByColony);
    expect(metricsAfter.presentSectorsByColony).toEqual(metricsBefore.presentSectorsByColony);
    expect(metricsAfter.get('sec_0_0')?.foundedSeats).toBe(1);
    expect(metricsAfter.get('sec_1_0')?.foundedSeats).toBe(1);
    expect(metricsAfter.get('sec_0_1')?.foundedSeats).toBe(1);
    expect(metricsAfter.get('sec_0_-1')?.foundedSeats).toBe(1);
    expect(metricsAfter.get('sec_-1_0')?.foundedSeats).toBe(1);

    assertRestoredBoundaryState(fixture, restored);
    expect(exploredSectorIdsForColony(restored, 0)).toEqual(exploredCol0Before);
    expect(countExploredTilesBySector(restored, 9)).toEqual(exploredCol9Before);

    const harness = createFakeSnapshotHarness({ [state.meta.planetId]: rawSnapshot }, 'all');
    const report = await harness.svc.restoreAll();
    expect(report).toEqual({
      restored: [state.meta.planetId],
      held: [],
      dbUnavailable: false,
    });
    expect(harness.wiped).toEqual([]);
    const serverRestored = restore(harness.loaded[state.meta.planetId]!);
    expect(extractPinnedAtlasManifest(serverRestored)).toEqual(manifestBefore);
    assertRestoredBoundaryState(fixture, serverRestored);
  }, 15_000);
});

describe('W11-40 — Incompatible flags, client, or manifest hashes reject without wiping or resetting', () => {
  it('rejects opening an occupied atlas save when W11 flag is disabled, client lacks atlas support, or manifest hash mismatches', () => {
    const { state } = buildOccupiedBoundaryFixture();
    const raw = saveAtlasWorldSnapshot(state);
    const preW11Flags = ['W00', 'W01', 'W02', 'W03', 'W04', 'W05', 'W06', 'W07', 'W08', 'W09', 'W10'];

    expect(validateAtlasSaveCompatibility(raw, { flags: preW11Flags })).toMatchObject({
      ok: false,
      code: 'w11_flag_required',
      preserveSnapshot: true,
      isAtlasSave: true,
    });

    expect(() => restoreAtlasWorldSnapshot(raw, { flags: preW11Flags })).toThrowError(
      IncompatibleAtlasSaveError,
    );
    try {
      restoreAtlasWorldSnapshot(raw, { flags: parseWaves('..10') });
      expect.unreachable('should have thrown IncompatibleAtlasSaveError');
    } catch (err) {
      expect(err).toBeInstanceOf(IncompatibleAtlasSaveError);
      expect((err as IncompatibleAtlasSaveError).code).toBe('w11_flag_required');
      expect((err as IncompatibleAtlasSaveError).preserveSnapshot).toBe(true);
    }

    expect(
      validateAtlasSaveCompatibility(raw, { flags: ['W11'], clientSupportsAtlas: false }),
    ).toMatchObject({
      ok: false,
      code: 'incompatible_atlas_save',
      preserveSnapshot: true,
      isAtlasSave: true,
    });

    expect(
      validateAtlasSaveCompatibility(raw, {
        flags: ['W11'],
        expectedAtlasHash: 'atlas_v1_wrong_hash_000000',
      }),
    ).toMatchObject({
      ok: false,
      code: 'atlas_manifest_mismatch',
      preserveSnapshot: true,
      isAtlasSave: true,
    });

    expect(atlasSnapshotVerdict(state.meta.planetId, raw, { flags: preW11Flags })).toMatchObject({
      kind: 'held',
      code: 'w11_flag_required',
      preserveSnapshot: true,
    });
  });

  it('holds occupied W11 atlas saves in SnapshotService when W11 is disabled without calling wipePlanet or regenerating', async () => {
    const { state } = buildOccupiedBoundaryFixture();
    const planetId = state.meta.planetId;
    const raw = saveAtlasWorldSnapshot(state);

    expect(devSnapshotVerdict(planetId, raw).kind).toBe('keep');
    const olderAtlasState = restore(raw);
    olderAtlasState.meta.genVersion = GEN_VERSION - 1;
    expect(devSnapshotVerdict(planetId, saveAtlasWorldSnapshot(olderAtlasState)).kind).toBe('keep');
    expect(devSnapshotVerdict('pl_dev', saveAtlasWorldSnapshot(olderAtlasState)).kind).toBe('keep');

    const harness = createFakeSnapshotHarness({ [planetId]: raw }, '..10');
    const reportOff = await harness.svc.restoreAll();
    expect(reportOff).toEqual({
      restored: [],
      held: [planetId],
      dbUnavailable: false,
    });
    expect(harness.wiped).toEqual([]);
    expect(Object.keys(harness.loaded)).toEqual([]);
    expect(
      harness.errorLogs.some((e) => e.planetId === planetId && e.code === 'w11_flag_required'),
    ).toBe(true);

    await expect(harness.svc.loadNew(planetId)).rejects.toThrowError(PlanetHeldError);
    await expect(harness.svc.loadHome(planetId, {})).rejects.toThrowError(PlanetHeldError);
    expect(harness.wiped).toEqual([]);
    expect(Object.keys(harness.loaded)).toEqual([]);
  });
});

describe('W11-40 — Legacy pre-W11 dev world compatibility with W11 off and W11 on', () => {
  it('restores legacy pre-W11 dev worlds cleanly under both W11 off (..10) and W11 on (all) without converting to atlas', async () => {
    const legacyDev = createPlanet({
      id: 'pl_dev',
      seed: 'legacy-dev-seed',
      type: 'temperate',
      planetType: 'desert',
      radius: 8,
    });
    spawnColonyLanding(legacyDev, {
      colonyId: 0,
      colonyIdStr: 'co_legacy_0',
      playerId: 'pr_legacy',
      handle: 'LegacyPioneer',
      tick: 5,
    });

    expect(isAtlasSaveState(legacyDev)).toBe(false);
    const rawLegacy = saveAtlasWorldSnapshot(legacyDev);
    expect(isAtlasSaveState(rawLegacy)).toBe(false);

    expect(
      validateAtlasSaveCompatibility(rawLegacy, {
        flags: parseWaves('..10').list,
        clientSupportsAtlas: false,
      }),
    ).toEqual({
      ok: true,
      isAtlasSave: false,
      legacyCompatibility: true,
      preserveSnapshot: true,
      manifest: null,
      planetId: 'pl_dev',
    });

    const restoredOff = restoreAtlasWorldSnapshot(rawLegacy, { flags: parseWaves('..10').list });
    expect(isAtlasSaveState(restoredOff)).toBe(false);
    expect(restoredOff.blobs.atlas).toBeUndefined();
    expect(restoredOff.colonies[0]?.id).toBe('co_legacy_0');

    const restoredOn = restoreAtlasWorldSnapshot(rawLegacy, { flags: parseWaves('all').list });
    expect(isAtlasSaveState(restoredOn)).toBe(false);
    expect(restoredOn.blobs.atlas).toBeUndefined();
    expect(restoredOn.colonies[0]?.id).toBe('co_legacy_0');

    const { state: atlasState } = buildOccupiedBoundaryFixture();
    const rawAtlas = saveAtlasWorldSnapshot(atlasState);
    const snaps = { pl_dev: rawLegacy, [atlasState.meta.planetId]: rawAtlas };

    const harnessOff = createFakeSnapshotHarness(snaps, '..10');
    const reportOff = await harnessOff.svc.restoreAll();
    expect(reportOff.restored).toEqual(['pl_dev']);
    expect(reportOff.held).toEqual([atlasState.meta.planetId]);
    expect(harnessOff.wiped).toEqual([]);

    const harnessOn = createFakeSnapshotHarness(snaps, 'all');
    const reportOn = await harnessOn.svc.restoreAll();
    expect([...reportOn.restored].sort()).toEqual(['pl_dev', atlasState.meta.planetId].sort());
    expect(reportOn.held).toEqual([]);
    expect(harnessOn.wiped).toEqual([]);
  });
});

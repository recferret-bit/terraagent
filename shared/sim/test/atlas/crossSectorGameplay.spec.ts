import { describe, expect, it } from 'vitest';
import { parseWaves, type SectorId } from '@terra/contracts';
import {
  claimCrossSectorTerritory,
  claimTerritoryRadius,
  computeAtlasSectorColonyMetrics,
  countExploredTilesBySector,
  createAtlasPlanetState,
  creditResource,
  DEPOSIT,
  ENTITY_KIND,
  ENTITY_STATE,
  evaluateCrossSectorPlacement,
  evaluatePlacement,
  exploredSectorIdsForColony,
  findHexPath,
  getAtlasBlob,
  getColonyPower,
  globalTileToSector,
  hexDistance,
  hexIndex,
  insertRow,
  inspectCrossSectorPath,
  inspectCrossSectorPowerGrid,
  notifyPylonOrBuildingRemoved,
  placementWorldFromState,
  PREP,
  relaysLinked,
  rowOf,
  setPlanetTime,
  SimHost,
  TERRAIN,
  type CommandOutcome,
  type PlanetState,
  type SimCommand,
} from '../../src';

let cmdSeq = 0;

function mkCmd(
  kind: string,
  args: unknown,
  colonyIndex = 0,
  source: 'player' | 'dev' = 'player',
): SimCommand {
  return {
    colonyIndex,
    source,
    commandId: `w11_41_${++cmdSeq}`,
    kind,
    args,
  };
}

function applyCmd(host: SimHost, cmd: SimCommand): CommandOutcome {
  host.submit(cmd);
  const res = host.step(1);
  return res.outcomes[0]!;
}

function flattenRegionForTest(
  state: PlanetState,
  centerQ: number,
  centerR: number,
  radius: number,
): void {
  const hex = hexIndex(state.grid.radius);
  for (let dr = -radius; dr <= radius; dr++) {
    for (let dq = Math.max(-radius, -dr - radius); dq <= Math.min(radius, -dr + radius); dq++) {
      const idx = hex.indexOf(centerQ + dq, centerR + dr);
      if (idx < 0) continue;
      state.grid.layers.terrain[idx] = TERRAIN.flat;
      state.grid.layers.prep[idx] = PREP.prepared;
      state.grid.layers.height[idx] = 1.2;
      state.grid.layers.deposit[idx] = DEPOSIT.none;
      state.grid.layers.richness[idx] = 0;
    }
  }
}

function createCrossSectorTestHost(seed = 'w11-41-cross-sector'): SimHost {
  const state = createAtlasPlanetState({
    planetId: 'p_verdant',
    planetType: 'temperate',
    seed,
    sectorRadius: 24,
    gridRadius: 56,
  });
  const host = new SimHost({
    flags: parseWaves('..03'),
  });
  host.load(state);
  return host;
}

function spawnActiveStructure(
  state: PlanetState,
  owner: number,
  kind: number,
  q: number,
  r: number,
  w = 2,
  d = 2,
  hp = 500,
): { row: number; id: number } {
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
  return { row, id };
}

function findUnitEntityId(state: PlanetState, colonyIndex: number, kind: number): number {
  const cols = state.entities.cols;
  for (let row = 0; row < state.entities.count; row++) {
    if (cols.owner[row] === colonyIndex && cols.kind[row] === kind) {
      return cols.id[row]!;
    }
  }
  return -1;
}

function getEntityTile(state: PlanetState, entityId: number): { q: number; r: number } {
  const row = rowOf(state.entities, entityId);
  if (row < 0) throw new Error(`missing entity ${entityId}`);
  return { q: state.entities.cols.q[row]!, r: state.entities.cols.r[row]! };
}

describe('W11-41 sector isolation: pathfinding and unit movement cannot cross sector boundaries', () => {
  it('blocks cross-sector pathfinding and unit movement while allowing intra-sector paths', () => {
    const host = createCrossSectorTestHost();
    flattenRegionForTest(host.state, 21, 0, 8);

    // Land Colony 0 in sec_0_0 near the tri-sector seam at (19, 0)
    expect(applyCmd(host, mkCmd('dev.land', { q: 19, r: 0 }, 0, 'dev')).code).toBeUndefined();

    const hqId = findUnitEntityId(host.state, 0, ENTITY_KIND.hq);
    expect(hqId).toBeGreaterThan(0);
    const startPos = getEntityTile(host.state, hqId);
    expect(globalTileToSector(startPos.q, startPos.r, 24).sectorId).toBe('sec_0_0');

    const wpIntra = { q: 22, r: 0 };
    const wpSec10 = { q: 26, r: -1 };
    const wpSec01 = { q: 24, r: 3 };
    expect(globalTileToSector(wpIntra.q, wpIntra.r, 24).sectorId).toBe('sec_0_0');
    expect(globalTileToSector(wpSec10.q, wpSec10.r, 24).sectorId).toBe('sec_1_0');
    expect(globalTileToSector(wpSec01.q, wpSec01.r, 24).sectorId).toBe('sec_0_1');

    // Intra-sector path inside sec_0_0 succeeds
    const intraLeg = inspectCrossSectorPath(host.state, startPos, wpIntra, { profile: 'ground' });
    expect(intraLeg.ok).toBe(true);
    expect(intraLeg.startSectorId).toBe('sec_0_0');
    expect(intraLeg.goalSectorId).toBe('sec_0_0');
    expect(intraLeg.crossesSectorBoundary).toBe(false);
    expect(intraLeg.visitedSectors).toEqual(['sec_0_0']);
    expect(intraLeg.seamCrossings).toEqual([]);
    expect(intraLeg.path).toEqual(findHexPath(host.state, startPos, wpIntra).path);

    // Cross-sector path sec_0_0 -> sec_1_0 and sec_1_0 -> sec_0_1 is disabled
    const leg1 = inspectCrossSectorPath(host.state, startPos, wpSec10, { profile: 'ground' });
    expect(leg1.ok).toBe(false);
    expect(leg1.reason).toBe('cross_sector_disabled');
    expect(leg1.path).toEqual([]);
    expect(leg1.visitedSectors).toEqual(['sec_0_0']);
    expect(leg1.seamCrossings).toEqual([]);
    expect(leg1.crossesSectorBoundary).toBe(false);
    expect(findHexPath(host.state, startPos, wpSec10).ok).toBe(false);

    const leg2 = inspectCrossSectorPath(host.state, wpSec10, wpSec01, { profile: 'ground' });
    expect(leg2.ok).toBe(false);
    expect(leg2.reason).toBe('cross_sector_disabled');
    expect(leg2.crossesSectorBoundary).toBe(false);

    // Walk HQ Commander within sec_0_0 via moveUnit command
    expect(applyCmd(host, mkCmd('moveUnit', { entityId: hqId, q: wpIntra.q, r: wpIntra.r })).code).toBeUndefined();
    host.step(40);
    expect(getEntityTile(host.state, hqId)).toEqual(wpIntra);

    // Attempting to walk HQ Commander across the sector boundary into sec_1_0 is blocked by pathfinder/locomotion
    applyCmd(host, mkCmd('moveUnit', { entityId: hqId, q: wpSec10.q, r: wpSec10.r }));
    host.step(40);
    expect(getEntityTile(host.state, hqId)).toEqual(wpIntra);
    expect(globalTileToSector(getEntityTile(host.state, hqId).q, getEntityTile(host.state, hqId).r, 24).sectorId).toBe(
      'sec_0_0',
    );

    const exploredBySec = countExploredTilesBySector(host.state, 0);
    expect(exploredBySec.sec_0_0).toBeGreaterThan(20);
    expect(exploredSectorIdsForColony(host.state, 0)).toContain('sec_0_0');
  });

  it('uses an isolated single-sector grid (R=48, 7,057 tiles) by default in createAtlasPlanetState and blocks cross-sector paths', () => {
    const state = createAtlasPlanetState({ planetType: 'temperate', seed: 'continent-walk-seed' });
    expect(state.grid.radius).toBe(48);
    expect(state.grid.count).toBe(7_057);

    const legA = inspectCrossSectorPath(state, { q: 0, r: 0 }, { q: 97, r: -48 });
    expect(legA.ok).toBe(false);
    expect(legA.reason).toBe('goal_out_of_bounds');
    expect(legA.crossesSectorBoundary).toBe(false);
  });
});

describe('W11-41 sector isolation: construction footprints and territory claims cannot cross sector boundaries', () => {
  it('rejects footprints straddling sector seams or placed in another sector while allowing intra-sector builds', () => {
    const host = createCrossSectorTestHost('w11-41-placement');
    flattenRegionForTest(host.state, 22, 0, 8);

    // Land Colony 0 at (20, 0) in sec_0_0 near the seam
    expect(applyCmd(host, mkCmd('dev.land', { q: 20, r: 0 }, 0, 'dev')).code).toBeUndefined();
    host.state.colonies[0]!.unlockStage = 4;
    creditResource(host.state.colonies[0]!, 'metals.t1', 500, host.tick);
    creditResource(host.state.colonies[0]!, 'minerals.t1', 500, host.tick);

    // 1. Evaluate a 3x3 Command Hub at (24, 1) whose footprint straddles sec_0_0, sec_0_1, and sec_1_0 -> blocked!
    const triSeamHubEval = evaluateCrossSectorPlacement(host.state, {
      colonyId: 0,
      building: 'commandHub',
      q: 24,
      r: 1,
    });
    expect(triSeamHubEval.ok).toBe(false);
    expect(triSeamHubEval.reason).toBe('cross_sector_disabled');
    expect(triSeamHubEval.straddlesSectorBoundary).toBe(true);
    expect(triSeamHubEval.footprintSectorIds).toEqual(['sec_0_0', 'sec_0_1', 'sec_1_0']);
    expect(
      evaluatePlacement(placementWorldFromState(host.state), {
        colonyId: 0,
        building: 'commandHub',
        q: 24,
        r: 1,
      }).ok,
    ).toBe(false);

    // Activate Command Hub at (20, 0) in sec_0_0 and claim territory at (24, 0) near the seam
    spawnActiveStructure(host.state, 0, ENTITY_KIND.commandHub, 20, 0, 3, 3, 1500);
    const claimReport = claimCrossSectorTerritory(host.state, 0, 24, 0, 6, host.tick);
    expect(claimReport.spansMultipleSectors).toBe(false);
    expect(claimReport.claimedSectorIds).toEqual(['sec_0_0']);
    expect(Object.keys(claimReport.claimedBySector)).toEqual(['sec_0_0']);
    const hex = hexIndex(host.state.grid.radius);
    expect(host.state.grid.layers.owner[hex.indexOf(24, 0)]).toBe(0);
    expect(host.state.grid.layers.owner[hex.indexOf(25, 0)]).toBe(-1); // sec_1_0 tile was NOT claimed!

    // 2. Evaluate a 2x2 Solar at (24, 0) straddling sec_0_0, sec_0_1, and sec_1_0 -> blocked!
    const seamSolarEval = evaluateCrossSectorPlacement(host.state, {
      colonyId: 0,
      building: 'solar',
      q: 24,
      r: 0,
    });
    expect(seamSolarEval.ok).toBe(false);
    expect(seamSolarEval.reason).toBe('cross_sector_disabled');
    expect(seamSolarEval.straddlesSectorBoundary).toBe(true);

    expect(
      applyCmd(
        host,
        mkCmd('enqueueTask', { task: { kind: 'build', building: 'solar', q: 24, r: 0 } }),
      ).code,
    ).toBe('terrain_unbuildable');

    // 3. Evaluate a Pylon inside sec_0_1 at (24, 3) -> blocked by cross_sector_disabled!
    const sec01PylonEval = evaluateCrossSectorPlacement(host.state, {
      colonyId: 0,
      building: 'pylon',
      q: 24,
      r: 3,
    });
    expect(sec01PylonEval.ok).toBe(false);
    expect(sec01PylonEval.reason).toBe('cross_sector_disabled');
    expect(sec01PylonEval.anchorSectorId).toBe('sec_0_1');
    expect(sec01PylonEval.crossesFromFoundingSector).toBe(true);

    // 4. Evaluate and enqueue a 2x2 Solar entirely inside sec_0_0 at (22, 0) -> succeeds!
    const intraSolarEval = evaluateCrossSectorPlacement(host.state, {
      colonyId: 0,
      building: 'solar',
      q: 22,
      r: 0,
    });
    expect(intraSolarEval.ok).toBe(true);
    expect(intraSolarEval.straddlesSectorBoundary).toBe(false);
    expect(intraSolarEval.footprintSectorIds).toEqual(['sec_0_0']);
    expect(
      applyCmd(
        host,
        mkCmd('enqueueTask', { task: { kind: 'build', building: 'solar', q: 22, r: 0 } }),
      ).code,
    ).toBeUndefined();
  });
});

describe('W11-41 intra-sector D-37 placement rejection parity', () => {
  it('rejects invalid intra-sector placements with standard D-37 placement blocks and reject codes', () => {
    const host = createCrossSectorTestHost('w11-41-rejects');
    flattenRegionForTest(host.state, 16, 0, 9);

    expect(applyCmd(host, mkCmd('dev.land', { q: 14, r: 0 }, 0, 'dev')).code).toBeUndefined();
    spawnActiveStructure(host.state, 0, ENTITY_KIND.commandHub, 14, 0, 3, 3, 1500);

    // 1. Tile in sec_0_0 (22, 0) outside Hub power zone (dist 8 > 6): fails with outsidePowerZone / outside_power_zone
    const outZoneEval = evaluateCrossSectorPlacement(host.state, {
      colonyId: 0,
      building: 'solar',
      q: 22,
      r: 0,
    });
    expect(outZoneEval.ok).toBe(false);
    expect(outZoneEval.anchorSectorId).toBe('sec_0_0');
    expect(outZoneEval.block).toBe('outsidePowerZone');
    expect(outZoneEval.code).toBe('outside_power_zone');
    expect(
      applyCmd(host, mkCmd('enqueueTask', { task: { kind: 'build', building: 'solar', q: 22, r: 0 } })).code,
    ).toBe('outside_power_zone');

    // 2. Extend pylon inside sec_0_0, then test foreign territory, water, and missing deposit
    spawnActiveStructure(host.state, 0, ENTITY_KIND.pylon, 19, 0, 1, 1, 100);
    const hex = hexIndex(host.state.grid.radius);
    const targetIdx = hex.indexOf(20, 0); // in sec_0_0
    host.state.grid.layers.owner[targetIdx] = 1; // owned by foreign Colony 1
    const foreignEval = evaluateCrossSectorPlacement(host.state, {
      colonyId: 0,
      building: 'solar',
      q: 20,
      r: 0,
    });
    expect(foreignEval.ok).toBe(false);
    expect(foreignEval.block).toBe('foreign');
    expect(foreignEval.code).toBe('not_own_territory');

    host.state.grid.layers.owner[targetIdx] = 0;
    host.state.grid.layers.terrain[targetIdx] = TERRAIN.deep;
    const waterEval = evaluateCrossSectorPlacement(host.state, {
      colonyId: 0,
      building: 'solar',
      q: 20,
      r: 0,
    });
    expect(waterEval.ok).toBe(false);
    expect(waterEval.block).toBe('water');
    expect(waterEval.code).toBe('terrain_unbuildable');
    expect(
      applyCmd(host, mkCmd('enqueueTask', { task: { kind: 'build', building: 'solar', q: 20, r: 0 } })).code,
    ).toBe('terrain_unbuildable');

    host.state.grid.layers.terrain[targetIdx] = TERRAIN.flat;
    const noDepEval = evaluateCrossSectorPlacement(host.state, {
      colonyId: 0,
      building: 'metalsExtractor',
      q: 20,
      r: 0,
    });
    expect(noDepEval.ok).toBe(false);
    expect(noDepEval.block).toBe('noDeposit');
    expect(noDepEval.code).toBe('site_blocked');
  });
});

describe('W11-41 sector-isolated power relay grid and founding-seat invariant (MM-05 / MM-33)', () => {
  it('isolates power relays within a single sector and prevents linking across sector boundaries', () => {
    const host = createCrossSectorTestHost('w11-41-power-and-seats');
    flattenRegionForTest(host.state, 20, 0, 9);
    setPlanetTime(host.state, { timeOfDay: 12 }, 0);

    // 1. Found Colony 0 in sec_0_0 at (18, 0) and claim territory (clamped to sec_0_0)
    expect(applyCmd(host, mkCmd('dev.land', { q: 18, r: 0 }, 0, 'dev')).code).toBeUndefined();
    claimTerritoryRadius(host.state, { colonyId: 0, q: 21, r: 0, radius: 6, tick: host.tick });

    // 2. Place Command Hub + 2x Solar + Extractor + Factory in sec_0_0, and a Pylon across the seam in sec_1_0
    spawnActiveStructure(host.state, 0, ENTITY_KIND.commandHub, 18, 0, 3, 3, 1500);
    spawnActiveStructure(host.state, 0, ENTITY_KIND.solar, 16, 2, 2, 2, 400);
    spawnActiveStructure(host.state, 0, ENTITY_KIND.solar, 16, -2, 2, 2, 400);
    spawnActiveStructure(host.state, 0, ENTITY_KIND.pylon, 22, 0, 1, 1, 100);
    const ext = spawnActiveStructure(host.state, 0, ENTITY_KIND.metalsExtractor, 21, 1, 2, 2, 500);
    const fac = spawnActiveStructure(host.state, 0, ENTITY_KIND.roboticsFactory, 19, 3, 3, 3, 800);
    // Pylon in sec_1_0 at (25, -1) is within hexDistance 3 of Pylon at (22, 0), but in another sector!
    spawnActiveStructure(host.state, 0, ENTITY_KIND.pylon, 25, -1, 1, 1, 100);
    const crossExt = spawnActiveStructure(host.state, 0, ENTITY_KIND.metalsExtractor, 26, -1, 2, 2, 500);

    expect(
      relaysLinked(
        host.state,
        { entityId: 1, kind: ENTITY_KIND.pylon, q: 22, r: 0, sectorId: 'sec_0_0' },
        { entityId: 2, kind: ENTITY_KIND.pylon, q: 25, r: -1, sectorId: 'sec_1_0' },
      ),
    ).toBe(false);

    host.step(1);

    // 3. Verify power network is strictly isolated to sec_0_0
    const powerReport = inspectCrossSectorPowerGrid(host.state, 0);
    expect(powerReport.spansMultipleSectors).toBe(false);
    expect(powerReport.connectedSectorIds).toEqual(['sec_0_0']);
    expect(powerReport.crossSectorRelayLinks).toEqual([]);
    expect(powerReport.powerSummary.brownout).toBe(false);
    expect(powerReport.powerSummary.entityPower?.[ext.id]?.state).toBe('online');
    expect(powerReport.powerSummary.entityPower?.[fac.id]?.state).toBe('online');
    expect(powerReport.powerSummary.entityPower?.[crossExt.id]?.state).toBe('offline');
    expect(getColonyPower(host.state, 0)?.brownout).toBe(false);

    // 4. Verify Founding-Seat Invariant (MM-05 / MM-33)
    const metrics = computeAtlasSectorColonyMetrics(host.state);
    expect(metrics.sec_0_0.foundedSeats).toBe(1);
    expect(metrics.sec_0_0.livingColonies).toBe(1);
    expect(metrics.sec_0_0.presentColonies).toBe(1);
    expect(metrics.sec_0_0.freeSeats).toBe(metrics.sec_0_0.foundingCapacity - 1);
    expect(metrics.totalFoundedSeats).toBe(1);
    expect(metrics.totalLivingColonies).toBe(1);
    expect(host.state.colonies[0]?.foundingSectorId).toBe('sec_0_0');
    expect(getAtlasBlob(host.state)?.foundingSectorByColony?.[0]).toBe('sec_0_0');
  });
});

describe('W11-41 intra-sector power severing, founding overrides, and colony elimination', () => {
  it('severs power when a bridging pylon is destroyed and supports Map/Record founding overrides + elimination', () => {
    const host = createCrossSectorTestHost('w11-41-sever-and-elim');
    flattenRegionForTest(host.state, 12, 0, 10);
    setPlanetTime(host.state, { timeOfDay: 12 }, 0);

    // Hub at (8, 0) in sec_0_0 -> Pylon A at (13, 0) -> Pylon B at (17, 0) -> Pylon C at (21, 0) -> Extractor at (21, 1)
    expect(applyCmd(host, mkCmd('dev.land', { q: 8, r: 0 }, 0, 'dev')).code).toBeUndefined();
    spawnActiveStructure(host.state, 0, ENTITY_KIND.commandHub, 8, 0, 3, 3, 1500);
    spawnActiveStructure(host.state, 0, ENTITY_KIND.solar, 6, 0, 2, 2, 400);
    spawnActiveStructure(host.state, 0, ENTITY_KIND.pylon, 13, 0, 1, 1, 100);
    const pylonB = spawnActiveStructure(host.state, 0, ENTITY_KIND.pylon, 17, 0, 1, 1, 100);
    spawnActiveStructure(host.state, 0, ENTITY_KIND.pylon, 21, 0, 1, 1, 100);
    const ext = spawnActiveStructure(host.state, 0, ENTITY_KIND.metalsExtractor, 21, 1, 2, 2, 500);

    expect(hexDistance(13, 0, 21, 0)).toBe(8); // outside Pylon A's radius 5
    expect(hexDistance(17, 0, 21, 0)).toBe(4); // inside Pylon B's radius 5
    host.step(1);

    const before = inspectCrossSectorPowerGrid(host.state, 0);
    expect(before.connectedSectorIds).toEqual(['sec_0_0']);
    expect(before.powerSummary.entityPower?.[ext.id]?.state).toBe('online');

    // Destroy bridging Pylon B at (17, 0)
    host.state.entities.cols.hp[pylonB.row] = 0;
    notifyPylonOrBuildingRemoved(host.state, pylonB.id, host.tick);
    const stepRes = host.step(1);
    const after = inspectCrossSectorPowerGrid(host.state, 0);
    expect(after.powerSummary.entityPower?.[ext.id]?.state).toBe('offline');
    expect(host.state.entities.cols.state[ext.row]).toBe(ENTITY_STATE.offlineNoGrid);
    expect(stepRes.events.some((e) => e.kind === 'powerSevered')).toBe(true);

    // Verify explicit Map / Record foundingSectorByColony overrides and elimination semantics
    const mapOverride = new Map<number, SectorId>([[0, 'sec_-1_0']]);
    expect(computeAtlasSectorColonyMetrics(host.state, mapOverride).sec_0_0.foundedSeats).toBe(0);
    expect(computeAtlasSectorColonyMetrics(host.state, { 0: 'sec_-1_0' }).get('sec_-1_0')?.foundedSeats).toBe(1);

    // Eliminate Colony 0: foundedSeats stays 1 (permanent seat consumed), livingColonies & presentColonies drop to 0
    host.state.colonies[0]!.status = 'eliminated';
    const elimMetrics = computeAtlasSectorColonyMetrics(host.state);
    expect(elimMetrics.sec_0_0.foundedSeats).toBe(1);
    expect(elimMetrics.sec_0_0.livingColonies).toBe(0);
    expect(elimMetrics.sec_0_0.presentColonies).toBe(0);
  });
});

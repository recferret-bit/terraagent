import { describe, expect, it } from 'vitest';
import { parseWaves, type SectorId } from '@terra/contracts';
import {
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

describe('W11-41 cross-sector walking and exploration across 3 sectors', () => {
  it('pathfinds and walks a unit from sec_0_0 -> sec_1_0 -> sec_0_1 with zero seam cost penalty and reveals 3-sector exploration', () => {
    const host = createCrossSectorTestHost();
    flattenRegionForTest(host.state, 23, 0, 8);

    // Land Colony 0 in sec_0_0 near the tri-sector seam at (19, 0)
    expect(applyCmd(host, mkCmd('dev.land', { q: 19, r: 0 }, 0, 'dev')).code).toBeUndefined();

    const hqId = findUnitEntityId(host.state, 0, ENTITY_KIND.hq);
    expect(hqId).toBeGreaterThan(0);
    const startPos = getEntityTile(host.state, hqId);
    expect(globalTileToSector(startPos.q, startPos.r).sectorId).toBe('sec_0_0');

    const wpSec10 = { q: 26, r: -1 };
    const wpSec01 = { q: 24, r: 3 };
    expect(globalTileToSector(wpSec10.q, wpSec10.r).sectorId).toBe('sec_1_0');
    expect(globalTileToSector(wpSec01.q, wpSec01.r).sectorId).toBe('sec_0_1');

    // Verify shared pathfinder across sec_0_0 -> sec_1_0 and sec_1_0 -> sec_0_1
    const leg1 = inspectCrossSectorPath(host.state, startPos, wpSec10, { profile: 'ground' });
    expect(leg1.ok).toBe(true);
    expect(leg1.startSectorId).toBe('sec_0_0');
    expect(leg1.goalSectorId).toBe('sec_1_0');
    expect(leg1.crossesSectorBoundary).toBe(true);
    expect(leg1.zeroSeamPenalty).toBe(true);
    expect(leg1.path).toEqual(findHexPath(host.state, startPos, wpSec10).path);

    const leg2 = inspectCrossSectorPath(host.state, wpSec10, wpSec01, { profile: 'ground' });
    expect(leg2.ok).toBe(true);
    expect(leg2.startSectorId).toBe('sec_1_0');
    expect(leg2.goalSectorId).toBe('sec_0_1');
    expect(leg2.crossesSectorBoundary).toBe(true);
    expect(leg2.zeroSeamPenalty).toBe(true);

    // Walk HQ Commander into sec_1_0 via moveUnit command
    expect(applyCmd(host, mkCmd('moveUnit', { entityId: hqId, q: wpSec10.q, r: wpSec10.r })).code).toBeUndefined();
    host.step(60);
    expect(getEntityTile(host.state, hqId)).toEqual(wpSec10);

    // Walk HQ Commander from sec_1_0 into sec_0_1 via moveUnit command
    expect(applyCmd(host, mkCmd('moveUnit', { entityId: hqId, q: wpSec01.q, r: wpSec01.r })).code).toBeUndefined();
    host.step(60);
    expect(getEntityTile(host.state, hqId)).toEqual(wpSec01);
    expect(findUnitEntityId(host.state, 0, ENTITY_KIND.hq)).toBe(hqId);

    // Verify per-colony exploration spans all 3 sectors
    const exploredBySec = countExploredTilesBySector(host.state, 0);
    expect(exploredBySec.sec_0_0).toBeGreaterThan(20);
    expect(exploredBySec.sec_1_0).toBeGreaterThan(10);
    expect(exploredBySec.sec_0_1).toBeGreaterThan(10);
    expect(exploredSectorIdsForColony(host.state, 0)).toEqual(['sec_0_0', 'sec_0_1', 'sec_1_0']);
  });

  it('finds continuous long-range land paths across 3 sector centers on the generated continent', () => {
    const state = createAtlasPlanetState({ planetType: 'temperate', seed: 'continent-walk-seed' });
    const legA = inspectCrossSectorPath(state, { q: 0, r: 0 }, { q: 49, r: -25 });
    const legB = inspectCrossSectorPath(state, { q: 49, r: -25 }, { q: 24, r: 25 });
    expect(legA.ok).toBe(true);
    expect(legA.startSectorId).toBe('sec_0_0');
    expect(legA.goalSectorId).toBe('sec_1_0');
    expect(legA.crossesSectorBoundary).toBe(true);
    expect(legA.zeroSeamPenalty).toBe(true);
    expect(legB.ok).toBe(true);
    expect(legB.startSectorId).toBe('sec_1_0');
    expect(legB.goalSectorId).toBe('sec_0_1');
    expect(legB.crossesSectorBoundary).toBe(true);
    expect(legB.zeroSeamPenalty).toBe(true);
  });
});

describe('W11-41 cross-sector construction footprints and D-37 placement parity', () => {
  it('accepts footprints straddling sector seams and inside adjacent sectors once territory and power reach across the seam', () => {
    const host = createCrossSectorTestHost('w11-41-placement');
    flattenRegionForTest(host.state, 24, 0, 8);

    // Land Colony 0 at (23, 0) in sec_0_0 right beside the seam
    expect(applyCmd(host, mkCmd('dev.land', { q: 23, r: 0 }, 0, 'dev')).code).toBeUndefined();
    host.state.colonies[0]!.unlockStage = 4;
    creditResource(host.state.colonies[0]!, 'metals.t1', 500, host.tick);
    creditResource(host.state.colonies[0]!, 'minerals.t1', 500, host.tick);

    // 1. Evaluate a 3x3 Command Hub at (24, 1) whose footprint straddles sec_0_0, sec_0_1, and sec_1_0!
    const triSeamHubEval = evaluateCrossSectorPlacement(host.state, {
      colonyId: 0,
      building: 'commandHub',
      q: 24,
      r: 1,
    });
    expect(triSeamHubEval.ok).toBe(true);
    expect(triSeamHubEval.straddlesSectorBoundary).toBe(true);
    expect(triSeamHubEval.footprintSectorIds).toEqual(['sec_0_0', 'sec_0_1', 'sec_1_0']);
    expect(
      evaluatePlacement(placementWorldFromState(host.state), {
        colonyId: 0,
        building: 'commandHub',
        q: 24,
        r: 1,
      }).ok,
    ).toBe(true);

    // Activate Command Hub at (21, 0) in sec_0_0 and extend territory + Pylon at (24, 0) on the seam
    spawnActiveStructure(host.state, 0, ENTITY_KIND.commandHub, 21, 0, 3, 3, 1500);
    spawnActiveStructure(host.state, 0, ENTITY_KIND.pylon, 24, 0, 1, 1, 100);
    claimTerritoryRadius(host.state, { colonyId: 0, q: 24, r: 0, radius: 6, tick: host.tick });

    // 2. Evaluate and enqueue a 2x2 Solar at (25, 0) straddling sec_0_1 and sec_1_0
    const seamSolarEval = evaluateCrossSectorPlacement(host.state, {
      colonyId: 0,
      building: 'solar',
      q: 25,
      r: 0,
    });
    expect(seamSolarEval.ok).toBe(true);
    expect(seamSolarEval.straddlesSectorBoundary).toBe(true);
    expect(seamSolarEval.footprintSectorIds).toEqual(['sec_0_1', 'sec_1_0']);

    expect(
      applyCmd(
        host,
        mkCmd('enqueueTask', { task: { kind: 'build', building: 'solar', q: 25, r: 0 } }),
      ).code,
    ).toBeUndefined();

    // 3. Evaluate and enqueue a Pylon inside sec_0_1 at (24, 3)
    const sec01PylonEval = evaluateCrossSectorPlacement(host.state, {
      colonyId: 0,
      building: 'pylon',
      q: 24,
      r: 3,
    });
    expect(sec01PylonEval.ok).toBe(true);
    expect(sec01PylonEval.anchorSectorId).toBe('sec_0_1');
    expect(
      applyCmd(
        host,
        mkCmd('enqueueTask', { task: { kind: 'build', building: 'pylon', q: 24, r: 3 } }),
      ).code,
    ).toBeUndefined();
  });
});

describe('W11-41 cross-sector D-37 placement rejection parity', () => {
  it('rejects invalid cross-seam and adjacent-sector placements with the exact same D-37 placement blocks and reject codes', () => {
    const host = createCrossSectorTestHost('w11-41-rejects');
    flattenRegionForTest(host.state, 24, 0, 9);

    expect(applyCmd(host, mkCmd('dev.land', { q: 21, r: 0 }, 0, 'dev')).code).toBeUndefined();
    spawnActiveStructure(host.state, 0, ENTITY_KIND.commandHub, 21, 0, 3, 3, 1500);

    // 1. Tile in sec_1_0 (30, -3) outside Hub power zone (dist 9 > 6): fails with outsidePowerZone / outside_power_zone
    const outZoneEval = evaluateCrossSectorPlacement(host.state, {
      colonyId: 0,
      building: 'solar',
      q: 30,
      r: -3,
    });
    expect(outZoneEval.ok).toBe(false);
    expect(outZoneEval.anchorSectorId).toBe('sec_1_0');
    expect(outZoneEval.block).toBe('outsidePowerZone');
    expect(outZoneEval.code).toBe('outside_power_zone');
    expect(
      applyCmd(host, mkCmd('enqueueTask', { task: { kind: 'build', building: 'solar', q: 30, r: -3 } })).code,
    ).toBe('outside_power_zone');

    // 2. Extend pylon across the seam, then test foreign territory, water, and missing deposit on seam
    spawnActiveStructure(host.state, 0, ENTITY_KIND.pylon, 24, 0, 1, 1, 100);
    const hex = hexIndex(host.state.grid.radius);
    const seamIdx = hex.indexOf(25, -1); // in sec_1_0
    host.state.grid.layers.owner[seamIdx] = 1; // owned by foreign Colony 1
    const foreignEval = evaluateCrossSectorPlacement(host.state, {
      colonyId: 0,
      building: 'solar',
      q: 25,
      r: -1,
    });
    expect(foreignEval.ok).toBe(false);
    expect(foreignEval.block).toBe('foreign');
    expect(foreignEval.code).toBe('not_own_territory');

    host.state.grid.layers.owner[seamIdx] = 0;
    host.state.grid.layers.terrain[seamIdx] = TERRAIN.deep;
    const waterEval = evaluateCrossSectorPlacement(host.state, {
      colonyId: 0,
      building: 'solar',
      q: 25,
      r: -1,
    });
    expect(waterEval.ok).toBe(false);
    expect(waterEval.block).toBe('water');
    expect(waterEval.code).toBe('terrain_unbuildable');
    expect(
      applyCmd(host, mkCmd('enqueueTask', { task: { kind: 'build', building: 'solar', q: 25, r: -1 } })).code,
    ).toBe('terrain_unbuildable');

    host.state.grid.layers.terrain[seamIdx] = TERRAIN.flat;
    const noDepEval = evaluateCrossSectorPlacement(host.state, {
      colonyId: 0,
      building: 'metalsExtractor',
      q: 25,
      r: -1,
    });
    expect(noDepEval.ok).toBe(false);
    expect(noDepEval.block).toBe('noDeposit');
    expect(noDepEval.code).toBe('site_blocked');
  });
});

describe('W11-41 cross-sector power relay grid and founding-seat invariant (MM-05 / MM-33)', () => {
  it('connects solar, pylons, and consumers across sec_0_0, sec_1_0, and sec_0_1 into one online grid and preserves foundedSeats', () => {
    const host = createCrossSectorTestHost('w11-41-power-and-seats');
    flattenRegionForTest(host.state, 24, 0, 9);
    setPlanetTime(host.state, { timeOfDay: 12 }, 0);

    // 1. Found Colony 0 in sec_0_0 at (20, 0) and claim territory across all 3 sectors
    expect(applyCmd(host, mkCmd('dev.land', { q: 20, r: 0 }, 0, 'dev')).code).toBeUndefined();
    claimTerritoryRadius(host.state, { colonyId: 0, q: 24, r: 0, radius: 7, tick: host.tick });

    // 2. Place Command Hub + Solar in sec_0_0, Pylons + Solar in sec_1_0, and Pylon + Extractor + Factory in sec_0_1
    spawnActiveStructure(host.state, 0, ENTITY_KIND.commandHub, 21, 0, 3, 3, 1500);
    spawnActiveStructure(host.state, 0, ENTITY_KIND.solar, 19, 2, 2, 2, 400);
    spawnActiveStructure(host.state, 0, ENTITY_KIND.pylon, 25, -1, 1, 1, 100);
    spawnActiveStructure(host.state, 0, ENTITY_KIND.solar, 27, -2, 2, 2, 400);
    spawnActiveStructure(host.state, 0, ENTITY_KIND.pylon, 24, 2, 1, 1, 100);
    const ext = spawnActiveStructure(host.state, 0, ENTITY_KIND.metalsExtractor, 24, 3, 2, 2, 500);
    const fac = spawnActiveStructure(host.state, 0, ENTITY_KIND.roboticsFactory, 22, 4, 3, 3, 800);

    // Walk HQ Commander into sec_1_0 at (29, -2) (clear of the 2x2 Solar at (27,-2))
    const hqId = findUnitEntityId(host.state, 0, ENTITY_KIND.hq);
    expect(applyCmd(host, mkCmd('moveUnit', { entityId: hqId, q: 29, r: -2 })).code).toBeUndefined();
    host.step(40);

    // 3. Verify unified cross-sector power network across sec_0_0, sec_1_0, and sec_0_1
    const powerReport = inspectCrossSectorPowerGrid(host.state, 0);
    expect(powerReport.spansMultipleSectors).toBe(true);
    expect(powerReport.connectedSectorIds).toEqual(['sec_0_0', 'sec_0_1', 'sec_1_0']);
    expect(powerReport.crossSectorRelayLinks.length).toBeGreaterThanOrEqual(2);
    expect(powerReport.powerSummary.brownout).toBe(false);
    expect(powerReport.powerSummary.supply).toBeGreaterThanOrEqual(30);
    expect(powerReport.powerSummary.demand).toBeGreaterThanOrEqual(3);
    expect(powerReport.powerSummary.entityPower?.[ext.id]?.state).toBe('online');
    expect(powerReport.powerSummary.entityPower?.[fac.id]?.state).toBe('online');
    expect(getColonyPower(host.state, 0)?.brownout).toBe(false);

    // 4. Verify Founding-Seat Invariant (MM-05 / MM-33)
    const metrics = computeAtlasSectorColonyMetrics(host.state);
    expect(metrics.sec_0_0.foundedSeats).toBe(1);
    expect(metrics.sec_0_0.livingColonies).toBe(1);
    expect(metrics.sec_0_0.presentColonies).toBe(1);
    expect(metrics.sec_0_0.freeSeats).toBe(metrics.sec_0_0.foundingCapacity - 1);

    expect(metrics.sec_1_0.foundedSeats).toBe(0);
    expect(metrics.sec_1_0.livingColonies).toBe(0);
    expect(metrics.sec_1_0.presentColonies).toBe(1);
    expect(metrics.sec_1_0.freeSeats).toBe(metrics.sec_1_0.foundingCapacity);

    expect(metrics.sec_0_1.foundedSeats).toBe(0);
    expect(metrics.sec_0_1.livingColonies).toBe(0);
    expect(metrics.sec_0_1.presentColonies).toBe(1);
    expect(metrics.sec_0_1.freeSeats).toBe(metrics.sec_0_1.foundingCapacity);

    expect(metrics.totalFoundedSeats).toBe(1);
    expect(metrics.totalLivingColonies).toBe(1);
    expect(metrics.presentSectorsByColony[0]).toEqual(['sec_0_0', 'sec_0_1', 'sec_1_0']);
    expect(host.state.colonies[0]?.foundingSectorId).toBe('sec_0_0');
    expect(host.state.colonies[0]?.presentSectorIds).toEqual(['sec_0_0', 'sec_0_1', 'sec_1_0']);
    expect(getAtlasBlob(host.state)?.foundingSectorByColony?.[0]).toBe('sec_0_0');
  });
});

describe('W11-41 cross-sector power severing, founding overrides, and colony elimination', () => {
  it('severs cross-sector power to a 3rd sector when the bridging pylon is destroyed and supports Map/Record founding overrides + elimination', () => {
    const host = createCrossSectorTestHost('w11-41-sever-and-elim');
    flattenRegionForTest(host.state, 24, 0, 10);
    setPlanetTime(host.state, { timeOfDay: 12 }, 0);

    // Hub at (17, 0) in sec_0_0 (radius 6) -> Pylon A at (22, 0) in sec_0_0 (dist 5 from Hub)
    // -> Pylon B at (26, -1) in sec_1_0 (dist 4 from A, dist 9 from Hub)
    // -> Pylon C at (24, 4) in sec_0_1 (dist 5 from B, dist 6 from A -> only reachable via B!)
    expect(applyCmd(host, mkCmd('dev.land', { q: 17, r: 0 }, 0, 'dev')).code).toBeUndefined();
    spawnActiveStructure(host.state, 0, ENTITY_KIND.commandHub, 17, 0, 3, 3, 1500);
    spawnActiveStructure(host.state, 0, ENTITY_KIND.solar, 15, 0, 2, 2, 400);
    spawnActiveStructure(host.state, 0, ENTITY_KIND.pylon, 22, 0, 1, 1, 100);
    const pylonB = spawnActiveStructure(host.state, 0, ENTITY_KIND.pylon, 26, -1, 1, 1, 100);
    spawnActiveStructure(host.state, 0, ENTITY_KIND.pylon, 24, 4, 1, 1, 100);
    const ext = spawnActiveStructure(host.state, 0, ENTITY_KIND.metalsExtractor, 24, 5, 2, 2, 500);

    expect(hexDistance(22, 0, 24, 4)).toBe(6); // outside Pylon A's radius 5
    expect(hexDistance(26, -1, 24, 4)).toBe(5); // inside Pylon B's radius 5 in sec_1_0!
    host.step(1);

    const before = inspectCrossSectorPowerGrid(host.state, 0);
    expect(before.connectedSectorIds).toEqual(['sec_0_0', 'sec_0_1', 'sec_1_0']);
    expect(before.powerSummary.entityPower?.[ext.id]?.state).toBe('online');

    // Destroy bridging Pylon B at (26, -1) in sec_1_0
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
    expect(elimMetrics.sec_0_1.presentColonies).toBe(0);
  });
});

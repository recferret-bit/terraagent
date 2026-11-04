import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import {
  ENTITY_KIND,
  PREP,
  SimHost,
  TERRAIN,
  compileData,
  createPlanet,
  evaluatePlacement,
  getBuildingFootprintTiles,
  getBuildingJobs,
  getColonyTerraformOrders,
  getConstructionOrders,
  getManualTerraformLaneCount,
  hexIndex,
  placementWorldFromState,
  rowOf,
  setColonyStock,
  setTileHeight,
  setTilePrep,
  setTileTerrain,
  spawnHqUnit,
  spawnTerraformerUnit,
  type SimCommand,
} from '../../src';

let seq = 0;
function mkCmd(kind: string, args: unknown, colonyIndex = 0): SimCommand {
  return { colonyIndex, source: 'player', commandId: `w05_lp_${++seq}`, kind, args };
}

function createW05Host(): SimHost {
  const host = new SimHost({ flags: parseWaves('..05') });
  const state = createPlanet({ type: 'flat', seed: 'w05-linked-prep', radius: 14 });
  host.load(state);
  const hqId = spawnHqUnit(state, { owner: 0, q: 0, r: 0 });
  const hqRow = rowOf(state.entities, hqId);
  state.entities.cols.cell[hqRow] = 800;
  state.entities.cols.cellMax[hqRow] = 800;
  setColonyStock(state, 0, {
    'metals.t1': 500,
    'minerals.t1': 500,
    'bio.biomass': 500,
    'bio.water': 500,
  });
  return host;
}

describe('W05-09: Linked site prep with W05 ops (D-37 re-opened, GP-55)', () => {
  it('acceptance: Place on 2 slope + 1 hole + 1 flat -> one linked order (Level x2, Fill, Grade x4); cancel -> both disappear', () => {
    const host = createW05Host();
    const state = host.state;
    const idx = hexIndex(state.grid.radius);
    const data = compileData(parseWaves('..05'));

    // Place a completed Command Hub at (0, 0) so power zone covers (3, 0)
    const hubFp = getBuildingFootprintTiles(0, 0, 3);
    for (const p of hubFp) {
      setTileTerrain(state.grid, idx.indexOf(p.q, p.r), TERRAIN.flat);
      setTilePrep(state.grid, idx.indexOf(p.q, p.r), PREP.prepared);
    }
    host.submit(mkCmd('placeBuilding', { building: 'commandHub', q: 0, r: 0 }));
    for (let t = 0; t < 200 && (getConstructionOrders(state, 0).length > 0 || state.colonies[0]?.hubEntityId === undefined); t++) {
      host.step(1);
    }

    // 2x2 Solar footprint at (3, 0): 2 slope + 1 hole + 1 flat (wild)
    const fp = getBuildingFootprintTiles(3, 0, 2);
    expect(fp).toHaveLength(4);
    setTileTerrain(state.grid, idx.indexOf(fp[0].q, fp[0].r), TERRAIN.slope);
    setTilePrep(state.grid, idx.indexOf(fp[0].q, fp[0].r), PREP.wild);
    setTileTerrain(state.grid, idx.indexOf(fp[1].q, fp[1].r), TERRAIN.slope);
    setTilePrep(state.grid, idx.indexOf(fp[1].q, fp[1].r), PREP.wild);
    setTileTerrain(state.grid, idx.indexOf(fp[2].q, fp[2].r), TERRAIN.hole);
    setTilePrep(state.grid, idx.indexOf(fp[2].q, fp[2].r), PREP.wild);
    setTileTerrain(state.grid, idx.indexOf(fp[3].q, fp[3].r), TERRAIN.flat);
    setTilePrep(state.grid, idx.indexOf(fp[3].q, fp[3].r), PREP.wild);

    // 1. evaluatePlacement accepts the site and bills Level x2, Fill x1, Grade x4
    const evalRes = evaluatePlacement(placementWorldFromState(state), {
      colonyId: 0,
      building: 'solar',
      q: 3,
      r: 0,
      data,
    });
    expect(evalRes.ok).toBe(true);
    expect(evalRes.bill.ops).toEqual({
      grade: 4,
      clear: 0,
      break: 0,
      level: 2,
      fill: 1,
    });
    expect(evalRes.bill.cost).toEqual({
      'metals.t1': 10,
      'minerals.t1': 9,
    });

    // 2. Enqueue the 2x2 Solar build order
    const buildCmd = mkCmd('enqueueTask', { task: { kind: 'build', building: 'solar', q: 3, r: 0 } });
    host.submit(buildCmd);
    const out = host.step(1).outcomes[0];
    expect(out?.code).toBeUndefined();

    // Verify one linked prep order with Level x2, Fill x1, Grade x4
    const tfOrders = getColonyTerraformOrders(state, 0);
    expect(tfOrders).toHaveLength(1);
    const prepOrder = tfOrders[0]!;
    expect(prepOrder.isLinkedPrep).toBe(true);
    expect(getManualTerraformLaneCount(state, 0)).toBe(0);
    expect(prepOrder.jobs).toHaveLength(7);
    expect(prepOrder.jobs.filter((j) => j.op === 'level')).toHaveLength(2);
    expect(prepOrder.jobs.filter((j) => j.op === 'fill')).toHaveLength(1);
    expect(prepOrder.jobs.filter((j) => j.op === 'grade')).toHaveLength(4);

    const buildJobs = Object.values(getBuildingJobs(state));
    expect(buildJobs).toHaveLength(1);
    const buildJob = buildJobs[0]!;
    expect(buildJob.prepOrderId).toBe(prepOrder.orderId);
    expect(buildJob.waitReason).toBe('site');

    // 3. Cancel the linked order -> both building job and linked prep order disappear
    host.submit(mkCmd('cancelTask', { taskId: prepOrder.orderId }));
    expect(host.step(1).outcomes[0]?.code).toBeUndefined();
    expect(getColonyTerraformOrders(state, 0)).toHaveLength(0);
    expect(Object.values(getBuildingJobs(state))).toHaveLength(0);
    expect(rowOf(state.entities, buildJob.entityId)).toBe(-1);
  });
});

describe('W05-09: Deep Reclaim tier gate & GP-55 uneven height spread in linked prep', () => {
  it('requires a T2 worker for linked Deep Reclaim, while Reclaim on shallow water works with T1', () => {
    const host = createW05Host();
    const state = host.state;
    const idx = hexIndex(state.grid.radius);
    const data = compileData(parseWaves('..05'));

    const fp = getBuildingFootprintTiles(3, 0, 3);
    for (const p of fp) {
      setTileTerrain(state.grid, idx.indexOf(p.q, p.r), TERRAIN.flat);
      setTilePrep(state.grid, idx.indexOf(p.q, p.r), PREP.wild);
    }
    // Shallow water is accepted with T1 HQ
    setTileTerrain(state.grid, idx.indexOf(fp[0].q, fp[0].r), TERRAIN.shallow);
    const shallowEval = evaluatePlacement(placementWorldFromState(state), {
      colonyId: 0,
      building: 'commandHub',
      q: 3,
      r: 0,
      data,
    });
    expect(shallowEval.ok).toBe(true);
    expect(shallowEval.bill.ops.reclaim).toBe(1);

    // Deep water is rejected with T1 workers only
    setTileTerrain(state.grid, idx.indexOf(fp[0].q, fp[0].r), TERRAIN.deep);
    const deepLocked = evaluatePlacement(placementWorldFromState(state), {
      colonyId: 0,
      building: 'commandHub',
      q: 3,
      r: 0,
      data,
    });
    expect(deepLocked.ok).toBe(false);
    expect(deepLocked.block).toBe('water');

    // Spawn a T2 Terraformer -> Deep Reclaim linked prep becomes valid
    spawnTerraformerUnit(state, { owner: 0, q: 1, r: 0, tier: 2 }, 0, data);
    const deepUnlocked = evaluatePlacement(placementWorldFromState(state), {
      colonyId: 0,
      building: 'commandHub',
      q: 3,
      r: 0,
      data,
    });
    expect(deepUnlocked.ok).toBe(true);
    expect(deepUnlocked.bill.ops.deepReclaim).toBe(1);
    expect(deepUnlocked.bill.ops.grade).toBe(9);
  });

  it('allows mild uneven height spread on unprepared footprint tiles when W05 linked prep is active (GP-55)', () => {
    const host = createW05Host();
    const state = host.state;
    const idx = hexIndex(state.grid.radius);
    const data = compileData(parseWaves('..05'));

    const fp = getBuildingFootprintTiles(3, 0, 3);
    for (const p of fp) {
      const ti = idx.indexOf(p.q, p.r);
      setTileTerrain(state.grid, ti, TERRAIN.flat);
      setTilePrep(state.grid, ti, PREP.wild);
      setTileHeight(state.grid, ti, 0);
    }
    // Make one tile slightly uneven (0.35m)
    setTileHeight(state.grid, idx.indexOf(fp[0].q, fp[0].r), 0.35);

    const res = evaluatePlacement(placementWorldFromState(state), {
      colonyId: 0,
      building: 'commandHub',
      q: 3,
      r: 0,
      data,
    });
    expect(res.ok).toBe(true);
    expect(state.entities.cols.kind.length).toBeGreaterThan(0);
    expect(ENTITY_KIND.commandHub).toBeGreaterThan(0);
  });
});

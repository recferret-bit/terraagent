import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import {
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
  hexIndex,
  placementWorldFromState,
  rowOf,
  setColonyStock,
  setTileHeight,
  setTilePrep,
  setTileTerrain,
  spawnHqUnit,
  spawnWorkerUnit,
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

describe('W05-09: obstacles are not a foundation (a place does not terraform)', () => {
  it('rejects a solar on 2 slope + 1 hole + 1 flat and creates no terraform order', () => {
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

    const evalRes = evaluatePlacement(placementWorldFromState(state), {
      colonyId: 0,
      building: 'solar',
      q: 3,
      r: 0,
      data,
    });
    expect(evalRes.ok).toBe(false);
    expect(['slope', 'hole', 'water']).toContain(evalRes.block);

    const buildCmd = mkCmd('enqueueTask', { task: { kind: 'build', building: 'solar', q: 3, r: 0 } });
    host.submit(buildCmd);
    expect(host.step(1).outcomes[0]?.code).toBe('terrain_unbuildable');
    expect(getColonyTerraformOrders(state, 0)).toEqual([]);
    expect(Object.values(getBuildingJobs(state))).toHaveLength(0);
  });
});

describe('W05-09: water and uneven ground stay unplaceable', () => {
  it('rejects shallow and deep water even when a T2 worker exists', () => {
    const host = createW05Host();
    const state = host.state;
    const idx = hexIndex(state.grid.radius);
    const data = compileData(parseWaves('..05'));

    const fp = getBuildingFootprintTiles(3, 0, 3);
    for (const p of fp) {
      setTileTerrain(state.grid, idx.indexOf(p.q, p.r), TERRAIN.flat);
      setTilePrep(state.grid, idx.indexOf(p.q, p.r), PREP.wild);
    }
    setTileTerrain(state.grid, idx.indexOf(fp[0].q, fp[0].r), TERRAIN.shallow);
    const shallowEval = evaluatePlacement(placementWorldFromState(state), {
      colonyId: 0,
      building: 'commandHub',
      q: 3,
      r: 0,
      data,
    });
    expect(shallowEval.ok).toBe(false);
    expect(shallowEval.block).toBe('water');

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

    spawnWorkerUnit(state, { owner: 0, q: 1, r: 0, tier: 2 });
    const deepUnlocked = evaluatePlacement(placementWorldFromState(state), {
      colonyId: 0,
      building: 'commandHub',
      q: 3,
      r: 0,
      data,
    });
    expect(deepUnlocked.ok).toBe(false);
    expect(deepUnlocked.block).toBe('water');
    expect(getColonyTerraformOrders(state, 0)).toEqual([]);
  });

  it('rejects a mild uneven height spread on a flat footprint', () => {
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
    expect(res.ok).toBe(false);
    expect(res.block).toBe('uneven');
  });
});

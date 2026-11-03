import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import {
  compileData,
  createPlanet,
  dataRow,
  ENTITY_KIND,
  ENTITY_STATE,
  getHarvesterView,
  hexDistance,
  hexIndex,
  listHarvesterViews,
  PREP,
  rowOf,
  SimHost,
  spawnHarvesterUnit,
  TERRAIN,
  type SimCommand,
} from '../../src';

let seq = 0;
function mkCmd(kind: string, args: unknown, colonyIndex: number | null = 0): SimCommand {
  return { colonyIndex, source: 'player', commandId: `harv_${++seq}`, kind, args };
}

function createW02Host(radius = 28): SimHost {
  const host = new SimHost({ flags: parseWaves('..02') });
  host.load(createPlanet({ type: 'flat', seed: 'harvester-test', radius }));
  return host;
}

describe('W02-11: Harvester unit stats and data compilation', () => {
  it('compiles Harvester T1 stats with 40/15/5/0 cost, 10s build, 0.5 harvestRate', () => {
    const compiled = compileData(parseWaves('..02'));
    const hRow = dataRow(compiled, 'unitsWorkersBasic', 'harvester');
    expect(hRow.cost).toEqual({
      'metals.t1': 40,
      'minerals.t1': 15,
      'bio.biomass': 5,
      'bio.water': 0,
    });
    expect(hRow.designBuildS).toBe(10);
    expect(hRow.buildS).toBe(50);
    expect(hRow.supply).toBe(1);
    expect(hRow.powerDrainPerS).toBe(1.5);
    expect(hRow.hp).toBe(160);
    expect(hRow.designSpeedTilesPerS).toBe(1.5);
    expect(hRow.speedTilesPerS).toBeCloseTo(0.3, 5);
    expect(hRow.viewRadius).toBe(7);
    expect(hRow.radius).toBe(0.4);
    expect(hRow.harvestRatePerS).toBe(0.5);
    expect(hRow.maxBuildTier).toBe(0);
  });

  it('spawns a Harvester and initializes entity store columns', () => {
    const host = createW02Host();
    const state = host.state;
    const harvesterId = spawnHarvesterUnit(state, { owner: 0, q: 0, r: 0 });
    const row = rowOf(state.entities, harvesterId);
    expect(row).toBe(0);

    const cols = state.entities.cols;
    expect(cols.kind[row]).toBe(ENTITY_KIND.harvester);
    expect(cols.owner[row]).toBe(0);
    expect(cols.tier[row]).toBe(1);
    expect(cols.q[row]).toBe(0);
    expect(cols.r[row]).toBe(0);
    expect(cols.x[row]).toBe(0);
    expect(cols.y[row]).toBe(0);
    expect(cols.hp[row]).toBe(160);
    expect(cols.hpMax[row]).toBe(160);
    expect(cols.workRate[row]).toBeCloseTo(1.0, 5);
    expect(cols.state[row]).toBe(ENTITY_STATE.idle);
  });
});

describe('W02-11: Harvester views and inspector fields', () => {
  it('exposes stats in getHarvesterView, blobs.units, colony, and host view', () => {
    const host = createW02Host();
    const state = host.state;
    state.colonies[0] = {
      index: 0,
      id: 'col-0',
      name: 'Alpha Colony',
      color: 0xff8800,
      status: 'active',
      changedAt: 0,
    };

    const harvesterId = spawnHarvesterUnit(state, { owner: 0, q: 0, r: 0 });
    expect(getHarvesterView(state, harvesterId)).toMatchObject({
      entityId: harvesterId,
      kind: ENTITY_KIND.harvester,
      unit: 'harvester',
      label: 'Harvester Drone',
      archetype: 'robot.miner',
      owner: 0,
      tier: 1,
      q: 0,
      r: 0,
      hp: 160,
      hpMax: 160,
      supply: 1,
      powerDrainPerS: 1.5,
      speedTilesPerS: 1.5,
      designSpeedTilesPerS: 1.5,
      viewRadius: 7,
      radius: 0.4,
      harvestRatePerS: 0.5,
      workRate: 1.0,
      maxBuildTier: 0,
      buildS: 50,
      designBuildS: 10,
      currentJob: 'idle',
    });

    const list = listHarvesterViews(state, 0);
    expect(list).toHaveLength(1);
    expect(list[0]?.entityId).toBe(harvesterId);

    const blobUnits = state.blobs.units?.value as Record<number, unknown> | undefined;
    expect(blobUnits?.[harvesterId]).toBeDefined();

    expect((state.colonies[0]?.harvesters as unknown[])?.[0]).toMatchObject({ entityId: harvesterId });
    expect((state.colonies[0]?.units as unknown[])?.[0]).toMatchObject({ entityId: harvesterId });

    expect(host.view().entities[0]).toMatchObject({
      id: harvesterId,
      kind: ENTITY_KIND.harvester,
      unit: 'harvester',
      label: 'Harvester Drone',
      archetype: 'robot.miner',
      supply: 1,
      powerDrainPerS: 1.5,
      speedTilesPerS: 1.5,
      viewRadius: 7,
      radius: 0.4,
      harvestRatePerS: 0.5,
      workRate: 1.0,
      maxBuildTier: 0,
    });
  });

  it('returns null or empty array for nonexistent queries', () => {
    const host = createW02Host();
    const state = host.state;
    expect(getHarvesterView(state, 123)).toBeNull();
    expect(getHarvesterView(state)).toBeNull();
    expect(listHarvesterViews(state, 0)).toEqual([]);
  });
});

describe('W02-11: Harvester vision and movement', () => {
  it('reveals fog-of-war vision within viewRadius 7 upon spawn', () => {
    const host = createW02Host();
    const state = host.state;
    spawnHarvesterUnit(state, { owner: 0, q: 0, r: 0 });

    const idx = hexIndex(state.grid.radius);
    const explored = state.grid.layers.explored as Uint8Array;
    for (let i = 0; i < idx.count; i++) {
      const d = hexDistance(0, 0, idx.q[i], idx.r[i]);
      expect(explored[i] & 1).toBe(d <= 7 ? 1 : 0);
    }
  });

  it('moves Harvester at 1.5 t/s (0.3 t/tick) over 15 tiles in 50 ticks (10.0 s)', () => {
    const host = createW02Host();
    const state = host.state;
    const harvesterId = spawnHarvesterUnit(state, { owner: 0, q: 0, r: 0 });
    const row = rowOf(state.entities, harvesterId);
    const cols = state.entities.cols;

    host.submit(mkCmd('moveUnit', { entityId: harvesterId, q: 15, r: 0 }, 0));

    for (let t = 1; t <= 49; t++) {
      const res = host.step(1);
      if (t === 1) expect(res.outcomes[0]?.code).toBeUndefined();
    }

    expect(host.tick).toBe(49);
    expect(cols.state[row]).toBe(ENTITY_STATE.moving);
    expect(cols.x[row]).toBeCloseTo(14.7, 2);
    expect(getHarvesterView(state, harvesterId)).toMatchObject({
      currentJob: 'moving',
      targetQ: 15,
      targetR: 0,
    });

    host.step(1);
    expect(host.tick).toBe(50);
    expect(cols.state[row]).toBe(ENTITY_STATE.idle);
    expect(cols.q[row]).toBe(15);
    expect(cols.r[row]).toBe(0);
    expect(getHarvesterView(state, harvesterId)).toMatchObject({
      q: 15,
      r: 0,
      currentJob: 'idle',
    });

    const idx = hexIndex(state.grid.radius);
    expect(state.grid.layers.explored[idx.indexOf(22, 0)] & 1).toBe(1);
    expect(state.grid.layers.explored[idx.indexOf(23, 0)] & 1).toBe(0);
  });

  it('validates movement destination, colony ownership, and impassable terrain', () => {
    const host = createW02Host();
    const state = host.state;
    const harvesterId = spawnHarvesterUnit(state, { owner: 0, q: 0, r: 0 });
    const idx = hexIndex(state.grid.radius);

    host.submit(mkCmd('moveUnit', { entityId: 9999, q: 2, r: 0 }, 0));
    expect(host.step(1).outcomes[0]?.code).toBe('unknown_entity');

    host.submit(mkCmd('moveUnit', { entityId: harvesterId, q: 2, r: 0 }, 1));
    expect(host.step(1).outcomes[0]?.code).toBe('not_own_colony');

    state.grid.layers.terrain[idx.indexOf(5, 0)] = TERRAIN.deep;
    host.submit(mkCmd('moveUnit', { entityId: harvesterId, q: 5, r: 0 }, 0));
    expect(host.step(1).outcomes[0]?.code).toBe('site_blocked');

    state.grid.layers.prep[idx.indexOf(6, 0)] = PREP.ridge;
    host.submit(mkCmd('moveUnit', { entityId: harvesterId, q: 6, r: 0 }, 0));
    expect(host.step(1).outcomes[0]?.code).toBe('site_blocked');
  });
});

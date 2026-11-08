import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import {
  compileData,
  createPlanet,
  dataRow,
  ENTITY_KIND,
  ENTITY_STATE,
  getWorkerView,
  hexDistance,
  hexIndex,
  listWorkerViews,
  PREP,
  rowOf,
  SimHost,
  spawnWorkerUnit,
  TERRAIN,
  type SimCommand,
} from '../../src';

let seq = 0;
function mkCmd(kind: string, args: unknown, colonyIndex: number | null = 0): SimCommand {
  return { colonyIndex, source: 'player', commandId: `harv_${++seq}`, kind, args };
}

function createW02Host(radius = 28): SimHost {
  const host = new SimHost({ flags: parseWaves('..02') });
  host.load(createPlanet({ type: 'flat', seed: 'worker-test', radius }));
  return host;
}

describe('W02-11: Worker unit stats and data compilation', () => {
  it('compiles Worker T1 stats with 40/15/5/0 cost, 10s build, 0.5 harvestRate', () => {
    const compiled = compileData(parseWaves('..02'));
    const hRow = dataRow(compiled, 'unitsWorkersBasic', 't1');
    expect(hRow.cost).toEqual({
      'metals.t1': 40,
      'minerals.t1': 15,
      'bio.biomass': 5,
      'bio.water': 0,
    });
    expect(hRow.designBuildS).toBe(10);
    expect(hRow.buildS).toBe(50);
    expect(hRow.supply).toBe(1);
    expect(hRow.powerDrainPerS).toBe(2);
    expect(hRow.hp).toBe(160);
    expect(hRow.designSpeedTilesPerS).toBe(1.5);
    expect(hRow.speedTilesPerS).toBeCloseTo(0.3, 5);
    expect(hRow.viewRadius).toBe(7);
    expect(hRow.radius).toBe(0.4);
    expect(hRow.harvestRatePerS).toBe(0.5);
    expect(hRow.maxBuildTier).toBe(1);
  });

  it('spawns a Worker and initializes entity store columns', () => {
    const host = createW02Host();
    const state = host.state;
    const workerId = spawnWorkerUnit(state, { owner: 0, q: 0, r: 0 });
    const row = rowOf(state.entities, workerId);
    expect(row).toBe(0);

    const cols = state.entities.cols;
    expect(cols.kind[row]).toBe(ENTITY_KIND.worker);
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

describe('W02-11: Worker views and inspector fields', () => {
  it('exposes stats in getWorkerView, blobs.units, colony, and host view', () => {
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

    const workerId = spawnWorkerUnit(state, { owner: 0, q: 0, r: 0 });
    expect(getWorkerView(state, workerId)).toMatchObject({
      entityId: workerId,
      kind: ENTITY_KIND.worker,
      unit: 'worker',
      label: 'Worker Drone T1',
      archetype: 'robot.miner',
      owner: 0,
      tier: 1,
      q: 0,
      r: 0,
      hp: 160,
      hpMax: 160,
      supply: 1,
      powerDrainPerS: 2,
      speedTilesPerS: 1.5,
      designSpeedTilesPerS: 1.5,
      viewRadius: 7,
      radius: 0.4,
      harvestRatePerS: 0.5,
      workRate: 1.0,
      maxBuildTier: 1,
      buildS: 50,
      designBuildS: 10,
      currentJob: 'idle',
    });

    const list = listWorkerViews(state, 0);
    expect(list).toHaveLength(1);
    expect(list[0]?.entityId).toBe(workerId);

    const blobUnits = state.blobs.units?.value as Record<number, unknown> | undefined;
    expect(blobUnits?.[workerId]).toBeDefined();

    expect((state.colonies[0]?.workers as unknown[])?.[0]).toMatchObject({ entityId: workerId });
    expect((state.colonies[0]?.units as unknown[])?.[0]).toMatchObject({ entityId: workerId });

    expect(host.view().entities[0]).toMatchObject({
      id: workerId,
      kind: ENTITY_KIND.worker,
      unit: 'worker',
      label: 'Worker Drone T1',
      archetype: 'robot.miner',
      supply: 1,
      powerDrainPerS: 2,
      speedTilesPerS: 1.5,
      viewRadius: 7,
      radius: 0.4,
      harvestRatePerS: 0.5,
      workRate: 1.0,
      maxBuildTier: 1,
    });
  });

  it('returns null or empty array for nonexistent queries', () => {
    const host = createW02Host();
    const state = host.state;
    expect(getWorkerView(state, 123)).toBeNull();
    expect(getWorkerView(state)).toBeNull();
    expect(listWorkerViews(state, 0)).toEqual([]);
  });
});

describe('W02-11: Worker vision and movement', () => {
  it('reveals fog-of-war vision within viewRadius 7 upon spawn', () => {
    const host = createW02Host();
    const state = host.state;
    spawnWorkerUnit(state, { owner: 0, q: 0, r: 0 });

    const idx = hexIndex(state.grid.radius);
    const explored = state.grid.layers.explored as Uint8Array;
    for (let i = 0; i < idx.count; i++) {
      const d = hexDistance(0, 0, idx.q[i], idx.r[i]);
      expect(explored[i] & 1).toBe(d <= 7 ? 1 : 0);
    }
  });

  it('moves Worker at 1.5 t/s (0.3 t/tick) over 15 tiles in 50 ticks (10.0 s)', () => {
    const host = createW02Host();
    const state = host.state;
    const workerId = spawnWorkerUnit(state, { owner: 0, q: 0, r: 0 });
    const row = rowOf(state.entities, workerId);
    const cols = state.entities.cols;

    host.submit(mkCmd('moveUnit', { entityId: workerId, q: 15, r: 0 }, 0));

    for (let t = 1; t <= 49; t++) {
      const res = host.step(1);
      if (t === 1) expect(res.outcomes[0]?.code).toBeUndefined();
    }

    expect(host.tick).toBe(49);
    expect(cols.state[row]).toBe(ENTITY_STATE.moving);
    expect(cols.x[row]).toBeCloseTo(14.7, 2);
    expect(getWorkerView(state, workerId)).toMatchObject({
      currentJob: 'moving',
      targetQ: 15,
      targetR: 0,
    });

    host.step(1);
    expect(host.tick).toBe(50);
    expect(cols.state[row]).toBe(ENTITY_STATE.idle);
    expect(cols.q[row]).toBe(15);
    expect(cols.r[row]).toBe(0);
    expect(getWorkerView(state, workerId)).toMatchObject({
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
    const workerId = spawnWorkerUnit(state, { owner: 0, q: 0, r: 0 });
    const idx = hexIndex(state.grid.radius);

    host.submit(mkCmd('moveUnit', { entityId: 9999, q: 2, r: 0 }, 0));
    expect(host.step(1).outcomes[0]?.code).toBe('unknown_entity');

    host.submit(mkCmd('moveUnit', { entityId: workerId, q: 2, r: 0 }, 1));
    expect(host.step(1).outcomes[0]?.code).toBe('not_own_colony');

    state.grid.layers.terrain[idx.indexOf(5, 0)] = TERRAIN.deep;
    host.submit(mkCmd('moveUnit', { entityId: workerId, q: 5, r: 0 }, 0));
    expect(host.step(1).outcomes[0]?.code).toBe('site_blocked');

    state.grid.layers.prep[idx.indexOf(6, 0)] = PREP.ridge;
    host.submit(mkCmd('moveUnit', { entityId: workerId, q: 6, r: 0 }, 0));
    expect(host.step(1).outcomes[0]?.code).toBe('site_blocked');
  });
});

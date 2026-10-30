import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import {
  compileData,
  createPlanet,
  dataRow,
  ENTITY_KIND,
  ENTITY_STATE,
  getHqView,
  hexDistance,
  hexIndex,
  PREP,
  rowOf,
  SimHost,
  spawnHqUnit,
  TERRAIN,
  type SimCommand,
} from '../../src';

let seq = 0;
function mkCmd(kind: string, args: unknown, colonyIndex: number | null = 0): SimCommand {
  return { colonyIndex, source: 'player', commandId: `hq_${++seq}`, kind, args };
}

function createW01Host(radius = 28): SimHost {
  const host = new SimHost({ flags: parseWaves('..01') });
  host.load(createPlanet({ type: 'flat', seed: 'hq-test', radius }));
  return host;
}

describe('W01-10: HQ T1 unit stats and view fields', () => {
  it('spawns HQ T1 at (0, 0) with §3.2 stats and reveals viewRadius 9 on grid.explored', () => {
    const host = createW01Host();
    const state = host.state;
    const hqId = spawnHqUnit(state, { owner: 0, q: 0, r: 0 });
    const row = rowOf(state.entities, hqId);
    expect(row).toBe(0);

    const cols = state.entities.cols;
    expect(cols.kind[row]).toBe(ENTITY_KIND.hq);
    expect(cols.owner[row]).toBe(0);
    expect(cols.tier[row]).toBe(1);
    expect(cols.q[row]).toBe(0);
    expect(cols.r[row]).toBe(0);
    expect(cols.x[row]).toBe(0);
    expect(cols.y[row]).toBe(0);
    expect(cols.hp[row]).toBe(900);
    expect(cols.hpMax[row]).toBe(900);
    expect(cols.cell[row]).toBe(800);
    expect(cols.cellMax[row]).toBe(800);
    expect(cols.workRate[row]).toBeCloseTo(1.5, 5);
    expect(cols.state[row]).toBe(ENTITY_STATE.idle);

    const compiled = compileData(parseWaves('..01'));
    const hqData = dataRow(compiled, 'hq', 't1');
    expect(hqData.radius).toBe(0.6);
    expect(hqData.viewRadius).toBe(9);
    expect(hqData.supply).toBe(0);
    expect(hqData.gridDrawPerS).toBe(0);
    expect(hqData.designSpeedTilesPerS).toBe(1.6);

    const idx = hexIndex(state.grid.radius);
    const explored = state.grid.layers.explored as Uint8Array;
    for (let i = 0; i < idx.count; i++) {
      const d = hexDistance(0, 0, idx.q[i], idx.r[i]);
      expect(explored[i] & 1).toBe(d <= 9 ? 1 : 0);
    }

    expect(getHqView(state, 0)).toMatchObject({
      entityId: hqId,
      owner: 0,
      tier: 1,
      q: 0,
      r: 0,
      hp: 900,
      hpMax: 900,
      cell: 800,
      cellMax: 800,
      workRate: 1.5,
      viewRadius: 9,
      currentJob: 'idle',
      queueCount: 0,
    });

    expect(host.view().entities[0]).toMatchObject({
      id: hqId,
      kind: ENTITY_KIND.hq,
      owner: 0,
      tier: 1,
      hp: 900,
      hpMax: 900,
      cell: 800,
      cellMax: 800,
      targetQ: 0,
      targetR: 0,
    });
  });
});

describe('W01-10: HQ T1 movement order and validation', () => {
  it('orders the HQ to a tile 16 away -> still moving at tick 49 and arrives at tick 50 (10.0 s)', () => {
    const host = createW01Host();
    const state = host.state;
    const hqId = spawnHqUnit(state, { owner: 0, q: 0, r: 0 });
    const row = rowOf(state.entities, hqId);
    const cols = state.entities.cols;

    host.submit(mkCmd('moveUnit', { entityId: hqId, q: 16, r: 0 }, 0));

    for (let t = 1; t <= 49; t++) {
      const res = host.step(1);
      if (t === 1) expect(res.outcomes[0]?.code).toBeUndefined();
    }

    expect(host.tick).toBe(49);
    expect(cols.state[row]).toBe(ENTITY_STATE.moving);
    expect(cols.x[row]).toBeCloseTo(15.68, 2);
    expect(getHqView(state, 0)).toMatchObject({
      currentJob: 'moving',
      queueCount: 1,
      targetQ: 16,
      targetR: 0,
    });

    host.step(1);
    expect(host.tick).toBe(50);
    expect(cols.state[row]).toBe(ENTITY_STATE.idle);
    expect(cols.q[row]).toBe(16);
    expect(cols.r[row]).toBe(0);
    expect(cols.x[row]).toBe(16);
    expect(cols.y[row]).toBe(0);
    expect(getHqView(state, 0)).toMatchObject({
      q: 16,
      r: 0,
      currentJob: 'idle',
      queueCount: 0,
    });

    const idx = hexIndex(state.grid.radius);
    expect(state.grid.layers.explored[idx.indexOf(25, 0)] & 1).toBe(1);
  });

  it('supports unitId/to payload shape and validates ownership, bounds and passability', () => {
    const host = createW01Host();
    const state = host.state;
    const hqId = spawnHqUnit(state, { owner: 0, q: 0, r: 0 });
    const idx = hexIndex(state.grid.radius);

    host.submit(mkCmd('moveUnit', { entityId: 999, q: 2, r: 0 }, 0));
    expect(host.step(1).outcomes[0]?.code).toBe('unknown_entity');

    host.submit(mkCmd('moveUnit', { entityId: hqId, q: 2, r: 0 }, 1));
    expect(host.step(1).outcomes[0]?.code).toBe('not_own_colony');

    host.submit(mkCmd('moveUnit', { entityId: hqId, q: 99, r: 99 }, 0));
    expect(host.step(1).outcomes[0]?.code).toBe('invalid_args');

    state.grid.layers.terrain[idx.indexOf(3, 0)] = TERRAIN.deep;
    host.submit(mkCmd('moveUnit', { entityId: hqId, q: 3, r: 0 }, 0));
    expect(host.step(1).outcomes[0]?.code).toBe('site_blocked');

    state.grid.layers.prep[idx.indexOf(4, 0)] = PREP.ridge;
    host.submit(mkCmd('moveUnit', { entityId: hqId, q: 4, r: 0 }, 0));
    expect(host.step(1).outcomes[0]?.code).toBe('site_blocked');

    host.submit(mkCmd('moveUnit', { unitId: hqId, to: { q: 8, r: 8 } }, 0));
    for (let i = 0; i < 49; i++) host.step(1);
    const row = rowOf(state.entities, hqId);
    expect(state.entities.cols.state[row]).toBe(ENTITY_STATE.moving);
    host.step(1);
    expect(state.entities.cols.state[row]).toBe(ENTITY_STATE.idle);
    expect(state.entities.cols.q[row]).toBe(8);
    expect(state.entities.cols.r[row]).toBe(8);
  });
});

import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import {
  compileData,
  createPlanet,
  dataRow,
  ENTITY_KIND,
  ENTITY_STATE,
  getHqRechargeRateEPerS,
  getHqView,
  getUnitRecord,
  hexDistance,
  hexIndex,
  insertRow,
  PREP,
  rowOf,
  setHqCellEnergy,
  SimHost,
  spawnHqUnit,
  stepTerraformWorkWithCell,
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

describe('W01-11: HQ power cell recharge and terraform energy draw', () => {
  it('self-recharges at 3 E/s (0.6 E/tick) and clamps at 800 E capacity', () => {
    const host = createW01Host();
    const state = host.state;
    const hqId = spawnHqUnit(state, { owner: 0, q: 0, r: 0 });
    const slot = rowOf(state.entities, hqId);

    setHqCellEnergy(state, slot, 0);
    expect(state.entities.cols.cell[slot]).toBe(0);
    expect(getHqView(state, 0)?.cell).toBe(0);
    expect(getHqRechargeRateEPerS(state, slot)).toBe(3);

    host.step(1);
    expect(state.entities.cols.cell[slot]).toBeCloseTo(0.6, 5);
    expect(getHqView(state, 0)?.cell).toBeCloseTo(0.6, 5);

    host.step(4);
    expect(state.entities.cols.cell[slot]).toBeCloseTo(3.0, 4);

    setHqCellEnergy(state, slot, 799.7);
    host.step(1);
    expect(state.entities.cols.cell[slot]).toBe(800);
    expect(getHqView(state, 0)?.cell).toBe(800);
  });

  it('fast-recharges at 20 E/s (4.0 E/tick) within 6 hexes of an active own Command Hub and drops to 3 E/s beyond 6 hexes', () => {
    const host = createW01Host();
    const state = host.state;
    const hqId = spawnHqUnit(state, { owner: 0, q: 0, r: 0 });
    const slot = rowOf(state.entities, hqId);
    const cols = state.entities.cols;

    const hubRow = insertRow(state.entities, state.meta.nextEntityId++, 0);
    cols.kind[hubRow] = ENTITY_KIND.hub;
    cols.owner[hubRow] = 0;
    cols.q[hubRow] = 6;
    cols.r[hubRow] = 0;
    cols.hp[hubRow] = 1500;
    cols.hpMax[hubRow] = 1500;
    cols.state[hubRow] = ENTITY_STATE.constructing;

    // Constructing Hub does not provide fast recharge
    expect(getHqRechargeRateEPerS(state, slot)).toBe(3);

    // Active Hub within distance 6 -> 20 E/s (4.0 E/tick)
    cols.state[hubRow] = ENTITY_STATE.active;
    expect(getHqRechargeRateEPerS(state, slot)).toBe(20);
    setHqCellEnergy(state, slot, 100);
    host.step(1);
    expect(cols.cell[slot]).toBeCloseTo(104, 5);

    // Move HQ to (-1, 0), hex distance 7 from Hub at (6, 0) -> drops back to 3 E/s (0.6 E/tick)
    cols.q[slot] = -1;
    cols.r[slot] = 0;
    expect(getHqRechargeRateEPerS(state, slot)).toBe(3);
    host.step(1);
    expect(cols.cell[slot]).toBeCloseTo(104.6, 4);
  });

  it('completes Grade (3s base, 20 E) in 10 ticks (2.0s) with full cell and continues at 3 E/s trickle in 34 ticks (6.8s) when drained to 0', () => {
    const host = createW01Host();
    const state = host.state;
    const hqId = spawnHqUnit(state, { owner: 0, q: 0, r: 0 });
    const slot = rowOf(state.entities, hqId);

    // 1. Full cell (800 E): Grade takes 2.0 s (10 ticks) at 1.5x work rate, drawing 20 E total (2.0 E/tick)
    let fullProgress = 0;
    let fullTicks = 0;
    let totalDrawnFull = 0;
    while (fullProgress < 1 - 1e-6 && fullTicks < 100) {
      host.step(1);
      const stepRes = stepTerraformWorkWithCell(state, slot, { baseTimeS: 3, totalEnergyE: 20 });
      fullProgress += stepRes.progressDelta;
      totalDrawnFull += stepRes.energyDrawnE;
      fullTicks++;
    }
    expect(fullTicks).toBe(10);
    expect(fullProgress).toBeCloseTo(1.0, 5);
    expect(totalDrawnFull).toBeCloseTo(20, 4);

    // 2. Acceptance check: Drain cell to 0 -> Grade continues at 3 E/s trickle (0.6 E/tick -> 0.03 progress/tick -> 34 ticks = 6.8s)
    setHqCellEnergy(state, slot, 0);
    expect(state.entities.cols.cell[slot]).toBe(0);

    let trickleProgress = 0;
    let trickleTicks = 0;
    while (trickleProgress < 1 - 1e-6 && trickleTicks < 100) {
      host.step(1);
      const stepRes = stepTerraformWorkWithCell(state, slot, { baseTimeS: 3, totalEnergyE: 20 });
      expect(stepRes.energyDrawnE).toBeCloseTo(0.6, 5);
      expect(stepRes.progressDelta).toBeCloseTo(0.03, 5);
      expect(state.entities.cols.cell[slot]).toBe(0);
      trickleProgress += stepRes.progressDelta;
      trickleTicks++;
    }
    expect(trickleTicks).toBe(34);
    expect(trickleProgress).toBeGreaterThanOrEqual(1.0);
    expect(trickleTicks * 0.2).toBeCloseTo(6.8, 5);
  });
});

describe('HQ movement vs. obstacles (trees / rock)', () => {
  function setup() {
    const host = createW01Host();
    const state = host.state;
    const hqId = spawnHqUnit(state, { owner: 0, q: 0, r: 0 });
    return { host, state, hqId, idx: hexIndex(state.grid.radius), terrain: state.grid.layers.terrain };
  }

  it('rejects a move onto an uncleared forest / rock tile', () => {
    const { host, hqId, idx, terrain } = setup();
    terrain[idx.indexOf(3, 0)] = TERRAIN.forest;
    terrain[idx.indexOf(0, 3)] = TERRAIN.rock;
    host.submit(mkCmd('moveUnit', { entityId: hqId, q: 3, r: 0 }));
    expect(host.step(1).outcomes[0]?.code).toBe('site_blocked');
    host.submit(mkCmd('moveUnit', { entityId: hqId, q: 0, r: 3 }));
    expect(host.step(1).outcomes[0]?.code).toBe('site_blocked');
  });

  it('walks around a forest wall and never enters a blocked tile; passes once cleared', () => {
    const { host, state, hqId, idx, terrain } = setup();
    const cols = state.entities.cols;
    const row = rowOf(state.entities, hqId);
    const wall = [-2, -1, 0, 1, 2].map((r) => idx.indexOf(2, r));
    for (const i of wall) terrain[i] = TERRAIN.forest;
    host.submit(mkCmd('moveUnit', { entityId: hqId, q: 5, r: 0 }));
    for (let t = 0; t < 120 && (t === 0 || cols.state[row] === ENTITY_STATE.moving); t++) {
      host.step(1);
      expect(terrain[idx.indexOf(cols.q[row], cols.r[row])]).not.toBe(TERRAIN.forest);
    }
    expect([cols.q[row], cols.r[row]]).toEqual([5, 0]);
    expect(host.tick).toBeGreaterThan(Math.ceil(5 / 0.32)); // detour is longer than the straight line

    for (const i of wall) terrain[i] = TERRAIN.flat; // "Clear" turns forest into flat
    host.submit(mkCmd('moveUnit', { entityId: hqId, q: 0, r: 0 }));
    expect(host.step(1).outcomes[0]?.code).toBeUndefined();
  });

  it('a target sealed off by obstacles fails in the movement orchestrator: the HQ never moves (no straight-line walk)', () => {
    const { host, state, hqId, idx, terrain } = setup();
    const row = rowOf(state.entities, hqId);
    for (const [q, r] of [[6, 0], [4, 0], [5, 1], [5, -1], [4, 1], [6, -1]]) {
      terrain[idx.indexOf(q, r)] = TERRAIN.rock;
    }
    host.submit(mkCmd('moveUnit', { entityId: hqId, q: 5, r: 0 }));
    expect(host.step(1).outcomes[0]?.code).toBeUndefined(); // reachability is the pathfinder's call, not the handler's
    host.step(10);
    const cols = state.entities.cols;
    expect([cols.x[row], cols.y[row], cols.state[row]]).toEqual([0, 0, ENTITY_STATE.idle]);
    expect(getUnitRecord(state, hqId)).toMatchObject({ current: null, lastFailure: { code: 'no_path', kind: 'move', source: 'player' } });
  });
});

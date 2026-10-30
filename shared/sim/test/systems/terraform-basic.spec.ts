import { describe, expect, it } from 'vitest';
import { eventDef, parseWaves } from '@terra/contracts';
import {
  canRunTerraformOpOnTile,
  createPlanet,
  DEPOSIT,
  enqueueTerraformOrder,
  ENTITY_KIND,
  ENTITY_STATE,
  getColonyStock,
  getColonyTerraformOrders,
  getHqView,
  hasColonyClaimedTerritory,
  hexIndex,
  insertRow,
  PREP,
  rowOf,
  setTileDeposit,
  setTileOwner,
  setTileTerrain,
  SimHost,
  spawnHqUnit,
  TERRAIN,
  type SimCommand,
} from '../../src';

let cmdSeq = 0;
function mkCmd(kind: string, args: unknown, colonyIndex: number | null = 0): SimCommand {
  return { colonyIndex, source: 'player', commandId: `tf_${++cmdSeq}`, kind, args };
}

function createW01Host(radius = 12): SimHost {
  const host = new SimHost({ flags: parseWaves('..01') });
  host.load(createPlanet({ type: 'flat', seed: 'terraform-basic-test', radius }));
  return host;
}

describe('W01-13: Grade, Clear, and Break operations', () => {
  it('acceptance: Grade 1 Flat tile with the HQ (1.5x) -> 2.0 s (10 ticks) of work, 20 E drawn from the cell, tile becomes prepared, tilePrepared emitted', () => {
    const host = createW01Host();
    const state = host.state;
    const hqId = spawnHqUnit(state, { owner: 0, q: 0, r: 0 });
    const hqSlot = rowOf(state.entities, hqId);
    const tileIdx = hexIndex(state.grid.radius).indexOf(1, 0);

    expect(state.grid.layers.terrain[tileIdx]).toBe(TERRAIN.flat);
    expect(state.grid.layers.prep[tileIdx]).toBe(PREP.wild);
    expect(state.entities.cols.cell[hqSlot]).toBe(800);

    host.submit(mkCmd('enqueueTask', { terraform: { op: 'grade', tiles: [{ q: 1, r: 0 }] } }, 0));

    const seenEvents = [];
    for (let t = 1; t <= 9; t++) {
      const res = host.step(1);
      if (t === 1) expect(res.outcomes[0]?.code).toBeUndefined();
      seenEvents.push(...res.events);
      expect(state.entities.cols.state[hqSlot]).toBe(ENTITY_STATE.working);
      expect(state.grid.layers.prep[tileIdx]).toBe(PREP.wild);
    }

    expect(host.tick).toBe(9);
    expect(state.entities.cols.cell[hqSlot]).toBeCloseTo(782, 4);

    const finalRes = host.step(1);
    seenEvents.push(...finalRes.events);

    expect(host.tick).toBe(10);
    expect(host.tick * 0.2).toBeCloseTo(2.0, 5);
    expect(state.entities.cols.cell[hqSlot]).toBeCloseTo(780, 4);
    expect(state.grid.layers.prep[tileIdx]).toBe(PREP.prepared);
    expect(state.entities.cols.state[hqSlot]).toBe(ENTITY_STATE.idle);
    expect(getHqView(state, 0)?.queueCount).toBe(0);

    const preparedEvents = seenEvents.filter((e) => e.kind === 'tilePrepared');
    expect(preparedEvents).toHaveLength(1);
    expect(preparedEvents[0].data).toMatchObject({ colonyId: 'col_0', count: 1, q: 1, r: 0 });
    expect(eventDef('tilePrepared').data.safeParse(preparedEvents[0].data).success).toBe(true);
  });

  it('Clear on a Forest tile takes 3.33 s (17 ticks) at 1.5x, draws 30 E, turns tile into Flat + PREP.flat, credits +5 bio.biomass, and emits obstacleRemoved', () => {
    const host = createW01Host();
    const state = host.state;
    const hqId = spawnHqUnit(state, { owner: 0, q: 0, r: 0 });
    const hqSlot = rowOf(state.entities, hqId);
    const tileIdx = hexIndex(state.grid.radius).indexOf(2, -1);

    setTileTerrain(state.grid, tileIdx, TERRAIN.forest);
    host.submit(mkCmd('enqueueTask', { op: 'clear', q: 2, r: -1 }, 0));

    const events = [];
    for (let t = 1; t <= 16; t++) {
      const res = host.step(1);
      if (t === 1) expect(res.outcomes[0]?.code).toBeUndefined();
      events.push(...res.events);
      expect(state.grid.layers.terrain[tileIdx]).toBe(TERRAIN.forest);
    }

    const res17 = host.step(1);
    events.push(...res17.events);

    expect(host.tick).toBe(17);
    expect(state.entities.cols.cell[hqSlot]).toBeCloseTo(770, 4);
    expect(state.grid.layers.terrain[tileIdx]).toBe(TERRAIN.flat);
    expect(state.grid.layers.prep[tileIdx]).toBe(PREP.flat);
    expect(getColonyStock(state, 0)['bio.biomass']).toBe(5);
    expect((host.view().colonies[0]?.stock as Record<string, number>)?.['bio.biomass']).toBe(5);

    const removedEvents = events.filter((e) => e.kind === 'obstacleRemoved');
    expect(removedEvents).toHaveLength(1);
    expect(removedEvents[0].data).toMatchObject({ colonyId: 'col_0', op: 'clear', count: 1, q: 2, r: -1 });
    expect(eventDef('obstacleRemoved').data.safeParse(removedEvents[0].data).success).toBe(true);
  });
});

describe('W01-13: Break, deposit preservation, territory rules, and queue management', () => {
  it('Break on a Rock tile takes 4.0 s (20 ticks) at 1.5x, draws 60 E, turns tile into Flat + PREP.flat, credits +10 metals.t1, and emits obstacleRemoved', () => {
    const host = createW01Host();
    const state = host.state;
    const hqId = spawnHqUnit(state, { owner: 0, q: 0, r: 0 });
    const hqSlot = rowOf(state.entities, hqId);
    const tileIdx = hexIndex(state.grid.radius).indexOf(-1, 2);

    setTileTerrain(state.grid, tileIdx, TERRAIN.rock);
    host.submit(mkCmd('enqueueTask', { terraform: { op: 'break', tiles: [{ q: -1, r: 2 }] } }, 0));

    const events = [];
    for (let t = 1; t <= 19; t++) {
      const res = host.step(1);
      if (t === 1) expect(res.outcomes[0]?.code).toBeUndefined();
      events.push(...res.events);
      expect(state.grid.layers.terrain[tileIdx]).toBe(TERRAIN.rock);
    }

    const res20 = host.step(1);
    events.push(...res20.events);

    expect(host.tick).toBe(20);
    expect(host.tick * 0.2).toBeCloseTo(4.0, 5);
    expect(state.entities.cols.cell[hqSlot]).toBeCloseTo(740, 4);
    expect(state.grid.layers.terrain[tileIdx]).toBe(TERRAIN.flat);
    expect(state.grid.layers.prep[tileIdx]).toBe(PREP.flat);
    expect(getColonyStock(state, 0)['metals.t1']).toBe(10);
    expect((host.view().colonies[0]?.stock as Record<string, number>)?.['metals.t1']).toBe(10);

    const removedEvents = events.filter((e) => e.kind === 'obstacleRemoved');
    expect(removedEvents).toHaveLength(1);
    expect(removedEvents[0].data).toMatchObject({ colonyId: 'col_0', op: 'break', count: 1, q: -1, r: 2 });
    expect(eventDef('obstacleRemoved').data.safeParse(removedEvents[0].data).success).toBe(true);
  });

  it('preserves surface deposit kind and richness when grading a deposit tile (UO-TF-04)', () => {
    const host = createW01Host();
    const state = host.state;
    spawnHqUnit(state, { owner: 0, q: 0, r: 0 });
    const tileIdx = hexIndex(state.grid.radius).indexOf(3, -1);

    setTileTerrain(state.grid, tileIdx, TERRAIN.flat);
    setTileDeposit(state.grid, tileIdx, DEPOSIT.metals, 1.15);

    host.submit(mkCmd('enqueueTask', { terraform: { op: 'grade', tiles: [{ q: 3, r: -1 }] } }, 0));
    host.step(10);

    expect(state.grid.layers.prep[tileIdx]).toBe(PREP.prepared);
    expect(state.grid.layers.deposit[tileIdx]).toBe(DEPOSIT.metals);
    expect(state.grid.layers.richness[tileIdx]).toBeCloseTo(1.15, 5);
  });
});

describe('W01-13: Territory rules and queue management', () => {
  it('enforces own-territory rule with before-Hub and allowUnclaimed exceptions (UO-TF-05)', () => {
    const host = createW01Host();
    const state = host.state;
    spawnHqUnit(state, { owner: 0, q: 0, r: 0 });
    const idx = hexIndex(state.grid.radius);
    const foreignIdx = idx.indexOf(2, 0);
    const ownIdx = idx.indexOf(4, 0);
    setTileOwner(state.grid, foreignIdx, 1);

    expect(canRunTerraformOpOnTile(state, 0, 'grade', 2, 0)).toEqual({ ok: false, reason: 'not_own_territory' });
    expect(canRunTerraformOpOnTile(state, 0, 'grade', 2, 0, { allowUnclaimed: true })).toEqual({
      ok: false,
      reason: 'not_own_territory',
    });
    host.submit(mkCmd('enqueueTask', { terraform: { op: 'grade', tiles: [{ q: 2, r: 0 }] } }, 0));
    expect(host.step(1).outcomes[0]?.code).toBe('not_own_territory');

    expect(hasColonyClaimedTerritory(state, 0)).toBe(false);
    expect(canRunTerraformOpOnTile(state, 0, 'grade', 3, 0)).toEqual({ ok: true });

    setTileOwner(state.grid, ownIdx, 0);
    expect(hasColonyClaimedTerritory(state, 0)).toBe(true);
    expect(canRunTerraformOpOnTile(state, 0, 'grade', 4, 0)).toEqual({ ok: true });
    expect(canRunTerraformOpOnTile(state, 0, 'grade', 3, 0)).toEqual({ ok: false, reason: 'not_own_territory' });
    expect(canRunTerraformOpOnTile(state, 0, 'grade', 3, 0, { allowUnclaimed: true })).toEqual({ ok: true });

    host.submit(mkCmd('enqueueTask', { terraform: { op: 'grade', tiles: [{ q: 3, r: 0 }] } }, 0));
    expect(host.step(1).outcomes[0]?.code).toBe('not_own_territory');

    setTileOwner(state.grid, ownIdx, -1);
    const hubRow = insertRow(state.entities, state.meta.nextEntityId++, state.meta.tick);
    state.entities.cols.kind[hubRow] = ENTITY_KIND.hub;
    state.entities.cols.owner[hubRow] = 0;
    state.entities.cols.hp[hubRow] = 1500;
    state.entities.cols.hpMax[hubRow] = 1500;
    state.entities.cols.state[hubRow] = ENTITY_STATE.active;
    expect(hasColonyClaimedTerritory(state, 0)).toBe(true);
    expect(canRunTerraformOpOnTile(state, 0, 'grade', 3, 0)).toEqual({ ok: false, reason: 'not_own_territory' });
  });

  it('filters mixed brush strokes with skippedCount and supports cancelTask', () => {
    const host = createW01Host();
    const state = host.state;
    const hqId = spawnHqUnit(state, { owner: 0, q: 0, r: 0 });
    const hqSlot = rowOf(state.entities, hqId);
    setTileTerrain(state.grid, hexIndex(state.grid.radius).indexOf(2, 0), TERRAIN.rock);

    const res = enqueueTerraformOrder(state, {
      colonyId: 0,
      op: 'grade',
      tiles: [{ q: 1, r: 0 }, { q: 2, r: 0 }, { q: 3, r: 0 }],
      orderId: 'brush_1',
    });
    expect(res.ok).toBe(true);
    expect(res.skippedCount).toBe(1);
    expect(res.order?.jobs).toHaveLength(2);
    expect(getHqView(state, 0)?.queueCount).toBe(1);

    host.step(5);
    expect(state.entities.cols.state[hqSlot]).toBe(ENTITY_STATE.working);

    host.submit(mkCmd('cancelTask', { taskId: 'brush_1' }, 0));
    expect(host.step(1).outcomes[0]?.code).toBeUndefined();
    expect(getColonyTerraformOrders(state, 0)).toHaveLength(0);
    expect(state.entities.cols.state[hqSlot]).toBe(ENTITY_STATE.idle);
    expect(getHqView(state, 0)?.queueCount).toBe(0);
  });
});

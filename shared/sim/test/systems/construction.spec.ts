import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import {
  createRegistryPipeline,
  createState,
  creditResource,
  ensureColonyLedger,
  ENTITY_KIND,
  ENTITY_STATE,
  enqueueQueueTask,
  getColonyCaps,
  getColonyStock,
  getFootprintTileIndices,
  executeDismantleAtTile,
  hexIndex,
  insertRow,
  placeBuildingOrder,
  PREP,
  setColonyStock,
  setTilePrep,
  spawnHqUnit,
  startBuildingConstruction,
  step,
  TERRAIN,
} from '../../src';

describe('W02-09 Generic T1 construction & demolish refund', () => {
  it('build a Solar (18 s -> 12 s at HQ 1.5x), then demolish -> 50% cost refunded and footprint stays prepared', () => {
    const state = createState({ planetId: 'p1', planetType: 'temperate', seed: 'w02', radius: 8 });
    const colony = ensureColonyLedger({
      index: 0,
      id: 'col-0',
      name: 'Alpha',
      color: 0xff6b00,
      status: 'active',
      changedAt: 0,
    });
    state.colonies.push(colony);

    // Seed colony with exact Solar T1 cost (60 metals.t1, 75 minerals.t1, 10 bio.biomass, 5 bio.water)
    creditResource(colony, 'metals.t1', 60, 0);
    creditResource(colony, 'minerals.t1', 75, 0);
    creditResource(colony, 'bio.biomass', 10, 0);
    creditResource(colony, 'bio.water', 5, 0);

    // Spawn HQ T1 (workRate 1.5x, maxBuildTier 1)
    const hqId = spawnHqUnit(state, { owner: 0, q: 0, r: 0 });
    const pipeline = createRegistryPipeline({ flags: parseWaves('..02') });

    // A prepared site (no linked prep) with the HQ already in build reach [2, 3]: it builds from the first step (W02-16)
    for (const i of getFootprintTileIndices(state, 2, 1, 2, 2).indices) setTilePrep(state.grid, i, PREP.prepared);

    // Start building Solar T1 (2x2) at (2, 1): designBuildS = 18s (90 ticks) -> 12s (60 ticks) at HQ 1.5x
    const started = startBuildingConstruction(state, {
      owner: 0,
      building: 'solar',
      q: 2,
      r: 1,
      workerEntityId: hqId,
    });
    expect(started).toEqual({
      ok: true,
      entityId: expect.any(Number),
      buildTicks: 90,
      effectiveTicks: 60,
    });
    if (!started.ok) throw new Error('expected ok');

    // Cost is deducted progressively across construction ticks (not 100% upfront at tick 0)
    expect(colony.stock['metals.t1']).toBe(60);
    expect(colony.stock['minerals.t1']).toBe(75);
    expect(colony.stock['bio.biomass']).toBe(10);
    expect(colony.stock['bio.water']).toBe(5);

    // Step 59 ticks (11.8s) -> still constructing, ~59/60 of cost paid progressively
    step(state, [], 59, pipeline);
    expect(state.entities.cols.state[1]).toBe(ENTITY_STATE.constructing);
    expect(colony.stock['metals.t1']).toBeCloseTo(1, 4);

    // Step 1 more tick (total 60 ticks = 12.0s) -> completed and 100% of cost deducted!
    const doneStep = step(state, [], 1, pipeline);
    expect(state.entities.cols.state[1]).toBe(ENTITY_STATE.active);
    expect(doneStep.events.some((e) => e.kind === 'buildingCompleted')).toBe(true);
    expect(colony.stock['metals.t1']).toBe(0);
    expect(colony.stock['minerals.t1']).toBe(0);
    expect(colony.stock['bio.biomass']).toBe(0);
    expect(colony.stock['bio.water']).toBe(0);

    // Demolish via command -> 50% cost refunded (30 / 37.5 / 5 / 2.5) and footprint stays prepared
    const demStep = step(
      state,
      [{ commandId: 'c-dem', colonyIndex: 0, source: 'player' as const, kind: 'demolish', args: { entityId: started.entityId } }],
      1,
      pipeline,
    );
    expect(demStep.outcomes[0].code).toBeUndefined();
    expect(colony.stock['metals.t1']).toBe(30);
    expect(colony.stock['minerals.t1']).toBe(37.5);
    expect(colony.stock['bio.biomass']).toBe(5);
    expect(colony.stock['bio.water']).toBe(2.5);

    const fp = getFootprintTileIndices(state, 2, 1, 2, 2);
    for (const tileIdx of fp.indices) {
      expect(state.grid.layers.prep[tileIdx]).toBe(PREP.prepared);
      expect(state.grid.layers.anchors[tileIdx]).toBe(0);
    }
  });
});

describe('W01/W02 construction coexistence & GP-11 cap preservation', () => {
  it('does not hijack W01 placeBuilding Command Hub orders or lower initial 600 metals landing cap under ..02 pipeline (GP-11)', () => {
    const state = createState({ planetId: 'p-w01-w02', planetType: 'temperate', seed: 'w02-coexist', radius: 12 });
    state.colonies[0] = {
      index: 0,
      id: 'col_0',
      name: 'Alpha',
      color: 0xff6b00,
      status: 'founding',
      caps: { metals: 600, minerals: 350, energy: 0, bio: 400, item: 0 },
      changedAt: 0,
    };
    setColonyStock(state, 0, {
      'metals.t1': 600,
      'minerals.t1': 350,
      'bio.biomass': 200,
      'bio.water': 200,
    });
    spawnHqUnit(state, { owner: 0, q: 0, r: 0 });
    const pipeline = createRegistryPipeline({ flags: parseWaves('..02') });

    const hex = hexIndex(state.grid.radius);
    for (let dr = -1; dr <= 1; dr++) {
      for (let dq = -1; dq <= 1; dq++) {
        setTilePrep(state.grid, hex.indexOf(3 + dq, dr), PREP.prepared);
      }
    }

    const placed = placeBuildingOrder(state, { colonyId: 0, q: 3, r: 0, buildingKind: 'commandHub' });
    expect(placed.ok).toBe(true);

    for (let t = 0; t < 120; t++) {
      step(state, [], 1, pipeline);
    }

    let hubRow = -1;
    for (let r = 0; r < state.entities.count; r++) {
      if (state.entities.cols.kind[r] === ENTITY_KIND.commandHub) hubRow = r;
    }
    expect(hubRow).toBeGreaterThanOrEqual(0);
    expect(state.entities.cols.state[hubRow]).toBe(ENTITY_STATE.active);
    const caps = getColonyCaps(state, 0);
    const stock = getColonyStock(state, 0);
    expect(caps.metals).toBe(600);
    expect(caps.minerals).toBe(500);
    expect(caps.bio).toBe(500);
    expect(stock['metals.t1']).toBe(400);
    expect(stock['minerals.t1']).toBe(250);
  });
});

describe('W02 building footprints, unit collision & perimeter spawn', () => {
  it('centers 3x3 Command Hub footprints on (q, r), blocks HQ and Worker movement onto buildings, and evacuates units under new footprints', () => {
    const state = createState({ planetId: 'p-fp', planetType: 'temperate', seed: 'w02-fp', radius: 12 });
    const colony = ensureColonyLedger({
      index: 0,
      id: 'col-0',
      name: 'Alpha',
      color: 0xff6b00,
      status: 'active',
      changedAt: 0,
    });
    state.colonies[0] = colony;
    creditResource(colony, 'metals.t1', 500, 0);
    creditResource(colony, 'minerals.t1', 500, 0);
    creditResource(colony, 'bio.biomass', 500, 0);
    creditResource(colony, 'bio.water', 500, 0);

    // 3x3 Hub at (0, 0) covers (-1..1, -1..1)
    const hubFp = getFootprintTileIndices(state, 0, 0, 3, 3);
    expect(hubFp.coords).toEqual([
      { q: -1, r: -1 }, { q: 0, r: -1 }, { q: 1, r: -1 },
      { q: -1, r: 0 }, { q: 0, r: 0 }, { q: 1, r: 0 },
      { q: -1, r: 1 }, { q: 0, r: 1 }, { q: 1, r: 1 },
    ]);

    const hqId = spawnHqUnit(state, { owner: 0, q: 0, r: 0 });
    startBuildingConstruction(state, {
      owner: 0,
      building: 'commandHub',
      q: 0,
      r: 0,
      instant: true,
      costOverride: {},
      tick: 0,
    });
    // HQ standing on (0, 0) was evacuated to a target outside the 3x3 Hub footprint
    expect(state.entities.cols.state[0]).toBe(ENTITY_STATE.moving);
    expect(Math.max(Math.abs(state.entities.cols.targetQ[0]), Math.abs(state.entities.cols.targetR[0]))).toBeGreaterThanOrEqual(2);

    // Build a Solar (2x2) at (3, 0) covering (3,0), (4,0), (3,1), (4,1)
    startBuildingConstruction(state, {
      owner: 0,
      building: 'solar',
      q: 3,
      r: 0,
      instant: true,
      costOverride: {},
      tick: 0,
    });

    const pipeline = createRegistryPipeline({ flags: parseWaves('..02') });
    // Queue and produce a Worker via enqueueTask -> spawns at Hub perimeter (not (0, 0))
    step(
      state,
      [{ commandId: 'q-hrv', colonyIndex: 0, source: 'player' as const, kind: 'enqueueTask', args: { task: { kind: 'buildUnit', unit: 'worker' } } }],
      55,
      pipeline,
    );
    let hrvId = -1;
    let hrvQ = 0;
    let hrvR = 0;
    for (let r = 0; r < state.entities.count; r++) {
      if (state.entities.cols.kind[r] === ENTITY_KIND.worker) {
        hrvId = state.entities.cols.id[r];
        hrvQ = state.entities.cols.q[r];
        hrvR = state.entities.cols.r[r];
      }
    }
    expect(hrvId).toBeGreaterThan(0);
    expect(Math.max(Math.abs(hrvQ), Math.abs(hrvR))).toBeGreaterThanOrEqual(2);

    // Both HQ and Worker reject moveUnit into Command Hub (0, 0) or Solar (3, 0) with site_blocked
    const moveRes = step(
      state,
      [
        { commandId: 'm-hq-hub', colonyIndex: 0, source: 'player' as const, kind: 'moveUnit', args: { entityId: hqId, q: 0, r: 0 } },
        { commandId: 'm-hrv-hub', colonyIndex: 0, source: 'player' as const, kind: 'moveUnit', args: { entityId: hrvId, q: 0, r: 0 } },
        { commandId: 'm-hrv-sol', colonyIndex: 0, source: 'player' as const, kind: 'moveUnit', args: { entityId: hrvId, q: 3, r: 0 } },
      ],
      1,
      pipeline,
    );
    expect(moveRes.outcomes.map((o) => o.code)).toEqual(['site_blocked', 'site_blocked', 'site_blocked']);
  });
});

describe('D-37 no building on un-terraformed ground (server)', () => {
  const setup = () => {
    const state = createState({ planetId: 'p1', planetType: 'temperate', seed: 'w02', radius: 8 });
    const colony = ensureColonyLedger({ index: 0, id: 'col-0', name: 'c', color: 0xff6b00, status: 'active', changedAt: 0 });
    state.colonies.push(colony);
    for (const k of ['metals.t1', 'minerals.t1', 'bio.biomass', 'bio.water'] as const) creditResource(colony, k, 500, 0);
    const hqId = spawnHqUnit(state, { owner: 0, q: 0, r: 0 });
    return { state, hqId };
  };
  const blockers = [TERRAIN.forest, TERRAIN.rock, TERRAIN.slope, TERRAIN.hole, TERRAIN.shallow];

  it.each(blockers)('startBuildingConstruction refuses terrain %i and leaves the tile untouched', (terrain) => {
    const { state, hqId } = setup();
    const fp = getFootprintTileIndices(state, 2, 1, 2, 2, 0);
    state.grid.layers.terrain[fp.indices[1]] = terrain;
    const res = startBuildingConstruction(state, { owner: 0, building: 'solar', q: 2, r: 1, workerEntityId: hqId });
    expect(res).toMatchObject({ ok: false, code: 'terrain_unbuildable' });
    expect(state.grid.layers.terrain[fp.indices[1]]).toBe(terrain);
  });

  it.each(blockers)('enqueueTask build is rejected up front on terrain %i', (terrain) => {
    const { state } = setup();
    const fp = getFootprintTileIndices(state, 2, 1, 2, 2, 0);
    state.grid.layers.terrain[fp.indices[0]] = terrain;
    const res = enqueueQueueTask(state, { colonyIndex: 0, task: { kind: 'build', building: 'solar', q: 2, r: 1 } });
    expect(res).toMatchObject({ ok: false, code: 'terrain_unbuildable' });
  });
});

describe('pod wreck dismantle', () => {
  const setup = () => {
    const state = createState({ planetId: 'p1', planetType: 'temperate', seed: 'w02', radius: 8 });
    state.colonies.push(ensureColonyLedger({ index: 0, id: 'col-0', name: 'c', color: 0xff6b00, status: 'active', changedAt: 0 }));
    const row = insertRow(state.entities, 900, 0);
    const c = state.entities.cols;
    c.kind[row] = ENTITY_KIND.pod; c.owner[row] = 0; c.q[row] = 0; c.r[row] = 0; c.hp[row] = 600; c.hpMax[row] = 600; c.state[row] = ENTITY_STATE.idle;
    const hqId = spawnHqUnit(state, { owner: 0, q: 0, r: 0 });
    return { state, hqId };
  };
  const hasKind = (state: ReturnType<typeof setup>['state'], kind: number) => Array.from({ length: state.entities.count }, (_, i) => state.entities.cols.kind[i]).includes(kind);

  it('is kept until the colony has an active Hub (it anchors the pre-Hub radius and the Hub distance)', () => {
    const { state } = setup();
    expect(executeDismantleAtTile(state, 0, 0, 0)).toEqual({ ok: false, reason: 'site_blocked' });
    expect(hasKind(state, ENTITY_KIND.pod)).toBe(true);
  });

  it('is scrapped once a Hub stands: the pod goes, the HQ Drone on the same hex stays, nothing is refunded', () => {
    const { state } = setup();
    const row = insertRow(state.entities, 901, 0);
    const c = state.entities.cols;
    c.kind[row] = ENTITY_KIND.commandHub; c.owner[row] = 0; c.q[row] = 3; c.r[row] = 0; c.hp[row] = 100; c.hpMax[row] = 100; c.state[row] = ENTITY_STATE.active;
    expect(executeDismantleAtTile(state, 0, 0, 0)).toMatchObject({ ok: true, entityId: 900, refunded: {} });
    expect(hasKind(state, ENTITY_KIND.pod)).toBe(false);
    expect(hasKind(state, ENTITY_KIND.hq)).toBe(true);
    expect(executeDismantleAtTile(state, 0, 0, 0)).toEqual({ ok: false, reason: 'cannot_dismantle_hq' });
  });

  it('a descending pod cannot be dismantled', () => {
    const { state } = setup();
    state.entities.cols.state[0] = ENTITY_STATE.descending;
    expect(executeDismantleAtTile(state, 0, 0, 0).ok).toBe(false);
  });
});

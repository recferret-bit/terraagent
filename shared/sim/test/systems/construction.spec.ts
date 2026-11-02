import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import {
  createRegistryPipeline,
  createState,
  creditResource,
  ensureColonyLedger,
  ENTITY_KIND,
  ENTITY_STATE,
  getColonyCaps,
  getColonyStock,
  getFootprintTileIndices,
  hexIndex,
  placeBuildingOrder,
  PREP,
  setColonyStock,
  setTilePrep,
  spawnHqUnit,
  startBuildingConstruction,
  step,
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

    // Cost was paid on start -> stock is now 0
    expect(colony.stock['metals.t1']).toBe(0);
    expect(colony.stock['minerals.t1']).toBe(0);
    expect(colony.stock['bio.biomass']).toBe(0);
    expect(colony.stock['bio.water']).toBe(0);

    // Step 59 ticks (11.8s) -> still constructing
    step(state, [], 59, pipeline);
    expect(state.entities.cols.state[1]).toBe(ENTITY_STATE.constructing);

    // Step 1 more tick (total 60 ticks = 12.0s) -> completed!
    const doneStep = step(state, [], 1, pipeline);
    expect(state.entities.cols.state[1]).toBe(ENTITY_STATE.active);
    expect(doneStep.events.some((e) => e.kind === 'buildingCompleted')).toBe(true);

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

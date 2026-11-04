import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import {
  colonyTerraformOrders,
  createRegistryPipeline,
  createState,
  creditResource,
  ensureColonyLedger,
  getColonyPower,
  getUnitCommand,
  hexIndex,
  PREP,
  setPlanetTime,
  setTileHeight,
  setTileOwner,
  setTilePrep,
  setTileTerrain,
  spawnTerraformerUnit,
  startBuildingConstruction,
  step,
  TERRAIN,
} from '../../src';

function createW05PowerColony(seed = 'w05-08') {
  const state = createState({ planetId: `p-${seed}`, planetType: 'temperate', seed, radius: 12 });
  const colony = ensureColonyLedger({
    index: 0,
    id: 'col-0',
    name: 'Alpha',
    color: 0xff6b00,
    status: 'active',
    changedAt: 0,
  });
  state.colonies.push(colony);
  creditResource(colony, 'metals.t1', 500, 0);
  creditResource(colony, 'minerals.t1', 500, 0);
  creditResource(colony, 'bio.biomass', 500, 0);
  creditResource(colony, 'bio.water', 500, 0);
  const hx = hexIndex(state.grid.radius);
  for (let i = 0; i < state.grid.count; i++) {
    setTileOwner(state.grid, i, 0, 0);
    setTileTerrain(state.grid, i, TERRAIN.flat, 0);
    setTilePrep(state.grid, i, PREP.prepared, 0);
    setTileHeight(state.grid, i, 0, 0);
  }
  const hubRes = startBuildingConstruction(state, {
    owner: 0,
    building: 'commandHub',
    q: 0,
    r: 0,
    instant: true,
    costOverride: {},
  });
  expect(hubRes.ok).toBe(true);
  // Add a Solar Collector near the Hub (+20 E/s net by day, 0 at night; Hub alone has +16 - 7 = +9 E/s net)
  const solarRes = startBuildingConstruction(state, {
    owner: 0,
    building: 'solar',
    q: 3,
    r: -3,
    instant: true,
    costOverride: {},
  });
  expect(solarRes.ok).toBe(true);
  const pipeline = createRegistryPipeline({ flags: parseWaves('..05') });
  return { state, colony, hx, pipeline };
}

describe('W05-08 · Op energy and group-1 brownout shedding', () => {
  it('Acceptance: Run Reclaim at night with a deficit -> the op pauses at 43 % and resumes at dawn from 43 %', () => {
    const { state, hx, pipeline } = createW05PowerColony('w05-08-night');
    const target = { q: 3, r: 0 };
    const tIdx = hx.indexOf(target.q, target.r);
    setTileTerrain(state.grid, tIdx, TERRAIN.shallow, 0);
    setTileHeight(state.grid, tIdx, -0.35, 0);

    // Start at noon (hour 12:00, full daylight): Hub (16) + Solar (20) = 36 E/s supply > Hub (7) + Drone (2.5) + Reclaim (14.29) = 23.79 E/s
    setPlanetTime(state, { timeOfDay: 12, timeScale: 0 }, 0);
    spawnTerraformerUnit(state, { owner: 0, q: 2, r: 0 });

    // Enqueue Reclaim (14 s = 70 ticks at 1.0x, 200 E = 14.2857 E/s) and run 28 more ticks -> 29 ticks so far
    const enqRes = step(
      state,
      [
        {
          commandId: 'cmd-reclaim-night',
          colonyIndex: 0,
          source: 'player',
          kind: 'enqueueTask',
          args: { terraform: { op: 'reclaim', tiles: [target] } },
        },
      ],
      1,
      pipeline,
    );
    expect(enqRes.outcomes[0]?.code).toBeUndefined();
    for (let t = 0; t < 28; t++) {
      step(state, [], 1, pipeline);
    }

    // Night falls (hour 22:00): Solar drops to 0, Hub supply 16 E/s < 7 (Hub) + 2.5 (Drone) + 14.29 (Reclaim) = 23.79 E/s
    setPlanetTime(state, { timeOfDay: 22, timeScale: 0 }, state.meta.tick);
    // One step for power.core (slot 7) to evaluate the night deficit and shed the group-1 terraform op at 30/70 = 43%
    step(state, [], 1, pipeline);

    const jobAtNightfall = colonyTerraformOrders(state, 0)[0]!.jobs[0]!;
    expect(Math.round(jobAtNightfall.progress * 100)).toBe(43);

    // Step 20 ticks through the night: the op stays paused at 43% with waitReason === 'power'
    for (let t = 0; t < 20; t++) {
      step(state, [], 1, pipeline);
    }
    const powerAtNight = getColonyPower(state, 0);
    expect(powerAtNight.brownout).toBe(true);
    expect(powerAtNight.shedGroupsActive).toContain(1);
    const pausedOrder = colonyTerraformOrders(state, 0)[0]!;
    const pausedJob = pausedOrder.jobs[0]!;
    expect(pausedJob.waitReason).toBe('power');
    expect(pausedOrder.status).toBe('waiting');
    expect(pausedOrder.waitReason).toBe('power');
    expect(Math.round(pausedJob.progress * 100)).toBe(43);
    expect(pausedJob.progress).toBeCloseTo(30 / 70, 5);
    expect(state.grid.layers.terrain[tIdx]).toBe(TERRAIN.shallow);

    // Dawn arrives (hour 08:00): Solar comes back online, clearing the deficit
    setPlanetTime(state, { timeOfDay: 8, timeScale: 0 }, state.meta.tick);
    step(state, [], 1, pipeline); // power.core clears shedWorkJobIds at end of tick
    expect(getColonyPower(state, 0).shedWorkJobIds).toEqual([]);
    expect(Math.round(colonyTerraformOrders(state, 0)[0]!.jobs[0]!.progress * 100)).toBe(43);

    // Next tick: resumes from 43% (30/70 -> 31/70)
    step(state, [], 1, pipeline);
    const resumedJob = colonyTerraformOrders(state, 0)[0]!.jobs[0]!;
    expect(resumedJob.waitReason).toBeUndefined();
    expect(resumedJob.progress).toBeCloseTo(31 / 70, 5);

    // Finish the remaining 39 ticks -> tile becomes Flat
    for (let t = 0; t < 39; t++) {
      step(state, [], 1, pipeline);
    }
    expect(state.grid.layers.terrain[tIdx]).toBe(TERRAIN.flat);
    expect(state.grid.layers.prep[tIdx]).toBe(PREP.flat);
    expect(colonyTerraformOrders(state, 0)).toHaveLength(0);
  });
});

describe('W05-08 · Area order splits tiles over <= 8 workers', () => {
  it('splits a 10-tile area order across at most 8 concurrent workers and completes all 10 tiles', () => {
    const { state, colony, hx, pipeline } = createW05PowerColony('w05-08-area');
    colony.powerSupplyOverride = 500;

    // Create 10 slope tiles in a row
    const tiles: Array<{ q: number; r: number }> = [];
    for (let i = 0; i < 10; i++) {
      const q = -4 + i;
      const r = 4;
      const idx = hx.indexOf(q, r);
      setTileTerrain(state.grid, idx, TERRAIN.slope, 0);
      setTileHeight(state.grid, idx, 1.5, 0);
      tiles.push({ q, r });
    }

    // Spawn 10 Terraformer Drones adjacent to the row
    const workerIds: number[] = [];
    for (let i = 0; i < 10; i++) {
      workerIds.push(spawnTerraformerUnit(state, { owner: 0, q: -4 + i, r: 3 }));
    }

    const enqRes = step(
      state,
      [
        {
          commandId: 'cmd-area-level-10',
          colonyIndex: 0,
          source: 'player',
          kind: 'enqueueTask',
          args: { terraform: { op: 'level', tiles } },
        },
      ],
      1,
      pipeline,
    );
    expect(enqRes.outcomes[0]?.code).toBeUndefined();

    // Step 2 ticks so workers claim tiles and start working
    step(state, [], 1, pipeline);
    step(state, [], 1, pipeline);

    const activeCommands = workerIds
      .map((id) => getUnitCommand(state, id))
      .filter((cmd) => cmd?.kind === 'terraform');
    expect(activeCommands).toHaveLength(8);
    const distinctTiles = new Set(activeCommands.map((c) => (c?.kind === 'terraform' ? `${c.q},${c.r}` : '')));
    expect(distinctTiles.size).toBe(8);

    // Step until all 10 tiles are leveled
    for (let t = 0; t < 115; t++) {
      step(state, [], 1, pipeline);
    }

    for (const t of tiles) {
      expect(state.grid.layers.terrain[hx.indexOf(t.q, t.r)]).toBe(TERRAIN.flat);
    }
    expect(colonyTerraformOrders(state, 0)).toHaveLength(0);
  });
});

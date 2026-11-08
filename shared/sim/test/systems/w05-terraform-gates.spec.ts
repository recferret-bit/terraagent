import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import {
  colonyTerraformOrders,
  createRegistryPipeline,
  createState,
  creditResource,
  ensureColonyLedger,
  hexIndex,
  PREP,
  setTileHeight,
  setTileOwner,
  setTilePrep,
  setTileTerrain,
  spawnWorkerUnit,
  startBuildingConstruction,
  step,
  TERRAIN,
} from '../../src';
import { getFootprintTileIndices } from '../../src/systems/economy/buildingRows';

/** A flat, owned, stocked colony with an instant Hub at (0, 0) and the pipeline of `waves`. */
function colony(waves: string) {
  const state = createState({ planetId: `p-w05-gates-${waves}`, planetType: 'temperate', seed: 'w05-gates', radius: 12 });
  const col = ensureColonyLedger({ index: 0, id: 'col-0', name: 'Alpha', color: 0xff6b00, status: 'active', changedAt: 0 });
  state.colonies.push(col);
  for (const k of ['metals.t1', 'minerals.t1', 'bio.biomass', 'bio.water'] as const) creditResource(col, k, 400, 0);
  col.powerSupplyOverride = 200;
  for (let i = 0; i < state.grid.count; i++) {
    setTileOwner(state.grid, i, 0, 0);
    setTileTerrain(state.grid, i, TERRAIN.flat, 0);
    setTileHeight(state.grid, i, 0, 0);
  }
  expect(startBuildingConstruction(state, { owner: 0, building: 'commandHub', q: 0, r: 0, instant: true, costOverride: {} }).ok).toBe(true);
  return { state, hx: hexIndex(state.grid.radius), pipeline: createRegistryPipeline({ flags: parseWaves(waves) }) };
}

const enqueue = (op: string, q: number, r: number, id: string) => ({
  commandId: id, colonyIndex: 0, source: 'player' as const, kind: 'enqueueTask', args: { terraform: { op, tiles: [{ q, r }] } },
});

describe('W05-01 · TA_WAVES=..04 never runs a W05 terraform op', () => {
  it('rejects level / fill / reclaim / deepReclaim / irrigate / seed with wave_disabled; grade / clear / break still queue', () => {
    const { state, hx, pipeline } = colony('..04');
    const ground: Record<string, [number, number]> = {
      level: [TERRAIN.slope, PREP.wild], fill: [TERRAIN.hole, PREP.wild], reclaim: [TERRAIN.shallow, PREP.wild],
      deepReclaim: [TERRAIN.deep, PREP.wild], irrigate: [TERRAIN.flat, PREP.prepared], seed: [TERRAIN.flat, PREP.irrigated],
      grade: [TERRAIN.flat, PREP.wild], clear: [TERRAIN.forest, PREP.wild], break: [TERRAIN.rock, PREP.wild],
    };
    spawnWorkerUnit(state, { tier: 2, owner: 0, q: 4, r: -4 });
    let q = -4;
    const codes: Record<string, string | undefined> = {};
    for (const [op, [terrain, prep]] of Object.entries(ground)) {
      const i = hx.indexOf(q, 5);
      setTileTerrain(state.grid, i, terrain, 0);
      setTilePrep(state.grid, i, prep, 0);
      codes[op] = step(state, [enqueue(op, q, 5, `cmd-${op}`)], 1, pipeline).outcomes[0]?.code;
      q++;
    }
    for (const op of ['level', 'fill', 'reclaim', 'deepReclaim', 'irrigate', 'seed']) expect(codes[op], op).toBe('wave_disabled');
    for (const op of ['grade', 'clear', 'break']) expect(codes[op], op).toBeUndefined();
    expect(colonyTerraformOrders(state, 0).map((o) => o.op).sort()).toEqual(['break', 'clear', 'grade']);
  });
});

describe('W05-07 / W05-10 · no growth ladder under a building', () => {
  it('Irrigate on a standing building footprint is rejected (site_blocked); next to it is accepted', () => {
    const { state, hx, pipeline } = colony('..05');
    const fp = getFootprintTileIndices(state, 4, 1, 2, 2).indices;
    for (const i of fp) setTilePrep(state.grid, i, PREP.prepared, 0);
    expect(startBuildingConstruction(state, { owner: 0, building: 'solar', q: 4, r: 1, instant: true, costOverride: {} }).ok).toBe(true);
    const under = fp[0]!;
    const out = step(state, [enqueue('irrigate', hx.q[under]!, hx.r[under]!, 'cmd-irr-under')], 1, pipeline);
    expect(out.outcomes[0]?.code).toBe('site_blocked');

    const free = hx.indexOf(-4, 4);
    setTilePrep(state.grid, free, PREP.prepared, 0);
    expect(step(state, [enqueue('irrigate', -4, 4, 'cmd-irr-free')], 1, pipeline).outcomes[0]?.code).toBeUndefined();
  });
});

describe('W05-29 · dock work on a crater counts as Fill', () => {
  it('a `work` job on a hole emits obstacleRemoved { op: fill } and tileStateChanged', () => {
    const { state, hx, pipeline } = colony('..05');
    const i = hx.indexOf(4, 0);
    setTileTerrain(state.grid, i, TERRAIN.hole, 0);
    setTileHeight(state.grid, i, -0.6, 0);
    spawnWorkerUnit(state, { tier: 1, owner: 0, q: 5, r: 0 });
    const cmd = { ...enqueue('work', 4, 0, 'cmd-work-hole'), args: { terraform: { op: 'work', intent: 'terraform', tiles: [{ q: 4, r: 0 }] } } };
    const events: Array<{ kind: string; data: Record<string, unknown> }> = [];
    const first = step(state, [cmd], 1, pipeline);
    expect(first.outcomes[0]?.code).toBeUndefined();
    for (let t = 0; t < 200 && state.grid.layers.terrain[i] === TERRAIN.hole; t++) events.push(...(step(state, [], 1, pipeline).events as typeof events));
    expect(state.grid.layers.terrain[i]).toBe(TERRAIN.flat);
    expect(events.find((e) => e.kind === 'obstacleRemoved')?.data).toMatchObject({ op: 'fill', q: 4, r: 0 });
    expect(events.find((e) => e.kind === 'tileStateChanged')?.data).toMatchObject({ op: 'fill', prevTerrain: 'hole', terrain: 'flat', prep: 'prepared' });
    expect(events.find((e) => e.kind === 'tilePrepared')?.data).toMatchObject({ q: 4, r: 0 }); // the ground ends Prepared: Groundbreaker still counts it
  });
});

import { describe, expect, it } from 'vitest';
import { eventDef, parseWaves } from '@terra/contracts';
import {
  clientTileLayers,
  compileData,
  dataRow,
  findSpecFromRow,
  groundWorkYields,
  terraformFindSpec,
  terraformYields,
  tune,
  type PlanetTuning,
  createRegistryPipeline,
  createState,
  decodeDiff,
  DEPOSIT,
  depositFamilyAndKey,
  diffSince,
  ensureColonyLedger,
  hexIndex,
  nextFloat,
  pickSpawn,
  PREP,
  pickSpawnTier,
  placeMetalsExtractor,
  restore,
  rollTerraformSpawn,
  setTileDeposit,
  setTilePrep,
  setTileTerrain,
  snapshot,
  spawnWorkerUnit,
  spawnHqUnit,
  spawnTerraformDeposit,
  step,
  TERRAFORM_RESOURCE_SPAWN,
  TERRAIN,
  view,
  type StepContext,
} from '../../src';
import production from '../../src/systems/production';
import { resourceValue } from '../../src/systems/economy/ledger';

const seq = (...xs: number[]) => {
  let i = 0;
  return () => xs[i++]!;
};

describe('terraform resource deposit spawn (1 %, tier 50/35/15)', () => {
  it('the numbers live in one exported data constant', () => {
    expect(TERRAFORM_RESOURCE_SPAWN).toEqual({
      chance: 0.01,
      tierWeights: { 1: 0.5, 2: 0.35, 3: 0.15 },
      families: ['metals', 'minerals', 'oil'],
      richnessBp: 10000,
    });
  });

  it('pickSpawn: a draw below 1 % spawns, 1 % and above does not', () => {
    expect(pickSpawn(0, 0, 0)).toEqual({ deposit: 'metals', tier: 1, richnessBp: 10000 });
    expect(pickSpawn(0.0099, 0.2, 0.5)).toEqual({ deposit: 'minerals', tier: 1, richnessBp: 10000 });
    expect(pickSpawn(0.01, 0, 0)).toBeNull();
    expect(pickSpawn(0.5, 0, 0)).toBeNull();
  });

  it('tier boundaries: [0, 0.5) → t1, [0.5, 0.85) → t2, [0.85, 1) → t3', () => {
    expect([0, 0.4999].map((r) => pickSpawnTier(r))).toEqual([1, 1]);
    expect([0.5, 0.6, 0.8499].map((r) => pickSpawnTier(r))).toEqual([2, 2, 2]);
    expect([0.85, 0.8501, 0.9999].map((r) => pickSpawnTier(r))).toEqual([3, 3, 3]);
  });

  it('family: uniform thirds over metals / minerals / oil', () => {
    expect([0, 0.3333].map((r) => pickSpawn(0, 0, r)?.deposit)).toEqual(['metals', 'metals']);
    expect([0.334, 0.6666].map((r) => pickSpawn(0, 0, r)?.deposit)).toEqual(['minerals', 'minerals']);
    expect([0.667, 0.9999].map((r) => pickSpawn(0, 0, r)?.deposit)).toEqual(['oil', 'oil']);
  });

  it('rollTerraformSpawn draws once on a miss and three times on a hit', () => {
    let calls = 0;
    expect(rollTerraformSpawn(() => (calls++, 0.5))).toBeNull();
    expect(calls).toBe(1);
    expect(rollTerraformSpawn(seq(0.001, 0.9, 0.7))).toEqual({ deposit: 'oil', tier: 3, richnessBp: 10000 });
  });

  it('spawnTerraformDeposit writes deposit + tier (stamped, visible to clients) and emits a valid resourceSpawned', () => {
    const state = createState({ planetId: 'p-sp', planetType: 'temperate', seed: 'sp', radius: 6 });
    const i = hexIndex(6).indexOf(2, -1);
    setTileDeposit(state, i, DEPOSIT.none, 0, 0);
    const events: Array<{ kind: string; data: unknown }> = [];
    const ctx = { tick: 7, emit: (e: { kind: string; data: unknown }) => events.push(e) } as unknown as StepContext;
    const spawn = spawnTerraformDeposit(state, { tileIdx: i, q: 2, r: -1 }, { colonyId: 'col-0' }, ctx, seq(0.005, 0.6, 0.1));
    expect(spawn).toEqual({ deposit: 'metals', tier: 2, richnessBp: 10000 });
    expect(state.grid.layers.deposit[i]).toBe(DEPOSIT.metals);
    expect(state.grid.layers.depositTier[i]).toBe(2);
    expect(state.grid.layers.richness[i]).toBe(10000);
    expect(events).toHaveLength(1);
    expect(events[0]!.kind).toBe('resourceSpawned');
    expect(eventDef('resourceSpawned').data.safeParse(events[0]!.data).success).toBe(true);
    expect(events[0]!.data).toMatchObject({ colonyId: 'col-0', q: 2, r: -1, deposit: 'metals', tier: 2 });

    expect(clientTileLayers().some((l) => l.name === 'depositTier')).toBe(true);
    const d = decodeDiff(diffSince(state, 6, { forClient: true }));
    const at = Array.from(d.tiles.idx).indexOf(i);
    expect(at).toBeGreaterThanOrEqual(0);
    expect(d.tiles.cols.depositTier?.[at]).toBe(2);
    expect(restore(snapshot(state, { forClient: true })).grid.layers.depositTier[i]).toBe(2);
    expect(view(state).tiles.depositTier?.[i]).toBe(2);

    // an occupied hex never rolls; removing the deposit resets its tier
    expect(spawnTerraformDeposit(state, { tileIdx: i, q: 2, r: -1 }, { colonyId: 'col-0' }, ctx, seq(0, 0, 0))).toBeNull();
    setTileDeposit(state, i, DEPOSIT.none, 0, 8);
    expect(state.grid.layers.depositTier[i]).toBe(0);
  });
});

describe('spawn roll in the work-jobs system', () => {
  it('a completed terraform job draws its roll from the misc stream (one draw on a miss), deterministically', () => {
    const run = () => {
      const state = createState({ planetId: 'p-roll', planetType: 'temperate', seed: 'roll', radius: 8 });
      state.colonies.push(ensureColonyLedger({ index: 0, id: 'col-0', name: 'A', color: 0xff6b00, status: 'active', changedAt: 0 }));
      const i = hexIndex(8).indexOf(1, 0);
      for (let k = 0; k < state.grid.count; k++) {
        setTileTerrain(state, k, TERRAIN.flat, 0);
        setTilePrep(state.grid, k, PREP.wild, 0);
        setTileDeposit(state, k, DEPOSIT.none, 0, 0);
        state.grid.layers.height[k] = 0;
        state.grid.layers.subDeposit[k] = 0;
      }
      setTileTerrain(state, i, TERRAIN.forest, 0);
      spawnHqUnit(state, { owner: 0, q: 0, r: 0 });
      const before = Uint32Array.from(state.rng.misc);
      const pipeline = createRegistryPipeline({ flags: parseWaves('..02') });
      step(state, [{ commandId: 'w', colonyIndex: 0, source: 'player', kind: 'enqueueTask', args: { terraform: { op: 'work', tiles: [{ q: 1, r: 0 }] } } }], 1, pipeline);
      step(state, [], 200, pipeline);
      return { state, i, before };
    };
    const a = run();
    const b = run();
    expect(a.state.grid.layers.terrain[a.i]).toBe(TERRAIN.flat);
    const expected = Uint32Array.from(a.before);
    const first = nextFloat(expected);
    if (first >= TERRAFORM_RESOURCE_SPAWN.chance) {
      expect(Array.from(a.state.rng.misc)).toEqual(Array.from(expected));
      expect(a.state.grid.layers.deposit[a.i]).toBe(DEPOSIT.none);
    }
    expect(Array.from(a.state.rng.misc)).toEqual(Array.from(b.state.rng.misc));
    expect(a.state.grid.layers.deposit[a.i]).toBe(b.state.grid.layers.deposit[b.i]);
    expect(a.state.grid.layers.depositTier[a.i]).toBe(b.state.grid.layers.depositTier[b.i]);
  });
});

describe('harvest of tiered deposits', () => {
  it('depositFamilyAndKey: tier 0/1 → t1 keys, 2/3 → tiered keys; oil → biomass / bio.t2 / bio.t3', () => {
    expect(depositFamilyAndKey(DEPOSIT.metals)).toEqual({ family: 'metals', key: 'metals.t1' });
    expect(depositFamilyAndKey(DEPOSIT.metals, 2)).toEqual({ family: 'metals', key: 'metals.t2' });
    expect(depositFamilyAndKey(DEPOSIT.minerals, 3)).toEqual({ family: 'minerals', key: 'minerals.t3' });
    expect([0, 1, 2, 3].map((t) => depositFamilyAndKey(DEPOSIT.oil, t)?.key)).toEqual(['bio.biomass', 'bio.biomass', 'bio.t2', 'bio.t3']);
    expect(depositFamilyAndKey(DEPOSIT.none, 2)).toBeNull();
  });

  it('a Worker next to a tier-2 metals deposit credits metals.t2, not metals.t1', () => {
    const state = createState({ planetId: 'p-h2', planetType: 'temperate', seed: 'h2', radius: 8 });
    const colony = ensureColonyLedger({ index: 0, id: 'col-0', name: 'A', color: 0xff6b00, status: 'active', changedAt: 0 });
    state.colonies.push(colony);
    const idx = hexIndex(state.grid.radius);
    for (let k = 0; k < state.grid.count; k++) setTileDeposit(state, k, DEPOSIT.none, 0, 0);
    setTileDeposit(state, idx.indexOf(1, 0), DEPOSIT.metals, 10000, 0, 2);
    spawnWorkerUnit(state, { owner: 0, q: 0, r: 0 });
    const pipeline = createRegistryPipeline({ flags: parseWaves('..02') });
    step(state, [], 1, pipeline);
    const t1 = resourceValue(colony, 'metals.t1');
    const t2 = resourceValue(colony, 'metals.t2');
    step(state, [], 5, pipeline);
    expect(resourceValue(colony, 'metals.t2') - t2).toBeCloseTo(0.5, 5);
    expect(resourceValue(colony, 'metals.t1')).toBe(t1);
  });

  it('a Metals Extractor on a tier-3 metals deposit credits metals.t3 and reports its rate under that key', () => {
    const state = createState({ planetId: 'p-x3', planetType: 'temperate', seed: 'x3', radius: 8 });
    const colony = ensureColonyLedger({ index: 0, id: 'col-0', name: 'A', color: 0xff6b00, status: 'active', changedAt: 0 });
    state.colonies.push(colony);
    const idx = hexIndex(state.grid.radius);
    for (let k = 0; k < state.grid.count; k++) {
      setTileTerrain(state, k, TERRAIN.flat, 0);
      setTilePrep(state.grid, k, PREP.prepared, 0);
      setTileDeposit(state, k, DEPOSIT.none, 0, 0);
      state.grid.layers.height[k] = 0;
    }
    setTileDeposit(state, idx.indexOf(1, 0), DEPOSIT.metals, 10000, 0, 3);
    const placed = placeMetalsExtractor(state, { owner: 0, q: 1, r: 0 });
    expect(placed.ok).toBe(true);
    // The extractor system alone (no Pylon network here, the power system would switch it off).
    const run = production.systems!.find((s) => s.id === 'production.extractors')!.run;
    for (let t = 1; t <= 10; t++) run(state, { tick: t, dt: 1 } as unknown as StepContext);
    expect(resourceValue(colony, 'metals.t3')).toBeGreaterThan(0);
    expect(resourceValue(colony, 'metals.t1')).toBe(0);
    expect(colony.production.incomePerS['metals.t3']).toBeGreaterThan(0);
    expect(colony.production.incomePerS['metals.t1']).toBe(0);
  });
});

describe('tunable numbers (D-35)', () => {
  const w02 = new Set(['W00', 'W01', 'W02']);

  it('the find odds are the terraformFinds.deposit row; a tune applies through compiled data', () => {
    expect(terraformFindSpec()).toEqual(TERRAFORM_RESOURCE_SPAWN);
    expect(terraformFindSpec(compileData(w02))).toEqual(TERRAFORM_RESOURCE_SPAWN);
    expect(terraformFindSpec(compileData(new Set(['W00', 'W01']))).chance).toBe(0); // no flag, no feature
    const tuned = compileData(w02, { terraformFinds: { deposit: { chance: 1, t1Weight: 0, t2Weight: 0, t3Weight: 1, families: ['oil'] } } });
    expect(terraformFindSpec(tuned)).toEqual({ chance: 1, tierWeights: { 1: 0, 2: 0, 3: 1 }, families: ['oil'], richnessBp: 10000 });
    expect(() => findSpecFromRow({ ...dataRow(tuned, 'terraformFinds', 'deposit'), families: ['gold'] })).toThrow(/families/);
    const t: PlanetTuning = { flags: parseWaves('..02').list as string[], base: {}, live: {} };
    expect(tune(t, { op: 'set', path: 'terraformFinds.deposit.chance', value: '0.5' }).next?.live).toEqual({ terraformFinds: { deposit: { chance: 0.5 } } });
  });

  it('a tuned chance of 1 makes every finished work job find a deposit of the tuned family and tier', () => {
    const data = compileData(w02, { terraformFinds: { deposit: { chance: 1, t1Weight: 0, t2Weight: 1, t3Weight: 0, families: ['minerals'] } } });
    const state = createState({ planetId: 'p-tuned', planetType: 'temperate', seed: 'tuned', radius: 8 });
    state.colonies.push(ensureColonyLedger({ index: 0, id: 'col-0', name: 'A', color: 0xff6b00, status: 'active', changedAt: 0 }));
    for (let k = 0; k < state.grid.count; k++) {
      setTileTerrain(state, k, TERRAIN.flat, 0);
      setTilePrep(state.grid, k, PREP.wild, 0);
      setTileDeposit(state, k, DEPOSIT.none, 0, 0);
      state.grid.layers.height[k] = 0;
      state.grid.layers.subDeposit[k] = 0;
    }
    const i = hexIndex(8).indexOf(2, 0);
    setTileTerrain(state, i, TERRAIN.rock, 0);
    spawnHqUnit(state, { owner: 0, q: 0, r: 0 });
    const pipeline = createRegistryPipeline({ flags: parseWaves('..02'), data });
    step(state, [{ commandId: 'w', colonyIndex: 0, source: 'player', kind: 'enqueueTask', args: { terraform: { op: 'work', tiles: [{ q: 2, r: 0 }] } } }], 1, pipeline);
    step(state, [], 200, pipeline);
    expect(state.grid.layers.deposit[i]).toBe(DEPOSIT.minerals);
    expect(state.grid.layers.depositTier[i]).toBe(2);
  });

  it('the terraform yield is one table (opsBasic yields) for the order path, the work path and the UI', () => {
    expect(terraformYields('clear')).toEqual({ 'bio.biomass': 15 });
    expect(terraformYields('break')).toEqual({ 'metals.t1': 8, 'minerals.t1': 4 });
    expect(terraformYields('grade')).toEqual({});
    expect(groundWorkYields('forest')).toEqual(terraformYields('clear'));
    expect(groundWorkYields('rock')).toEqual(terraformYields('break'));
    expect(groundWorkYields('slope')).toEqual({});
    const tuned = compileData(w02, { opsBasic: { break: { yields: { 'metals.t1': 20 } } } });
    expect(groundWorkYields('rock', tuned)).toEqual({ 'metals.t1': 20 });
  });
});

describe('dev.spawndeposit', () => {
  it('places a full deposit of the family and tier on the tile (stamped)', () => {
    const state = createState({ planetId: 'p-dev', planetType: 'temperate', seed: 'dev', radius: 8 });
    state.colonies.push(ensureColonyLedger({ index: 0, id: 'col-0', name: 'A', color: 0xff6b00, status: 'active', changedAt: 0 }));
    const pipeline = createRegistryPipeline({ flags: parseWaves('..02') });
    const i = hexIndex(8).indexOf(3, -1);
    const dev = (args: unknown) => step(state, [{ commandId: `d${state.meta.tick}`, colonyIndex: 0, source: 'dev', kind: 'dev.spawndeposit', args }], 1, pipeline).outcomes[0];
    expect(dev({ q: 3, r: -1, family: 'oil', tier: 3 })?.code).toBeUndefined();
    expect(state.grid.layers.deposit[i]).toBe(DEPOSIT.oil);
    expect(state.grid.layers.depositTier[i]).toBe(3);
    expect(state.grid.layers.richness[i]).toBe(10000);
    expect(state.grid.layers.changedAt[i]).toBe(state.meta.tick);
    expect(dev({ q: 3, r: -1, family: 'gold', tier: 3 })?.code).toBe('invalid_args');
    expect(dev({ q: 99, r: 0, family: 'oil', tier: 1 })?.code).toBe('invalid_args');
  });
});

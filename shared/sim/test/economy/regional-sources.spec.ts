import { RegionsContent, parseWaves } from '@terra/contracts';
import { describe, expect, it } from 'vitest';
import {
  compileData, createPlanet, createRegistryPipeline, createState, DEPOSIT, ENTITY_KIND, ENTITY_STATE, ensureColonyLedger, GEN_VERSION, hexIndex, insertRow,
  placeMetalsExtractor, resolvePlanetRegion, restore, setTileDeposit, snapshot, step, writeRegionPin,
  getRegionPin, regionViewOf, regionalSourcePolicy, REGION_PIN_BLOB, resolveRegion, type PlanetState, type ResolvedRegion, type StepContext,
} from '../../src';
import { spawnTerraformDeposit } from '../../src/systems/terraform-basic/resourceSpawn';
import { resourceValue } from '../../src/systems/economy/ledger';

const ok = (r: ReturnType<typeof resolveRegion>): ResolvedRegion => {
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.region;
};
const desertCtx = { planetType: 'desert', planetId: 'pl_dune' };
const ridgeContent = RegionsContent.parse({
  profiles: [{ regionProfileId: 'crystal-ridge', resources: { 'minerals.t3': { occurrenceWeightBp: 8000 } } }],
  bindings: [{ scopeKind: 'sectorArchetype', archetype: 'crystal-ridge', regionProfileId: 'crystal-ridge' }],
});
const desert = ok(resolvePlanetRegion({}, desertCtx));
const ridge = ok(resolvePlanetRegion({ regions: ridgeContent }, { ...desertCtx, sectorArchetype: 'crystal-ridge', sectorId: 'sec_ridge' }));

const make = (region?: ResolvedRegion, seed = 'regional-1'): PlanetState =>
  createPlanet({ id: 'pl_dune', seed, type: 'desert', planetType: 'desert', radius: 40, worldSalt: 'salt', ...(region ? { region } : {}) });

/** Tier-3 share among all minerals deposits (visible layer). */
function crystalShare(s: PlanetState): { t3: number; all: number } {
  const L = s.grid.layers;
  let t3 = 0, all = 0;
  for (let i = 0; i < s.grid.count; i++) {
    if (L.deposit[i] !== DEPOSIT.minerals) continue;
    all++;
    if (L.depositTier[i] === 3) t3++;
  }
  return { t3, all };
}

const findCtx = (data: ReturnType<typeof compileData>): StepContext => ({ data, tick: 5, emit: () => undefined, rng: () => new Uint32Array([1, 2, 3, 4]) }) as unknown as StepContext;
const dataWithChance = (chance: number) => compileData(parseWaves('..13'), { overrides: { terraformFinds: { deposit: { chance } } } });

/** The first `n` tiles that hold no deposit (pick them once: a find turns a tile into a deposit). */
const emptyTiles = (s: PlanetState, n = 900): number[] => {
  const out: number[] = [];
  for (let i = 0; i < s.grid.count && out.length < n; i++) if (s.grid.layers.deposit[i] === DEPOSIT.none) out.push(i);
  return out;
};

function runFinds(s: PlanetState, chance: number, tiles: number[] = emptyTiles(s)): void {
  const ctx = findCtx(dataWithChance(chance));
  const hx = hexIndex(s.grid.radius);
  for (const i of tiles) spawnTerraformDeposit(s, { tileIdx: i, q: hx.q[i], r: hx.r[i] }, { colonyId: 'c0' }, ctx);
}

describe('regional sources (ECON-GEO-01/02, W13-51)', () => {
  it('desert crystal 15 stays scarce through gen, terraform finds and reload; a crystal-ridge override at 80 is higher', () => {
    const policyShare = (r: ResolvedRegion) => {
      const w = (k: 'minerals.t1' | 'minerals.t2' | 'minerals.t3') => regionalSourcePolicy(r, k, 'surfaceDeposit').weightBp;
      return w('minerals.t3') / (w('minerals.t1') + w('minerals.t2') + w('minerals.t3'));
    };
    expect(regionalSourcePolicy(desert, 'minerals.t3', 'surfaceDeposit').weightBp).toBe(1500);
    const base = make(desert);
    const genShare = crystalShare(base);
    expect(genShare.all).toBeGreaterThan(40);
    expect(genShare.t3 / genShare.all).toBeLessThan(0.15); // nowhere near the old 20 % standard share
    expect(Math.abs(genShare.t3 / genShare.all - policyShare(desert))).toBeLessThan(0.05);

    const reloaded = restore(snapshot(base));
    runFinds(reloaded, 1);
    const afterFinds = crystalShare(reloaded);
    expect(afterFinds.all).toBeGreaterThan(genShare.all);
    expect(afterFinds.t3 / afterFinds.all).toBeLessThan(0.15);

    const again = restore(snapshot(restore(snapshot(reloaded))));
    expect(crystalShare(again)).toEqual(afterFinds);

    const ridgeShare = crystalShare(make(ridge));
    expect(policyShare(ridge)).toBeGreaterThan(0.25);
    expect(ridgeShare.t3 / ridgeShare.all).toBeGreaterThan(crystalShare(base).t3 / genShare.all);
    expect(ridgeShare.t3 / ridgeShare.all).toBeGreaterThan(0.15);
  });

  it('terraform finds are seeded by tile identity: no reroll on repeat, cancel or reload', () => {
    const a = make(desert), b = restore(snapshot(make(desert)));
    const tiles = emptyTiles(a);
    runFinds(a, 0.5, tiles);
    const first = Array.from(a.grid.layers.deposit);
    runFinds(a, 0.5, tiles); // repeating the same terraforms changes nothing (found tiles hold a deposit, the others roll the same no)
    expect(Array.from(a.grid.layers.deposit)).toEqual(first);
    runFinds(b, 0.5, tiles);
    expect(Array.from(b.grid.layers.deposit)).toEqual(first);
    expect(Array.from(b.grid.layers.depositTier)).toEqual(Array.from(a.grid.layers.depositTier));
  });

  it('a zero-weight resource never appears, anywhere (no uniform fallback, no scarcity bypass)', () => {
    const noCrystal = ok(resolvePlanetRegion({ regions: RegionsContent.parse({
      profiles: [{ regionProfileId: 'nocrystal', resources: { 'minerals.t3': { occurrenceWeightBp: 0, terraformFindWeightBp: 0 } } }],
      bindings: [{ scopeKind: 'planetId', planetId: 'pl_dune', regionProfileId: 'nocrystal' }],
    }) }, desertCtx));
    const s = make(noCrystal);
    runFinds(s, 1);
    expect(crystalShare(s).t3).toBe(0);
  });

  it('a pre-existing snapshot keeps its original deposits and endowment hash after a profile change', () => {
    const a = make(desert);
    const bytes = snapshot(a);
    const loaded = restore(bytes);
    const pinned = getRegionPin(loaded)!;
    expect(pinned.endowmentHash).toBe(desert.endowmentHash);
    const deposits = Array.from(loaded.grid.layers.deposit), tiers = Array.from(loaded.grid.layers.depositTier);
    // a different profile is active now (crystal ridge): writing it, or loading, never regenerates or re-pins
    expect(writeRegionPin(loaded, ridge)!.endowmentHash).toBe(desert.endowmentHash);
    expect(loaded.blobs[REGION_PIN_BLOB]!.value).toEqual(a.blobs[REGION_PIN_BLOB]!.value);
    expect(Array.from(loaded.grid.layers.deposit)).toEqual(deposits);
    expect(Array.from(loaded.grid.layers.depositTier)).toEqual(tiers);
    expect(ridge.endowmentHash).not.toBe(desert.endowmentHash);
    expect(snapshot(make(ridge))).not.toEqual(bytes);
    // a planet built before W13 stays legacy: it cannot be pinned later and keeps no regional policy
    const legacy = make();
    legacy.meta.tick = 10;
    expect(writeRegionPin(legacy, desert)).toBeUndefined();
    expect(regionViewOf(legacy)).toBeUndefined();
  });

  it('W13 off: generation is bit-identical (no region = no pin, same bytes, same genVersion); W13 on changes deposits only', () => {
    const off = make();
    expect(off.meta.genVersion).toBe(GEN_VERSION);
    expect(off.blobs[REGION_PIN_BLOB]).toBeUndefined();
    expect(snapshot(off)).toEqual(snapshot(createPlanet({ id: 'pl_dune', seed: 'regional-1', type: 'desert', planetType: 'desert', radius: 40, worldSalt: 'salt', region: undefined })));
    const on = make(desert);
    expect(on.meta.genVersion).toBe(GEN_VERSION);
    for (const layer of ['terrain', 'prep', 'height', 'subDeposit', 'subRichness']) expect(Array.from(on.grid.layers[layer])).toEqual(Array.from(off.grid.layers[layer]));
  });
});

const solarFor = (state: PlanetState): void => {
  const solar = insertRow(state.entities, state.meta.nextEntityId++, 0);
  const c = state.entities.cols;
  c.kind[solar] = ENTITY_KIND.solar; c.owner[solar] = 0; c.hp[solar] = 200; c.hpMax[solar] = 200; c.state[solar] = ENTITY_STATE.active;
};
const regionWith = (id: string, resources: Record<string, Record<string, number>>): ResolvedRegion =>
  ok(resolvePlanetRegion({ regions: RegionsContent.parse({ profiles: [{ regionProfileId: id, resources }], bindings: [{ scopeKind: 'planetId', planetId: 'pl_dune', regionProfileId: id }] }) }, desertCtx));

/** One metals extractor on a 6000 bp metals deposit for 50 ticks, with or without a pinned region. */
function runExtractor(region?: ResolvedRegion) {
  const state = createState({ planetId: 'p1', planetType: 'temperate', seed: 'w13-51', radius: 6 });
  if (region) writeRegionPin(state, region);
  const idx = hexIndex(state.grid.radius).indexOf(2, 1);
  setTileDeposit(state, idx, DEPOSIT.metals, 6000, 0, 1);
  expect(placeMetalsExtractor(state, { owner: 0, q: 1, r: 1 }).ok).toBe(true);
  solarFor(state);
  step(state, [], 50, createRegistryPipeline({ flags: parseWaves('..02') }));
  const col = ensureColonyLedger(state.colonies[0]);
  return { depleted: (6000 - state.grid.layers.richness[idx]) / 20, stock: resourceValue(col, 'metals.t1'), col };
}

/** Water held after 5 s with `n` water extractors under a pinned sector renewable allowance of `renewable` per sim hour. */
function waterAfter(n: number, renewable: number): number {
  const state = createState({ planetId: 'p', planetType: 'temperate', seed: 'w', radius: 6 });
  writeRegionPin(state, regionWith('w', { 'bio.water': { renewableUnitsPerSimHour: renewable } }));
  for (let i = 0; i < n; i++) {
    const row = insertRow(state.entities, state.meta.nextEntityId++, 0);
    const c = state.entities.cols;
    c.kind[row] = ENTITY_KIND.waterExtractor; c.owner[row] = 0; c.hp[row] = 100; c.hpMax[row] = 100; c.state[row] = ENTITY_STATE.active;
  }
  solarFor(state);
  step(state, [], 25, createRegistryPipeline({ flags: parseWaves('..02') }));
  return resourceValue(ensureColonyLedger(state.colonies[0]), 'bio.water');
}

describe('regional extraction and renewables (W13-51)', () => {
  it('finite credits match depletion; yield scales removal and credit together', () => {
    const legacy = runExtractor();
    expect(legacy.stock).toBeCloseTo(legacy.depleted, 4);
    const slow = runExtractor(regionWith('slow', { 'metals.t1': { extractionYieldBp: 5000 } }));
    expect(slow.stock).toBeCloseTo(slow.depleted, 4); // credit == depletion at any yield
    expect(slow.depleted).toBeCloseTo(legacy.depleted / 2, 3);
    // a T1 deposit never pays a higher tier, whatever is unlocked
    for (const k of ['metals.t2', 'metals.t3', 'minerals.t3'] as const) expect(resourceValue(slow.col, k)).toBe(0);
  });

  it('the Water Extractor draws from the shared sector renewable budget; extra extractors do not multiply it', () => {
    expect(waterAfter(2, 0)).toBe(0); // 0 = no renewal
    const one = waterAfter(1, 360); // 360 per sim hour over 5 s
    const four = waterAfter(4, 360);
    expect(four).toBeLessThanOrEqual(one * 1.0001 + 1e-9);
    expect(four).toBeGreaterThan(0);
  });
});

import { describe, expect, it } from 'vitest';
import { ENTITY_KIND, ENTITY_STATE } from '../../src/ecs/columns';
import { placeSpawnedEntity } from '../../src/ecs/placement';
import { insertRow } from '../../src/ecs/store';
import { hexDistance, hexIndex } from '../../src/grid/hex';
import { DEPOSIT, PREP, TERRAIN } from '../../src/grid/layers';
import { ensureColonyRecord } from '../../src/kernel/colonies';
import { createState, type PlanetState } from '../../src/kernel/state';
import { ensureColonyLedger } from '../../src/systems/economy/ledger';
import {
  computeSliderWeightBp,
  DEFAULT_COLONY_PRIORITIES,
  DEFENSE_UNDER_ATTACK_FLOOR_BP,
  evaluateColonyNeeds,
  evaluateWeightedColonyNeeds,
  NEED_KEYS,
  NEED_TO_PRIORITY_KEY,
  REPAIR_FLOOR_BP,
  selectDeterministicBuildSite,
  weightColonyNeeds,
} from '../../src/systems/rule-engine';

function makeTestPlanet(radius = 20): PlanetState {
  const state = createState({
    planetId: 'pl_weight_test',
    planetType: 'temperate',
    seed: 'w08-24-deterministic-seed',
    radius,
  });
  const col = ensureColonyRecord(state, 0, 0);
  col.status = 'active';
  ensureColonyLedger(col, { baseCap: 500 });
  return state;
}

function claimTerritoryRadiusForTest(state: PlanetState, colonyIndex: number, cq: number, cr: number, radius: number): void {
  const hx = hexIndex(state.grid.radius);
  const ownerLayer = state.grid.layers.owner as Int16Array;
  const terrainLayer = state.grid.layers.terrain as Uint8Array;
  const prepLayer = state.grid.layers.prep as Uint8Array;
  for (let i = 0; i < state.grid.count; i++) {
    if (hexDistance(cq, cr, hx.q[i]!, hx.r[i]!) <= radius) {
      ownerLayer[i] = colonyIndex;
      terrainLayer[i] = TERRAIN.flat;
      prepLayer[i] = PREP.prepared;
    }
  }
}

function spawnEntity(
  state: PlanetState,
  opts: {
    kind: number;
    owner: number;
    q: number;
    r: number;
    hp?: number;
    hpMax?: number;
    state?: number;
  },
): number {
  const id = state.meta.nextEntityId++;
  const row = insertRow(state.entities, id, state.meta.tick);
  const cols = state.entities.cols;
  cols.kind[row] = opts.kind;
  cols.owner[row] = opts.owner;
  placeSpawnedEntity(state.entities, row, opts.q, opts.r, state.meta.tick);
  cols.hp[row] = opts.hp ?? 500;
  cols.hpMax[row] = opts.hpMax ?? 500;
  cols.state[row] = opts.state ?? ENTITY_STATE.active;
  return id;
}

describe('W08-24 · Slider weighting formula and canonical mapping (SIM-R-03)', () => {
  it('maps all 7 canonical needs to the 5 priority sliders and defaults each slider to 50', () => {
    expect(DEFAULT_COLONY_PRIORITIES).toEqual({
      economy: 50,
      expansion: 50,
      defense: 50,
      power: 50,
      terraform: 50,
    });
    expect(Object.keys(NEED_TO_PRIORITY_KEY)).toEqual([...NEED_KEYS]);
    expect(NEED_TO_PRIORITY_KEY).toEqual({
      energy: 'power',
      storage: 'economy',
      supply: 'economy',
      extraction: 'economy',
      defense: 'defense',
      expand: 'expansion',
      repair: 'defense',
    });
  });

  it('computes exact integer formula score = floor(need * (5000 + priority * 100) / 10000)', () => {
    expect(computeSliderWeightBp(6000, 50)).toBe(6000);
    expect(computeSliderWeightBp(6000, 100)).toBe(9000);
    expect(computeSliderWeightBp(6000, 0)).toBe(3000);

    const neutral = weightColonyNeeds({ energy: 6000, storage: 6000, expand: 6000 }, { power: 50, economy: 100, expansion: 0 });
    expect(neutral.energy).toBe(6000);
    expect(neutral.storage).toBe(9000);
    expect(neutral.expand).toBe(3000);
    expect(neutral.topNeed).toBe('storage');
    expect(neutral.topScore).toBe(9000);
  });

  it('ranks weighted needs descending and breaks ties deterministically by canonical NEED_KEYS order', () => {
    const res = weightColonyNeeds(
      {
        energy: 5000,
        storage: 5000,
        supply: 5000,
        extraction: 5000,
        defense: 0,
        expand: 5000,
        repair: 0,
      },
      { power: 50, economy: 50, expansion: 50, defense: 50, terraform: 50 },
    );
    expect(res.ranked.slice(0, 5).map((r) => r.need)).toEqual([
      'energy',
      'storage',
      'supply',
      'extraction',
      'expand',
    ]);
    expect(res.top.need).toBe('energy');
  });
});

describe('W08-24 · Safety floors: repair >= 8000 bp and defense under attack >= 8000 bp', () => {
  it('Acceptance check: defense=0 with damaged structure/unit still scores repair >= 8000 bp', () => {
    const state = makeTestPlanet();
    spawnEntity(state, {
      kind: ENTITY_KIND.commandHub,
      owner: 0,
      q: 0,
      r: 0,
      hp: 750,
      hpMax: 1500,
    });

    const rawNeeds = evaluateColonyNeeds(state, 0);
    expect(rawNeeds.repair).toBeGreaterThanOrEqual(8000);

    const weighted = weightColonyNeeds(rawNeeds, {
      economy: 100,
      expansion: 100,
      power: 100,
      terraform: 100,
      defense: 0,
    });
    expect(weighted.repair).toBeGreaterThanOrEqual(REPAIR_FLOOR_BP);
    expect(weighted.scores.repair).toBeGreaterThanOrEqual(8000);
    const repairEntry = weighted.ranked.find((e) => e.need === 'repair')!;
    expect(repairEntry.floorApplied).toBe(true);

    // Even a low raw repair need (e.g. 2000 bp) with defense=0 is floored to 8000 bp
    const lowRawWeighted = weightColonyNeeds({ repair: 2000 }, { defense: 0 });
    expect(lowRawWeighted.repair).toBe(8000);
    expect(lowRawWeighted.topNeed).toBe('repair');
  });

  it('Acceptance check: defense=0 under active attack still scores defense >= 8000 bp (+1000 bp when away)', () => {
    const state = makeTestPlanet();
    spawnEntity(state, { kind: ENTITY_KIND.commandHub, owner: 0, q: 0, r: 0 });
    spawnEntity(state, { kind: ENTITY_KIND.worker, owner: 1, q: 6, r: 0, hp: 120, hpMax: 120 });

    const weighted = evaluateWeightedColonyNeeds(state, 0, {
      economy: 50,
      expansion: 50,
      power: 50,
      terraform: 50,
      defense: 0,
    });
    expect(weighted.raw.detail.hostilesWithin15).toBeGreaterThan(0);
    expect(weighted.defense).toBeGreaterThanOrEqual(DEFENSE_UNDER_ATTACK_FLOOR_BP);
    expect(weighted.scores.defense).toBe(8000);

    const awayWeighted = evaluateWeightedColonyNeeds(
      state,
      0,
      { defense: 0 },
      { away: true },
    );
    expect(awayWeighted.defense).toBe(9000);
  });
});

describe('W08-24 · Deterministic site selection (SIM-R-05 / SIM-R-06)', () => {
  it('picks the exact same (q, r, tileIndex) across 10 repeated runs for extractors and generators', () => {
    const state = makeTestPlanet();
    claimTerritoryRadiusForTest(state, 0, 0, 0, 10);
    spawnEntity(state, { kind: ENTITY_KIND.commandHub, owner: 0, q: 0, r: 0, hp: 1500, hpMax: 1500 });

    const hx = hexIndex(state.grid.radius);
    const depositLayer = state.grid.layers.deposit as Uint8Array;
    const richnessLayer = state.grid.layers.richness as Float32Array;

    const depA = hx.indexOf(4, -1);
    const depB = hx.indexOf(6, 1);
    depositLayer[depA] = DEPOSIT.metals;
    richnessLayer[depA] = 10000;
    depositLayer[depB] = DEPOSIT.metals;
    richnessLayer[depB] = 9000;

    const firstExt = selectDeterministicBuildSite(state, 0, 'metalsExtractor');
    const firstSolar = selectDeterministicBuildSite(state, 0, 'solar');
    expect(firstExt).not.toBeNull();
    expect(firstSolar).not.toBeNull();
    expect(firstExt!.q).toBe(4);
    expect(firstExt!.r).toBe(-1);
    expect(firstExt!.tileIndex).toBe(depA);

    for (let run = 0; run < 10; run++) {
      const extSite = selectDeterministicBuildSite(state, 0, 'metalsExtractor');
      const solarSite = selectDeterministicBuildSite(state, 0, 'solar');
      expect(extSite).toEqual(firstExt);
      expect(solarSite).toEqual(firstSolar);
    }
  });

  it('breaks exact score ties deterministically by lowest tileIndex', () => {
    const state = makeTestPlanet();
    claimTerritoryRadiusForTest(state, 0, 0, 0, 10);
    spawnEntity(state, { kind: ENTITY_KIND.commandHub, owner: 0, q: 0, r: 0, hp: 1500, hpMax: 1500 });

    const hx = hexIndex(state.grid.radius);
    const depositLayer = state.grid.layers.deposit as Uint8Array;
    const richnessLayer = state.grid.layers.richness as Float32Array;

    // Two symmetric deposit tiles at identical hex distance 4 from Hub (0, 0) and identical richness 10000 bp
    const northIdx = hx.indexOf(0, -4);
    const southIdx = hx.indexOf(0, 4);
    expect(northIdx).toBeLessThan(southIdx);

    depositLayer[northIdx] = DEPOSIT.metals;
    richnessLayer[northIdx] = 10000;
    depositLayer[southIdx] = DEPOSIT.metals;
    richnessLayer[southIdx] = 10000;

    const chosen = selectDeterministicBuildSite(state, 0, 'metalsExtractor');
    expect(chosen).not.toBeNull();
    expect(chosen!.tileIndex).toBe(northIdx);
    expect(chosen!.q).toBe(0);
    expect(chosen!.r).toBe(-4);
  });

  it('prefers valid buildable owned tiles around the hub (lane gap, organic 3..8 hex band) without blocking deposits', () => {
    const state = makeTestPlanet();
    claimTerritoryRadiusForTest(state, 0, 0, 0, 10);
    spawnEntity(state, { kind: ENTITY_KIND.commandHub, owner: 0, q: 0, r: 0, hp: 1500, hpMax: 1500 });

    const hx = hexIndex(state.grid.radius);
    const depositLayer = state.grid.layers.deposit as Uint8Array;
    const richnessLayer = state.grid.layers.richness as Float32Array;
    const depIdx = hx.indexOf(3, 0);
    depositLayer[depIdx] = DEPOSIT.metals;
    richnessLayer[depIdx] = 10000;

    for (const kind of ['solar', 'wind', 'depot', 'roboticsFactory']) {
      const site = selectDeterministicBuildSite(state, 0, kind);
      expect(site, `expected site for ${kind}`).not.toBeNull();
      expect(site!.distanceToHub).toBeGreaterThanOrEqual(3);
      expect(site!.distanceToHub).toBeLessThanOrEqual(8);
      expect(site!.tileIndex).not.toBe(depIdx);
    }
  });
});

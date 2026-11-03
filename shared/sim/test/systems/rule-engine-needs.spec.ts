import { describe, expect, it } from 'vitest';
import { ENTITY_KIND, ENTITY_STATE } from '../../src/ecs/columns';
import { placeSpawnedEntity } from '../../src/ecs/placement';
import { insertRow } from '../../src/ecs/store';
import { hexIndex } from '../../src/grid/hex';
import { DEPOSIT, TERRAIN } from '../../src/grid/layers';
import { ensureColonyRecord } from '../../src/kernel/colonies';
import { createState, setBlob, type PlanetState } from '../../src/kernel/state';
import { ensureColonyLedger } from '../../src/systems/economy/ledger';
import {
  evaluateColonyNeeds,
  MAX_NEED_BP,
  NEED_KEYS,
  type NeedKey,
} from '../../src/systems/rule-engine';

function makeTestPlanet(radius = 24): PlanetState {
  const state = createState({
    planetId: 'pl_needs_test',
    planetType: 'temperate',
    seed: 'w08-needs-seed',
    radius,
  });
  const col = ensureColonyRecord(state, 0, 0);
  col.status = 'active';
  ensureColonyLedger(col, { baseCap: 500 });
  return state;
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

describe('W08-23 · Rule-engine needs scoring (energy & storage acceptance)', () => {
  it('exposes the 7 canonical need keys and clamps all scores to integer 0..10000 bp', () => {
    expect(NEED_KEYS).toEqual([
      'energy',
      'storage',
      'supply',
      'extraction',
      'defense',
      'expand',
      'repair',
    ]);
    const state = makeTestPlanet();
    const res = evaluateColonyNeeds(state, 0);
    for (const key of NEED_KEYS) {
      const val = res[key];
      expect(Number.isInteger(val)).toBe(true);
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThanOrEqual(MAX_NEED_BP);
      expect(res.scores[key]).toBe(val);
    }
  });

  it('Acceptance check 1: night forecast deficit produces energy >= 6000 bp', () => {
    const state = makeTestPlanet();
    setBlob(
      state,
      'power',
      {
        byColony: {
          0: {
            colonyIndex: 0,
            hasHub: true,
            founderCorePerS: 8,
            solarGrossPerS: 21,
            solarInternalDrainPerS: 1,
            solarNetPerS: 20,
            supply: 28,
            demand: 17,
            rawDemand: 17,
            net: 11,
            brownout: false,
          },
        },
      },
      0,
    );

    const res = evaluateColonyNeeds(state, 0);
    expect(res.detail.nightNetPerS).toBeLessThan(0);
    expect(res.energy).toBeGreaterThanOrEqual(6000);
    expect(res.energy).toBeLessThanOrEqual(10000);

    const brownoutRes = evaluateColonyNeeds(state, 0, {
      supply: 8,
      rawDemand: 16,
      net: -8,
      brownout: true,
    });
    expect(brownoutRes.energy).toBeGreaterThanOrEqual(8000);
  });

  it('Acceptance check 2: storage at 90% of cap produces storage >= 5000 bp', () => {
    const state = makeTestPlanet();
    const col = ensureColonyLedger(state.colonies[0]!, { baseCap: 500 });
    col.stock['metals.t1'] = 450; // 450 / 500 = 90%
    col.stock['minerals.t1'] = 200;

    const res = evaluateColonyNeeds(state, 0);
    expect(res.detail.maxStorageRatio).toBeCloseTo(0.9, 5);
    expect(res.storage).toBeGreaterThanOrEqual(5000);
    expect(res.storage).toBeLessThanOrEqual(10000);

    col.stock['metals.t1'] = 250;
    expect(evaluateColonyNeeds(state, 0).storage).toBe(0);
  });
});

describe('W08-23 · Rule-engine needs scoring (supply, repair, defense)', () => {
  it('scores supply >= 6000 bp when supplyUsed / supplyCap >= 0.9', () => {
    const state = makeTestPlanet();
    spawnEntity(state, { kind: ENTITY_KIND.commandHub, owner: 0, q: 0, r: 0 });
    for (let i = 0; i < 9; i++) {
      spawnEntity(state, { kind: ENTITY_KIND.harvester, owner: 0, q: i + 1, r: 0 });
    }

    const res = evaluateColonyNeeds(state, 0);
    expect(res.detail.supplyUsed).toBe(9);
    expect(res.detail.supplyCap).toBe(10);
    expect(res.supply).toBeGreaterThanOrEqual(6000);
  });

  it('scores repair >= 8000 bp when a colony building or unit is damaged (hp < maxHp)', () => {
    const state = makeTestPlanet();
    spawnEntity(state, {
      kind: ENTITY_KIND.commandHub,
      owner: 0,
      q: 0,
      r: 0,
      hp: 900,
      hpMax: 1500,
    });

    const res = evaluateColonyNeeds(state, 0);
    expect(res.detail.damagedEntityCount).toBe(1);
    expect(res.repair).toBeGreaterThanOrEqual(8000);
    expect(res.repair).toBeLessThanOrEqual(10000);
  });

  it('scores defense >= 8000 bp when a hostile entity is within 15 hex tiles', () => {
    const state = makeTestPlanet();
    spawnEntity(state, { kind: ENTITY_KIND.commandHub, owner: 0, q: 0, r: 0 });
    spawnEntity(state, { kind: ENTITY_KIND.harvester, owner: 1, q: 10, r: 2, hp: 120, hpMax: 120 });

    const res = evaluateColonyNeeds(state, 0);
    expect(res.detail.hostilesWithin15).toBe(1);
    expect(res.defense).toBeGreaterThanOrEqual(8000);

    const farState = makeTestPlanet();
    spawnEntity(farState, { kind: ENTITY_KIND.commandHub, owner: 0, q: 0, r: 0 });
    spawnEntity(farState, { kind: ENTITY_KIND.harvester, owner: 1, q: 12, r: 8, hp: 120, hpMax: 120 });
    expect(evaluateColonyNeeds(farState, 0).defense).toBe(0);
  });
});

describe('W08-23 · Rule-engine needs scoring (expand, extraction, table)', () => {
  it('scores expand >= 5000 bp when free buildable owned tiles < 30 or unclaimed deposits exist nearby', () => {
    const state = makeTestPlanet();
    const hx = hexIndex(state.grid.radius);
    const ownerLayer = state.grid.layers.owner as Int8Array;
    const terrainLayer = state.grid.layers.terrain as Uint8Array;
    const depositLayer = state.grid.layers.deposit as Uint8Array;

    let claimed = 0;
    for (let i = 0; i < state.grid.count && claimed < 12; i++) {
      terrainLayer[i] = TERRAIN.flat;
      ownerLayer[i] = 0;
      claimed++;
    }
    const nearIdx = hx.indexOf(8, 0);
    if (nearIdx >= 0) depositLayer[nearIdx] = DEPOSIT.metals;

    const res = evaluateColonyNeeds(state, 0);
    expect(res.detail.freeBuildableOwnedTiles).toBeLessThan(30);
    expect(res.expand).toBeGreaterThanOrEqual(5000);
  });

  it('scores extraction >= 5000 bp when missing an extractor or running low resource income/stock', () => {
    const state = makeTestPlanet();
    const col = ensureColonyLedger(state.colonies[0]!, { baseCap: 500 });
    col.stock['metals.t1'] = 120;
    col.stock['minerals.t1'] = 100;

    const missingExtRes = evaluateColonyNeeds(state, 0);
    expect(missingExtRes.detail.extractorCount).toBe(0);
    expect(missingExtRes.extraction).toBeGreaterThanOrEqual(5000);

    spawnEntity(state, { kind: ENTITY_KIND.metalsExtractor, owner: 0, q: 2, r: 0 });
    const deficitRes = evaluateColonyNeeds(state, 0, {
      resourceIncomePerS: 1.0,
      resourceSpendPerS: 3.5,
    });
    expect(deficitRes.extraction).toBeGreaterThanOrEqual(5000);

    const table: Array<{ need: NeedKey; minBp: number; actual: number }> = [
      { need: 'energy', minBp: 6000, actual: evaluateColonyNeeds(state, 0, { nightNetPerS: -5 }).energy },
      { need: 'storage', minBp: 5000, actual: evaluateColonyNeeds(state, 0, { storageFillRatio: 0.9 }).storage },
      { need: 'supply', minBp: 6000, actual: evaluateColonyNeeds(state, 0, { supplyUsed: 9, supplyCap: 10 }).supply },
      { need: 'extraction', minBp: 5000, actual: missingExtRes.extraction },
      { need: 'defense', minBp: 8000, actual: evaluateColonyNeeds(state, 0, { hostilesWithin15: 2 }).defense },
      { need: 'expand', minBp: 5000, actual: evaluateColonyNeeds(state, 0, { freeBuildableOwnedTiles: 10 }).expand },
      { need: 'repair', minBp: 8000, actual: evaluateColonyNeeds(state, 0, { damagedEntities: 1, minHpRatio: 0.6 }).repair },
    ];
    for (const row of table) {
      expect(row.actual, `expected ${row.need} >= ${row.minBp}`).toBeGreaterThanOrEqual(row.minBp);
    }
  });
});

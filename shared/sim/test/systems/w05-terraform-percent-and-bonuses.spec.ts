import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import {
  colonyTerraformStats,
  createRegistryPipeline,
  createState,
  DEPOSIT,
  ensureColonyLedger,
  ENTITY_KIND,
  ENTITY_STATE,
  getExtractorLivingBonus,
  groundMoveMultiplierBp,
  hexDistance,
  hexIndex,
  insertRow,
  isExtractorAdjacentToLiving,
  placeMetalsExtractor,
  placeWaterExtractor,
  PREP,
  rowOf,
  setTileDeposit,
  setTileHeight,
  setTileOwner,
  setTilePrep,
  setTileTerrain,
  spawnTerraformerUnit,
  step,
  syncColonyTerraformStats,
  TERRAIN,
  type ColonyTerraformStats,
  type ExtractorLivingBonusRecord,
} from '../../src';

describe('W05-10 · Terraform % calculation', () => {
  it('Acceptance (Terraform %): 10 Living of 412 owned (excluding unreclaimed Deep Water and Ridge/Moat) -> 2.4 %', () => {
    const state = createState({ planetId: 'p-w05-10-pct', planetType: 'temperate', seed: 'w05-10', radius: 15 });
    const colony = ensureColonyLedger({
      index: 0,
      id: 'col-0',
      name: 'Alpha',
      color: 0xff6b00,
      status: 'active',
      changedAt: 0,
    });
    state.colonies.push(colony);

    let eligibleCount = 0;
    let livingCount = 0;
    let deepCount = 0;
    let ridgeCount = 0;
    let moatCount = 0;

    for (let i = 0; i < state.grid.count; i++) {
      if (eligibleCount < 412) {
        setTileOwner(state.grid, i, 0, 0);
        setTileTerrain(state.grid, i, TERRAIN.flat, 0);
        setTilePrep(state.grid, i, livingCount < 10 ? PREP.living : PREP.prepared, 0);
        if (livingCount < 10) livingCount++;
        eligibleCount++;
      } else if (deepCount < 8) {
        setTileOwner(state.grid, i, 0, 0);
        setTileTerrain(state.grid, i, TERRAIN.deep, 0);
        setTilePrep(state.grid, i, PREP.wild, 0);
        deepCount++;
      } else if (ridgeCount < 5) {
        setTileOwner(state.grid, i, 0, 0);
        setTileTerrain(state.grid, i, TERRAIN.flat, 0);
        setTilePrep(state.grid, i, PREP.ridge, 0);
        ridgeCount++;
      } else if (moatCount < 4) {
        setTileOwner(state.grid, i, 0, 0);
        setTileTerrain(state.grid, i, TERRAIN.flat, 0);
        setTilePrep(state.grid, i, PREP.moat, 0);
        moatCount++;
      }
    }

    const stats = syncColonyTerraformStats(state, 0, 1);
    expect(stats).toEqual({
      livingTiles: 10,
      eligibleOwnedTiles: 412,
      percent: 2.4,
    });
    expect(colonyTerraformStats(state, 0).percent).toBe(2.4);
    expect((colony as { terraform?: ColonyTerraformStats }).terraform?.percent).toBe(2.4);
  });
});

describe('W05-10 · Living adjacency extractor bonus (+5 %)', () => {
  it('Acceptance (Extractor Living bonus): an extractor next to Living reads +5 % and produces 1.05x output', () => {
    const state = createState({ planetId: 'p-w05-10-ext', planetType: 'temperate', seed: 'w05-10-ext', radius: 8 });
    const pipeline = createRegistryPipeline({ flags: parseWaves('..05') });
    const idx = hexIndex(state.grid.radius);

    for (let i = 0; i < state.grid.count; i++) {
      setTileOwner(state.grid, i, 0, 0);
      setTileTerrain(state.grid, i, TERRAIN.flat, 0);
      setTilePrep(state.grid, i, PREP.prepared, 0);
      setTileHeight(state.grid, i, 0, 0);
    }

    setTileDeposit(state, idx.indexOf(1, 1), DEPOSIT.metals, 10000, 0);
    const placedMetals = placeMetalsExtractor(state, { owner: 0, q: 1, r: 1 });
    expect(placedMetals.ok).toBe(true);
    if (!placedMetals.ok) throw new Error('expected metals extractor placement to succeed');

    const placedWater = placeWaterExtractor(state, { owner: 0, q: -3, r: -2 });
    expect(placedWater.ok).toBe(true);
    if (!placedWater.ok) throw new Error('expected water extractor placement to succeed');

    for (let s = 0; s < 3; s++) {
      const solarRow = insertRow(state.entities, state.meta.nextEntityId++, 0);
      state.entities.cols.kind[solarRow] = ENTITY_KIND.solar;
      state.entities.cols.owner[solarRow] = 0;
      state.entities.cols.hp[solarRow] = 200;
      state.entities.cols.hpMax[solarRow] = 200;
      state.entities.cols.state[solarRow] = ENTITY_STATE.active;
    }

    expect(isExtractorAdjacentToLiving(state, 1, 1, 2, 2, 0)).toBe(false);
    expect(getExtractorLivingBonus(state, 1, 1, 2, 2, 0)).toEqual({
      adjacentToLiving: false,
      bonus: 0,
      mult: 1,
      label: '0 %',
    });

    step(state, [], 5, pipeline);
    const colony = ensureColonyLedger(state.colonies[0]!);
    expect(colony.stock['metals.t1']).toBeCloseTo(1.0, 5);
    expect(colony.production.incomePerS['metals.t1']).toBeCloseTo(1.0, 4);
    expect(colony.production.extractors?.[placedMetals.entityId]?.livingBonusText).toBe('0 %');

    setTilePrep(state.grid, idx.indexOf(0, 1), PREP.living, state.meta.tick);
    setTilePrep(state.grid, idx.indexOf(-4, -2), PREP.living, state.meta.tick);

    expect(isExtractorAdjacentToLiving(state, 1, 1, 2, 2, 0)).toBe(true);
    expect(getExtractorLivingBonus(state, 1, 1, 2, 2, 0)).toEqual({
      adjacentToLiving: true,
      bonus: 0.05,
      mult: 1.05,
      label: '+5 %',
    });

    const prevMetals = colony.stock['metals.t1'];
    const prevWater = colony.stock['bio.water'];
    step(state, [], 5, pipeline);

    expect(colony.stock['metals.t1'] - prevMetals).toBeCloseTo(1.05, 5);
    expect(colony.production.incomePerS['metals.t1']).toBeCloseTo(1.05, 4);
    expect(colony.production.extractors?.[placedMetals.entityId]).toMatchObject({
      entityId: placedMetals.entityId,
      adjacentToLiving: true,
      livingBonus: 0.05,
      livingBonusText: '+5 %',
      ratePerS: 1.05,
    });
    expect(
      (colony as { extractorBonuses?: Record<number, ExtractorLivingBonusRecord> }).extractorBonuses?.[
        placedMetals.entityId
      ]?.livingBonusText,
    ).toBe('+5 %');
    expect(colony.stock['bio.water'] - prevWater).toBeCloseTo(0.875 * 1.05, 5);
    expect(colony.production.extractors?.[placedWater.entityId]?.livingBonusText).toBe('+5 %');
  });
});

function measureGroundMoveDistance(prepState: number): number {
  const pipeline = createRegistryPipeline({ flags: parseWaves('..05') });
  const state = createState({ planetId: `p-move-${prepState}`, planetType: 'temperate', seed: 'move', radius: 12 });
  const colony = ensureColonyLedger({
    index: 0,
    id: 'col-0',
    name: 'Alpha',
    color: 0xff6b00,
    status: 'active',
    changedAt: 0,
  });
  colony.powerSupplyOverride = 100;
  state.colonies.push(colony);

  for (let i = 0; i < state.grid.count; i++) {
    setTileOwner(state.grid, i, 0, 0);
    setTileTerrain(state.grid, i, TERRAIN.flat, 0);
    setTilePrep(state.grid, i, prepState, 0);
    setTileHeight(state.grid, i, 0, 0);
  }

  const unitId = spawnTerraformerUnit(state, { owner: 0, q: -5, r: 0 });
  step(
    state,
    [
      {
        commandId: 'cmd-move',
        colonyIndex: 0,
        source: 'player',
        kind: 'moveUnit',
        args: { entityId: unitId, q: 5, r: 0 },
      },
    ],
    10,
    pipeline,
  );

  const uRow = rowOf(state.entities, unitId);
  return hexDistance(-5, 0, state.entities.cols.x[uRow]!, state.entities.cols.y[uRow]!);
}

describe('W05-10 · Living ground move speed bonus (+10 %)', () => {
  it('Ground unit moving across PREP.living tiles advances +10 % faster (1.1x) than across PREP.prepared tiles', () => {
    const tempState = createState({ planetId: 'p-bp', planetType: 'temperate', seed: 'bp', radius: 3 });
    setTilePrep(tempState.grid, 0, PREP.living, 0);
    expect(groundMoveMultiplierBp(tempState.grid, 0)).toBe(11000);

    const distPrepared = measureGroundMoveDistance(PREP.prepared);
    const distLiving = measureGroundMoveDistance(PREP.living);
    expect(distPrepared).toBeGreaterThan(0);
    expect(distLiving / distPrepared).toBeCloseTo(1.1, 4);
  });
});

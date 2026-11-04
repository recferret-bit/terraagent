import { describe, expect, it } from 'vitest';
import {
  EVENT_KINDS,
  parseWaves,
  TerraformOp,
  W05_NEW_TERRAFORM_OPS,
} from '@terra/contracts';
import {
  compileData,
  dataRow,
  getTerraformOpSpec,
  listTerraformMenuOps,
  PREP,
  TERRAIN,
} from '../../src';

describe('W05-01 menu op wave gating & op specs', () => {
  it('TA_WAVES=..04 -> menu data lists only Grade/Clear/Break and omits W05 rows', () => {
    const compiled = compileData(parseWaves('..04'));
    const ops = listTerraformMenuOps(compiled).map((s) => s.op);
    expect(ops).toEqual(['grade', 'clear', 'break']);
    expect(Object.keys(compiled.tables.terraform ?? {})).toHaveLength(0);
    expect(compiled.tables.unitsWorkersBasic?.terraformer).toBeUndefined();
  });

  it('TA_WAVES=..05 -> menu data lists all 6 new ops (level, fill, reclaim, deepReclaim, irrigate, seed)', () => {
    const compiled = compileData(parseWaves('..05'));
    const ops = listTerraformMenuOps(compiled).map((s) => s.op);
    expect(ops).toEqual([
      'grade',
      'clear',
      'break',
      'level',
      'fill',
      'reclaim',
      'deepReclaim',
      'irrigate',
      'seed',
    ]);
    for (const op of W05_NEW_TERRAFORM_OPS) {
      expect(TerraformOp.safeParse(op).success).toBe(true);
    }

    const level = getTerraformOpSpec('level', compiled);
    expect(level.baseTimeS).toBe(8);
    expect(level.energyCostE).toBe(60);
    expect(level.cost).toEqual({ 'minerals.t1': 2 });
    expect(level.fromTerrain).toBe(TERRAIN.slope);
    expect(level.toTerrain).toBe(TERRAIN.flat);
    expect(level.toPrep).toBe(PREP.flat);
    expect(level.minWorkerTier).toBe(1);

    const fill = getTerraformOpSpec('fill', compiled);
    expect(fill.baseTimeS).toBe(10);
    expect(fill.energyCostE).toBe(100);
    expect(fill.cost).toEqual({ 'metals.t1': 10, 'minerals.t1': 5 });
    expect(fill.fromTerrain).toBe(TERRAIN.hole);
    expect(fill.toTerrain).toBe(TERRAIN.flat);

    const reclaim = getTerraformOpSpec('reclaim', compiled);
    expect(reclaim.baseTimeS).toBe(14);
    expect(reclaim.energyCostE).toBe(200);
    expect(reclaim.cost).toEqual({ 'metals.t1': 20, 'minerals.t1': 10 });
    expect(reclaim.fromTerrain).toBe(TERRAIN.shallow);
    expect(reclaim.toTerrain).toBe(TERRAIN.flat);

    const deepReclaim = getTerraformOpSpec('deepReclaim', compiled);
    expect(deepReclaim.minWorkerTier).toBe(2);
    expect(deepReclaim.fromTerrain).toBe(TERRAIN.deep);
    expect(deepReclaim.toTerrain).toBe(TERRAIN.flat);

    const irrigate = getTerraformOpSpec('irrigate', compiled);
    expect(irrigate.baseTimeS).toBe(10);
    expect(irrigate.energyCostE).toBe(80);
    expect(irrigate.cost).toEqual({ 'bio.water': 15 });
    expect(irrigate.desertWaterMult).toBe(2);
    expect(irrigate.fromPrep).toBe(PREP.prepared);
    expect(irrigate.toPrep).toBe(PREP.irrigated);

    const seed = getTerraformOpSpec('seed', compiled);
    expect(seed.baseTimeS).toBe(15);
    expect(seed.energyCostE).toBe(90);
    expect(seed.cost).toEqual({ 'bio.water': 10, 'minerals.t1': 5 });
    expect(seed.fromPrep).toBe(PREP.irrigated);
    expect(seed.toPrep).toBe(PREP.living);
  });
});

describe('W05-01 Terraformer unit row, building rows, resource-tier gate rows, and events', () => {
  it('includes Terraformer unit row, W05 building rows, resource-tier gate rows, and W05 events', () => {
    const compiled = compileData(parseWaves('..05'));
    const tfUnit = dataRow(compiled, 'unitsWorkersBasic', 'terraformer');
    expect(tfUnit.workRate).toBe(1.0);
    expect(tfUnit.powerDrainPerS).toBe(2.5);
    expect(tfUnit.lanes).toEqual(['terraform']);

    expect(dataRow(compiled, 'terraform', 'territoryBeacon').claimRadius).toBe(8);
    expect(dataRow(compiled, 'terraform', 'hydro').requiresAdjacentWater).toBe(true);
    expect(dataRow(compiled, 'terraform', 'hazardShield').shieldRadius).toBe(8);
    expect(dataRow(compiled, 'terraform', 'lightningRod').protectRadius).toBe(6);

    const t2Gate = dataRow(compiled, 'terraform', 'tier2Gate');
    expect(t2Gate.minTerraformPct).toBe(30);
    expect(t2Gate.ringRadius).toBe(2);
    expect(t2Gate.minRingTerraformedRatio).toBe(0.5);
    expect(t2Gate.t1Share).toBe(0.7);
    expect(t2Gate.t2Share).toBe(0.3);

    const t3Gate = dataRow(compiled, 'terraform', 'tier3Gate');
    expect(t3Gate.minTerraformPct).toBe(70);
    expect(t3Gate.ringRadius).toBe(2);
    expect(t3Gate.minRingLivingRatio).toBe(0.5);
    expect(t3Gate.t1Share).toBe(0.5);
    expect(t3Gate.t2Share).toBe(0.3);
    expect(t3Gate.t3Share).toBe(0.2);

    expect(EVENT_KINDS).toEqual(
      expect.arrayContaining([
        'tileStateChanged',
        'territoryClaimed',
        'borderFrozen',
        'territoryReverting',
        'lightningStrike',
        'meteorImpact',
        'stormStarted',
        'stormEnded',
        'tierUnlocked',
      ]),
    );
  });
});

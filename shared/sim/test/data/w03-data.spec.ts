import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import { compileData, dataRow } from '../../src/data';
import { resolveItemUnlockStage } from '../../src/systems/progression/validate';

describe('W03-01 data rows: grid table (Builder + 8 W03 buildings + queueConfig)', () => {
  it('compiles out all W03 rows when wave set is ..02', () => {
    const compiled = compileData(parseWaves('..02'));
    expect(Object.keys(compiled.tables.grid ?? {})).toHaveLength(0);
    expect(compiled.tables.unitsWorkersBasic.t2).toBeUndefined();
  });

  it('includes Builder and all 8 W03 building rows when W03 is enabled', () => {
    const compiled = compileData(parseWaves('..03'));

    // Worker Drone T2 (12s -> 60 ticks, speed 1.5 t/s -> 0.3 t/tick, workRate 1.0, repairRateMultiplier 1.5, maxBuildTier 2)
    const t2 = dataRow(compiled, 'unitsWorkersBasic', 't2');
    expect(t2.buildS).toBe(60);
    expect(t2.workRate).toBe(1.0);
    expect(t2.repairRateMultiplier).toBe(1.5);
    expect(t2.maxBuildTier).toBe(2);
    expect(t2.tier).toBe(2);
    expect(t2.label).toBe('Worker Drone T2');
    expect(t2.powerDrainPerS).toBe(3);
    expect(t2.hp).toBe(150);

    // Pylon T1 (4s -> 20 ticks, power zone radius 5 (Hub 6), maxLoadPerS 80)
    const pylon = dataRow(compiled, 'grid', 'pylon');
    expect(pylon.buildS).toBe(20);
    expect(pylon.powerZoneRadius).toBe(5);
    expect(dataRow(compiled, 'hub', 't1').powerZoneRadius).toBe(6);
    expect(pylon.maxLoadPerS).toBe(80);
    expect(pylon.shedGroup).toBe(4);

    // Capacitor T1 (16s -> 80 ticks, capacityE 1500, maxDischargePerS 30)
    const cap = dataRow(compiled, 'grid', 'capacitor');
    expect(cap.buildS).toBe(80);
    expect(cap.capacityE).toBe(1500);
    expect(cap.maxDischargePerS).toBe(30);
    expect(cap.powerDrainPerS).toBe(2);

    // Wind T1 (14s -> 70 ticks, gross 16, drain 1)
    const wind = dataRow(compiled, 'grid', 'wind');
    expect(wind.buildS).toBe(70);
    expect(wind.grossOutputPerS).toBe(13);
    expect(wind.internalDrainPerS).toBe(1);

    // Thermal T1 (15s -> 75 ticks, gross 28, drain 3, fuelPerS 1.5 * 0.25 = 0.375)
    const thermal = dataRow(compiled, 'grid', 'thermal');
    expect(thermal.buildS).toBe(75);
    expect(thermal.grossOutputPerS).toBe(28);
    expect(thermal.internalDrainPerS).toBe(3);
    expect(thermal.fuelPerS).toBeCloseTo(0.375, 5);
    expect(thermal.pollutionPerPlant).toBe(1);

    // Supply Depot T1 (12s -> 60 ticks, +1000 cap per family)
    const depot = dataRow(compiled, 'grid', 'supplyDepot');
    expect(depot.buildS).toBe(60);
    expect(depot.storageCapBonusPerFamily).toBe(1000);
    expect(depot.shedGroup).toBe(3);

    // Minerals Quarry T1 (16s -> 80 ticks, outputPerS 3.0 * 0.25 = 0.75)
    const quarry = dataRow(compiled, 'grid', 'mineralsQuarry');
    expect(quarry.buildS).toBe(80);
    expect(quarry.requiresDeposit).toBe('minerals');
    expect(quarry.outputPerS).toBeCloseTo(0.75, 5);

    // Water Extractor T1 (15s -> 75 ticks, outputPerS 3.5 * 0.25 = 0.875, desertOutputMult 0.5)
    const water = dataRow(compiled, 'grid', 'waterExtractor');
    expect(water.buildS).toBe(75);
    expect(water.outputPerS).toBeCloseTo(0.875, 5);
    expect(water.desertOutputMult).toBe(0.5);

    // Petroleum Well T1 (20s -> 100 ticks, outputPerS 2.5 * 0.25 = 0.625, requiresDeposit 'oil')
    const well = dataRow(compiled, 'grid', 'petroleumWell');
    expect(well.buildS).toBe(100);
    expect(well.requiresDeposit).toBe('oil');
    expect(well.outputPerS).toBeCloseTo(0.625, 5);
  });

  it('each placeable grid row unlockStage equals the stage table placement reads', () => {
    const compiled = compileData(parseWaves('..03'));
    const expected: Record<string, number> = {
      pylon: 2,
      capacitor: 2,
      wind: 2,
      thermal: 3,
      supplyDepot: 2,
      waterExtractor: 2,
      petroleumWell: 2,
    };
    for (const [id, stage] of Object.entries(expected)) {
      const row = dataRow(compiled, 'grid', id);
      expect(row.unlockStage).toBe(stage);
      expect(resolveItemUnlockStage(String(row.building))).toBe(stage);
    }
    expect(dataRow(compiled, 'economyT1Basic', 'metalsExtractor').unlockStage).toBe(1);
    expect(dataRow(compiled, 'economyT1Basic', 'solar').unlockStage).toBe(1);
  });
});

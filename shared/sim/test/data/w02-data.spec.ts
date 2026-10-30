import { describe, expect, it } from 'vitest';
import { parseWaves, RESOURCE_FAMILY_OF, RESOURCE_KEYS } from '@terra/contracts';
import { compileData, dataRow } from '../../src/data';

describe('W02-01 data rows: resources, economyT1Basic, unitsWorkersBasic', () => {
  it('compiles out all W02 rows when wave set is ..01', () => {
    const compiled = compileData(parseWaves('..01'));
    expect(Object.keys(compiled.tables.resources ?? {})).toHaveLength(0);
    expect(Object.keys(compiled.tables.economyT1Basic ?? {})).toHaveLength(0);
    expect(Object.keys(compiled.tables.unitsWorkersBasic ?? {})).toHaveLength(0);
  });

  it('includes all W02 rows and converts design units when W02 is enabled', () => {
    const compiled = compileData(parseWaves('..02'));

    // 10 ResourceKey rows with matching family and tier
    expect(Object.keys(compiled.tables.resources)).toHaveLength(10);
    for (const key of RESOURCE_KEYS) {
      const row = dataRow(compiled, 'resources', key);
      expect(row.family).toBe(RESOURCE_FAMILY_OF[key]);
      expect([1, 2, 3]).toContain(row.tier);
    }

    // Metals Extractor T1 (14s -> 70 ticks) & Solar T1 (18s -> 90 ticks)
    const extractor = dataRow(compiled, 'economyT1Basic', 'metalsExtractor');
    expect(extractor.buildS).toBe(70);
    expect(extractor.powerDrainPerS).toBe(6);
    expect(extractor.hp).toBe(500);
    expect(extractor.requiresDeposit).toBe('metals');

    const solar = dataRow(compiled, 'economyT1Basic', 'solar');
    expect(solar.buildS).toBe(90);
    expect(solar.grossOutputPerS).toBe(21);
    expect(solar.internalDrainPerS).toBe(1);
    expect(solar.desertBonusMult).toBe(1.35);

    // Shed groups 1..4 and dayCycle (20 min = 1200s -> 6000 ticks)
    for (const g of [1, 2, 3, 4]) {
      expect(dataRow(compiled, 'economyT1Basic', `shedGroup${g}`).group).toBe(g);
    }
    const dayCycle = dataRow(compiled, 'economyT1Basic', 'dayCycle');
    expect(dayCycle.dayLengthS).toBe(6000);
    expect((dayCycle.nightShareByPlanetType as Record<string, number>).temperate).toBe(0.45);

    // Harvester T1 (10s -> 50 ticks, speed 1.5 t/s -> 0.3 t/tick)
    const harvester = dataRow(compiled, 'unitsWorkersBasic', 'harvester');
    expect(harvester.buildS).toBe(50);
    expect(harvester.supply).toBe(1);
    expect(harvester.powerDrainPerS).toBe(1.5);
    expect(harvester.hp).toBe(160);
    expect(harvester.speedTilesPerS).toBeCloseTo(0.3, 5);
    expect(harvester.viewRadius).toBe(7);
    expect(harvester.radius).toBe(0.4);
  });
});

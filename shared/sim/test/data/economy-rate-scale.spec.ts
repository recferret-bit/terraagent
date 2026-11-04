import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import { compileData, dataRow, ECONOMY_RATE_SCALE } from '../../src/data';

describe('W02-03 ECONOMY_RATE_SCALE in compileData', () => {
  it('defaults ECONOMY_RATE_SCALE to 0.25 and scales resource flow rates only (not solar or costs)', () => {
    expect(ECONOMY_RATE_SCALE).toBe(0.25);

    const compiled = compileData(parseWaves('..02'), { economyRateScale: 0.25 });
    const extractor = dataRow(compiled, 'economyT1Basic', 'metalsExtractor');
    const solar = dataRow(compiled, 'economyT1Basic', 'solar');
    const harvester = dataRow(compiled, 'unitsWorkersBasic', 'harvester');

    // Acceptance check: Extractor outputPerS is 1.0, Solar grossOutputPerS is still 14
    expect(extractor.outputPerS).toBe(1.0);
    expect(extractor.designOutputPerS).toBe(4.0);
    expect(solar.grossOutputPerS).toBe(14);
    expect(solar.netOutputPerS).toBe(13);
    expect(solar.internalDrainPerS).toBe(1);

    // Harvester standing harvest rate (2.0 -> 0.5 res/s)
    expect(harvester.harvestRatePerS).toBe(0.5);
    expect(harvester.designHarvestRatePerS).toBe(2.0);

    // Costs remain untouched
    expect(extractor.cost).toEqual({
      'metals.t1': 65,
      'minerals.t1': 20,
      'bio.biomass': 0,
      'bio.water': 10,
    });
    expect(solar.cost).toEqual({
      'metals.t1': 60,
      'minerals.t1': 75,
      'bio.biomass': 10,
      'bio.water': 5,
    });
  });

  it('supports custom economyRateScale override in compileData', () => {
    const unscaled = compileData(parseWaves('..02'), { economyRateScale: 1.0 });
    expect(dataRow(unscaled, 'economyT1Basic', 'metalsExtractor').outputPerS).toBe(4.0);
    expect(dataRow(unscaled, 'unitsWorkersBasic', 'harvester').harvestRatePerS).toBe(2.0);
    expect(dataRow(unscaled, 'economyT1Basic', 'solar').grossOutputPerS).toBe(14);
  });
});

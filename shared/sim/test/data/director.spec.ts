import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import { compileData, dataRow } from '../../src/data';

describe('W16-01 director data rows', () => {
  it('drops the table when W16 is off', () => {
    expect(compileData(parseWaves('..15')).tables.director).toEqual({});
  });

  it('keeps the spec defaults in design units when W16 is on', () => {
    const compiled = compileData(parseWaves('..16'));
    expect(dataRow(compiled, 'director', 'conservative').reserveFloorBp).toBe(4000);
    expect(dataRow(compiled, 'director', 'conservative').commitBp).toBe(1500);
    expect(dataRow(compiled, 'director', 'risky').reserveFloorBp).toBe(1500);
    expect(dataRow(compiled, 'director', 'risky').commitBp).toBe(3500);
    expect(dataRow(compiled, 'director', 'risky').combatThresholdMilli).toBe(900);
    expect(dataRow(compiled, 'director', 'cadence').normalIntervalS).toBe(300);
    expect(dataRow(compiled, 'director', 'cadence').criticalIntervalS).toBe(120);
    expect(dataRow(compiled, 'director', 'budget').globalTokensPerDay).toBe(20_000_000);
    expect(dataRow(compiled, 'director', 'budget').pendingCap).toBe(512);
    expect(dataRow(compiled, 'director', 'retention').rawDays).toBe(14);
  });
});

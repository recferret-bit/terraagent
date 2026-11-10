import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import { compileData, dataRow } from '../../src/data';

describe('W22-01 treasury data rows', () => {
  it('drops project and vote rows when W22 is off', () => {
    const off = compileData(parseWaves('..21'));
    expect(off.tables.treasury).toEqual({});
    expect(off.tables.treasuryPolicy).toEqual({});
  });

  it('keeps the proposed project costs and the 6 h vote window when W22 is on', () => {
    const on = compileData(parseWaves('..22'));
    expect(dataRow(on, 'treasury', 'meteor_shield')).toMatchObject({ durationH: 6, magnitudeBp: 7500, cost: 1500, visits: 0 });
    expect(dataRow(on, 'treasury', 'terraform_boost')).toMatchObject({ durationH: 12, magnitudeBp: 2500, cost: 1000 });
    expect(dataRow(on, 'treasury', 'guild_subsidy')).toMatchObject({ durationH: 0, magnitudeBp: 0, cost: 800, visits: 1 });
    expect(dataRow(on, 'treasuryPolicy', 'vote')).toMatchObject({ proposalTtlH: 6, passAboveBp: 5000, passMinYes: 2 });
    expect(dataRow(on, 'treasuryPolicy', 'hazard')).toMatchObject({ intervalTicks: 180, baseStrikeBp: 10000 });
    expect(dataRow(on, 'market', 'policy').treasuryShareBp).toBe(2000);
  });

  it('rejects a fractional project cost', () => {
    expect(() => compileData(parseWaves('..22'), { treasury: { meteor_shield: { cost: 1.5 } } })).toThrow();
  });
});

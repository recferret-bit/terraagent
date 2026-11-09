import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import { compileData, dataRow } from '../../src/data';

/** AW-20 / AW-21. The same numbers are `AWAY_*` in `@terra/contracts` (`notify/limits.ts`). */

describe('W09-01 away defaults row', () => {
  it('publishes the AW-20 percents and the policy version when W09 is on', () => {
    const row = dataRow(compileData(parseWaves('..09')), 'away', 'defaults');
    expect(row.perDirectivePct).toBe(40);
    expect(row.perSessionPct).toBe(60);
    expect(row.policyVersion).toBe(1);
  });

  it('drops the row when the wave is off', () => {
    const tables = compileData(parseWaves('..08')).tables as { away?: Record<string, unknown> };
    expect(tables.away?.defaults).toBeUndefined();
  });

  it('rejects a tune of the snapshot policy version', () => {
    expect(() => compileData(parseWaves('all'), { away: { defaults: { policyVersion: 2 } } })).toThrow(/fixed|policyVersion/i);
  });
});

import { describe, expect, it } from 'vitest';
import { parseWaves, T1_RESOURCE_KEYS } from '@terra/contracts';
import { compileData, dataRow } from '../../src/data';

describe('W01-01 data rows: terrain, opsBasic, hq, hub', () => {
  it('compiles out all W01 rows when wave set is ..00', () => {
    const compiled = compileData(parseWaves('..00'));
    expect(Object.keys(compiled.tables.terrain ?? {})).toHaveLength(0);
    expect(Object.keys(compiled.tables.opsBasic ?? {})).toHaveLength(0);
    expect(Object.keys(compiled.tables.hq ?? {})).toHaveLength(0);
    expect(Object.keys(compiled.tables.hub ?? {})).toHaveLength(0);
  });

  it('includes W01 rows and converts design units to ticks when W01 is enabled', () => {
    const compiled = compileData(parseWaves('..01'));
    expect(Object.keys(compiled.tables.terrain)).toEqual(
      expect.arrayContaining(['flat', 'forest', 'rock', 'slope', 'hole', 'shallow', 'deep', 'temperate']),
    );
    expect(dataRow(compiled, 'terrain', 'temperate').livingMoveMult).toBe(1.1);
    expect(dataRow(compiled, 'worldgen', 'temperate').mineralsRichnessModBp).toBe(11500);

    // Grade: 3s -> 15 ticks (at 200ms/tick), Clear: 5s -> 25 ticks, Break: 6s -> 30 ticks
    expect(dataRow(compiled, 'opsBasic', 'grade').timeS).toBe(15);
    expect(dataRow(compiled, 'opsBasic', 'clear').timeS).toBe(25);
    expect(dataRow(compiled, 'opsBasic', 'break').timeS).toBe(30);

    // HQ T1 & starting kit (only T1 keys > 0)
    const hq = dataRow(compiled, 'hq', 't1');
    expect(hq.hp).toBe(900);
    expect(hq.workRate).toBe(1.5);
    expect(hq.cellCapacity).toBe(800);

    const kit = dataRow(compiled, 'hq', 'startingKit');
    expect(kit.podDescentS).toBe(30); // 6s -> 30 ticks
    const cargo = kit.cargo as Record<string, number>;
    for (const [k, v] of Object.entries(cargo)) {
      if ((T1_RESOURCE_KEYS as readonly string[]).includes(k)) expect(v).toBeGreaterThan(0);
      else expect(v).toBe(0);
    }

    // Command Hub T1: 30s -> 150 ticks
    const hub = dataRow(compiled, 'hub', 't1');
    expect(hub.buildS).toBe(150);
    expect(hub.claimRadius).toBe(10);
    expect(hub.storageCapPerFamily).toBe(500);
    expect(hub.supplyCap).toBe(10);
    expect(hub.founderCoreGenPerS).toBe(16);
  });
});

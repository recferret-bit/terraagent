import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import { allTables, compileData, compileTables, dataRow, defineTable, tune, type PlanetTuning } from '../../src';

const flags = new Set(['W00', 'W01']);
const cargo = dataRow(compileData(flags), 'hq', 'startingKit').cargo as Record<string, number>;

describe('resource amounts in data are whole, non-negative units (TableDef.amounts)', () => {
  it('every shipped table compiles; hq, hub, opsBasic, prestige, regions and tradeHub declare their amount fields', () => {
    expect(() => compileData(flags)).not.toThrow();
    const declared = Object.fromEntries(allTables().filter((t) => t.amounts).map((t) => [t.name, t.amounts]));
    expect(declared).toEqual({
      hq: ['cargo'],
      hub: ['cost', 'storageCapPerFamily'],
      logistics: ['consumption'],
      opsBasic: ['yields'],
      prestige: ['cost'],
      regions: ['reserveUnitsMin', 'reserveUnitsMax', 'starterGuarantee', 'renewableUnitsPerSimHour'],
      tradeHub: ['cost', 'dailyMintCapPerResource'],
    });
  });

  it('rejects a fractional cargo override (the landing repro) with the exact place and value', () => {
    expect(() => compileData(flags, { hq: { startingKit: { cargo: { ...cargo, 'metals.t1': 600.5 } } } })).toThrow(
      "balance override hq.startingKit.cargo['metals.t1']: resource amounts are whole, non-negative units, got 600.5",
    );
  });

  it('rejects fractional or negative costs and yields, and unknown resource keys', () => {
    expect(() => compileData(flags, { hub: { t1: { cost: { 'metals.t1': 200.5 } } } })).toThrow(/hub\.t1\.cost\['metals\.t1'\].*got 200\.5/);
    expect(() => compileData(flags, { hub: { t1: { cost: { gold: 5 } } } })).toThrow('balance override hub.t1.cost: unknown resource "gold"');
    expect(() => compileData(flags, { opsBasic: { break: { yields: { 'metals.t1': 10.5 } } } })).toThrow(/opsBasic\.break\.yields\['metals\.t1'\]: .*got 10\.5/);
    expect(() => compileData(flags, { opsBasic: { clear: { yields: { 'bio.biomass': -1 } } } })).toThrow(/got -1/);
    expect(() => compileData(flags, { hub: { t1: { storageCapPerFamily: 499.9 } } })).toThrow(/storageCapPerFamily/);
    // Whole amounts and other fields stay tunable.
    expect(dataRow(compileData(flags, { opsBasic: { break: { yields: { 'metals.t1': 25 } } } }), 'opsBasic', 'break').yields).toEqual({ 'metals.t1': 25 });
    expect(() => compileData(flags, { hq: { startingKit: { cargo: { ...cargo, 'metals.t1': 0 } } } })).not.toThrow();
  });

  it('checks base rows too (a table file with a bad amount fails to compile), also rows of disabled waves', () => {
    const t = (rows: object[]) => defineTable({ name: 'fx', summary: 'test', amounts: ['cost', 'gain'], rows: rows as never });
    const run = (rows: object[]) => () => compileTables({ flags: new Set(['W00']), tables: [t(rows)] });
    expect(run([{ id: 'a', wave: 'W00', cost: { 'metals.t1': 3 }, gain: 2, label: 1.5 }])).not.toThrow();
    expect(run([{ id: 'a', wave: 'W00', cost: null, gain: null }])).not.toThrow();
    expect(run([{ id: 'a', wave: 'W07', cost: { 'metals.t1': 0.25 } }])).toThrow("data fx.a.cost['metals.t1']: resource amounts are whole, non-negative units, got 0.25");
    expect(run([{ id: 'a', wave: 'W00', gain: 1.5 }])).toThrow('data fx.a.gain: resource amounts are whole, non-negative units, got 1.5');
    expect(run([{ id: 'a', wave: 'W00', cost: [1, 2] }])).toThrow(/fx\.a\.cost: .*a number or a resource map/);
    expect(run([{ id: 'a', wave: 'W00', cost: 'lots' }])).toThrow(/fx\.a\.cost: .*got "lots"/);
  });

  it('dev `tune` refuses a fractional amount and leaves the planet tuning untouched', () => {
    const t: PlanetTuning = { flags: parseWaves('..01').list as string[], base: {}, live: {} };
    expect(() => tune(t, { op: 'set', path: 'opsBasic.break.yields', value: '{"metals.t1":10.5}' })).toThrow(/opsBasic\.break\.yields\['metals\.t1'\]: resource amounts are whole/);
    expect(() => tune(t, { op: 'set', path: 'hq.startingKit.cargo', value: JSON.stringify({ ...cargo, 'bio.water': 0.5 }) })).toThrow(/cargo\['bio\.water'\]/);
    expect(t.live).toEqual({});
    expect(tune(t, { op: 'set', path: 'opsBasic.break.yields', value: '{"metals.t1":12}' }).next?.live).toEqual({ opsBasic: { break: { yields: { 'metals.t1': 12 } } } });
  });
});

import { describe, expect, it } from 'vitest';
import { compileData, compileTables, createEngineConfig, dataRow, defineTable } from '../../src';

const later = defineTable({
  name: 'fixture',
  summary: 'test',
  units: { buildS: 'seconds' },
  rows: [
    { id: 'a', wave: 'W00', buildS: 30 },
    { id: 'b', wave: 'W01', buildS: 10 },
    { id: 'c', wave: 'W07', buildS: 1 },
  ],
});

describe('compileData', () => {
  it('drops rows of disabled waves (..00 keeps only W00)', () => {
    const d = compileTables({ flags: new Set(['W00']), tables: [later] });
    expect(Object.keys(d.tables.fixture)).toEqual(['a']);
    const all = compileTables({ flags: new Set(['W00', 'W01', 'W07']), tables: [later] });
    expect(Object.keys(all.tables.fixture)).toEqual(['a', 'b', 'c']);
    expect(all.hash).not.toBe(d.hash);
  });

  it('converts a 30 s build to 150 ticks and per-second rates to per-tick', () => {
    const d = compileData(new Set(['W00']));
    expect(dataRow(d, 'dev', 'probe')).toMatchObject({ buildS: 150, ratePerS: 0.5, nudgeTiles: 1 });
  });

  it('hash is stable and the engine config compiles data by default', () => {
    expect(compileData(new Set(['W00'])).hash).toBe(compileData(new Set(['W00'])).hash);
    expect(createEngineConfig({ flags: ['W00'] }).data.hash).toBe(compileData(new Set(['W00'])).hash);
  });

  it('refuses duplicates and non-numeric unit fields', () => {
    expect(() => compileTables({ flags: new Set(['W00']), tables: [later, later] })).toThrow(/duplicate data table/);
    const bad = defineTable({ name: 'bad', summary: '', units: { t: 'seconds' }, rows: [{ id: 'x', wave: 'W00', t: 'soon' }] });
    expect(() => compileTables({ flags: new Set(['W00']), tables: [bad] })).toThrow(/needs a number/);
  });

  it('a missing row says so', () => {
    expect(() => dataRow(compileData(new Set(['W00'])), 'dev', 'nope')).toThrow(/missing/);
  });
});

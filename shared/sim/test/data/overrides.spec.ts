import { describe, expect, it } from 'vitest';
import {
  compileData, compileTables, dataRow, defineTable, exportOverrides, mergeOverrides, parseOverrides, parseTunePath, setOverride,
} from '../../src';

const fx = defineTable({
  name: 'fixture', summary: 'test', units: { buildS: 'seconds' },
  rows: [{ id: 'a', wave: 'W00', buildS: 30, label: 'x', on: true }, { id: 'b', wave: 'W01', buildS: 10, label: 'y', on: false }],
});
const flags = new Set(['W00']);

describe('balance overrides', () => {
  it('merges in design units before conversion (60 s → 300 ticks)', () => {
    const d = compileTables({ flags, tables: [fx], overrides: { fixture: { a: { buildS: 60 } } } });
    expect(dataRow(d, 'fixture', 'a')).toMatchObject({ buildS: 300, label: 'x' });
  });

  it('changes the hash; an empty/identical override hashes like none; the same override hashes the same', () => {
    const base = compileTables({ flags, tables: [fx] }).hash;
    const o = { fixture: { a: { buildS: 60 } } };
    const h = compileTables({ flags, tables: [fx], overrides: o }).hash;
    expect(h).not.toBe(base);
    expect(compileTables({ flags, tables: [fx], overrides: o }).hash).toBe(h);
    expect(compileTables({ flags, tables: [fx], overrides: {} }).hash).toBe(base);
    expect(compileTables({ flags, tables: [fx], overrides: { fixture: { a: { buildS: 30 } } } }).hash).toBe(base);
  });

  it('rejects unknown table, row, field and a value of the wrong type', () => {
    const run = (o: object) => () => compileTables({ flags, tables: [fx], overrides: o as never });
    expect(run({ nope: {} })).toThrow(/unknown table "nope"/);
    expect(run({ fixture: { zz: {} } })).toThrow(/unknown row "fixture.zz"/);
    expect(run({ fixture: { a: { buildz: 1 } } })).toThrow(/unknown field "fixture.a.buildz"/);
    expect(run({ fixture: { a: { id: 'q' } } })).toThrow(/unknown field/);
    expect(run({ fixture: { a: { buildS: 'fast' } } })).toThrow(/is a number, got string/);
    expect(run({ fixture: { a: { on: 1 } } })).toThrow(/is a boolean, got number/);
  });

  it('a row of a disabled wave can be overridden (no effect until its wave is on)', () => {
    expect(() => compileTables({ flags, tables: [fx], overrides: { fixture: { b: { buildS: 5 } } } })).not.toThrow();
  });

  it('compileData applies overrides to the real tables', () => {
    const d = compileData(flags, { dev: { probe: { nudgeTiles: 3, buildS: 60 } } });
    expect(dataRow(d, 'dev', 'probe')).toMatchObject({ nudgeTiles: 3, buildS: 300 });
    expect(d.hash).not.toBe(compileData(flags).hash);
  });
});

describe('tune helpers', () => {
  it('parseTunePath', () => {
    expect(parseTunePath('dev.probe.nudgeTiles')).toEqual({ table: 'dev', row: 'probe', field: 'nudgeTiles' });
    for (const bad of ['dev', 'dev.probe', 'a.b.c.d', 'a..c', 'a b.c.d']) expect(() => parseTunePath(bad)).toThrow(/<table>.<row>.<field>/);
  });

  it('setOverride parses numbers, booleans, strings and JSON, and never mutates', () => {
    const o0 = {};
    const o1 = setOverride(o0, 'dev.probe.nudgeTiles', '3');
    expect(o1).toEqual({ dev: { probe: { nudgeTiles: 3 } } });
    expect(o0).toEqual({});
    expect(setOverride(o1, 'dev.probe.on', 'true').dev?.probe).toEqual({ nudgeTiles: 3, on: true });
    expect(setOverride(o1, 'dev.probe.label', 'hello').dev?.probe?.label).toBe('hello');
    expect(setOverride(o1, 'dev.probe.list', '[1,2]').dev?.probe?.list).toEqual([1, 2]);
    expect(() => setOverride(o1, 'dev.probe.x', undefined)).toThrow(/value is required/);
  });

  it('mergeOverrides layers b over a; exportOverrides round-trips through parseOverrides', () => {
    const m = mergeOverrides({ dev: { probe: { nudgeTiles: 2, buildS: 1 } } }, { dev: { probe: { nudgeTiles: 5 } } });
    expect(m).toEqual({ dev: { probe: { nudgeTiles: 5, buildS: 1 } } });
    const text = exportOverrides(m);
    expect(text).toContain('\n');
    expect(parseOverrides(JSON.parse(text))).toEqual(m);
    expect(() => parseOverrides({ dev: 3 })).toThrow(/table "dev" must be an object/);
    expect(() => parseOverrides([])).toThrow(/root must be an object/);
  });
});

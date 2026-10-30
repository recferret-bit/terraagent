import { describe, expect, it, vi } from 'vitest';
import { allTables } from '@terra/sim';
import { clientDataFor, ClientFlagsStore, resolveClientFlags } from './index';
import { loadFeatures, defineFeature, selectFeatures } from '../registry';

const r = (search: string, welcomeFlags?: string[], dev = true) => resolveClientFlags({ search, dev, welcomeFlags, warn: () => {} });

describe('resolveClientFlags', () => {
  it('defaults to all waves without welcome', () => {
    const x = r('');
    expect(x.source).toBe('default');
    expect(x.flags.list).toHaveLength(26);
  });
  it('?waves=..00 overrides in dev', () => {
    const x = r('?planet=dune&waves=..00');
    expect(x.source).toBe('override');
    expect(x.flags.list).toEqual(['W00']);
  });
  it('ignores the override outside dev', () => expect(r('?waves=..00', undefined, false).source).toBe('default'));
  it('welcome is authoritative; override only narrows', () => {
    expect(r('', ['W00', 'W01']).source).toBe('welcome');
    expect(r('?waves=..07', ['W00', 'W01']).flags.list).toEqual(['W00', 'W01']);
    expect(r('?waves=00', ['W00', 'W01']).flags.list).toEqual(['W00']);
    expect(r('?waves=..07', ['W00', 'W01']).source).toBe('override');
  });
  it('malformed override warns and falls back', () => {
    const warn = vi.fn();
    const x = resolveClientFlags({ search: '?waves=banana', dev: true, warn });
    expect(warn).toHaveBeenCalled();
    expect(x.source).toBe('default');
    expect(resolveClientFlags({ search: '?waves=banana', dev: true, welcomeFlags: ['W00'], warn }).source).toBe('welcome');
  });
});

describe('ClientFlagsStore', () => {
  it('notifies only on change', () => {
    const s = new ClientFlagsStore(r(''));
    const fn = vi.fn();
    const off = s.onChange(fn);
    s.update(r(''));
    expect(fn).not.toHaveBeenCalled();
    s.update(r('?waves=..00'));
    expect(fn).toHaveBeenCalledTimes(1);
    off();
    s.update(r(''));
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('waves=..00 end to end', () => {
  const flags = r('?waves=..00').flags;
  it('a W07 feature with a menu is not loaded', () => {
    const w07 = defineFeature({ id: 'later', wave: 'W07', menus: [{ id: 'm', label: 'M', open() {} }] });
    const w00 = defineFeature({ id: 'base', wave: 'W00' });
    const out = selectFeatures([w07, w00], { flags: new Set(flags.list), host: 'server' });
    expect(out.map((f) => f.id)).toEqual(['base']);
    expect(out.flatMap((f) => f.menus ?? [])).toEqual([]);
  });
  it('real features only include W00', () => {
    for (const f of loadFeatures({ flags: new Set(flags.list), host: 'server' })) expect(f.wave).toBe('W00');
  });
  it('data rows are compiled for W00 only', () => {
    const data = clientDataFor(flags);
    const rows = Object.values(data.tables).flatMap((t) => Object.values(t));
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.wave).toBe('W00');
    expect(allTables().length).toBeGreaterThan(0);
  });
});

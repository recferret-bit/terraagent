import { describe, expect, it } from 'vitest';
import { collectFeatures, selectFeatures } from './select';
import { defineFeature } from './types';

const mk = (id: string, wave: string, extra = {}) => defineFeature({ id, wave, ...extra });
const opts = (flags: string[], host: 'server' | 'local' = 'server') => ({ flags: new Set(flags), host });

describe('selectFeatures', () => {
  it('skips features whose wave flag is off', () => {
    const all = [mk('hello', 'W07'), mk('core', 'W00')];
    expect(selectFeatures(all, opts(['W00'])).map((f) => f.id)).toEqual(['core']);
    expect(selectFeatures(all, opts(['W00', 'W07'])).map((f) => f.id)).toEqual(['core', 'hello']);
  });
  it('hides server-only features on the local host', () => {
    const all = [mk('a', 'W00', { hostOnly: 'server' }), mk('b', 'W00')];
    expect(selectFeatures(all, opts(['W00'], 'local')).map((f) => f.id)).toEqual(['b']);
  });
  it('sorts by id', () => {
    expect(selectFeatures([mk('z', 'W00'), mk('a', 'W00')], opts(['W00'])).map((f) => f.id)).toEqual(['a', 'z']);
  });
});

describe('collectFeatures', () => {
  it('rejects duplicates and missing defaults', () => {
    expect(() => collectFeatures({ a: { default: mk('x', 'W00') }, b: { default: mk('x', 'W00') } })).toThrow(/duplicate/);
    expect(() => collectFeatures({ a: {} })).toThrow(/no default/);
  });
});

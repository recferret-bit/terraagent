import { describe, expect, it } from 'vitest';
import { flagsFromList, FlagSpecError, parseWaves } from '../src';

describe('parseWaves', () => {
  it('all / empty → W00..W25', () => {
    for (const s of ['all', '', undefined, null]) {
      const f = parseWaves(s);
      expect(f.list.length).toBe(26);
      expect(f.spec).toBe('all');
      expect(f.has('W25')).toBe(true);
    }
  });
  it('..07 → W00..W07', () => {
    const f = parseWaves('..07');
    expect(f.list).toEqual(['W00', 'W01', 'W02', 'W03', 'W04', 'W05', 'W06', 'W07']);
    expect(f.has('W08')).toBe(false);
    expect(f.spec).toBe('..07');
  });
  it('..00 keeps only W00', () => {
    expect(parseWaves('..00').list).toEqual(['W00']);
  });
  it('explicit lists always include W00', () => {
    const f = parseWaves('01,07');
    expect(f.list).toEqual(['W00', 'W01', 'W07']);
    expect(f.spec).toBe('00,01,07');
    expect(parseWaves('W00,W02').list).toEqual(['W00', 'W02']);
  });
  it('rejects typos instead of enabling waves', () => {
    for (const s of ['al', '..', '..26', '1,x', '00;01', '..7a']) expect(() => parseWaves(s), s).toThrow(FlagSpecError);
  });
  it('round-trips through the welcome list', () => {
    expect(flagsFromList(parseWaves('..03').list).spec).toBe('..03');
  });
});

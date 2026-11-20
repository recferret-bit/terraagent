import { describe, expect, it } from 'vitest';
import { rampAmountToAtomic } from './rampAmount';

const ok = (t: string, d: number) => { const r = rampAmountToAtomic(t, d); return r.ok ? r.atomic : `ERR:${r.error}`; };

describe('rampAmountToAtomic', () => {
  it('scales by the token decimals (6 vs 24)', () => {
    expect(ok('10.00', 6)).toBe('10000000');
    expect(ok('10', 6)).toBe('10000000');
    expect(ok('1', 24)).toBe('1000000000000000000000000');
    expect(ok('0.5', 24)).toBe('500000000000000000000000');
    expect(ok(' 2.5 ', 6)).toBe('2500000');
  });
  it('handles boundaries and trailing zeros', () => {
    expect(ok('0.000001', 6)).toBe('1');
    expect(ok('10.0000000', 6)).toBe('10000000');
    expect(ok('0.000000000000000000000001', 24)).toBe('1');
    expect(ok('1', 0)).toBe('1');
  });
  it('rejects too many decimals', () => {
    expect(ok('10.0000001', 6)).toMatch(/^ERR:.*at most 6 decimals/);
    expect(ok('1.5', 0)).toMatch(/^ERR:/);
  });
  it('rejects zero, empty, negative, exponent and junk', () => {
    for (const bad of ['', '  ', '0', '0.000', '-1', '+1', '1e6', '1,5', '.5', '5.', 'abc', '0x10', 'NaN', 'Infinity', '1 000'])
      expect(ok(bad, 6), bad).toMatch(/^ERR:/);
  });
  it('rejects absurdly huge values, accepts large sane ones', () => {
    expect(ok('1'.repeat(40), 6)).toMatch(/^ERR:.*too large/);
    expect(ok('1000000', 24)).toBe('1' + '0'.repeat(30));
  });
  it('bad decimals does not throw', () => {
    expect(ok('1', 99)).toMatch(/^ERR:/);
  });
});

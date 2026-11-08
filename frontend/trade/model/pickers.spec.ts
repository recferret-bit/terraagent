import { describe, expect, it } from 'vitest';
import { pickQuote } from './units';

describe('pickQuote', () => {
  it('keeps the wanted quote when the new resource trades against it', () => {
    expect(pickQuote(['metals.t1', 'USDC'], undefined, 'USDC')).toBe('USDC');
    expect(pickQuote(['metals.t1', 'USDC', 'NEAR'], 'NEAR', 'USDC')).toBe('NEAR');
  });
  it('falls back to the first listed quote, or nothing', () => {
    expect(pickQuote(['metals.t1', 'NEAR'], undefined, 'USDC')).toBe('metals.t1');
    expect(pickQuote([] as string[], 'USDC')).toBeUndefined();
  });
});

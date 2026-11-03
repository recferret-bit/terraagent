import { describe, expect, it } from 'vitest';
import { explorerIsOff, wavesExcludeW06 } from './gate';

describe('explorer wave gate', () => {
  it('treats a missing param and all as unrestricted', () => {
    expect(wavesExcludeW06('')).toBe(false);
    expect(wavesExcludeW06('?waves=all')).toBe(false);
    expect(wavesExcludeW06('?waves=')).toBe(false);
  });

  it('turns off a ceiling or list that does not include 06', () => {
    expect(wavesExcludeW06('?waves=..05')).toBe(true);
    expect(wavesExcludeW06('?waves=..00')).toBe(true);
    expect(wavesExcludeW06('?waves=00,05')).toBe(true);
    expect(wavesExcludeW06('?waves=W05')).toBe(true);
  });

  it('stays on when 06 or W06 is included', () => {
    expect(wavesExcludeW06('?waves=..06')).toBe(false);
    expect(wavesExcludeW06('?waves=06')).toBe(false);
    expect(wavesExcludeW06('?waves=W06')).toBe(false);
    expect(wavesExcludeW06('?waves=00,W06')).toBe(false);
  });

  it('counts a bad spec as off, and health 404 as off even when waves are open', () => {
    expect(wavesExcludeW06('?waves=banana')).toBe(true);
    expect(explorerIsOff('', 200)).toBe(false);
    expect(explorerIsOff('', 404)).toBe(true);
    expect(explorerIsOff('', null)).toBe(false);
    expect(explorerIsOff('?waves=..05', 200)).toBe(true);
    expect(explorerIsOff('?waves=..06', 404)).toBe(true);
  });
});

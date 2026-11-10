import { describe, expect, it } from 'vitest';
import { directorDigestLine, type DirectorDigestEvent } from '../../src/market/director/digest-line.js';

const SOLD = 'Director sold 300 metals to the Guild.';

function fill(over: Partial<DirectorDigestEvent> = {}): DirectorDigestEvent {
  return { resource: 'metals.t1', side: 'sell', amount: 300, counterparty: 'Guild', ...over };
}

describe('directorDigestLine', () => {
  it('names the four Tier-1 resources on both sides', () => {
    expect(directorDigestLine(fill())).toBe(SOLD);
    expect(directorDigestLine(fill({ side: 'buy' }))).toBe('Director bought 300 metals from the Guild.');
    expect(directorDigestLine(fill({ resource: 'minerals.t1' }))).toBe('Director sold 300 minerals to the Guild.');
    expect(directorDigestLine(fill({ resource: 'bio.water', side: 'buy', amount: 40 }))).toBe(
      'Director bought 40 water from the Guild.',
    );
    expect(directorDigestLine(fill({ resource: 'bio.biomass', amount: 12 }))).toBe(
      'Director sold 12 biomass to the Guild.',
    );
  });

  it('uses the family name for metals and minerals tiers', () => {
    expect(directorDigestLine(fill({ resource: 'minerals.t1', side: 'buy' }))).toBe(
      'Director bought 300 minerals from the Guild.',
    );
    expect(directorDigestLine(fill({ resource: 'metals.t2', amount: 1 }))).toBe('Director sold 1 metals to the Guild.');
  });

  it('is not a line for amount 0, a blank counterparty, or an unnamed resource', () => {
    expect(directorDigestLine(fill({ amount: 0 }))).toBeNull();
    expect(directorDigestLine(fill({ amount: -1 }))).toBeNull();
    expect(directorDigestLine(fill({ amount: 1.5 }))).toBeNull();
    expect(directorDigestLine(fill({ counterparty: '  ' }))).toBeNull();
    expect(directorDigestLine(fill({ resource: 'bio.t2' }))).toBeNull();
    expect(directorDigestLine(fill({ side: 'hold' }))).toBeNull();
  });

  it('still returns the sentence when W09 is off', () => {
    const waves = { has: (wave: string) => wave !== 'W09' };
    expect(waves.has('W09')).toBe(false);
    expect(directorDigestLine(fill())).toBe(SOLD);
  });
});

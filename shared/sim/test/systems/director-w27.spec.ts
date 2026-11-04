import { describe, expect, it } from 'vitest';
import { summarizeRelevant, syntheticWorld } from '../../src/systems/director/w27';

describe('W16-41 W27 summary port', () => {
  it('returns bounded relevant summaries from a 450-sector world and does not force residency', () => {
    const page = summarizeRelevant(syntheticWorld(450));
    expect(page.summaries.map((row) => row.sectorId)).toEqual(['sec_0', 'sec_7']);
    expect(page.summaries[0]?.freshness).toBe('fresh');
    expect(page.summaries[1]?.freshness).toBe('stale');
    expect(page.summaries[1]?.resources).toEqual([]);
    expect(page.omitted).toBe(0);
    expect(page.residency).toBe('partial');
    expect(page.worldCreated).toBe(false);
  });

  it('keeps unknown and unloaded distinct and does not invent zero resources', () => {
    const page = summarizeRelevant([
      { sectorId: 'a', relevant: true, freshness: 'unknown' },
      { sectorId: 'b', relevant: true, freshness: 'unloaded' },
      { sectorId: 'c', relevant: true, freshness: 'unavailable' },
    ]);
    expect(page.summaries.map((row) => row.freshness)).toEqual(['unknown', 'unloaded', 'unavailable']);
    expect(page.summaries.every((row) => row.resources === null)).toBe(true);
  });

  it('caps the page at 64 relevant sectors', () => {
    const sectors = Array.from({ length: 80 }, (_, i) => ({
      sectorId: `s${i}`,
      relevant: true,
      freshness: 'fresh' as const,
      resources: [{ id: 'metals.t1', amount: 1 }],
    }));
    const page = summarizeRelevant(sectors);
    expect(page.summaries).toHaveLength(64);
    expect(page.omitted).toBe(16);
    expect(page.residency).toBe('partial');
  });
});

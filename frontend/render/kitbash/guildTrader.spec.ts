import { describe, expect, it } from 'vitest';
import { ArchetypeCatalog } from './index';

describe('ship.guildTrader', () => {
  it('registers the Guild trader ship with ground contact under the triangle cap', () => {
    expect(ArchetypeCatalog.has('ship.guildTrader')).toBe(true);
    const entry = ArchetypeCatalog.get('ship.guildTrader');
    expect(entry.category).toBe('ship');
    expect(entry.label).toBe('Guild Trader');
    const geo = entry.create();
    geo.computeBoundingBox();
    expect(geo.boundingBox!.min.y).toBeCloseTo(0, 3);
    expect(geo.getAttribute('position').count / 3).toBeLessThan(3500);
  });
});

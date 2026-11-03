// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderStatsSection } from './sections/StatsSection';
import { makeW12ProfileFixture } from './testFixtures';

describe('W12-16 Stats tiles renderer', () => {
  it('renders all 16 stats tiles and formats multi-digit numbers with spaces', () => {
    const profile = makeW12ProfileFixture();
    profile.stats.resourcesProduced = 12450;

    const node = renderStatsSection(profile.stats);
    const tiles = node.querySelectorAll('.ta-stat-tile');
    expect(tiles).toHaveLength(16);

    const resTile = node.querySelector('[data-testid="me-stat-resourcesProduced"]');
    expect(resTile?.querySelector('.ta-stat-value')?.textContent).toBe('12 450');

    const powerTile = node.querySelector('[data-testid="me-stat-peakNetPower"]');
    expect(powerTile?.querySelector('.ta-stat-value')?.textContent).toBe('140 E/s');
  });
});

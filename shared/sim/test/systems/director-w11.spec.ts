import { describe, expect, it } from 'vitest';
import { projectW11Context, restoreW11Context } from '../../src/systems/director';

const ids = { worldId: 'world_terra', colonyId: 'co_home', planetId: 'pl_dune' };

describe('W16-40 W11 context adapter', () => {
  it('keeps canonical ids across a restart and does not treat a full sector as a wall', () => {
    const view = projectW11Context({
      ...ids,
      w11: true,
      sectors: [
        { sectorId: 'sec_home', relation: 'home', lifecycle: 'full' },
        { sectorId: 'sec_next', relation: 'neighbor', lifecycle: 'open' },
      ],
    });
    const restored = restoreW11Context(JSON.stringify(view));
    expect(restored.colonyId).toBe('co_home');
    expect(restored.worldId).toBe('world_terra');
    expect(restored.planetId).toBe('pl_dune');
    expect(restored.sectors).toHaveLength(2);
    expect(restored.expansionBlocked).toBe(false);
    expect(restored.compatibility).toBe('w11');
  });

  it('marks W11-off as an explicit bounded view and does not invent sectors', () => {
    const view = projectW11Context({ ...ids, w11: false, sectors: [{ sectorId: 'sec_x', relation: 'home', lifecycle: 'open' }] });
    expect(view.w11).toBe(false);
    expect(view.sectors).toEqual([]);
    expect(view.compatibility).toBe('bounded-dev');
    expect(view.expansionBlocked).toBe(false);
  });
});

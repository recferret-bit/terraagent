import { describe, expect, it } from 'vitest';
import { createScenarioPlanet, getScenario, listScenarios } from '../_loader';

describe('scenario loader', () => {
  it('discovers w00 and looks it up by id or file name', () => {
    expect(listScenarios().map((s) => s.id)).toContain('w00');
    expect(getScenario('w00')).toBeDefined();
    expect(getScenario('w00-empty')).toBe(getScenario('w00'));
    expect(getScenario('nope')).toBeUndefined();
    expect(() => createScenarioPlanet('nope')).toThrow(/unknown scenario/);
  });

  it('builds identical planets (same seed) that differ only by planet id; the test entity is at 0,0', () => {
    const a = createScenarioPlanet('w00', { planetId: 'pl_A' }).host.state;
    const b = createScenarioPlanet('w00', { planetId: 'pl_B' }).host.state;
    expect(a.meta.planetId).toBe('pl_A');
    expect(a.meta.seed).toBe(b.meta.seed);
    a.meta.planetId = b.meta.planetId = '';
    expect(a).toEqual(b);
    expect(a.entities.count).toBe(1);
    expect(a.entities.cols.kind[0]).toBe(1);
    expect([a.entities.cols.q[0], a.entities.cols.r[0]]).toEqual([0, 0]);
  });

  it('flags are the scenario waves intersected with the given set', () => {
    const { host } = createScenarioPlanet('w00', { flags: ['W00', 'W01'] });
    expect([...host.pipeline.config.flags]).toEqual(['W00']);
  });
});

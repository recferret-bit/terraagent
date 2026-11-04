import { colonyDirector } from '@terra/sim';
import { describe, expect, it } from 'vitest';
import { createScenarioPlanet, getScenario } from '../_loader';

describe('w16 director scenario', () => {
  it('seeds one landed colony on waves through W16', () => {
    expect(getScenario('w16-director')).toBe(getScenario('w16'));
    const { host } = createScenarioPlanet('w16');
    expect([...host.pipeline.config.flags]).toContain('W16');
    expect([...host.pipeline.config.flags]).not.toContain('W17');
    expect(host.state.colonies).toHaveLength(1);
    expect(host.state.colonies[0]?.name).toBe('Director Basin');
  });

  it('stores Conservative Resources with independent sliders and raids off', () => {
    const { host } = createScenarioPlanet('w16');
    const view = colonyDirector(host.state, 0);
    expect(view?.awayRaids).toBe(false);
    expect(view?.policy.risk).toBe('conservative');
    expect(view?.policy.preset).toBe('resources');
    expect(view?.policy.note).toBe('w16 fixture');
    expect(view?.policy.priorities).toEqual({
      economy: 70,
      expansion: 40,
      defense: 50,
      power: 60,
      terraform: 30,
    });
    const sum = Object.values(view!.policy.priorities).reduce((n, v) => n + v, 0);
    expect(sum).toBe(250);
  });
});

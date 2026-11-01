import { RESOURCE_KEYS } from '@terra/contracts';
import { getColonyStock, getHqView, getLandingPods, getSpawnSlots } from '@terra/sim';
import { describe, expect, it } from 'vitest';
import { apiFor, createScenarioPlanet, getScenario, listScenarios } from '../_loader';

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

  it('discovers w01-landfall and seeds a temperate planet at the drop moment with cargo 600/350/200/200', () => {
    expect(listScenarios().map((s) => s.id)).toContain('w01');
    expect(getScenario('w01')).toBeDefined();
    expect(getScenario('w01-landfall')).toBe(getScenario('w01'));
    const { host } = createScenarioPlanet('w01', { planetId: 'pl_W01' });
    expect([...host.pipeline.config.flags]).toEqual(['W00', 'W01']);
    expect(host.state.colonies).toHaveLength(1);
    expect(host.state.colonies[0]?.stock).toEqual({
      ...Object.fromEntries(RESOURCE_KEYS.map((k) => [k, 0])),
      'metals.t1': 600,
      'minerals.t1': 350,
      'bio.biomass': 200,
      'bio.water': 200,
    });
    expect(host.state.entities.count).toBe(1);
  });

  it('w01 then dev.land (the auto-place flow) deploys the HQ at slot 0 and credits the cargo once', () => {
    const { host } = createScenarioPlanet('w01', { planetId: 'pl_W01A' });
    const land = (commandId: string, args: object): string | undefined => {
      host.submit({ colonyIndex: 0, source: 'dev', commandId, kind: 'dev.land', args });
      return host.step(1).outcomes[0]?.code;
    };
    expect(land('land_1', {})).toBeUndefined();
    expect(land('land_2', { q: 0, r: 0 })).toBe('already_landed');
    const pods = getLandingPods(host.state);
    expect(pods).toHaveLength(1);
    expect(pods[0]).toMatchObject({ colonyId: 0, q: getSpawnSlots(host.state)[0].q, r: getSpawnSlots(host.state)[0].r, deployed: true });
    expect(getSpawnSlots(host.state)[0].claimedBy).toBe(0);
    expect(getHqView(host.state, 0)).not.toBeNull();
    expect(getColonyStock(host.state, 0)).toEqual({
      ...Object.fromEntries(RESOURCE_KEYS.map((k) => [k, 0])),
      'metals.t1': 600,
      'minerals.t1': 350,
      'bio.biomass': 200,
      'bio.water': 200,
    });
  });

  it('GP-37: the scenario api checks args against the command contract before the engine sees them', () => {
    const { host } = createScenarioPlanet('w01', { planetId: 'pl_W01C' });
    const api = apiFor(host);
    const tick = host.tick;
    expect(() => api.command('dev.land', { colonyId: 0 }, 0)).toThrow(/invalid args/);
    expect(host.tick).toBe(tick); // refused before submit: nothing stepped
    api.command('dev.land', {}, 0);
    expect(getLandingPods(host.state)[0].deployed).toBe(true);
  });
});

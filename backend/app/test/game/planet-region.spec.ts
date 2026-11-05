import { createScenarioPlanet } from '@terra/scenarios';
import { createPlanet, getRegionPin, regionForNewPlanet, snapshot } from '@terra/sim';
import { describe, expect, it } from 'vitest';
import { PlanetHost } from '../../src/game/thread/planet-host';

const W13_FLAGS = ['W00', 'W01', 'W02', 'W03', 'W04', 'W05', 'W06', 'W07', 'W08', 'W09', 'W10', 'W11', 'W12', 'W13'];
const load = (flags: readonly string[], msg: Record<string, unknown>) => {
  const host = new PlanetHost(0, flags, () => undefined);
  host.handle({ t: 'load', ...msg } as never);
  return host.planets.get(msg.planetId as string)!.state;
};

/** W13-57: the server sim thread pins the regional endowment of a NEW planet with the same shared rule the local host uses. */
describe('PlanetHost pins the region at creation (W13-57)', () => {
  it('W13 on: a new desert planet carries the pin the shared rule resolves, equal to the scenario loader / local host', () => {
    const s = load(W13_FLAGS, { planetId: 'pl_r1', params: { type: 'desert', seed: 'r', radius: 16 } });
    const pin = getRegionPin(s)!;
    expect(pin.context).toEqual({ planetType: 'desert', planetId: 'pl_r1' });
    expect(pin.endowmentHash).toBe(regionForNewPlanet({ flags: ['W13'], planetType: 'desert', planetId: 'pl_r1' })!.endowmentHash);
    expect(getRegionPin(createScenarioPlanet('w13r', { planetId: 'pl_r1' }).host.state)!.endowmentHash).toBe(pin.endowmentHash);
  });

  it('a host-resolved profile region wins; W13 off and restored planets are untouched', () => {
    const region = regionForNewPlanet({ flags: ['W13'], planetType: 'ocean', planetId: 'pl_r2' })!;
    expect(getRegionPin(load(W13_FLAGS, { planetId: 'pl_r2', params: { type: 'ocean', seed: 'r', radius: 12, region } }))!.endowmentHash).toBe(region.endowmentHash);
    expect(getRegionPin(load(W13_FLAGS.slice(0, -1), { planetId: 'pl_r3', params: { type: 'desert', seed: 'r', radius: 12 } }))).toBeUndefined();
    const legacy = snapshot(createPlanet({ id: 'pl_r4', seed: 'r', type: 'desert', planetType: 'desert', radius: 12 }));
    expect(getRegionPin(load(W13_FLAGS, { planetId: 'pl_r4', snapshot: legacy }))).toBeUndefined(); // an existing planet is never re-pinned
  });
});

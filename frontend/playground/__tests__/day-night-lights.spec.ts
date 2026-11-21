import { describe, expect, it } from 'vitest';
import { getBuildingLightLevel } from '@terra/render/lighting/buildingLights';
import { SpawnSet } from '../content/SpawnSet';

function rigVisible(spawns: SpawnSet): boolean[] {
  return spawns.spawns.map((s) => {
    const rig = (s.mesh.userData as { projectorRig?: { group: { visible: boolean } } }).projectorRig;
    return rig?.group.visible ?? false;
  });
}

describe('playground day/night lights', () => {
  it('turns bulbs and beams off by day and on at night, and keeps a ruin dark', () => {
    const spawns = new SpawnSet();
    spawns.rebuild(['building.commandHub', 'building.pylon'], 'dune', false);

    spawns.tick(0, 0.016, false, false, 0, 'building.commandHub', false);
    expect(spawns.spawns.map((s) => getBuildingLightLevel(s.mesh))).toEqual([0, 0]);
    expect(rigVisible(spawns)).toEqual([false, false]);

    spawns.tick(0, 0.016, false, false, 0, 'building.commandHub', true);
    expect(spawns.spawns.map((s) => getBuildingLightLevel(s.mesh))).toEqual([1, 1]);
    expect(rigVisible(spawns)).toEqual([true, true]);

    spawns.applyRuin(true);
    spawns.tick(0, 0.016, false, false, 0, 'building.commandHub', true);
    expect(spawns.spawns.map((s) => getBuildingLightLevel(s.mesh))).toEqual([0, 0]);
    expect(rigVisible(spawns)).toEqual([false, false]);
    spawns.dispose();
  });
});

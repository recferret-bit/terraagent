import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { attachEntityProjectorRig } from './EntityProjectorRig';
import { applyBuildingLight, getBuildingLightLevel, LIGHT_FALL_TAU_S, stepLightLevel } from './buildingLights';

function fakeBuilding(): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
  mesh.userData = { uniforms: { uLit: { value: 1 } } };
  attachEntityProjectorRig(mesh, 'building.commandHub');
  return mesh;
}

describe('applyBuildingLight (the single renderer entry point)', () => {
  it('writes the emissive uniform and the rig, and remembers the level', () => {
    const mesh = fakeBuilding();
    applyBuildingLight(mesh, 0, 1.2);
    expect((mesh.userData.uniforms as { uLit: { value: number } }).uLit.value).toBe(0);
    expect(getBuildingLightLevel(mesh)).toBe(0);
    const rig = mesh.userData.projectorRig as { group: THREE.Group };
    expect(rig.group.visible).toBe(false);
    applyBuildingLight(mesh, 1, 1.2);
    expect((mesh.userData.uniforms as { uLit: { value: number } }).uLit.value).toBe(1);
    expect(rig.group.visible).toBe(true);
  });

  it('clamps the level and tolerates a mesh without the uniform', () => {
    const bare = new THREE.Object3D();
    applyBuildingLight(bare, 3, 1);
    expect(getBuildingLightLevel(bare)).toBe(1);
    applyBuildingLight(bare, -1, 1);
    expect(getBuildingLightLevel(bare)).toBe(0);
  });
});

describe('stepLightLevel (fade, no pop)', () => {
  it('eases monotonically and never overshoots', () => {
    let v = 1;
    const seen: number[] = [];
    for (let i = 0; i < 200; i++) {
      v = stepLightLevel(v, 0, 1 / 60);
      seen.push(v);
    }
    expect(seen[0]).toBeGreaterThan(0.95); // no pop on the first frame
    for (let i = 1; i < seen.length; i++) expect(seen[i]!).toBeLessThanOrEqual(seen[i - 1]!);
    expect(seen.at(-1)).toBe(0);
  });

  it('about 63 % of the way after one time constant, and rises back up', () => {
    const v = stepLightLevel(1, 0, LIGHT_FALL_TAU_S);
    expect(v).toBeGreaterThan(0.3);
    expect(v).toBeLessThan(0.4);
    expect(stepLightLevel(0, 1, 1 / 60)).toBeGreaterThan(0);
    expect(stepLightLevel(0.5, 0.5, 0.1)).toBe(0.5);
  });
});

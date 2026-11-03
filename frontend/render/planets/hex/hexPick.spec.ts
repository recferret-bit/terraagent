import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { hexCount, hexIndex } from '@terra/sim/grid/hex';
import { createHexTerrain, HEX_PREP, HEX_TERRAIN, specForPlanetType } from './index';

describe('hex terrain pick', () => {
  it('a ray through a tree canopy picks the forest tile the tree stands on, not the ground behind it', () => {
    const r = 6;
    const count = hexCount(r);
    const hx = hexIndex(r);
    const terrain = new Uint8Array(count).fill(HEX_TERRAIN.flat);
    const prep = new Uint8Array(count).fill(HEX_PREP.flat);
    const height = new Float32Array(count);
    const forestIdx = hx.indexOf(0, 0);
    terrain[forestIdx] = HEX_TERRAIN.forest;
    const t = createHexTerrain({ radius: r, tiles: { terrain, prep, height }, look: specForPlanetType('temperate') });
    t.group.updateMatrixWorld(true);

    const tree = t.props.instancesForTile(forestIdx)[0]!;
    expect(tree).toBeDefined();
    // A shallow ray aimed at the trunk 0.5 m up: the ground under that ray lies well past the forest tile.
    const target = new THREE.Vector3(tree.x, tree.y + 0.5, tree.z);
    const origin = target.clone().add(new THREE.Vector3(-20, 6, -20));
    const ray = new THREE.Raycaster(origin, target.clone().sub(origin).normalize());

    const pick = t.pick(ray);
    expect(pick?.i).toBe(forestIdx);

    // The same ray with the props hidden falls through to the ground behind the tree.
    for (const m of Object.values(t.props.meshes).flat()) m.visible = false;
    const ground = t.pick(ray);
    expect(ground?.i).not.toBe(forestIdx);
    t.dispose();
  });
});

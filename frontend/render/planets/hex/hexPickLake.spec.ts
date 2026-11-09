import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { hexCount, hexIndex } from '@terra/sim/grid/hex';
import { createHexTerrain, HEX_PREP, HEX_TERRAIN, specForPlanetType } from './index';
import { tileXZ } from './hexMath';

const R = 12;
const LAKE: ReadonlyArray<readonly [number, number]> = [[-4, 0], [-3, 0], [-5, 1], [-4, 1], [-3, 1]];

/** A terrain with `lake` as shallow water (lakebed below the level), everything else flat ground. */
function lakeTerrain(lake: ReadonlyArray<readonly [number, number]>) {
  const n = hexCount(R);
  const hx = hexIndex(R);
  const terrain = new Uint8Array(n).fill(HEX_TERRAIN.flat);
  const prep = new Uint8Array(n).fill(HEX_PREP.flat);
  const height = new Float32Array(n);
  for (const [q, r] of lake) {
    const i = hx.indexOf(q, r);
    terrain[i] = HEX_TERRAIN.shallow;
    height[i] = -0.22;
  }
  return createHexTerrain({ radius: R, tiles: { terrain, prep, height }, look: specForPlanetType('temperate') });
}

/** Camera looking at `(x, z)` from `dist` metres at `elev` degrees, azimuth `az` degrees (the game's iso-ish views). */
function cameraFor(x: number, y: number, z: number, dist: number, elev: number, az: number): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(35, 16 / 9, 0.5, 2000);
  const e = (elev * Math.PI) / 180, a = (az * Math.PI) / 180;
  cam.position.set(x + Math.cos(a) * Math.cos(e) * dist, y + Math.sin(e) * dist, z + Math.sin(a) * Math.cos(e) * dist);
  cam.lookAt(x, y, z);
  cam.updateMatrixWorld(true);
  cam.updateProjectionMatrix();
  return cam;
}

describe('hex terrain pick on a lake', () => {
  it.each([
    ['whole lake', LAKE],
    ['last hex of a reclaimed lake (isolated pit)', [[-3, 1]] as const],
  ])('every water hex centre can be picked from every camera side: %s', (_label, lake) => {
    const t = lakeTerrain(lake);
    t.group.updateMatrixWorld(true);
    const hx = hexIndex(R);
    const misses: string[] = [];
    for (const [q, r] of lake) {
      const [x, z] = tileXZ(q, r);
      // What the player sees and clicks is the water surface (y = 0), not the lakebed under it.
      const spots: Array<[number, number]> = [[0, 0], ...[0, 1, 2, 3, 4, 5].map((k): [number, number] => [Math.cos((k * Math.PI) / 3 + Math.PI / 6) * 0.45, Math.sin((k * Math.PI) / 3 + Math.PI / 6) * 0.45])];
      for (const [dx, dz] of spots) {
        for (const elev of [20, 30, 45, 70]) {
          for (let az = 0; az < 360; az += 45) {
            const cam = cameraFor(x, 0, z, 30, elev, az);
            const ndc = new THREE.Vector3(x + dx, 0, z + dz).project(cam);
            const pick = t.pick(new THREE.Vector2(ndc.x, ndc.y), cam);
            if (pick?.i !== hx.indexOf(q, r)) misses.push(`(${q},${r}) off ${dx.toFixed(2)},${dz.toFixed(2)} elev ${elev} az ${az} -> ${pick ? `${pick.q},${pick.r}` : 'null'}`);
          }
        }
      }
    }
    expect(misses).toEqual([]);
    t.dispose();
  });
});

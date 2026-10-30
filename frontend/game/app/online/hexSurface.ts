import * as THREE from 'three';
import type { PlanetSpec } from '@terra/render/planets/PlanetSpec';
import type { HexTerrain } from '@terra/render/planets/hex';
import type { PlanetSurface } from '@terra/render/planets/surface/types';

/** Adapts the hex terrain to the `PlanetSurface` shape `RTSCamera` expects (it only reads `halfSize` and `heightAt`). */
export function hexSurface(terrain: HexTerrain, spec: PlanetSpec): PlanetSurface {
  return {
    spec, group: terrain.group, halfSize: terrain.halfSize,
    heightAt: (x, z) => terrain.heightAt(x, z),
    isLiquid: () => false,
    landingSite: new THREE.Vector3(0, terrain.heightAt(0, 0), 0),
    update() {},
    dispose() { terrain.dispose(); },
  };
}

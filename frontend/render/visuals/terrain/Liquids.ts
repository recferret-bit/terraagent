import * as THREE from 'three';
import { createWaterMaterial } from '../water/WaterMaterial';

export interface LiquidResult { mesh: THREE.Mesh; uniforms: Record<string, THREE.IUniform>; dispose(): void }

interface Common {
  level: number;
  /** R = bed / terrain height (m). With `shoreField`, an RGBA field: G = distance to dry ground (m), B = water mask. */
  heightTex: THREE.Texture;
  span: number;
  coverage: number;
  /** `heightTex` carries the baked shore distance (G) and water mask (B) channels (hex planet water). */
  shoreField?: boolean;
}

function plane(c: Common, seg: number) {
  const g = new THREE.PlaneGeometry(c.coverage, c.coverage, seg, seg);
  g.rotateX(-Math.PI / 2);
  return g;
}

/**
 * Water surface of the prototype lakes: a thin wrapper over `createWaterMaterial`
 * (`visuals/water/WaterMaterial.ts`) on one 160-segment plane. The hex planet uses the material directly, on spatial
 * surface buckets (`planets/hex/waterBuckets.ts`).
 */
export function createWater(c: Common, shallow: number, deep: number, sky: number): LiquidResult {
  const water = createWaterMaterial({
    shallow, deep, sky, heightTex: c.heightTex, span: c.span, level: c.level, shoreField: c.shoreField,
  });
  const mesh = new THREE.Mesh(plane(c, 160), water.material);
  mesh.name = 'water'; mesh.position.y = c.level; mesh.receiveShadow = true; mesh.renderOrder = 1;
  return { mesh, uniforms: water.uniforms, dispose() { mesh.geometry.dispose(); water.dispose(); } };
}

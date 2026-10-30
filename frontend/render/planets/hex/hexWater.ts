import * as THREE from 'three';
import { hexIndex } from '@terra/sim/grid/hex';
import type { PlanetSpec } from '../PlanetSpec';
import { createWater, type LiquidResult } from '../../visuals/terrain/Liquids';
import { buildHeightTexture } from '../../visuals/terrain/TerrainGrid';
import { HEX_PREP, HEX_TERRAIN, type HexTileLayers } from './chunkMesh';
import { planetExtent, tileAt, tileXZ } from './hexMath';

export const HEX_WATER_LEVEL = 0.0;
const TEX_RES = 128;

export interface HexWater {
  readonly mesh: THREE.Mesh;
  readonly uniforms: Record<string, THREE.IUniform>;
  readonly waterTileCount: number;
  readonly waterTriangleCount: number;
  update(layers: HexTileLayers): void;
  dispose(): void;
}

function isWaterTile(layers: HexTileLayers, i: number): boolean {
  if (!layers.terrain || i < 0) return false;
  const p = layers.prep?.[i] ?? 0;
  if (p === HEX_PREP.prepared || p === HEX_PREP.flat || p === HEX_PREP.living || p === HEX_PREP.irrigated) {
    return false;
  }
  const t = layers.terrain[i] ?? 0;
  return t === HEX_TERRAIN.shallow || t === HEX_TERRAIN.deep;
}

function sampleWaterBed(radius: number, layers: HexTileLayers, span: number): Float32Array {
  const hs = new Float32Array(TEX_RES * TEX_RES);
  const step = span / (TEX_RES - 1);
  for (let j = 0; j < TEX_RES; j++) {
    const z = -span / 2 + j * step;
    for (let i = 0; i < TEX_RES; i++) {
      const x = -span / 2 + i * step;
      const hit = tileAt(radius, x, z);
      let h = 1.0;
      if (hit && layers.terrain && isWaterTile(layers, hit.i)) {
        const t = layers.terrain[hit.i] ?? 0;
        h = t === HEX_TERRAIN.deep ? -1.6 : -0.35;
      }
      hs[j * TEX_RES + i] = h;
    }
  }
  return hs;
}

function buildWaterSurfaceGeometry(
  radius: number,
  layers: HexTileLayers,
): { geo: THREE.BufferGeometry; waterTiles: number; waterTris: number } {
  const hx = hexIndex(radius);
  const local = new Map<number, number>();
  const order: number[] = [];
  const vert = (i: number) => {
    let v = local.get(i);
    if (v === undefined) {
      v = order.length;
      local.set(i, v);
      order.push(i);
    }
    return v;
  };
  const idx: number[] = [];
  let waterTiles = 0;
  for (let i = 0; i < hx.count; i++) {
    const w0 = isWaterTile(layers, i);
    if (w0) waterTiles++;
    const q = hx.q[i]!, r = hx.r[i]!;
    const b = hx.indexOf(q + 1, r), c = hx.indexOf(q, r + 1);
    if (b >= 0 && c >= 0 && (w0 || isWaterTile(layers, b) || isWaterTile(layers, c))) {
      idx.push(vert(i), vert(c), vert(b));
    }
    const b2 = hx.indexOf(q, r - 1), c2 = hx.indexOf(q - 1, r);
    if (b2 >= 0 && c2 >= 0 && (w0 || isWaterTile(layers, b2) || isWaterTile(layers, c2))) {
      idx.push(vert(b2), vert(c2), vert(i));
    }
  }
  const V = order.length;
  const pos = new Float32Array(V * 3);
  const nor = new Float32Array(V * 3);
  const uv = new Float32Array(V * 2);
  const ext = Math.max(1, planetExtent(radius).x * 2.2);
  for (let v = 0; v < V; v++) {
    const i = order[v]!;
    const [x, z] = tileXZ(hx.q[i]!, hx.r[i]!);
    pos[v * 3] = x;
    pos[v * 3 + 1] = isWaterTile(layers, i) ? 0.0 : -0.015;
    pos[v * 3 + 2] = z;
    nor[v * 3 + 1] = 1;
    uv[v * 2] = x / ext + 0.5;
    uv[v * 2 + 1] = z / ext + 0.5;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(new THREE.BufferAttribute(Uint32Array.from(idx), 1));
  if (V > 0) {
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
  }
  return { geo, waterTiles, waterTris: idx.length / 3 };
}

/** Creates the animated hydro water plane over Shallow and Deep hex tiles using `Liquids.ts`. */
export function createHexWater(radius: number, look: PlanetSpec, initialLayers: HexTileLayers): HexWater {
  const ext = planetExtent(radius);
  const span = Math.max(16, ext.x * 2.2);
  let heightTex = buildHeightTexture(sampleWaterBed(radius, initialLayers, span), TEX_RES);
  const shallowCol = look.palette.water ?? 0x38858f;
  const deepCol = look.palette.waterDeep ?? 0x10344a;
  const liquid: LiquidResult = createWater(
    { level: HEX_WATER_LEVEL, heightTex, span, coverage: span },
    shallowCol,
    deepCol,
    look.sky.skyColor,
  );
  liquid.mesh.name = 'hexWater';
  liquid.mesh.position.y = HEX_WATER_LEVEL;

  let waterTileCount = 0;
  let waterTriangleCount = 0;

  const syncGeometry = (layers: HexTileLayers) => {
    const { geo, waterTiles, waterTris } = buildWaterSurfaceGeometry(radius, layers);
    liquid.mesh.geometry.dispose();
    liquid.mesh.geometry = geo;
    liquid.mesh.visible = waterTiles > 0;
    waterTileCount = waterTiles;
    waterTriangleCount = waterTris;
  };

  syncGeometry(initialLayers);

  return {
    get mesh() {
      return liquid.mesh;
    },
    get uniforms() {
      return liquid.uniforms;
    },
    get waterTileCount() {
      return waterTileCount;
    },
    get waterTriangleCount() {
      return waterTriangleCount;
    },
    update(layers) {
      const nextTex = buildHeightTexture(sampleWaterBed(radius, layers, span), TEX_RES);
      heightTex.dispose();
      heightTex = nextTex;
      if (liquid.uniforms.uHeightTex) liquid.uniforms.uHeightTex.value = heightTex;
      syncGeometry(layers);
    },
    dispose() {
      heightTex.dispose();
      liquid.dispose();
      liquid.mesh.removeFromParent();
    },
  };
}

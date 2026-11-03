import * as THREE from 'three';
import { hexIndex, hexRound } from '@terra/sim/grid/hex';
import type { PlanetSpec } from '../PlanetSpec';
import { createWaterMaterial } from '../../visuals/water/WaterMaterial';
import { createWaterFauna, type WaterFauna } from '../../visuals/water/fauna';
import {
  bakeShoreField, createShoreField, createShoreFieldTexture, writeShoreFieldTexture, type WaterCodeAt,
} from '../../visuals/water/shoreField';
import { HEX_TERRAIN, isClearedPrep, type HexTileLayers } from './chunkMesh';
import { TILE_M, planetExtent } from './hexMath';
import { createWaterBucketSet } from './waterBuckets';

export const HEX_WATER_LEVEL = 0.0;

export interface HexWater {
  /** Parent of the surface buckets and the fauna, at the water level (add this to the scene). */
  readonly group: THREE.Group;
  /** Surface buckets: one Mesh per 32 m cell with water (`waterBuckets.ts`), all sharing `material`. */
  readonly buckets: readonly THREE.Mesh[];
  /** The one water material (F8 WATER / WIND and the clocks reach every bucket through it). */
  readonly material: THREE.Material;
  readonly uniforms: Record<string, THREE.IUniform>;
  readonly waterTileCount: number;
  readonly waterTriangleCount: number;
  /** Fish and jellies under the surface (a child of `group`; placed from the shore field, bucketed per cell). */
  readonly fauna: WaterFauna;
  /**
   * Re-reads the water tiles. With `changed` (tile indices), nothing is rebuilt unless one of them gained, lost or
   * changed its water (shallow / deep), and then only the surface buckets around those tiles; without it, the bed
   * texture and every bucket are rebuilt.
   */
  update(layers: HexTileLayers, changed?: ArrayLike<number>): void;
  /** Hides the surface buckets and fauna buckets wholly outside the view focus; call once per frame. */
  cullToFocus(): void;
  dispose(): void;
}

function isWaterTile(layers: HexTileLayers, i: number): boolean {
  if (!layers.terrain || i < 0) return false;
  if (isClearedPrep(layers.prep?.[i] ?? 0)) return false;
  const t = layers.terrain[i] ?? 0;
  return t === HEX_TERRAIN.shallow || t === HEX_TERRAIN.deep;
}

/** 0 = dry, 1 = shallow water, 2 = deep water: everything the bed texture and the surface read from a tile. */
function waterCode(layers: HexTileLayers, i: number): number {
  if (!isWaterTile(layers, i)) return 0;
  return layers.terrain![i] === HEX_TERRAIN.deep ? 2 : 1;
}

/**
 * `tileAt` with the hex index cached (same rounding as `planeToAxial`) returning the recorded water code: the shore
 * field calls it once per texel (512²), so it must stay cheap.
 */
export function hexWaterCodeAt(radius: number, codes: ArrayLike<number>): WaterCodeAt {
  const hx = hexIndex(radius);
  const inv = 1 / TILE_M, rk = 2 / Math.sqrt(3);
  return (x, z) => {
    const r = z * inv * rk;
    const [q, rr] = hexRound(x * inv - r / 2, r);
    const i = hx.indexOf(q, rr);
    return i < 0 ? 0 : codes[i]!;
  };
}

/** Creates the animated hydro water over Shallow and Deep hex tiles: spatial surface buckets sharing one material. */
export function createHexWater(radius: number, look: PlanetSpec, initialLayers: HexTileLayers): HexWater {
  const ext = planetExtent(radius);
  const span = Math.max(16, ext.x * 2.2);
  const field = createShoreField(span);
  const fieldTex = createShoreFieldTexture(field.res);
  const deepCol = look.palette.waterDeep ?? 0x10344a;
  const water = createWaterMaterial({
    shallow: look.palette.water ?? 0x38858f, deep: deepCol, sky: look.sky.skyColor, heightTex: fieldTex, span,
    level: HEX_WATER_LEVEL, shoreField: true,
  });
  const surface = createWaterBucketSet(radius, water.material);
  const group = new THREE.Group();
  group.name = 'hexWater';
  group.position.y = HEX_WATER_LEVEL;
  const fauna = createWaterFauna({ time: water.uniforms.uTime!, deepColor: { value: new THREE.Color(deepCol) }, seed: look.seed });
  group.add(surface.group, fauna.group);

  const hasWater = look.kind !== 'dune';
  let waterTileCount = 0;
  const codes = new Uint8Array(hexIndex(radius).count);
  const isWater = (i: number) => codes[i] !== 0;
  const setCode = (i: number, c: number) => { waterTileCount += (c !== 0 ? 1 : 0) - (codes[i] !== 0 ? 1 : 0); codes[i] = c; };
  /** Tiles of `changed` whose water code differs from the recorded one. */
  const waterChanges = (layers: HexTileLayers, changed: ArrayLike<number>) => {
    const out: number[] = [];
    for (let n = 0; n < changed.length; n++) {
      const i = changed[n]!;
      if (i >= 0 && i < codes.length && codes[i] !== waterCode(layers, i)) out.push(i);
    }
    return out;
  };

  const codeAt = hexWaterCodeAt(radius, codes);
  /** Re-bakes the bed / shore-distance / mask field from `codes` and re-places the fish. */
  const bakeField = () => {
    bakeShoreField(codeAt, field);
    writeShoreFieldTexture(fieldTex, field);
    if (water.uniforms.uHeightTex) water.uniforms.uHeightTex.value = fieldTex;
    fauna.rebuild(field);
  };
  const rebuildAll = (layers: HexTileLayers) => {
    for (let i = 0; i < codes.length; i++) setCode(i, waterCode(layers, i));
    bakeField();
    surface.rebuild(isWater);
    group.visible = waterTileCount > 0;
  };

  if (hasWater) rebuildAll(initialLayers);
  else group.visible = false;

  return {
    group,
    get buckets() { return surface.meshes; },
    material: water.material,
    uniforms: water.uniforms,
    get waterTileCount() { return waterTileCount; },
    get waterTriangleCount() { return surface.triangleCount; },
    fauna,
    update(layers, changed) {
      if (!hasWater) return;
      if (!changed) { rebuildAll(layers); return; }
      const touched = waterChanges(layers, changed);
      if (touched.length === 0) return;
      for (const i of touched) setCode(i, waterCode(layers, i));
      bakeField();
      surface.rebuild(isWater, surface.cellsTouchedBy(touched));
      group.visible = waterTileCount > 0;
    },
    cullToFocus() {
      surface.cullToFocus();
      fauna.cullToFocus();
    },
    dispose() {
      fauna.dispose();
      surface.dispose();
      fieldTex.dispose();
      water.dispose();
      group.removeFromParent();
    },
  };
}

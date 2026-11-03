import * as THREE from 'three';
import { HEX_DIRS, hexIndex } from '@terra/sim/grid/hex';
import { cullToViewFocus, worldCellKey } from '../../core/focusCull';
import { WAVE_VERT_PEAK } from '../../visuals/water/waveModel';
import { planetExtent, tileXZ } from './hexMath';
import { PROP_CELL_M } from './propBuckets';

/**
 * The hex water surface split into square world cells (`WATER_CELL_M`, the props' cell size): one Mesh per cell with
 * water, all sharing ONE material (so F8 / clock uniforms stay shared). three frustum-culls off-screen buckets (the
 * vertex swell then never runs for them) and `cullToFocus` hides buckets wholly outside the view focus. A water-tile
 * change rebuilds only the buckets whose triangles it touches.
 *
 * Triangles join three tile centres (the hex lattice's dual); each belongs to the bucket of its owner tile `i`
 * (`(i, (q, r+1), (q+1, r))` and `((q, r-1), (q-1, r), i)`), so every triangle exists once. Vertices on a cell border
 * are duplicated, which is seamless: everything the shader reads is derived from the world position.
 */
export const WATER_CELL_M = PROP_CELL_M;
/** Shore vertices (dry tile centres next to water) sit this far below the level; the shader masks them by height. */
export const WATER_SHORE_PIN_Y = -0.16;

export interface WaterBucketSet {
  /** Parent of the bucket meshes. */
  readonly group: THREE.Group;
  /** Live bucket meshes, ordered by cell key. */
  readonly meshes: readonly THREE.Mesh[];
  readonly triangleCount: number;
  /** Rebuilds every bucket (no `cells`) or only the given cells. */
  rebuild(isWater: (i: number) => boolean, cells?: Iterable<string>): void;
  /** Cells whose triangles a change of the given tiles can touch (the tiles' own cells and their neighbours'). */
  cellsTouchedBy(tiles: Iterable<number>): Set<string>;
  /** Hides buckets wholly outside the view focus; call once per frame. */
  cullToFocus(): void;
  dispose(): void;
}

interface CellGeometry { geo: THREE.BufferGeometry; tris: number }

/** Builds one cell's surface geometry (null when it has no water triangle), bounds padded by the vertex swell. */
function buildCell(radius: number, tiles: readonly number[], isWater: (i: number) => boolean, uvExt: number): CellGeometry | null {
  const hx = hexIndex(radius);
  const local = new Map<number, number>();
  const order: number[] = [];
  const vert = (i: number) => {
    let v = local.get(i);
    if (v === undefined) { v = order.length; local.set(i, v); order.push(i); }
    return v;
  };
  const idx: number[] = [];
  for (const i of tiles) {
    const w0 = isWater(i);
    const q = hx.q[i]!, r = hx.r[i]!;
    const b = hx.indexOf(q + 1, r), c = hx.indexOf(q, r + 1);
    if (b >= 0 && c >= 0 && (w0 || isWater(b) || isWater(c))) idx.push(vert(i), vert(c), vert(b));
    const b2 = hx.indexOf(q, r - 1), c2 = hx.indexOf(q - 1, r);
    if (b2 >= 0 && c2 >= 0 && (w0 || isWater(b2) || isWater(c2))) idx.push(vert(b2), vert(c2), vert(i));
  }
  if (idx.length === 0) return null;
  const V = order.length;
  const pos = new Float32Array(V * 3), nor = new Float32Array(V * 3), uv = new Float32Array(V * 2);
  for (let v = 0; v < V; v++) {
    const i = order[v]!;
    const [x, z] = tileXZ(hx.q[i]!, hx.r[i]!);
    pos.set([x, isWater(i) ? 0 : WATER_SHORE_PIN_Y, z], v * 3);
    nor[v * 3 + 1] = 1;
    uv.set([x / uvExt + 0.5, z / uvExt + 0.5], v * 2);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(new THREE.BufferAttribute(Uint32Array.from(idx), 1));
  geo.computeBoundingBox();
  const box = geo.boundingBox!;
  box.min.y = Math.min(box.min.y, -WAVE_VERT_PEAK); // the swell moves water vertices by up to ±WAVE_VERT_PEAK
  box.max.y = Math.max(box.max.y, WAVE_VERT_PEAK);
  geo.boundingSphere = box.getBoundingSphere(new THREE.Sphere());
  return { geo, tris: idx.length / 3 };
}

/** Tile indices per world cell (by the tile centre), and each tile's cell. */
function cellIndex(radius: number): { cells: Map<string, number[]>; cellOf: string[] } {
  const hx = hexIndex(radius);
  const cells = new Map<string, number[]>();
  const cellOf: string[] = new Array(hx.count);
  for (let i = 0; i < hx.count; i++) {
    const [x, z] = tileXZ(hx.q[i]!, hx.r[i]!);
    const key = worldCellKey(x, z, WATER_CELL_M);
    cellOf[i] = key;
    let list = cells.get(key);
    if (!list) cells.set(key, (list = []));
    list.push(i);
  }
  return { cells, cellOf };
}

export function createWaterBucketSet(radius: number, material: THREE.Material): WaterBucketSet {
  const hx = hexIndex(radius);
  const { cells, cellOf } = cellIndex(radius);
  const uvExt = Math.max(1, planetExtent(radius).x * 2.2);
  const group = new THREE.Group();
  group.name = 'hexWaterBuckets';
  const buckets = new Map<string, { mesh: THREE.Mesh; tris: number }>();
  let meshes: THREE.Mesh[] = [];
  let triangleCount = 0;

  const rebuildCell = (key: string, isWater: (i: number) => boolean) => {
    const old = buckets.get(key);
    const built = buildCell(radius, cells.get(key) ?? [], isWater, uvExt);
    if (old) { triangleCount -= old.tris; old.mesh.geometry.dispose(); }
    if (!built) {
      if (old) { group.remove(old.mesh); buckets.delete(key); }
      return;
    }
    triangleCount += built.tris;
    if (old) { old.mesh.geometry = built.geo; old.tris = built.tris; return; }
    const mesh = new THREE.Mesh(built.geo, material);
    mesh.name = `hexWater ${key}`;
    mesh.userData.waterCell = key;
    mesh.receiveShadow = true;
    mesh.renderOrder = 1; // after the (default-order) fauna, so the surface lies over them
    buckets.set(key, { mesh, tris: built.tris });
    group.add(mesh);
  };

  return {
    group,
    get meshes() { return meshes; },
    get triangleCount() { return triangleCount; },
    rebuild(isWater, only) {
      for (const key of only ?? cells.keys()) rebuildCell(key, isWater);
      meshes = [...buckets.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([, b]) => b.mesh);
    },
    cellsTouchedBy(tiles) {
      const out = new Set<string>();
      for (const i of tiles) {
        if (i < 0 || i >= hx.count) continue;
        out.add(cellOf[i]!);
        for (const [dq, dr] of HEX_DIRS) {
          const n = hx.indexOf(hx.q[i]! + dq, hx.r[i]! + dr);
          if (n >= 0) out.add(cellOf[n]!);
        }
      }
      return out;
    },
    cullToFocus() { cullToViewFocus(meshes, (m) => m.geometry.boundingSphere); },
    dispose() {
      for (const { mesh } of buckets.values()) { mesh.geometry.dispose(); mesh.removeFromParent(); }
      buckets.clear();
      meshes = [];
      triangleCount = 0;
    },
  };
}

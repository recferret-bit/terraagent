import * as THREE from 'three';
import { HEX_DIRS, hexIndex } from '@terra/sim/grid/hex';
import type { PlanetSpec } from '../../PlanetSpec';
import { sphereInViewFocus, viewFocusBounded, worldCellKey } from '../../../core/focusCull';
import { buildInstanced, createFoliageMaterial, type InstOpts, type Place } from '../../../visuals/terrain/Scatter';
import {
  makeBarrelCactusGeo,
  makeBushGeo,
  makeGrassTuftGeo,
  makeSaguaroCactusGeo,
  makeShoreReedsGeo,
  makeWildflowerGeo,
} from '../../../visuals/terrain/groundFloraGeos';
import { buildBiomeTreeAtlasGeo } from '../../../visuals/terrain/treeBreeds';
import { type HexTileLayers } from '../chunkMesh';
import { tileXZ } from '../hexMath';
import {
  GROUND_FLORA_KINDS,
  placeFloraByCellsWithExclusion,
  type GroundFloraKind,
} from './floraPlacementPipeline';

export { GROUND_FLORA_KINDS, type GroundFloraKind };

const FLORA_CELL_M = 32;
const FLORA_BOUNDS_PAD = 1.6;

export interface HexFloraCounts {
  grassTuft: number;
  wildflower: number;
  bush: number;
  saguaro: number;
  barrelCactus: number;
  reeds: number;
  duneTree: number;
}

export interface HexFloraLayer {
  readonly group: THREE.Group;
  readonly timeU: THREE.IUniform<number>;
  readonly meshes: Readonly<Record<GroundFloraKind, readonly THREE.InstancedMesh[]>>;
  counts(): HexFloraCounts;
  update(layers: HexTileLayers, heightAt: (x: number, z: number) => number, changed?: ArrayLike<number>): void;
  cullToFocus(): void;
  dispose(): void;
}

const jitterTint = (amt: number, hue = 0) => (rv: number, c: THREE.Color) => {
  const k = 1 + (rv - 0.5) * 2 * amt;
  c.setRGB(k * (1 + (rv - 0.5) * hue), k, k * (1 - (rv - 0.5) * hue));
};

const FLORA_OPTS: Record<GroundFloraKind, InstOpts> = {
  grassTuft: { sx: [0.55, 0.95], sy: [0.55, 1.15], sink: 0.03, tilt: 0.14, tint: jitterTint(0.22, 0.16), castShadow: false },
  wildflower: { sx: [0.65, 1.05], sy: [0.65, 1.15], sink: 0.03, tilt: 0.12, tint: jitterTint(0.20, 0.18), castShadow: false },
  bush: { sx: [0.58, 1.02], sy: [0.62, 1.08], sink: 0.06, tilt: 0.14, tint: jitterTint(0.20, 0.12), castShadow: true },
  saguaro: { sx: [0.55, 0.92], sy: [0.58, 1.08], sink: 0.08, tilt: 0.08, tint: jitterTint(0.16, 0.08), castShadow: true },
  barrelCactus: { sx: [0.62, 1.08], sy: [0.62, 1.06], sink: 0.06, tilt: 0.16, tint: jitterTint(0.18, 0.10), castShadow: true },
  reeds: { sx: [0.68, 1.08], sy: [0.72, 1.25], sink: 0.06, tilt: 0.12, tint: jitterTint(0.18, 0.10), castShadow: false },
  duneTree: { sx: [0.32, 0.50], sy: [0.36, 0.62], sink: 0.08, tilt: 0.06, tint: jitterTint(0.16, 0.08), encodeBreedInColor: true, castShadow: true },
};

function commitCellFloraMeshes(
  cell: string,
  byKind: Record<GroundFloraKind, Place[]> | undefined,
  geos: Record<GroundFloraKind, THREE.BufferGeometry>,
  mats: Record<GroundFloraKind, THREE.Material>,
  group: THREE.Group,
  meshes: Map<string, THREE.InstancedMesh>,
  cellCounts: Map<string, HexFloraCounts>,
): void {
  const cnt: HexFloraCounts = { grassTuft: 0, wildflower: 0, bush: 0, saguaro: 0, barrelCactus: 0, reeds: 0, duneTree: 0 };
  for (const kind of GROUND_FLORA_KINDS) {
    const key = `${kind}|${cell}`;
    const prev = meshes.get(key);
    if (prev) { group.remove(prev); prev.dispose(); meshes.delete(key); }
    const list = byKind?.[kind] ?? [];
    cnt[kind] = list.length;
    if (list.length === 0) continue;
    const im = buildInstanced(geos[kind], mats[kind], list, FLORA_OPTS[kind]);
    im.name = `hexFlora-${kind} ${cell}`;
    im.boundingSphere!.radius += FLORA_BOUNDS_PAD;
    im.boundingBox!.expandByScalar(FLORA_BOUNDS_PAD);
    meshes.set(key, im);
    group.add(im);
  }
  cellCounts.set(cell, cnt);
}

interface FloraSpatialIndex {
  tileX: Float32Array;
  tileZ: Float32Array;
  allTiles: number[];
  cellBounds: Map<string, { minX: number; maxX: number; minZ: number; maxZ: number }>;
  tileCell: string[];
}

function buildFloraSpatialIndex(hx: ReturnType<typeof hexIndex>): FloraSpatialIndex {
  const tileX = new Float32Array(hx.count);
  const tileZ = new Float32Array(hx.count);
  const allTiles = new Array<number>(hx.count);
  const cellBounds = new Map<string, { minX: number; maxX: number; minZ: number; maxZ: number }>();
  const tileCell = new Array<string>(hx.count);
  for (let i = 0; i < hx.count; i++) {
    allTiles[i] = i;
    const [x, z] = tileXZ(hx.q[i]!, hx.r[i]!);
    tileX[i] = x;
    tileZ[i] = z;
    const cell = worldCellKey(x, z, FLORA_CELL_M);
    tileCell[i] = cell;
    const b = cellBounds.get(cell);
    if (!b) cellBounds.set(cell, { minX: x, maxX: x, minZ: z, maxZ: z });
    else {
      if (x < b.minX) b.minX = x;
      if (x > b.maxX) b.maxX = x;
      if (z < b.minZ) b.minZ = z;
      if (z > b.maxZ) b.maxZ = z;
    }
  }
  return { tileX, tileZ, allTiles, cellBounds, tileCell };
}

function collectDirtyCellsAndEvalTiles(
  changed: ArrayLike<number>,
  hx: ReturnType<typeof hexIndex>,
  index: FloraSpatialIndex,
): { dirtyCells: Set<string>; evalTiles: number[] } {
  const dirtyCells = new Set<string>();
  for (let k = 0; k < changed.length; k++) {
    const idx = changed[k]!;
    if (idx < 0 || idx >= hx.count) continue;
    dirtyCells.add(index.tileCell[idx]!);
    const q = hx.q[idx]!, r = hx.r[idx]!;
    for (const [dq, dr] of HEX_DIRS) {
      const j = hx.indexOf(q + dq, r + dr);
      if (j >= 0) dirtyCells.add(index.tileCell[j]!);
    }
  }
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const cell of dirtyCells) {
    const b = index.cellBounds.get(cell);
    if (!b) continue;
    if (b.minX < minX) minX = b.minX;
    if (b.maxX > maxX) maxX = b.maxX;
    if (b.minZ < minZ) minZ = b.minZ;
    if (b.maxZ > maxZ) maxZ = b.maxZ;
  }
  const evalTiles: number[] = [];
  for (let i = 0; i < hx.count; i++) {
    const x = index.tileX[i]!, z = index.tileZ[i]!;
    if (x >= minX - 4.5 && x <= maxX + 4.5 && z >= minZ - 4.5 && z <= maxZ + 4.5) evalTiles.push(i);
  }
  return { dirtyCells, evalTiles };
}

export function createHexFloraLayer(radius: number, look: PlanetSpec): HexFloraLayer {
  const hx = hexIndex(radius);
  const group = new THREE.Group();
  group.name = 'hexFlora';
  const timeU: THREE.IUniform<number> = { value: 0 };

  const geos: Record<GroundFloraKind, THREE.BufferGeometry> = {
    grassTuft: makeGrassTuftGeo(look.kind, look.seed + 11),
    wildflower: makeWildflowerGeo(look.kind, look.seed + 23),
    bush: makeBushGeo(look.kind, look.seed + 37),
    saguaro: makeSaguaroCactusGeo(look.seed + 53),
    barrelCactus: makeBarrelCactusGeo(look.seed + 67),
    reeds: makeShoreReedsGeo(look.seed + 79),
    duneTree: buildBiomeTreeAtlasGeo('dune', look.seed + 97),
  };
  const mats: Record<GroundFloraKind, THREE.Material> = {
    grassTuft: createFoliageMaterial(timeU, 1.35, true, false),
    wildflower: createFoliageMaterial(timeU, 1.15, true, false),
    bush: createFoliageMaterial(timeU, 0.65, false, false),
    saguaro: createFoliageMaterial(timeU, 0.18, false, false),
    barrelCactus: createFoliageMaterial(timeU, 0.12, false, false),
    reeds: createFoliageMaterial(timeU, 1.65, true, false),
    duneTree: createFoliageMaterial(timeU, 0.80, true, true),
  };

  const index = buildFloraSpatialIndex(hx);
  const meshes = new Map<string, THREE.InstancedMesh>();
  const meshesByKind = Object.fromEntries(GROUND_FLORA_KINDS.map((k) => [k, []])) as unknown as Record<GroundFloraKind, THREE.InstancedMesh[]>;
  const syncKindMeshes = () => {
    for (const k of GROUND_FLORA_KINDS) {
      meshesByKind[k] = [...meshes.entries()].filter(([id]) => id.startsWith(`${k}|`)).map(([, m]) => m);
    }
  };
  const cellCounts = new Map<string, HexFloraCounts>();

  return {
    group,
    timeU,
    meshes: meshesByKind,
    counts() {
      const total: HexFloraCounts = { grassTuft: 0, wildflower: 0, bush: 0, saguaro: 0, barrelCactus: 0, reeds: 0, duneTree: 0 };
      for (const c of cellCounts.values()) {
        for (const k of GROUND_FLORA_KINDS) total[k] += c[k];
      }
      return total;
    },
    update(layers, heightAt, changed) {
      if (!changed) {
        const byCell = placeFloraByCellsWithExclusion(index.allTiles, null, index.tileCell, hx, radius, layers, heightAt, look);
        for (const cell of index.cellBounds.keys()) {
          commitCellFloraMeshes(cell, byCell.get(cell), geos, mats, group, meshes, cellCounts);
        }
        syncKindMeshes();
        return;
      }
      const { dirtyCells, evalTiles } = collectDirtyCellsAndEvalTiles(changed, hx, index);
      if (dirtyCells.size === 0) return;
      const byCell = placeFloraByCellsWithExclusion(evalTiles, dirtyCells, index.tileCell, hx, radius, layers, heightAt, look);
      for (const cell of dirtyCells) {
        commitCellFloraMeshes(cell, byCell.get(cell), geos, mats, group, meshes, cellCounts);
      }
      syncKindMeshes();
    },
    cullToFocus() {
      const bounded = viewFocusBounded();
      for (const m of meshes.values()) {
        m.visible = !bounded || sphereInViewFocus(m, m.boundingSphere!, 6);
      }
    },
    dispose() {
      for (const m of meshes.values()) { m.removeFromParent(); m.dispose(); }
      meshes.clear();
      cellCounts.clear();
      for (const k of GROUND_FLORA_KINDS) {
        geos[k].dispose();
        mats[k].dispose();
      }
      group.removeFromParent();
    },
  };
}

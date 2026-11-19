import * as THREE from 'three';
import { HEX_DIRS, hexDistance, hexIndex } from '@terra/sim/grid/hex';
import type { PlanetKind, PlanetSpec } from '../../PlanetSpec';
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
import { HEX_DEPOSIT, HEX_PREP, HEX_TERRAIN, isClearedPrep, tileHash01, tileHashU32, type HexTileLayers } from '../chunkMesh';
import { tileXZ } from '../hexMath';
import { generateTileForestTrees } from './forestPipeline';

export type GroundFloraKind = 'grassTuft' | 'wildflower' | 'bush' | 'saguaro' | 'barrelCactus' | 'reeds' | 'duneTree';

export const GROUND_FLORA_KINDS: readonly GroundFloraKind[] = [
  'grassTuft',
  'wildflower',
  'bush',
  'saguaro',
  'barrelCactus',
  'reeds',
  'duneTree',
] as const;

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
  duneTree: { sx: [0.34, 0.54], sy: [0.38, 0.68], sink: 0.08, tilt: 0.08, tint: jitterTint(0.16, 0.08), encodeBreedInColor: true, castShadow: true },
};

function makeSpot(
  q: number,
  r: number,
  cx: number,
  cz: number,
  heightAt: (x: number, z: number) => number,
  salt: number,
  radMin: number,
  radSpan: number,
): Place {
  const ang = tileHash01(q, r, salt) * Math.PI * 2;
  const dist = radMin + tileHash01(q, r, salt + 1) * radSpan;
  const x = cx + Math.cos(ang) * dist;
  const z = cz + Math.sin(ang) * dist;
  return {
    x,
    y: heightAt(x, z),
    z,
    rot: tileHash01(q, r, salt + 2) * Math.PI * 2,
    s: tileHash01(q, r, salt + 3),
    r: tileHash01(q, r, salt + 4),
  };
}

function bordersShallowWater(hx: ReturnType<typeof hexIndex>, q: number, r: number, layers: HexTileLayers, kind: PlanetKind): boolean {
  if (kind === 'dune' || !layers.terrain) return false;
  for (const [dq, dr] of HEX_DIRS) {
    const j = hx.indexOf(q + dq, r + dr);
    if (j >= 0 && !isClearedPrep(layers.prep?.[j] ?? 0) && layers.terrain[j] === HEX_TERRAIN.shallow) return true;
  }
  return false;
}

function scatterDuneTileFlora(
  q: number,
  r: number,
  tileIdx: number,
  t: number,
  rawH: number,
  cx: number,
  cz: number,
  heightAt: (x: number, z: number) => number,
  seed: number,
  into: Record<GroundFloraKind, Place[]>,
): void {
  const bioPatch = tileHash01(q, r, seed + 771);
  const wadiMoisture = rawH < 0.62 ? 0.14 : 0;
  if (t === HEX_TERRAIN.forest || (t === HEX_TERRAIN.slope && bioPatch + wadiMoisture > 0.965)) {
    const nTrees = t === HEX_TERRAIN.forest ? 1 + (tileHashU32(q, r, 109) % 2) : 1;
    for (const tr of generateTileForestTrees(q, r, tileIdx, 'dune', heightAt, seed, nTrees)) {
      into.duneTree.push(tr);
    }
  }
  if (t === HEX_TERRAIN.slope || t === HEX_TERRAIN.flat) {
    if (bioPatch > 0.84) into.saguaro.push(makeSpot(q, r, cx, cz, heightAt, 610, 0.18, 0.48));
    else if (bioPatch > 0.72) into.barrelCactus.push(makeSpot(q, r, cx, cz, heightAt, 630, 0.20, 0.50));
    if (tileHash01(q, r, seed + 641) > 0.68) into.bush.push(makeSpot(q, r, cx, cz, heightAt, 650, 0.24, 0.48));
    if (tileHash01(q, r, seed + 661) > 0.58) into.grassTuft.push(makeSpot(q, r, cx, cz, heightAt, 670, 0.22, 0.52));
  } else if (t === HEX_TERRAIN.rock && tileHash01(q, r, seed + 681) > 0.66) {
    into.barrelCactus.push(makeSpot(q, r, cx, cz, heightAt, 690, 0.28, 0.42));
  }
}

function scatterLushTileFlora(
  hx: ReturnType<typeof hexIndex>,
  q: number,
  r: number,
  t: number,
  prep: number,
  cx: number,
  cz: number,
  layers: HexTileLayers,
  heightAt: (x: number, z: number) => number,
  kind: PlanetKind,
  seed: number,
  into: Record<GroundFloraKind, Place[]>,
): void {
  if (prep === HEX_PREP.living) {
    for (let k = 0; k < 2; k++) into.grassTuft.push(makeSpot(q, r, cx, cz, heightAt, 710 + k * 9, 0.55, 0.22));
    if (tileHash01(q, r, seed + 729) > 0.45) into.wildflower.push(makeSpot(q, r, cx, cz, heightAt, 735, 0.52, 0.24));
    return;
  }
  if (isClearedPrep(prep)) return;

  if (bordersShallowWater(hx, q, r, layers, kind) && (t === HEX_TERRAIN.flat || t === HEX_TERRAIN.forest || t === HEX_TERRAIN.slope)) {
    const nReeds = 1 + (tileHashU32(q, r, 741) % 2);
    for (let k = 0; k < nReeds; k++) into.reeds.push(makeSpot(q, r, cx, cz, heightAt, 750 + k * 9, 0.35, 0.42));
  }

  if (t === HEX_TERRAIN.flat) {
    // Rich grass hexagon variations: meadow grass hex, wildflower clover hex, shrubby prairie hex, or open glade
    const hexVariant = tileHash01(q, r, seed + 811);
    if (hexVariant > 0.26) {
      const tufts = hexVariant > 0.72 ? 3 : 2;
      for (let k = 0; k < tufts; k++) into.grassTuft.push(makeSpot(q, r, cx, cz, heightAt, 820 + k * 11, 0.18, 0.56));
    }
    if (hexVariant > 0.60) into.wildflower.push(makeSpot(q, r, cx, cz, heightAt, 860, 0.20, 0.50));
    if (tileHash01(q, r, seed + 877) > 0.78) into.bush.push(makeSpot(q, r, cx, cz, heightAt, 885, 0.32, 0.40));
  } else if (t === HEX_TERRAIN.forest) {
    const uRoll = tileHash01(q, r, seed + 901);
    if (uRoll > 0.35) into.bush.push(makeSpot(q, r, cx, cz, heightAt, 910, 0.26, 0.44));
    if (uRoll > 0.52) into.wildflower.push(makeSpot(q, r, cx, cz, heightAt, 925, 0.24, 0.46));
    into.grassTuft.push(makeSpot(q, r, cx, cz, heightAt, 940, 0.20, 0.52));
  } else if (t === HEX_TERRAIN.slope && tileHash01(q, r, seed + 953) > 0.55) {
    into.grassTuft.push(makeSpot(q, r, cx, cz, heightAt, 960, 0.22, 0.48));
    if (tileHash01(q, r, seed + 971) > 0.68) into.bush.push(makeSpot(q, r, cx, cz, heightAt, 980, 0.26, 0.42));
  }
}

function scatterHexFloraTile(
  hx: ReturnType<typeof hexIndex>,
  radius: number,
  i: number,
  layers: HexTileLayers,
  heightAt: (x: number, z: number) => number,
  look: PlanetSpec,
  into: Record<GroundFloraKind, Place[]>,
): void {
  if (!layers.terrain) return;
  const dep = layers.deposit?.[i] ?? 0;
  if (dep === HEX_DEPOSIT.metals || dep === HEX_DEPOSIT.minerals || dep === HEX_DEPOSIT.oil) return;
  const prep = layers.prep?.[i] ?? 0;
  if (prep === HEX_PREP.ridge || prep === HEX_PREP.moat) return;
  const owned = (layers.owner?.[i] ?? -1) >= 0;
  if (owned && (prep === HEX_PREP.prepared || prep === HEX_PREP.irrigated || prep === HEX_PREP.flat)) return;
  const q = hx.q[i]!, r = hx.r[i]!;
  if (hexDistance(0, 0, q, r) >= radius) return; // keep outer planet rim crisp against sky
  const t = layers.terrain[i] ?? 0;
  if (t === HEX_TERRAIN.shallow || t === HEX_TERRAIN.deep || t === HEX_TERRAIN.hole) return;
  const [cx, cz] = tileXZ(q, r);
  if (look.kind === 'dune') {
    if (!isClearedPrep(prep)) scatterDuneTileFlora(q, r, i, t, layers.height[i] ?? 0, cx, cz, heightAt, look.seed, into);
    else if (prep === HEX_PREP.living) into.grassTuft.push(makeSpot(q, r, cx, cz, heightAt, 710, 0.45, 0.20));
  } else {
    scatterLushTileFlora(hx, q, r, t, prep, cx, cz, layers, heightAt, look.kind, look.seed, into);
  }
}

function rebuildFloraCellMeshes(
  cell: string,
  tilesInCell: readonly number[],
  hx: ReturnType<typeof hexIndex>,
  radius: number,
  layers: HexTileLayers,
  heightAt: (x: number, z: number) => number,
  look: PlanetSpec,
  geos: Record<GroundFloraKind, THREE.BufferGeometry>,
  mats: Record<GroundFloraKind, THREE.Material>,
  group: THREE.Group,
  meshes: Map<string, THREE.InstancedMesh>,
  cellCounts: Map<string, HexFloraCounts>,
): void {
  const byKind: Record<GroundFloraKind, Place[]> = {
    grassTuft: [], wildflower: [], bush: [], saguaro: [], barrelCactus: [], reeds: [], duneTree: [],
  };
  for (const i of tilesInCell) scatterHexFloraTile(hx, radius, i, layers, heightAt, look, byKind);

  const cnt: HexFloraCounts = { grassTuft: 0, wildflower: 0, bush: 0, saguaro: 0, barrelCactus: 0, reeds: 0, duneTree: 0 };
  for (const kind of GROUND_FLORA_KINDS) {
    const key = `${kind}|${cell}`;
    const prev = meshes.get(key);
    if (prev) { group.remove(prev); prev.dispose(); meshes.delete(key); }
    const list = byKind[kind];
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

  const cellTiles = new Map<string, number[]>();
  const tileCell = new Array<string>(hx.count);
  for (let i = 0; i < hx.count; i++) {
    const [x, z] = tileXZ(hx.q[i]!, hx.r[i]!);
    const cell = worldCellKey(x, z, FLORA_CELL_M);
    tileCell[i] = cell;
    let list = cellTiles.get(cell);
    if (!list) cellTiles.set(cell, (list = []));
    list.push(i);
  }

  const meshes = new Map<string, THREE.InstancedMesh>();
  const cellCounts = new Map<string, HexFloraCounts>();
  const rebuildCell = (cell: string, layers: HexTileLayers, heightAt: (x: number, z: number) => number) =>
    rebuildFloraCellMeshes(cell, cellTiles.get(cell) ?? [], hx, radius, layers, heightAt, look, geos, mats, group, meshes, cellCounts);

  return {
    group,
    timeU,
    counts() {
      const total: HexFloraCounts = { grassTuft: 0, wildflower: 0, bush: 0, saguaro: 0, barrelCactus: 0, reeds: 0, duneTree: 0 };
      for (const c of cellCounts.values()) {
        for (const k of GROUND_FLORA_KINDS) total[k] += c[k];
      }
      return total;
    },
    update(layers, heightAt, changed) {
      if (!changed) {
        for (const cell of cellTiles.keys()) rebuildCell(cell, layers, heightAt);
        return;
      }
      const dirtyCells = new Set<string>();
      for (let k = 0; k < changed.length; k++) {
        const idx = changed[k]!;
        if (idx < 0 || idx >= hx.count) continue;
        dirtyCells.add(tileCell[idx]!);
        const q = hx.q[idx]!, r = hx.r[idx]!;
        for (const [dq, dr] of HEX_DIRS) {
          const j = hx.indexOf(q + dq, r + dr);
          if (j >= 0) dirtyCells.add(tileCell[j]!);
        }
      }
      for (const cell of dirtyCells) rebuildCell(cell, layers, heightAt);
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

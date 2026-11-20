import * as THREE from 'three';
import { hexIndex, mixGroundSeed } from '@terra/sim/grid/hex';
import { buildBiomeOrchestratorConfig } from '../../orchestrators/BiomeConfig';
import { buildPropsView } from '../../orchestrators/biomeViews';
import { GroundObjectsOrchestrator } from '../../orchestrators/GroundObjectsOrchestrator';
import { ResourcesOrchestrator } from '../../orchestrators/ResourcesOrchestrator';
import { TreesOrchestrator } from '../../orchestrators/TreesOrchestrator';
import type { PlanetKind, PlanetSpec } from '../PlanetSpec';
import type { Place } from '../../visuals/terrain/Scatter';
import { GROUND_VARIANT_COUNT } from '../../visuals/terrain/groundFloraGeos';
import type { TreeBreedId } from '../../visuals/terrain/treeBreeds';
import {
  HEX_DEPOSIT,
  HEX_TERRAIN,
  tileHash01,
  tileHashU32,
  type HexTileLayers,
} from './chunkMesh';
import { generateTileForestTrees, type GeneratedForestTree } from './flora/forestPipeline';
import { canFitObjectOnTerrain, classifyHexTilePropSite } from './flora/terrainCompatibility';
import { clampToGroundHexagon, HEX_PROP_EDGE_MARGIN_M, tileXZ } from './hexMath';

export type PropKind = 'pine' | 'duneTree' | 'boulder' | 'spire' | 'metals' | 'minerals' | 'oil';
export type DepositVisualStage = 'full' | 'half' | 'depleted';

export const PROP_KINDS: readonly PropKind[] = ['pine', 'duneTree', 'boulder', 'spire', 'metals', 'minerals', 'oil'];

/** Maps a tile's deposit richness in basis points (`0..10000+`) to one of the 3 visual stages (`full`, `half`, `depleted`). */
export function getDepositVisualStage(richnessBp?: number): DepositVisualStage {
  if (richnessBp === undefined) return 'full';
  if (richnessBp <= 0) return 'depleted';
  if (richnessBp <= 5000) return 'half';
  return 'full';
}

export interface TilePropInstance extends Place {
  kind: PropKind;
  tileQ: number;
  tileR: number;
  tileIndex: number;
  breedId?: TreeBreedId;
}

export interface ChunkPropBuckets {
  pine: TilePropInstance[];
  duneTree: TilePropInstance[];
  boulder: TilePropInstance[];
  spire: TilePropInstance[];
  metals: TilePropInstance[];
  minerals: TilePropInstance[];
  oil: TilePropInstance[];
  total: number;
}

export interface HexPropScatter {
  readonly group: THREE.Group;
  /** Bucket meshes per kind (one per 32 m cell holding that kind, `propBuckets.ts`); drawn instance `i` of mesh `m` is
   * `m.userData.placed[placedIndex(m, i)]` (`propFocusCompaction.ts`). Kinds without props have no mesh. A rebuild replaces a kind's array, so hold the record. */
  readonly meshes: Readonly<Record<PropKind, readonly THREE.InstancedMesh[]>>;
  readonly timeU: THREE.IUniform<number>;
  /** Stores a chunk's props; a bucket whose instances did not change keeps its mesh at the next `rebuildMeshes`. */
  setChunk(key: string, buckets: ChunkPropBuckets): void;
  /** Rebuilds every bucket a `setChunk` changed since the last call (no-op when none did). */
  rebuildMeshes(): void;
  /** Hides the buckets wholly outside the view focus (cheap; call once per frame). */
  cullToFocus(): void;
  counts(): Record<PropKind, number>;
  instancesForTile(tileIndex: number): TilePropInstance[];
  /** Nearest prop (tree, rock, deposit) the ray hits → the tile it stands on, with the hit distance; null on a miss. */
  pickProp(ray: THREE.Raycaster): { q: number; r: number; distance: number } | null;
  dispose(): void;
}

function makeInstance(
  kind: PropKind,
  q: number,
  r: number,
  tileIndex: number,
  cx: number,
  cz: number,
  heightAt: (x: number, z: number) => number,
  k: number,
  count: number,
  saltBase: number,
  radMin: number,
  radSpan: number,
  radius?: number,
  planetSeed = 0,
): TilePropInstance {
  const seededSalt = mixGroundSeed(planetSeed, saltBase);
  const baseAngle = tileHash01(q, r, seededSalt + 99) * Math.PI * 2;
  const h1 = tileHash01(q, r, seededSalt + k * 7);
  const h2 = tileHash01(q, r, seededSalt + k * 7 + 1);
  const h3 = tileHash01(q, r, seededSalt + k * 7 + 2);
  const h4 = tileHash01(q, r, seededSalt + k * 7 + 3);
  const h5 = tileHash01(q, r, seededSalt + k * 7 + 4);
  const minR = count > 1 ? Math.max(radMin, 0.34) : radMin;
  const dist = minR + radSpan * h1;
  const sector = (Math.PI * 2) / Math.max(1, count);
  const angle = baseAngle + k * sector + (h2 - 0.5) * Math.min(0.42, sector * 0.3);
  let x: number;
  let z: number;
  if (radius !== undefined && radius > 0) {
    const [ax, az] = clampToGroundHexagon(radius, cx, cz, HEX_PROP_EDGE_MARGIN_M + minR + radSpan * 0.65);
    const rawX = ax + Math.cos(angle) * dist;
    const rawZ = az + Math.sin(angle) * dist;
    [x, z] = clampToGroundHexagon(radius, rawX, rawZ, HEX_PROP_EDGE_MARGIN_M);
  } else {
    x = cx + Math.cos(angle) * dist;
    z = cz + Math.sin(angle) * dist;
  }
  return {
    kind,
    tileQ: q,
    tileR: r,
    tileIndex,
    x,
    y: heightAt(x, z), // the prop's own spot on the surface, not the tile centre (RN-02)
    z,
    rot: h3 * Math.PI * 2,
    s: 0.25 + 0.7 * h4,
    r: h5,
    ...(kind === 'boulder' || kind === 'spire'
      ? { breedIndex: tileHashU32(q, r, seededSalt + k * 7 + 5) % GROUND_VARIANT_COUNT }
      : {}),
  };
}

/**
 * Deposit tier look: a richer deposit is a bigger cluster of larger, brighter nodes (same models and colours, so the
 * kind stays readable): tier 1 = 3 nodes, tier 2 = 4 nodes x1.12 size +10 % brightness, tier 3 = 5 nodes x1.24 +20 %.
 */
const DEPOSIT_TIER_LOOK: Record<1 | 2 | 3, { count: number; scale: number; tintMul?: number }> = {
  1: { count: 3, scale: 1 },
  2: { count: 4, scale: 1.12, tintMul: 1.1 },
  3: { count: 5, scale: 1.24, tintMul: 1.2 },
};

/** `depositTier` layer value -> visual tier (0 / unknown = legacy tier 1). */
export function depositVisualTier(depositTier?: number): 1 | 2 | 3 {
  return depositTier === 2 || depositTier === 3 ? depositTier : 1;
}

/**
 * Shrinks a node by depletion stage (`half` keeps two medium nodes and flattens the rest, `depleted` flattens all) and
 * grows it by the tier scale; a flattened node keeps its tier-1 height so it still reads as spent rubble.
 */
function applyDepositStage(inst: TilePropInstance, stage: DepositVisualStage, k: number, base: number, tierScale: number): void {
  inst.stage = stage;
  const [sxz, sy] = stage === 'full' ? [1, 1] : stage === 'half' ? (k < 2 ? [0.68, 0.68] : [0.68, 0.25]) : [0.65, 0.18];
  inst.scaleX = base * sxz * tierScale;
  inst.scaleY = base * sy * (sy < 0.5 ? 1 : tierScale);
  inst.scaleZ = base * sxz * tierScale;
}

function scatterDepositProps(
  depKind: PropKind,
  q: number,
  r: number,
  tileIndex: number,
  heightAt: (x: number, z: number) => number,
  stage: DepositVisualStage,
  depositTier?: number,
  radius?: number,
  planetSeed = 0,
): TilePropInstance[] {
  const look = DEPOSIT_TIER_LOOK[depositVisualTier(depositTier)];
  const [cx, cz] = tileXZ(q, r);
  const depSalt = mixGroundSeed(planetSeed, 800);
  const out: TilePropInstance[] = [];
  for (let k = 0; k < look.count; k++) {
    const inst = makeInstance(depKind, q, r, tileIndex, cx, cz, heightAt, k, look.count, 800, 0.34, 0.30, radius, planetSeed);
    applyDepositStage(inst, stage, k, 0.78 + 0.40 * tileHash01(q, r, depSalt + k * 7 + 3), look.scale);
    if (look.tintMul !== undefined) inst.tintMul = look.tintMul;
    out.push(inst);
  }
  return out;
}

function treeToPropInstance(propKind: 'pine' | 'duneTree', q: number, r: number, tileIndex: number, tr: GeneratedForestTree): TilePropInstance {
  return {
    kind: propKind,
    tileQ: q,
    tileR: r,
    tileIndex,
    x: tr.x,
    y: tr.y,
    z: tr.z,
    rot: tr.rot,
    s: tr.s,
    r: tr.r,
    scaleX: tr.scaleX,
    scaleY: tr.scaleY,
    scaleZ: tr.scaleZ,
    tintMul: tr.tintMul,
    breedId: tr.breedId,
    breedIndex: tr.breedIndex,
    windMul: tr.windMul,
  };
}

/**
 * Deterministic prop instances for a single hex tile `(q, r)` from its current `terrain`, `prep`, `deposit`, and `richnessBp`.
 * Evaluates `classifyHexTilePropSite` + `canFitObjectOnTerrain` purely from `(q, r)` and the tile's own state so clearing or
 * reclaiming a tile never shifts or mutates props on neighbouring tiles (RN-02).
 */
export function scatterTileProps(
  q: number,
  r: number,
  tileIndex: number,
  terrain: number,
  prep = 0,
  deposit = 0,
  heightAt: (x: number, z: number) => number = () => 0,
  kind: PlanetKind = 'forestRock',
  richnessBp?: number,
  /** Sim `depositTier` of the tile: 0 / undefined = legacy tier 1, else 1..3. */
  depositTier = 0,
  /** Optional planet radius: when given, clamps outer-ring/corner props inside the ground hexagon perimeter. */
  radius?: number,
  planetSeed = 17,
): TilePropInstance[] {
  const out: TilePropInstance[] = [];
  const [cx, cz] = tileXZ(q, r);
  const site = classifyHexTilePropSite(q, r, terrain, prep, deposit, kind, planetSeed);

  if (deposit === HEX_DEPOSIT.metals || deposit === HEX_DEPOSIT.minerals || deposit === HEX_DEPOSIT.oil) {
    const depKind: PropKind =
      deposit === HEX_DEPOSIT.metals ? 'metals' : deposit === HEX_DEPOSIT.minerals ? 'minerals' : 'oil';
    if (!canFitObjectOnTerrain(depKind, site)) return out;
    return scatterDepositProps(depKind, q, r, tileIndex, heightAt, getDepositVisualStage(richnessBp), depositTier, radius, planetSeed);
  }

  if (terrain === HEX_TERRAIN.forest) {
    if (canFitObjectOnTerrain('duneTree', site)) {
      const nTrees = 1 + (tileHashU32(q, r, mixGroundSeed(planetSeed, 109)) % 2);
      const trees = generateTileForestTrees(q, r, tileIndex, 'dune', heightAt, planetSeed, nTrees, radius);
      for (const tr of trees) {
        out.push(treeToPropInstance('duneTree', q, r, tileIndex, tr));
      }
      if (canFitObjectOnTerrain('boulder', site) && tileHashU32(q, r, mixGroundSeed(planetSeed, 101)) % 2 === 0) {
        const cand = makeInstance('boulder', q, r, tileIndex, cx, cz, heightAt, 0, 1, 520, 0.44, 0.20, radius, planetSeed);
        if (trees.every((tr) => Math.hypot(cand.x - tr.x, cand.z - tr.z) >= 0.95)) {
          out.push(cand);
        }
      }
    } else if (canFitObjectOnTerrain('pine', site)) {
      for (const tr of generateTileForestTrees(q, r, tileIndex, kind, heightAt, planetSeed, undefined, radius)) {
        out.push(treeToPropInstance('pine', q, r, tileIndex, tr));
      }
    }
  } else if (terrain === HEX_TERRAIN.rock && canFitObjectOnTerrain('spire', site)) {
    const count = 2 + (tileHashU32(q, r, mixGroundSeed(planetSeed, 303)) % 2);
    for (let k = 0; k < count; k++) {
      const propKind: PropKind = k === count - 1 ? 'spire' : 'boulder';
      if (!canFitObjectOnTerrain(propKind, site)) continue;
      out.push(makeInstance(propKind, q, r, tileIndex, cx, cz, heightAt, k, count, 400, 0.34, 0.34, radius, planetSeed));
    }
  }
  return out;
}

/** Scatters props for every tile in `chunkTiles`, bucketed by prop kind. */
export function scatterChunkProps(
  radius: number,
  chunkTiles: ArrayLike<number>,
  layers: HexTileLayers,
  heightAt: (x: number, z: number) => number,
): ChunkPropBuckets {
  const hx = hexIndex(radius);
  const buckets: ChunkPropBuckets = {
    pine: [],
    duneTree: [],
    boulder: [],
    spire: [],
    metals: [],
    minerals: [],
    oil: [],
    total: 0,
  };
  const terrain = layers.terrain;
  if (!terrain) return buckets;
  const prep = layers.prep;
  const deposit = layers.deposit;
  const richness = layers.richness;
  const depositTier = layers.depositTier;
  const kind = layers.kind ?? 'forestRock';
  const seed = layers.seed ?? 17;

  for (let n = 0; n < chunkTiles.length; n++) {
    const i = chunkTiles[n]!;
    const q = hx.q[i]!, r = hx.r[i]!;
    const props = scatterTileProps(
      q,
      r,
      i,
      terrain[i] ?? 0,
      prep?.[i] ?? 0,
      deposit?.[i] ?? 0,
      heightAt,
      kind,
      richness ? richness[i] : undefined,
      depositTier?.[i] ?? 0,
      radius,
      seed,
    );
    for (const p of props) {
      buckets[p.kind].push(p);
      buckets.total++;
    }
  }
  return buckets;
}

export const buildChunkPropInstances = scatterChunkProps;

/**
 * Pooled hex prop scatter facade backed by `TreesOrchestrator`, `GroundObjectsOrchestrator`, and `ResourcesOrchestrator`.
 */
export function createHexPropScatter(look: PlanetSpec, radius = 32): HexPropScatter {
  const group = new THREE.Group();
  group.name = 'hexProps';
  const floraSink = new THREE.Group();
  const timeU: THREE.IUniform<number> = { value: 0 };
  const cfg = buildBiomeOrchestratorConfig(look, radius);
  const trees = new TreesOrchestrator(cfg, group, floraSink, timeU);
  const groundObjects = new GroundObjectsOrchestrator(cfg, look, group, floraSink, timeU);
  const resources = new ResourcesOrchestrator(cfg, group);
  const view = buildPropsView(group, timeU, trees, groundObjects, resources);

  return {
    ...view,
    dispose() {
      view.dispose();
      trees.dispose();
      groundObjects.dispose();
      resources.dispose();
      group.removeFromParent();
    },
  };
}

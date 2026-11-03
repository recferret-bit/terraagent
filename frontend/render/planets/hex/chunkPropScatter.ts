import * as THREE from 'three';
import { hexIndex } from '@terra/sim/grid/hex';
import type { PlanetKind, PlanetSpec } from '../PlanetSpec';
import {
  createFoliageMaterial,
  createRockMaterial,
  makeBoulderGeo,
  makeBroadleafGeo,
  makePineGeo,
  makeSpireGeo,
  type InstOpts,
  type Place,
} from '../../visuals/terrain/Scatter';
import {
  HEX_DEPOSIT,
  HEX_TERRAIN,
  isClearedPrep,
  tileHash01,
  tileHashU32,
  type HexTileLayers,
} from './chunkMesh';
import { tileXZ } from './hexMath';
import { createPropBucketSet } from './propBuckets';

export type PropKind = 'pine' | 'boulder' | 'spire' | 'metals' | 'minerals' | 'oil';
export type DepositVisualStage = 'full' | 'half' | 'depleted';

export const PROP_KINDS: readonly PropKind[] = ['pine', 'boulder', 'spire', 'metals', 'minerals', 'oil'];

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
}

export interface ChunkPropBuckets {
  pine: TilePropInstance[];
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
): TilePropInstance {
  const baseAngle = tileHash01(q, r, saltBase + 99) * Math.PI * 2;
  const h1 = tileHash01(q, r, saltBase + k * 7);
  const h2 = tileHash01(q, r, saltBase + k * 7 + 1);
  const h3 = tileHash01(q, r, saltBase + k * 7 + 2);
  const h4 = tileHash01(q, r, saltBase + k * 7 + 3);
  const h5 = tileHash01(q, r, saltBase + k * 7 + 4);
  const minR = count > 1 ? Math.max(radMin, 0.34) : radMin;
  const dist = minR + radSpan * h1;
  const sector = (Math.PI * 2) / Math.max(1, count);
  const angle = baseAngle + k * sector + (h2 - 0.5) * Math.min(0.42, sector * 0.3);
  const x = cx + Math.cos(angle) * dist;
  const z = cz + Math.sin(angle) * dist;
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
): TilePropInstance[] {
  const look = DEPOSIT_TIER_LOOK[depositVisualTier(depositTier)];
  const [cx, cz] = tileXZ(q, r);
  const out: TilePropInstance[] = [];
  for (let k = 0; k < look.count; k++) {
    const inst = makeInstance(depKind, q, r, tileIndex, cx, cz, heightAt, k, look.count, 800, 0.34, 0.30);
    applyDepositStage(inst, stage, k, 0.78 + 0.40 * tileHash01(q, r, 800 + k * 7 + 3), look.scale);
    if (look.tintMul !== undefined) inst.tintMul = look.tintMul;
    out.push(inst);
  }
  return out;
}

/**
 * Deterministic prop instances for a single hex tile `(q, r)` from its current `terrain`, `prep`, `deposit`, and `richnessBp`.
 * Depends only on `(q, r)` and the tile's own state so clearing a tile never shifts props on neighbouring tiles.
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
): TilePropInstance[] {
  const out: TilePropInstance[] = [];
  const [cx, cz] = tileXZ(q, r);

  if (deposit === HEX_DEPOSIT.metals || deposit === HEX_DEPOSIT.minerals || deposit === HEX_DEPOSIT.oil) {
    if (kind === 'dune' && terrain === HEX_TERRAIN.rock) return out;
    const depKind: PropKind =
      deposit === HEX_DEPOSIT.metals ? 'metals' : deposit === HEX_DEPOSIT.minerals ? 'minerals' : 'oil';
    return scatterDepositProps(depKind, q, r, tileIndex, heightAt, getDepositVisualStage(richnessBp), depositTier);
  }

  if (!isClearedPrep(prep)) {
    if (terrain === HEX_TERRAIN.forest) {
      if (kind === 'dune') {
        const count = 1 + (tileHashU32(q, r, 101) % 2); // 1..2 desert boulders instead of trees
        for (let k = 0; k < count; k++) {
          out.push(makeInstance('boulder', q, r, tileIndex, cx, cz, heightAt, k, count, 200, 0.26, 0.38));
        }
      } else {
        const count = 2 + (tileHashU32(q, r, 101) % 3); // 2..4 trees
        for (let k = 0; k < count; k++) {
          out.push(makeInstance('pine', q, r, tileIndex, cx, cz, heightAt, k, count, 200, 0.34, 0.36));
        }
      }
    } else if (terrain === HEX_TERRAIN.rock && kind !== 'dune') {
      const count = 2 + (tileHashU32(q, r, 303) % 2); // 2..3 boulders/spires on non-dune rock
      for (let k = 0; k < count; k++) {
        const propKind: PropKind = k === count - 1 ? 'spire' : 'boulder';
        out.push(makeInstance(propKind, q, r, tileIndex, cx, cz, heightAt, k, count, 400, 0.34, 0.34));
      }
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
    );
    for (const p of props) {
      buckets[p.kind].push(p);
      buckets.total++;
    }
  }
  return buckets;
}

export const buildChunkPropInstances = scatterChunkProps;

const jitterTint = (amt: number, hueShift = 0) => (rv: number, c: THREE.Color) => {
  const k = 1 + (rv - 0.5) * 2 * amt;
  c.setRGB(k * (1 + (rv - 0.5) * hueShift), k, k * (1 - (rv - 0.5) * hueShift));
};

const INST_OPTS: Record<PropKind, InstOpts> = {
  pine: { sx: [0.32, 0.52], sy: [0.36, 0.68], sink: 0.08, tilt: 0.06, tint: jitterTint(0.18, 0.12) },
  boulder: { sx: [0.34, 0.60], sy: [0.42, 0.68], sink: 0.06, tilt: 0.20, tint: jitterTint(0.22) },
  spire: { sx: [0.32, 0.52], sy: [0.74, 1.38], sink: 0.10, tilt: 0.12, tint: jitterTint(0.2) },
  metals: { sx: [0.32, 0.50], sy: [0.44, 0.68], sink: 0.06, tilt: 0.18, tint: jitterTint(0.15, 0.08) },
  minerals: { sx: [0.32, 0.50], sy: [0.78, 1.32], sink: 0.10, tilt: 0.12, tint: jitterTint(0.15, -0.08) },
  oil: { sx: [0.32, 0.50], sy: [0.36, 0.54], sink: 0.05, tilt: 0.12, tint: jitterTint(0.12) },
};

/**
 * The hex props: deterministic per-tile scatter, drawn as spatially bucketed instanced meshes (`propBuckets.ts`, one
 * per 32 m cell and kind) so off-screen buckets are frustum-culled in the colour and shadow passes. `setChunk` marks
 * only the (cell, kind) buckets whose instances changed, so a delta that touches no props rebuilds nothing.
 */
export function createHexPropScatter(look: PlanetSpec): HexPropScatter {
  const group = new THREE.Group();
  group.name = 'hexProps';
  const timeU: THREE.IUniform<number> = { value: 0 };

  const rockTint = new THREE.Color(look.palette.rock);
  const darkTint = new THREE.Color(look.palette.rockDark);
  const treeGeo =
    look.kind === 'oceanForest'
      ? makeBroadleafGeo(new THREE.Color(look.palette.groundLow), new THREE.Color(look.palette.groundHigh), look.seed)
      : makePineGeo(new THREE.Color(0x2f6a3c), new THREE.Color(0x3f7a43));
  const geos: Record<PropKind, THREE.BufferGeometry> = {
    pine: treeGeo,
    boulder: makeBoulderGeo(11 + (look.seed % 7), rockTint),
    spire: makeSpireGeo(7 + (look.seed % 5), rockTint.clone().lerp(darkTint, 0.25)),
    metals: makeBoulderGeo(29, new THREE.Color(0xc86d28)),
    minerals: makeSpireGeo(43, new THREE.Color(0x38c8dc)),
    oil: makeBoulderGeo(61, new THREE.Color(0x1e1928)),
  };
  const mats: Record<PropKind, THREE.Material> = {
    pine: createFoliageMaterial(timeU, 0.7),
    boulder: createRockMaterial({ rough: 0.92 }),
    spire: createRockMaterial({ rough: 0.88 }),
    metals: createRockMaterial({ rough: 0.48, metal: 0.65 }),
    minerals: createRockMaterial({ rough: 0.28, metal: 0.25 }),
    oil: createRockMaterial({ rough: 0.22, metal: 0.35 }),
  };

  const buckets = createPropBucketSet(group, { kinds: PROP_KINDS, geos, mats, opts: INST_OPTS });
  const byChunk = new Map<string, ChunkPropBuckets>();

  return {
    group,
    meshes: buckets.meshes,
    timeU,
    setChunk(key, b) {
      buckets.setChunk(key, b);
      byChunk.set(key, b);
    },
    rebuildMeshes: () => buckets.rebuild(),
    cullToFocus: () => buckets.cullToFocus(),
    counts() {
      const out: Record<PropKind, number> = { pine: 0, boulder: 0, spire: 0, metals: 0, minerals: 0, oil: 0 };
      for (const b of byChunk.values()) {
        for (const k of PROP_KINDS) out[k] += b[k].length;
      }
      return out;
    },
    instancesForTile(tileIndex) {
      const out: TilePropInstance[] = [];
      for (const b of byChunk.values()) {
        for (const k of PROP_KINDS) {
          for (const inst of b[k]) {
            if (inst.tileIndex === tileIndex) out.push(inst);
          }
        }
      }
      return out;
    },
    pickProp: (ray) => buckets.pick(ray),
    dispose() {
      buckets.dispose();
      for (const k of PROP_KINDS) {
        geos[k].dispose();
        mats[k].dispose();
      }
      byChunk.clear();
      group.removeFromParent();
    },
  };
}

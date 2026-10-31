import * as THREE from 'three';
import { hexIndex } from '@terra/sim/grid/hex';
import type { PlanetKind, PlanetSpec } from '../PlanetSpec';
import {
  buildInstanced,
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
  HEX_PREP,
  HEX_TERRAIN,
  tileHash01,
  tileHashU32,
  type HexTileLayers,
} from './chunkMesh';
import { tileXZ } from './hexMath';

export type PropKind = 'pine' | 'boulder' | 'spire' | 'metals' | 'minerals' | 'oil';

export const PROP_KINDS: readonly PropKind[] = ['pine', 'boulder', 'spire', 'metals', 'minerals', 'oil'];

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
  readonly meshes: Record<PropKind, THREE.InstancedMesh>;
  readonly timeU: THREE.IUniform<number>;
  setChunk(key: string, buckets: ChunkPropBuckets): void;
  rebuildMeshes(): void;
  counts(): Record<PropKind, number>;
  instancesForTile(tileIndex: number): TilePropInstance[];
  dispose(): void;
}

function makeInstance(
  kind: PropKind,
  q: number,
  r: number,
  tileIndex: number,
  cx: number,
  cy: number,
  cz: number,
  k: number,
  count: number,
  saltBase: number,
  radMin: number,
  radSpan: number,
): TilePropInstance {
  const h1 = tileHash01(q, r, saltBase + k * 7);
  const h2 = tileHash01(q, r, saltBase + k * 7 + 1);
  const h3 = tileHash01(q, r, saltBase + k * 7 + 2);
  const h4 = tileHash01(q, r, saltBase + k * 7 + 3);
  const h5 = tileHash01(q, r, saltBase + k * 7 + 4);
  const dist = radMin + radSpan * h1;
  const angle = (k / count) * Math.PI * 2 + (h2 - 0.5) * 0.85;
  const x = cx + Math.cos(angle) * dist;
  const z = cz + Math.sin(angle) * dist;
  return {
    kind,
    tileQ: q,
    tileR: r,
    tileIndex,
    x,
    y: cy,
    z,
    rot: h3 * Math.PI * 2,
    s: 0.25 + 0.7 * h4,
    r: h5,
  };
}

/**
 * Deterministic prop instances for a single hex tile `(q, r)` from its current `terrain`, `prep`, and `deposit`.
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
): TilePropInstance[] {
  const out: TilePropInstance[] = [];
  const [cx, cz] = tileXZ(q, r);
  const cy = heightAt(cx, cz);
  const cleared = prep === HEX_PREP.prepared || prep === HEX_PREP.irrigated || prep === HEX_PREP.living;

  if (!cleared) {
    if (terrain === HEX_TERRAIN.forest) {
      if (kind === 'dune') {
        const count = 1 + (tileHashU32(q, r, 101) % 2); // 1..2 desert boulders instead of trees
        for (let k = 0; k < count; k++) {
          out.push(makeInstance('boulder', q, r, tileIndex, cx, cy, cz, k, count, 200, 0.26, 0.44));
        }
      } else {
        const count = 2 + (tileHashU32(q, r, 101) % 3); // 2..4 trees
        for (let k = 0; k < count; k++) {
          out.push(makeInstance('pine', q, r, tileIndex, cx, cy, cz, k, count, 200, 0.26, 0.48));
        }
      }
    } else if (terrain === HEX_TERRAIN.rock) {
      const count = 2 + (tileHashU32(q, r, 303) % 2); // 2..3 boulders/spires
      for (let k = 0; k < count; k++) {
        const propKind: PropKind = k === count - 1 ? 'spire' : 'boulder';
        out.push(makeInstance(propKind, q, r, tileIndex, cx, cy, cz, k, count, 400, 0.24, 0.44));
      }
    }
  }

  if (deposit === HEX_DEPOSIT.metals || deposit === HEX_DEPOSIT.minerals || deposit === HEX_DEPOSIT.oil) {
    const depKind: PropKind =
      deposit === HEX_DEPOSIT.metals ? 'metals' : deposit === HEX_DEPOSIT.minerals ? 'minerals' : 'oil';
    const depCount = 2 + (tileHashU32(q, r, 707) % 2); // 2..3 deposit nodes
    for (let k = 0; k < depCount; k++) {
      out.push(makeInstance(depKind, q, r, tileIndex, cx, cy, cz, k, depCount, 800, 0.2, 0.36));
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
  const kind = layers.kind ?? 'forestRock';

  for (let n = 0; n < chunkTiles.length; n++) {
    const i = chunkTiles[n]!;
    const q = hx.q[i]!, r = hx.r[i]!;
    const props = scatterTileProps(q, r, i, terrain[i] ?? 0, prep?.[i] ?? 0, deposit?.[i] ?? 0, heightAt, kind);
    for (const p of props) {
      buckets[p.kind].push(p);
      buckets.total++;
    }
  }
  return buckets;
}

const jitterTint = (amt: number, hueShift = 0) => (rv: number, c: THREE.Color) => {
  const k = 1 + (rv - 0.5) * 2 * amt;
  c.setRGB(k * (1 + (rv - 0.5) * hueShift), k, k * (1 - (rv - 0.5) * hueShift));
};

const INST_OPTS: Record<PropKind, InstOpts> = {
  pine: { sx: [0.32, 0.52], sy: [0.36, 0.68], sink: 0.08, tilt: 0.06, tint: jitterTint(0.18, 0.12) },
  boulder: { sx: [0.28, 0.56], sy: [0.22, 0.44], sink: 0.1, tilt: 0.32, tint: jitterTint(0.22) },
  spire: { sx: [0.26, 0.48], sy: [0.65, 1.35], sink: 0.04, tilt: 0.14, tint: jitterTint(0.2) },
  metals: { sx: [0.26, 0.44], sy: [0.24, 0.42], sink: 0.08, tilt: 0.28, tint: jitterTint(0.15, 0.08) },
  minerals: { sx: [0.22, 0.38], sy: [0.55, 1.1], sink: 0.03, tilt: 0.22, tint: jitterTint(0.15, -0.08) },
  oil: { sx: [0.3, 0.5], sy: [0.1, 0.2], sink: 0.06, tilt: 0.1, tint: jitterTint(0.12) },
};

/** Manages instanced prop meshes across all hex chunks; rebuilding a chunk updates only that chunk's slice. */
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

  const byChunk = new Map<string, ChunkPropBuckets>();
  const meshes = {} as Record<PropKind, THREE.InstancedMesh>;

  const rebuildMeshes = () => {
    for (const kind of PROP_KINDS) {
      const old = meshes[kind];
      if (old) {
        group.remove(old);
        old.dispose();
      }
      const merged: TilePropInstance[] = [];
      for (const b of byChunk.values()) {
        for (const inst of b[kind]) merged.push(inst);
      }
      const im = buildInstanced(geos[kind], mats[kind], merged, INST_OPTS[kind]);
      im.name = `hexProp-${kind}`;
      im.visible = merged.length > 0;
      meshes[kind] = im;
      group.add(im);
    }
  };

  rebuildMeshes();

  return {
    group,
    meshes,
    timeU,
    setChunk(key, buckets) {
      byChunk.set(key, buckets);
    },
    rebuildMeshes,
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
    dispose() {
      for (const k of PROP_KINDS) {
        meshes[k]?.dispose();
        geos[k].dispose();
        mats[k].dispose();
      }
      byChunk.clear();
      group.removeFromParent();
    },
  };
}

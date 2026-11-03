import * as THREE from 'three';
import { buildInstanced, type InstOpts } from '../../visuals/terrain/Scatter';
import { sphereInViewFocus, viewFocusBounded, worldCellKey } from '../../core/focusCull';
import { tileXZ } from './hexMath';
import { bucketShadowPad, compactBucketToFocus, placedIndex, resetPropShadowLights } from './propFocusCompaction';
import type { ChunkPropBuckets, PropKind, TilePropInstance } from './chunkPropScatter';

/**
 * Side (m) of the square world cells the props are bucketed into: one InstancedMesh per (cell, kind), so three's
 * frustum culling drops off-screen buckets in the colour pass AND in every shadow-map pass (one planet-wide mesh per
 * kind can never be culled, so every tree vertex ran with the wind shader in all three passes). Dense trees use
 * `PROP_CELL_M`; the sparser rocks and deposits use cells twice as wide, so they do not cost a draw call per few nodes.
 */
export const PROP_CELL_M = 32;
const SPARSE_CELL_M = PROP_CELL_M * 2;
/**
 * Bounds padding (m) on top of the instances' own bounds, for the foliage wind (`Scatter.ts` `FOLIAGE_SWAY_BEGIN`): a
 * ~5.9 m pine moves ~0.6 m at the default wind but ~1.9 m at the slider maxima (strength 2, gust 1: lean ≈ 1.2 m +
 * trunk ≈ 0.5 m + crown ≈ 0.2 m); with less, crowns of corner trees pop at the screen edge / fitted shadow box.
 */
export const PROP_BOUNDS_PAD = 2;

export const propCellSize = (kind: PropKind): number => (kind === 'pine' ? PROP_CELL_M : SPARSE_CELL_M);

/** Bucket cell of a `kind` prop on tile (q, r): by the tile centre, so a tile's props always share one bucket. */
export function tilePropCellKey(kind: PropKind, q: number, r: number): string {
  const [x, z] = tileXZ(q, r);
  return worldCellKey(x, z, propCellSize(kind));
}

type KindLists = Partial<Record<PropKind, TilePropInstance[]>>;
/** One chunk's props split by cell. */
type CellSplit = Map<string, KindLists>;

function splitByCell(b: ChunkPropBuckets, kinds: readonly PropKind[]): CellSplit {
  const out: CellSplit = new Map();
  for (const kind of kinds) {
    for (const inst of b[kind]) {
      const key = tilePropCellKey(kind, inst.tileQ, inst.tileR);
      let lists = out.get(key);
      if (!lists) out.set(key, (lists = {}));
      (lists[kind] ??= []).push(inst);
    }
  }
  return out;
}

const sameInstance = (a: TilePropInstance, b: TilePropInstance) =>
  a.kind === b.kind && a.tileIndex === b.tileIndex && a.x === b.x && a.y === b.y && a.z === b.z && a.rot === b.rot &&
  a.s === b.s && a.r === b.r && a.stage === b.stage && a.scaleX === b.scaleX && a.scaleY === b.scaleY &&
  a.scaleZ === b.scaleZ && a.tintMul === b.tintMul;

/** True when two instance lists are the same (scatter is deterministic, so an untouched tile re-scatters equal). */
function sameInstances(a: readonly TilePropInstance[] = [], b: readonly TilePropInstance[] = []): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!sameInstance(a[i]!, b[i]!)) return false;
  return true;
}

export interface PropBucketMeta {
  propKind: PropKind;
  propCell: string;
  /** Build order of the mesh's instances: drawn instance id `i` is `placed[placedIndex(mesh, i)]` (focus compaction). */
  placed: TilePropInstance[];
}

export const bucketMeta = (m: THREE.Object3D): PropBucketMeta => m.userData as PropBucketMeta;

export interface PropBucketSet {
  /** Live bucket meshes per kind (ordered by cell key); kinds without props have none. */
  readonly meshes: Readonly<Record<PropKind, readonly THREE.InstancedMesh[]>>;
  /** Stores a chunk's props; only the (cell, kind) buckets whose instances changed are marked for rebuild. */
  setChunk(key: string, buckets: ChunkPropBuckets): void;
  /** Rebuilds the dirty buckets (no-op when none is). */
  rebuild(): void;
  /**
   * Hides the buckets whose bounds lie wholly outside the view focus (`core/viewFocus.ts`). On top of three's frustum
   * culling this mainly trims the shadow-map passes, whose light frustum is wider than the view (measured on the
   * radius-56 dev planet: 5-12 % fewer triangles per frame).
   */
  cullToFocus(): void;
  /** Nearest prop instance the ray hits → its tile and hit distance. */
  pick(ray: THREE.Raycaster): { q: number; r: number; distance: number } | null;
  dispose(): void;
}

export interface PropBucketLook {
  kinds: readonly PropKind[];
  geos: Record<PropKind, THREE.BufferGeometry>;
  mats: Record<PropKind, THREE.Material>;
  opts: Record<PropKind, InstOpts>;
}

function buildBucket(look: PropBucketLook, kind: PropKind, cell: string, placed: TilePropInstance[]): THREE.InstancedMesh {
  const im = buildInstanced(look.geos[kind], look.mats[kind], placed, look.opts[kind]);
  im.name = `hexProp-${kind} ${cell}`;
  const meta: PropBucketMeta = { propKind: kind, propCell: cell, placed };
  Object.assign(im.userData, meta);
  im.boundingSphere!.radius += PROP_BOUNDS_PAD;
  im.boundingBox!.expandByScalar(PROP_BOUNDS_PAD);
  return im;
}

/** Spatially bucketed instanced meshes for the hex props, all under `group`. */
export function createPropBucketSet(group: THREE.Group, look: PropBucketLook): PropBucketSet {
  const splits = new Map<string, CellSplit>();
  const buckets = new Map<string, THREE.InstancedMesh>();
  const dirty = new Set<string>();
  const meshes = Object.fromEntries(look.kinds.map((k) => [k, []])) as unknown as Record<PropKind, THREE.InstancedMesh[]>;
  const id = (kind: PropKind, cell: string) => `${kind}|${cell}`;

  const rebuildOne = (bucketId: string) => {
    const sep = bucketId.indexOf('|');
    const kind = bucketId.slice(0, sep) as PropKind, cell = bucketId.slice(sep + 1);
    const old = buckets.get(bucketId);
    if (old) { group.remove(old); old.dispose(); buckets.delete(bucketId); }
    const merged: TilePropInstance[] = [];
    for (const split of splits.values()) for (const inst of split.get(cell)?.[kind] ?? []) merged.push(inst);
    if (merged.length === 0) return kind;
    const im = buildBucket(look, kind, cell, merged);
    buckets.set(bucketId, im);
    group.add(im);
    return kind;
  };

  return {
    meshes,
    setChunk(key, b) {
      const prev = splits.get(key), next = splitByCell(b, look.kinds);
      for (const cell of new Set([...(prev?.keys() ?? []), ...next.keys()])) {
        for (const kind of look.kinds) {
          if (!sameInstances(prev?.get(cell)?.[kind], next.get(cell)?.[kind])) dirty.add(id(kind, cell));
        }
      }
      splits.set(key, next);
    },
    rebuild() {
      if (dirty.size === 0) return;
      const kinds = new Set<PropKind>();
      for (const bucketId of dirty) kinds.add(rebuildOne(bucketId));
      dirty.clear();
      for (const kind of kinds) {
        meshes[kind] = [...buckets.entries()].filter(([k]) => k.startsWith(`${kind}|`)).sort(([a], [b]) => (a < b ? -1 : 1)).map(([, m]) => m);
      }
    },
    cullToFocus() {
      // A clamped focus (camera looking at the horizon) may not cover the whole screen: then frustum culling only.
      const bounded = viewFocusBounded();
      for (const m of buckets.values()) {
        if (!bounded) { compactBucketToFocus(m); m.visible = true; continue; }
        // a bucket straddling the focus draws only its instances near it (`propFocusCompaction.ts`)
        m.visible = sphereInViewFocus(m, m.boundingSphere!, bucketShadowPad(m)) && compactBucketToFocus(m);
      }
    },
    pick(ray) {
      for (const hit of ray.intersectObjects([...buckets.values()].filter((m) => m.visible), false)) {
        const im = hit.object as THREE.InstancedMesh;
        const inst = hit.instanceId !== undefined ? bucketMeta(im).placed?.[placedIndex(im, hit.instanceId)] : undefined;
        if (inst) return { q: inst.tileQ, r: inst.tileR, distance: hit.distance };
      }
      return null;
    },
    dispose() {
      for (const m of buckets.values()) { m.removeFromParent(); m.dispose(); }
      buckets.clear();
      splits.clear();
      resetPropShadowLights(); // the next session's lights are other cameras
    },
  };
}

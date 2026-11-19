import * as THREE from 'three';
import { hexIndex } from '@terra/sim/grid/hex';
import { buildChunk, type ChunkBuffers, type HexTileLayers } from './chunkMesh';
import { chunkKey, chunkLayout, type ChunkDef } from './chunks';
import { CHUNK_TILES } from './hexMath';
import { scatterChunkProps, type ChunkPropBuckets, type HexPropScatter } from './chunkPropScatter';

export interface PrecomputedChunkEntry {
  buffers: ChunkBuffers;
  props: ChunkPropBuckets;
}

export interface HexChunkSetOptions {
  precomputed?: Readonly<Record<string, PrecomputedChunkEntry>>;
  progressive?: boolean;
  priorityTile?: { q: number; r: number };
}

/** How far (hex steps) a changed tile reaches: its slope neighbours' heights (1), their normals (2), and chunks that
 * hold those tiles as border vertices (3). The axial box of this half-size covers every tile within that distance. */
const DIRTY_REACH = 3;

function createTerrainDepthMaterial(): THREE.MeshDepthMaterial {
  const mat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aRock;\nvarying float vRock;')
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvRock = aRock;\ntransformed.y -= 0.08;',
      );
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vRock;')
      .replace(
        '#include <clipping_planes_fragment>',
        '#include <clipping_planes_fragment>\nif (vRock < 0.001) discard;',
      );
  };
  return mat;
}

function buildChunkMesh(
  radius: number,
  def: ChunkDef,
  layers: HexTileLayers,
  effHeights: ArrayLike<number>,
  material: THREE.Material,
  depthMaterial: THREE.MeshDepthMaterial,
  precomputedBuffers?: ChunkBuffers,
): THREE.Mesh {
  const b = precomputedBuffers ?? buildChunk(radius, def.tiles, layers, undefined, effHeights);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(b.position, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(b.normal, 3));
  geo.setAttribute('aAO', new THREE.BufferAttribute(b.aAO, 1));
  geo.setAttribute('aRock', new THREE.BufferAttribute(b.aRock, 1));
  geo.setAttribute('aHexShore', new THREE.BufferAttribute(b.aHexShore, 1));
  geo.setIndex(new THREE.BufferAttribute(b.index, 1));
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = `hexChunk ${def.cq},${def.cr}`;
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  mesh.customDepthMaterial = depthMaterial;
  return mesh;
}

/** Keys of the chunks whose surface or props can change when the tiles in `changed` change. */
function collectDirtyChunks(radius: number, changed: ArrayLike<number>, known: { has(k: string): boolean }): Set<string> {
  const hx = hexIndex(radius);
  const dirty = new Set<string>();
  for (let n = 0; n < changed.length; n++) {
    const i = changed[n]!, q = hx.q[i]!, r = hx.r[i]!;
    for (let dq = -DIRTY_REACH; dq <= DIRTY_REACH; dq++) for (let dr = -DIRTY_REACH; dr <= DIRTY_REACH; dr++) {
      const k = chunkKey(q + dq, r + dr);
      if (known.has(k)) dirty.add(k);
    }
  }
  return dirty;
}

/** The surface meshes of one hex terrain, one per 32x32 chunk, plus their prop buckets in the shared scatter. */
export interface HexChunkSet {
  readonly meshes: ReadonlyMap<string, THREE.Mesh>;
  /** Rebuilds every chunk (`changed` omitted) or only those a change in `changed` can reach, then the dirty props. */
  rebuild(layers: HexTileLayers, effHeights: ArrayLike<number>, changed?: ArrayLike<number>): void;
  /** Begins a progressive multi-frame initial build sorted outward from `priorityTile`. */
  beginProgressive(layers: HexTileLayers, effHeights: ArrayLike<number>): void;
  /** Steps progressive chunk + prop bucket creation within `budgetMs`; returns `true` once 100% built. */
  stepProgressive(budgetMs?: number): boolean;
  /** Immediately completes any remaining progressive chunks + prop meshes. */
  finishProgressive(): void;
  isComplete(): boolean;
  dispose(): void;
}

function sortKeysFromPriority(defs: readonly ChunkDef[], priorityTile?: { q: number; r: number }): string[] {
  const pq = (priorityTile?.q ?? 0) / CHUNK_TILES - 0.5;
  const pr = (priorityTile?.r ?? 0) / CHUNK_TILES - 0.5;
  return [...defs]
    .sort((a, b) => Math.hypot(a.cq - pq, a.cr - pr) - Math.hypot(b.cq - pq, b.cr - pr))
    .map((d) => `${d.cq},${d.cr}`);
}

export function createHexChunkSet(
  radius: number,
  parent: THREE.Group,
  material: THREE.Material,
  props: HexPropScatter,
  heightAt: (x: number, z: number) => number,
  options?: HexChunkSetOptions,
): HexChunkSet {
  const defs = chunkLayout(radius);
  const byKey = new Map(defs.map((d) => [`${d.cq},${d.cr}`, d]));
  const meshes = new Map<string, THREE.Mesh>();
  const depthMaterial = createTerrainDepthMaterial();
  let precomputed: Record<string, PrecomputedChunkEntry> | null = options?.precomputed ? { ...options.precomputed } : null;
  let pendingKeys: string[] = [];
  let pendingLayers: HexTileLayers | null = null;
  let pendingHeights: ArrayLike<number> | null = null;
  let propsPendingRebuild = false;

  const place = (k: string, layers: HexTileLayers, effHeights: ArrayLike<number>) => {
    const def = byKey.get(k)!, old = meshes.get(k);
    if (old) { parent.remove(old); old.geometry.dispose(); }
    const pre = precomputed?.[k];
    if (pre && precomputed) delete precomputed[k];
    const m = buildChunkMesh(radius, def, layers, effHeights, material, depthMaterial, pre?.buffers);
    meshes.set(k, m);
    parent.add(m);
    props.setChunk(k, pre?.props ?? scatterChunkProps(radius, def.tiles, layers, heightAt));
  };

  const finishProgressive = () => {
    if (pendingKeys.length > 0 && pendingLayers && pendingHeights) {
      for (const k of pendingKeys) place(k, pendingLayers, pendingHeights);
    }
    pendingKeys = [];
    pendingLayers = null;
    pendingHeights = null;
    precomputed = null;
    if (propsPendingRebuild) {
      propsPendingRebuild = false;
      props.rebuildMeshes();
    }
  };

  return {
    meshes,
    rebuild(layers, effHeights, changed) {
      if (pendingKeys.length > 0 || propsPendingRebuild) finishProgressive();
      const keys = changed ? collectDirtyChunks(radius, changed, byKey) : byKey.keys();
      for (const k of keys) place(k, layers, effHeights);
      precomputed = null;
      props.rebuildMeshes();
    },
    beginProgressive(layers, effHeights) {
      pendingKeys = sortKeysFromPriority(defs, options?.priorityTile);
      pendingLayers = layers;
      pendingHeights = effHeights;
      propsPendingRebuild = true;
      // Place the closest 2 landing-zone chunks immediately so `heightAt` / local spawn geometry exist right away.
      const initial = Math.min(2, pendingKeys.length);
      for (let i = 0; i < initial; i++) {
        place(pendingKeys.shift()!, layers, effHeights);
      }
      if (pendingKeys.length === 0) finishProgressive();
    },
    stepProgressive(budgetMs = 2.0) {
      if (pendingKeys.length === 0 && !propsPendingRebuild) return true;
      const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
      const deadline = now() + Math.max(0.25, budgetMs);
      while (pendingKeys.length > 0 && pendingLayers && pendingHeights) {
        place(pendingKeys.shift()!, pendingLayers, pendingHeights);
        if (now() >= deadline) return false;
      }
      finishProgressive();
      return true;
    },
    finishProgressive,
    isComplete: () => pendingKeys.length === 0 && !propsPendingRebuild,
    dispose() {
      pendingKeys = [];
      pendingLayers = null;
      pendingHeights = null;
      precomputed = null;
      propsPendingRebuild = false;
      for (const m of meshes.values()) { m.geometry.dispose(); m.removeFromParent(); }
      meshes.clear();
      depthMaterial.dispose();
    },
  };
}

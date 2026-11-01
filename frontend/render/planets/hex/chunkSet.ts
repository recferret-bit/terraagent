import * as THREE from 'three';
import { hexIndex } from '@terra/sim/grid/hex';
import { buildChunk, type HexTileLayers } from './chunkMesh';
import { chunkKey, chunkLayout, type ChunkDef } from './chunks';
import { scatterChunkProps, type HexPropScatter } from './chunkPropScatter';

/** How far (hex steps) a changed tile reaches: its slope neighbours' heights (1), their normals (2), and chunks that
 * hold those tiles as border vertices (3). The axial box of this half-size covers every tile within that distance. */
const DIRTY_REACH = 3;

function buildChunkMesh(radius: number, def: ChunkDef, layers: HexTileLayers, effHeights: ArrayLike<number>, material: THREE.Material): THREE.Mesh {
  const b = buildChunk(radius, def.tiles, layers, undefined, effHeights);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(b.position, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(b.normal, 3));
  geo.setAttribute('aAO', new THREE.BufferAttribute(b.aAO, 1));
  geo.setAttribute('aRock', new THREE.BufferAttribute(b.aRock, 1));
  geo.setAttribute('color', new THREE.BufferAttribute(b.color, 3));
  geo.setAttribute('aPrepTarget', new THREE.BufferAttribute(b.aPrepTarget, 1));
  geo.setAttribute('aPrepStartTime', new THREE.BufferAttribute(b.aPrepStartTime, 1));
  geo.setIndex(new THREE.BufferAttribute(b.index, 1));
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = `hexChunk ${def.cq},${def.cr}`;
  mesh.receiveShadow = true;
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
  dispose(): void;
}

export function createHexChunkSet(
  radius: number,
  parent: THREE.Group,
  material: THREE.Material,
  props: HexPropScatter,
  heightAt: (x: number, z: number) => number,
): HexChunkSet {
  const defs = chunkLayout(radius);
  const byKey = new Map(defs.map((d) => [`${d.cq},${d.cr}`, d]));
  const meshes = new Map<string, THREE.Mesh>();

  const place = (k: string, layers: HexTileLayers, effHeights: ArrayLike<number>) => {
    const def = byKey.get(k)!, old = meshes.get(k);
    if (old) { parent.remove(old); old.geometry.dispose(); }
    const m = buildChunkMesh(radius, def, layers, effHeights, material);
    meshes.set(k, m);
    parent.add(m);
    props.setChunk(k, scatterChunkProps(radius, def.tiles, layers, heightAt));
  };

  return {
    meshes,
    rebuild(layers, effHeights, changed) {
      const keys = changed ? collectDirtyChunks(radius, changed, byKey) : byKey.keys();
      for (const k of keys) place(k, layers, effHeights);
      props.rebuildMeshes();
    },
    dispose() {
      for (const m of meshes.values()) { m.geometry.dispose(); m.removeFromParent(); }
      meshes.clear();
    },
  };
}

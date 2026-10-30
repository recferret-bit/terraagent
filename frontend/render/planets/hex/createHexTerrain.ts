import * as THREE from 'three';
import { hexIndex } from '@terra/sim/grid/hex';
import type { PlanetSpec } from '../PlanetSpec';
import { createTerrainMaterial, terrainUniforms } from '../../visuals/terrain/terrainMaterial';
import { buildChunk } from './chunkMesh';
import { chunkKey, chunkLayout, type ChunkDef } from './chunks';
import { addHexEdges } from './hexEdges';
import { planetExtent, rayGround, tileAt } from './hexMath';
import { makeHeightSampler } from './heightSampler';

/** Tile layers the terrain reads (apps pass plain arrays; the sim's `ClientTiles` fits). Only `height` shapes the surface for now. */
export interface HexTiles { terrain: ArrayLike<number>; height: ArrayLike<number> }

export interface HexPick { q: number; r: number; i: number }

export interface HexTerrain {
  readonly group: THREE.Group;
  readonly chunks: readonly THREE.Mesh[];
  readonly radius: number;
  /** Half-extent (m) of the largest square inside the planet: a camera clamped to it never leaves the ground. */
  readonly halfSize: number;
  heightAt(x: number, z: number): number;
  /** Ray (or NDC point + camera) → tile under it, or null when it misses the planet. */
  pick(ray: THREE.Raycaster | THREE.Vector2, camera?: THREE.Camera): HexPick | null;
  /** New tile layers; rebuilds only the chunks around `changed` tile indices (all when omitted). */
  updateTiles(tiles: HexTiles, changed?: ArrayLike<number>): void;
  dispose(): void;
}

export interface HexTerrainOptions {
  radius: number;
  tiles: HexTiles;
  look: PlanetSpec;
  /** Strength of the thin hex edge lines, 0..1 (default 0.55). */
  edges?: number;
}

const WIND: [number, number] = [0.8, 0.6];

/** Hex terrain from the sim tile grid: 32x32-tile chunks, one merged BufferGeometry each, the existing terrain shader. */
export function createHexTerrain(opts: HexTerrainOptions): HexTerrain {
  const { radius, look } = opts;
  let tiles = opts.tiles;
  const hx = hexIndex(radius);
  const ext = planetExtent(radius);
  const uniforms = terrainUniforms(look, -99, ext.x * 1.2, WIND);
  const edge: THREE.IUniform<number> = { value: opts.edges ?? 0.55 };
  const material = createTerrainMaterial(uniforms, (sh) => addHexEdges(sh, edge));
  const group = new THREE.Group();
  group.name = 'hexTerrain';
  const defs = chunkLayout(radius);
  const meshes = new Map<string, THREE.Mesh>();
  const heightAt = makeHeightSampler(radius, () => tiles.height);

  const build = (def: ChunkDef): THREE.Mesh => {
    const b = buildChunk(radius, def.tiles, tiles.height);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(b.position, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(b.normal, 3));
    geo.setAttribute('aAO', new THREE.BufferAttribute(b.aAO, 1));
    geo.setAttribute('aRock', new THREE.BufferAttribute(b.aRock, 1));
    geo.setIndex(new THREE.BufferAttribute(b.index, 1));
    geo.computeBoundingSphere(); geo.computeBoundingBox();
    const mesh = new THREE.Mesh(geo, material);
    mesh.name = `hexChunk ${def.cq},${def.cr}`;
    mesh.receiveShadow = true;
    return mesh;
  };
  const place = (def: ChunkDef) => {
    const k = `${def.cq},${def.cr}`, old = meshes.get(k);
    if (old) { group.remove(old); old.geometry.dispose(); }
    const m = build(def);
    meshes.set(k, m); group.add(m);
  };
  defs.forEach(place);
  const byKey = new Map(defs.map((d) => [`${d.cq},${d.cr}`, d]));

  const ray = new THREE.Raycaster();
  return {
    group, radius, halfSize: ext.z, heightAt,
    get chunks() { return [...meshes.values()]; },
    pick(input, camera) {
      let r = input as THREE.Raycaster;
      if (input instanceof THREE.Vector2) { ray.setFromCamera(input, camera!); r = ray; }
      const hit = rayGround(r.ray.origin, r.ray.direction, heightAt);
      return hit ? tileAt(radius, hit.x, hit.z) : null;
    },
    updateTiles(next, changed) {
      tiles = next;
      if (!changed) { defs.forEach(place); return; }
      const dirty = new Set<string>();
      for (let n = 0; n < changed.length; n++) {
        const i = changed[n]!, q = hx.q[i]!, r = hx.r[i]!;
        // a tile moves its own vertex and (through the fan normals) its 6 neighbours', each owned by chunks of tiles
        // one step around it: so every chunk within 2 steps of the tile
        for (let dq = -2; dq <= 2; dq++) for (let dr = -2; dr <= 2; dr++) {
          const k = chunkKey(q + dq, r + dr);
          if (byKey.has(k)) dirty.add(k);
        }
      }
      for (const k of dirty) place(byKey.get(k)!);
    },
    dispose() {
      for (const m of meshes.values()) m.geometry.dispose();
      meshes.clear(); material.dispose(); group.removeFromParent();
    },
  };
}

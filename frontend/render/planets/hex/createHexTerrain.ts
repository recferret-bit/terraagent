import * as THREE from 'three';
import { hexIndex } from '@terra/sim/grid/hex';
import type { PlanetSpec } from '../PlanetSpec';
import { createTerrainMaterial, terrainUniforms } from '../../visuals/terrain/terrainMaterial';
import {
  buildChunk,
  computeEffectiveHeights,
  HEX_PREP,
  INITIAL_PREP_START_TIME,
  PREP_BLEND_DURATION_S,
  type HexTileLayers,
} from './chunkMesh';
import { chunkKey, chunkLayout, type ChunkDef } from './chunks';
import { createHexPropScatter, scatterChunkProps, type HexPropScatter } from './chunkPropScatter';
import { addHexEdges } from './hexEdges';
import { planetExtent, rayGround, tileAt } from './hexMath';
import { createHexWater, HEX_WATER_LEVEL, type HexWater } from './hexWater';
import { makeHeightSampler } from './heightSampler';
import {
  buildTerritoryBorderGeometry,
  createTerritoryBorderMaterial,
  type TerritoryBorderStats,
} from './territoryBorder';

/** Tile layers the terrain reads (apps pass plain arrays; the sim's `ClientTiles` fits). */
export interface HexTiles extends HexTileLayers {
  terrain: ArrayLike<number>;
  height: ArrayLike<number>;
  prep?: ArrayLike<number>;
  deposit?: ArrayLike<number>;
  owner?: ArrayLike<number>;
}

export interface HexPick { q: number; r: number; i: number }

export interface HexTerrain {
  readonly group: THREE.Group;
  readonly chunks: readonly THREE.Mesh[];
  readonly material: THREE.MeshStandardMaterial;
  readonly uniforms: Record<string, THREE.IUniform>;
  readonly water: HexWater;
  readonly props: HexPropScatter;
  readonly borderMesh: THREE.Mesh;
  readonly radius: number;
  /** Half-extent (m) of the largest square inside the planet: a camera clamped to it never leaves the ground. */
  readonly halfSize: number;
  heightAt(x: number, z: number): number;
  /** Ray (or NDC point + camera) → tile under it, or null when it misses the planet. */
  pick(ray: THREE.Raycaster | THREE.Vector2, camera?: THREE.Camera): HexPick | null;
  /** New tile layers (or changed tile indices when `tiles` was mutated in-place); rebuilds dirty chunks and borders. */
  updateTiles(tilesOrChanged?: HexTiles | ArrayLike<number>, changed?: ArrayLike<number>): void;
  /** Advances shader time (`uTime`) for the 0.4 s Wild -> Prepared pad transition and water ripples. */
  tick(dt: number): void;
  /** Returns the current [0..1] Prepared pad blend factor for tile `(q, r)`. */
  getTilePrepBlend(q: number, r: number): number;
  /** Returns current territory border geometry statistics. */
  getTerritoryBorderStats(): TerritoryBorderStats;
  /** Enables or disables the colour-blind hatch pattern along territory borders. */
  setColorBlindMode(enabled: boolean): void;
  /** Overrides colony border colours (`ownerIndex -> hexColor`). */
  setColonyColors(colors: Record<number, number>): void;
  dispose(): void;
}

export type HexTerrainHandle = HexTerrain;

export interface HexTerrainOptions {
  radius: number;
  tiles: HexTiles;
  look: PlanetSpec;
  /** Strength of the thin hex edge lines, 0..1 (default 0.55). */
  edges?: number;
  /** Initial colour-blind hatch pattern mode for territory borders. */
  colorBlindMode?: boolean;
  /** Optional custom colony border colour overrides (`owner -> 0xrrggbb`). */
  colonyColors?: Record<number, number>;
}

const WIND: [number, number] = [0.8, 0.6];
const activeTerrains = new Set<HexTerrain>();
let globalColorBlindMode = false;

export function getActiveHexTerrains(): ReadonlySet<HexTerrain> {
  return activeTerrains;
}

export function getGlobalTerritoryColorBlindMode(): boolean {
  return globalColorBlindMode;
}

export function setGlobalTerritoryColorBlindMode(enabled: boolean): void {
  globalColorBlindMode = Boolean(enabled);
  for (const t of activeTerrains) {
    t.setColorBlindMode(globalColorBlindMode);
  }
}

function buildChunkMesh(
  radius: number,
  def: ChunkDef,
  layers: HexTileLayers,
  material: THREE.Material,
): THREE.Mesh {
  const b = buildChunk(radius, def.tiles, layers);
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

function syncPrepTransitionTimes(
  prevPrep: Uint8Array,
  startTimes: Float32Array,
  nextPrep: ArrayLike<number> | undefined,
  now: number,
): void {
  for (let i = 0; i < prevPrep.length; i++) {
    const wasPrep = prevPrep[i] === HEX_PREP.prepared;
    const p = nextPrep?.[i] ?? 0;
    const nowPrep = p === HEX_PREP.prepared;
    if (!wasPrep && nowPrep) startTimes[i] = now;
    else if (!nowPrep) startTimes[i] = INITIAL_PREP_START_TIME;
    prevPrep[i] = p;
  }
}

function collectDirtyChunks(
  hx: ReturnType<typeof hexIndex>,
  changed: ArrayLike<number>,
  byKey: ReadonlyMap<string, ChunkDef>,
): Set<string> {
  const dirty = new Set<string>();
  for (let n = 0; n < changed.length; n++) {
    const i = changed[n]!, q = hx.q[i]!, r = hx.r[i]!;
    for (let dq = -2; dq <= 2; dq++) for (let dr = -2; dr <= 2; dr++) {
      const k = chunkKey(q + dq, r + dr);
      if (byKey.has(k)) dirty.add(k);
    }
  }
  return dirty;
}

interface BorderController {
  readonly mesh: THREE.Mesh;
  rebuild(tiles: HexTileLayers, effHeights: ArrayLike<number>): void;
  getStats(): TerritoryBorderStats;
  setColorBlindMode(enabled: boolean, tiles: HexTileLayers, effHeights: ArrayLike<number>): void;
  setColonyColors(colors: Record<number, number>, tiles: HexTileLayers, effHeights: ArrayLike<number>): void;
  dispose(): void;
}

function createBorderController(
  radius: number,
  initialTiles: HexTileLayers,
  initialEffHeights: ArrayLike<number>,
  initialColorBlind: boolean,
  initialColonyColors?: Record<number, number>,
): BorderController {
  let colorBlindMode = initialColorBlind;
  let colonyColors: Record<number, number> = { ...(initialColonyColors ?? {}) };
  const mat = createTerritoryBorderMaterial();
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat);
  mesh.name = 'territory-border';
  mesh.renderOrder = 2;
  let stats: TerritoryBorderStats = {
    ownedTileCount: 0,
    boundaryEdgeCount: 0,
    frozenEdgeCount: 0,
    hatchSegmentCount: 0,
    colorBlindMode,
  };

  const rebuild = (tiles: HexTileLayers, effHeights: ArrayLike<number>) => {
    const res = buildTerritoryBorderGeometry(radius, tiles, { effHeights, colorBlindMode, colonyColors });
    mesh.geometry.dispose();
    mesh.geometry = res.geometry;
    mesh.visible = res.stats.boundaryEdgeCount > 0;
    stats = res.stats;
  };

  rebuild(initialTiles, initialEffHeights);

  return {
    mesh,
    rebuild,
    getStats: () => ({ ...stats }),
    setColorBlindMode(enabled, tiles, effHeights) {
      colorBlindMode = Boolean(enabled);
      rebuild(tiles, effHeights);
    },
    setColonyColors(colors, tiles, effHeights) {
      colonyColors = { ...colors };
      rebuild(tiles, effHeights);
    },
    dispose() {
      mesh.geometry.dispose();
      mat.dispose();
      mesh.removeFromParent();
    },
  };
}

function resolveTilesAndChanged(
  current: HexTiles,
  nextOrChanged?: HexTiles | ArrayLike<number>,
  maybeChanged?: ArrayLike<number>,
): { tiles: HexTiles; changed?: ArrayLike<number> } {
  if (!nextOrChanged) return { tiles: current, changed: maybeChanged };
  if ('height' in nextOrChanged) return { tiles: nextOrChanged, changed: maybeChanged };
  return { tiles: current, changed: nextOrChanged };
}

/** Hex terrain from the sim tile grid: 32x32-tile chunks, class relief, hydro water plane, and per-tile prop scatter. */
export function createHexTerrain(opts: HexTerrainOptions): HexTerrain {
  const { radius, look } = opts;
  const hx = hexIndex(radius);
  let tiles = opts.tiles;
  let elapsedTime = 0;
  const prevPrep = new Uint8Array(hx.count);
  const prepStartTimes = new Float32Array(hx.count).fill(INITIAL_PREP_START_TIME);
  for (let i = 0; i < hx.count; i++) prevPrep[i] = tiles.prep?.[i] ?? 0;

  let effHeights = computeEffectiveHeights(radius, tiles);
  const ext = planetExtent(radius);
  const uniforms = terrainUniforms(look, HEX_WATER_LEVEL, ext.x * 1.2, WIND);
  const edge: THREE.IUniform<number> = { value: opts.edges ?? 0.55 };
  const material = createTerrainMaterial(uniforms, (sh) => addHexEdges(sh, edge));
  const group = new THREE.Group();
  group.name = 'hexTerrain';
  const defs = chunkLayout(radius);
  const meshes = new Map<string, THREE.Mesh>();
  const heightAt = makeHeightSampler(radius, () => effHeights);
  const water = createHexWater(radius, look, tiles);
  const props = createHexPropScatter(look);
  const borders = createBorderController(radius, tiles, effHeights, opts.colorBlindMode ?? globalColorBlindMode, opts.colonyColors);

  const place = (def: ChunkDef) => {
    const k = `${def.cq},${def.cr}`, old = meshes.get(k);
    if (old) { group.remove(old); old.geometry.dispose(); }
    const m = buildChunkMesh(radius, def, { ...tiles, prepStartTime: prepStartTimes }, material);
    meshes.set(k, m);
    group.add(m);
    props.setChunk(k, scatterChunkProps(radius, def.tiles, tiles, heightAt));
  };

  defs.forEach(place);
  props.rebuildMeshes();
  group.add(water.mesh, props.group, borders.mesh);
  const byKey = new Map(defs.map((d) => [`${d.cq},${d.cr}`, d]));
  const ray = new THREE.Raycaster();

  const handle: HexTerrain = {
    group, material, uniforms, water, props, borderMesh: borders.mesh, radius, halfSize: ext.z, heightAt,
    get chunks() { return [...meshes.values()]; },
    pick(input, camera) {
      let r = input as THREE.Raycaster;
      if (input instanceof THREE.Vector2) { ray.setFromCamera(input, camera!); r = ray; }
      const hit = rayGround(r.ray.origin, r.ray.direction, heightAt);
      return hit ? tileAt(radius, hit.x, hit.z) : null;
    },
    updateTiles(nextOrChanged, maybeChanged) {
      const resolved = resolveTilesAndChanged(tiles, nextOrChanged, maybeChanged);
      tiles = resolved.tiles;
      syncPrepTransitionTimes(prevPrep, prepStartTimes, tiles.prep, elapsedTime);
      effHeights = computeEffectiveHeights(radius, tiles);
      if (!resolved.changed) defs.forEach(place);
      else for (const k of collectDirtyChunks(hx, resolved.changed, byKey)) place(byKey.get(k)!);
      props.rebuildMeshes();
      water.update(tiles);
      borders.rebuild(tiles, effHeights);
    },
    tick(dt) {
      elapsedTime += Math.max(0, dt);
      if (uniforms.uTime) uniforms.uTime.value = elapsedTime;
      if (water.uniforms.uTime) water.uniforms.uTime.value = elapsedTime;
    },
    getTilePrepBlend(q, r) {
      const i = hx.indexOf(q, r);
      if (i < 0 || (tiles.prep?.[i] ?? 0) !== HEX_PREP.prepared) return 0;
      const start = prepStartTimes[i] ?? INITIAL_PREP_START_TIME;
      return Math.min(1, Math.max(0, (elapsedTime - start) / PREP_BLEND_DURATION_S));
    },
    getTerritoryBorderStats: () => borders.getStats(),
    setColorBlindMode: (enabled) => borders.setColorBlindMode(enabled, tiles, effHeights),
    setColonyColors: (colors) => borders.setColonyColors(colors, tiles, effHeights),
    dispose() {
      activeTerrains.delete(handle);
      for (const m of meshes.values()) m.geometry.dispose();
      meshes.clear();
      water.dispose(); props.dispose(); borders.dispose(); material.dispose();
      group.removeFromParent();
    },
  };
  activeTerrains.add(handle);
  return handle;
}

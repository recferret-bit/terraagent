import * as THREE from 'three';
import { hexIndex } from '@terra/sim/grid/hex';
import type { PlanetSpec } from '../PlanetSpec';
import { createTerrainMaterial, terrainUniforms } from '../../visuals/terrain/terrainMaterial';
import { computeEffectiveHeights, HEX_PREP, type HexTileLayers } from './chunkMesh';
import { createHexChunkSet } from './chunkSet';
import { createHexPropScatter, type HexPropScatter } from './chunkPropScatter';
import { createBorderController } from './borderController';
import { addHexEdges, foundationPadUniforms } from './hexEdges';
import { planetExtent, rayGround, tileAt } from './hexMath';
import { createHexWater, HEX_WATER_LEVEL, type HexWater } from './hexWater';
import { makeHeightSampler } from './heightSampler';
import { PrepTransitions } from './prepTransitions';
import type { TerritoryBorderStats } from './territoryBorder';

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
  /**
   * New tile layers (or changed tile indices when `tiles` was mutated in-place). With `changed`, only the chunks and
   * props a changed tile can reach are rebuilt, and the water only when a changed tile gained or lost water; an empty
   * `changed` rebuilds nothing but the borders. Without `changed`, everything is rebuilt.
   */
  updateTiles(tilesOrChanged?: HexTiles | ArrayLike<number>, changed?: ArrayLike<number>): void;
  /** Rebuilds only the territory borders (owner layer changed), optionally from new tile layers with the same ground. */
  refreshBorders(tiles?: HexTiles): void;
  /** Advances shader time (`uTime`, foliage sway) for the 0.4 s Wild -> Prepared pad transition and water ripples. */
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
  const prep = new PrepTransitions(hx.count, tiles.prep);
  let effHeights = computeEffectiveHeights(radius, tiles);
  const ext = planetExtent(radius);
  const uniforms = { ...terrainUniforms(look, HEX_WATER_LEVEL, ext.x * 1.2, WIND), ...foundationPadUniforms() };
  const edge: THREE.IUniform<number> = { value: opts.edges ?? 0.55 };
  const material = createTerrainMaterial(uniforms, (sh) => addHexEdges(sh, edge));
  const group = new THREE.Group();
  group.name = 'hexTerrain';
  const heightAt = makeHeightSampler(radius, () => effHeights);
  const water = createHexWater(radius, look, tiles);
  const props = createHexPropScatter(look);
  const borders = createBorderController(radius, tiles, effHeights, opts.colorBlindMode ?? globalColorBlindMode, opts.colonyColors);
  const chunks = createHexChunkSet(radius, group, material, props, heightAt);
  const chunkLayers = (): HexTileLayers => ({ ...tiles, prepStartTime: prep.startTimes, kind: look.kind });

  chunks.rebuild(chunkLayers(), effHeights);
  group.add(water.mesh, props.group, borders.mesh);
  const ray = new THREE.Raycaster();

  const handle: HexTerrain = {
    group, material, uniforms, water, props, borderMesh: borders.mesh, radius, halfSize: ext.z, heightAt,
    get chunks() { return [...chunks.meshes.values()]; },
    pick(input, camera) {
      let r = input as THREE.Raycaster;
      if (input instanceof THREE.Vector2) { ray.setFromCamera(input, camera!); r = ray; }
      const hit = rayGround(r.ray.origin, r.ray.direction, heightAt);
      return hit ? tileAt(radius, hit.x, hit.z) : null;
    },
    updateTiles(nextOrChanged, maybeChanged) {
      const resolved = resolveTilesAndChanged(tiles, nextOrChanged, maybeChanged);
      tiles = resolved.tiles;
      prep.sync(tiles.prep, elapsedTime);
      const changed = resolved.changed;
      if (!changed || changed.length > 0) {
        effHeights = computeEffectiveHeights(radius, tiles);
        chunks.rebuild(chunkLayers(), effHeights, changed);
        water.update(tiles, changed);
      }
      borders.rebuild(tiles, effHeights);
    },
    refreshBorders(next) {
      if (next) tiles = next;
      borders.rebuild(tiles, effHeights);
    },
    tick(dt) {
      elapsedTime += Math.max(0, dt);
      if (uniforms.uTime) uniforms.uTime.value = elapsedTime;
      if (water.uniforms.uTime) water.uniforms.uTime.value = elapsedTime;
      props.timeU.value = elapsedTime;
      const settled = prep.settle(elapsedTime);
      if (settled.length) chunks.rebuild(chunkLayers(), effHeights, settled);
    },
    getTilePrepBlend(q, r) {
      const i = hx.indexOf(q, r);
      return i < 0 ? 0 : prep.blend(i, (tiles.prep?.[i] ?? 0) === HEX_PREP.prepared, elapsedTime);
    },
    getTerritoryBorderStats: () => borders.getStats(),
    setColorBlindMode: (enabled) => borders.setColorBlindMode(enabled, tiles, effHeights),
    setColonyColors: (colors) => borders.setColonyColors(colors, tiles, effHeights),
    dispose() {
      activeTerrains.delete(handle);
      chunks.dispose();
      water.dispose(); props.dispose(); borders.dispose(); material.dispose();
      group.removeFromParent();
    },
  };
  activeTerrains.add(handle);
  return handle;
}

import * as THREE from 'three';
import { hexIndex } from '@terra/sim/grid/hex';
import type { PlanetSpec } from '../PlanetSpec';
import { createTerrainMaterial, terrainUniforms } from '../../visuals/terrain/terrainMaterial';
import { computeEffectiveHeights, type HexTileLayers } from './chunkMesh';
import { createHexChunkSet } from './chunkSet';
import { createHexPropScatter, type HexPropScatter } from './chunkPropScatter';
import { createBorderController } from './borderController';
import { addHexEdges } from './hexEdges';
import { planetExtent, rayGround, tileAt } from './hexMath';
import { createHexWater, HEX_WATER_LEVEL, type HexWater } from './hexWater';
import { createHexAmbient } from './hexAmbient';
import { getWindUniforms } from '../../core/windConfig';
import { makeHeightSampler } from './heightSampler';
import type { TerritoryBorderStats } from './territoryBorder';
import { createHexTileTint } from './tileTint';

/** Tile layers the terrain reads (apps pass plain arrays; the sim's `ClientTiles` fits). */
export interface HexTiles extends HexTileLayers {
  terrain: ArrayLike<number>;
  height: ArrayLike<number>;
  prep?: ArrayLike<number>;
  deposit?: ArrayLike<number>;
  richness?: ArrayLike<number>;
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
  /** Mutates a single tile's state in place (including optional deposit richness) and incrementally rebuilds chunks/props. */
  setTileState(
    q: number,
    r: number,
    terrain?: number,
    prep?: number,
    height?: number,
    deposit?: number,
    richness?: number,
  ): void;
  /** Rebuilds only the territory borders (owner layer changed), optionally from new tile layers with the same ground. */
  refreshBorders(tiles?: HexTiles): void;
  /** Advances shader time (`uTime`) for foliage sway and water ripples. */
  tick(dt: number): void;
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

/** Placeholder only: the hex terrain's `uWind` is replaced by the shared F8 wind direction (`core/windConfig.ts`). */
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

function applyTileStateMutation(
  tiles: HexTiles,
  count: number,
  idx: number,
  terrainVal?: number,
  prepVal?: number,
  heightVal?: number,
  depositVal?: number,
  richnessVal?: number,
): void {
  if (terrainVal !== undefined) (tiles.terrain as { [n: number]: number })[idx] = terrainVal;
  if (prepVal !== undefined) {
    if (!tiles.prep) (tiles as { prep?: Uint8Array }).prep = new Uint8Array(count);
    (tiles.prep as { [n: number]: number })[idx] = prepVal;
  }
  if (heightVal !== undefined) (tiles.height as { [n: number]: number })[idx] = heightVal;
  if (depositVal !== undefined) {
    if (!tiles.deposit) (tiles as { deposit?: Uint8Array }).deposit = new Uint8Array(count);
    (tiles.deposit as { [n: number]: number })[idx] = depositVal;
  }
  if (richnessVal !== undefined) {
    if (!tiles.richness) (tiles as { richness?: Uint16Array }).richness = new Uint16Array(count).fill(10000);
    (tiles.richness as { [n: number]: number })[idx] = richnessVal;
  }
}

/** Hex terrain from the sim tile grid: 32x32-tile chunks, class relief, hydro water plane, and per-tile prop scatter. */
export function createHexTerrain(opts: HexTerrainOptions): HexTerrain {
  const { radius, look } = opts;
  const hx = hexIndex(radius);
  let tiles = opts.tiles;
  let elapsedTime = 0;
  const chunkLayers = (): HexTileLayers => ({ ...tiles, kind: look.kind });
  let effHeights = computeEffectiveHeights(radius, chunkLayers());
  const ext = planetExtent(radius);
  const tint = createHexTileTint(radius, chunkLayers());
  // Dune ripples follow the same shared wind object as dust, trees and waves (by reference: F8 WIND re-orients them).
  const uniforms: Record<string, THREE.IUniform> = { ...terrainUniforms(look, HEX_WATER_LEVEL, ext.x * 1.2, [0, 0]), ...tint.uniforms, uWind: getWindUniforms().uWindDir };
  const edge: THREE.IUniform<number> = { value: opts.edges ?? 0.55 };
  const material = createTerrainMaterial(uniforms, (sh) => addHexEdges(sh, edge));
  // three keys programs on `onBeforeCompile.toString()`, which is the same closure for the plain heightfield terrain:
  // without its own key a renderer showing both would reuse one program (no tint / water gate, or missing attributes).
  material.customProgramCacheKey = () => 'taHexTerrain';
  const group = new THREE.Group();
  group.name = 'hexTerrain';
  const heightAt = makeHeightSampler(radius, () => effHeights);
  const water = createHexWater(radius, look, tiles);
  const props = createHexPropScatter(look);
  const borders = createBorderController(radius, tiles, effHeights, opts.colorBlindMode ?? globalColorBlindMode, opts.colonyColors);
  const chunks = createHexChunkSet(radius, group, material, props, heightAt);

  chunks.rebuild(chunkLayers(), effHeights);
  const ambient = createHexAmbient(look, ext.z);
  group.add(water.group, props.group, borders.mesh, ambient.points);
  const ray = new THREE.Raycaster();

  const handle: HexTerrain = {
    group, material, uniforms, water, props, borderMesh: borders.mesh, radius, halfSize: ext.z, heightAt,
    get chunks() { return [...chunks.meshes.values()]; },
    pick(input, camera) {
      let r = input as THREE.Raycaster;
      if (input instanceof THREE.Vector2) { ray.setFromCamera(input, camera!); r = ray; }
      const hit = rayGround(r.ray.origin, r.ray.direction, heightAt);
      // A click on a tree canopy or a rock picks the tile that prop stands on, not the ground behind it.
      const prop = props.pickProp(r);
      if (prop && (!hit || prop.distance < r.ray.origin.distanceTo(new THREE.Vector3(hit.x, hit.y, hit.z)))) {
        const i = hexIndex(radius).indexOf(prop.q, prop.r);
        if (i >= 0) return { q: prop.q, r: prop.r, i };
      }
      return hit ? tileAt(radius, hit.x, hit.z) : null;
    },
    updateTiles(nextOrChanged, maybeChanged) {
      const resolved = resolveTilesAndChanged(tiles, nextOrChanged, maybeChanged);
      tiles = resolved.tiles;
      const changed = resolved.changed;
      if (!changed || changed.length > 0) {
        const layers = chunkLayers();
        effHeights = computeEffectiveHeights(radius, layers);
        tint.update(layers, changed);
        chunks.rebuild(layers, effHeights, changed);
        water.update(tiles, changed);
      }
      borders.rebuild(tiles, effHeights);
    },
    setTileState(q, r, terrainVal, prepVal, heightVal, depositVal, richnessVal) {
      const idx = hx.indexOf(q, r);
      if (idx < 0) return;
      applyTileStateMutation(tiles, hx.count, idx, terrainVal, prepVal, heightVal, depositVal, richnessVal);
      handle.updateTiles([idx]);
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
      props.cullToFocus(); // hide what lies off the view focus (one frame stale; the focus has a 1.5x margin)
      water.cullToFocus(); // surface + fauna buckets
      ambient.setTime(elapsedTime);
    },
    getTerritoryBorderStats: () => borders.getStats(),
    setColorBlindMode: (enabled) => borders.setColorBlindMode(enabled, tiles, effHeights),
    setColonyColors: (colors) => borders.setColonyColors(colors, tiles, effHeights),
    dispose() {
      activeTerrains.delete(handle);
      chunks.dispose();
      water.dispose(); props.dispose(); borders.dispose(); material.dispose(); tint.dispose(); ambient.dispose();
      group.removeFromParent();
    },
  };
  activeTerrains.add(handle);
  return handle;
}

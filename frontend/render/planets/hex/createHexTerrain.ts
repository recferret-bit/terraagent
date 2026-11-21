import * as THREE from 'three';
import { hashGroundSeed, hexIndex } from '@terra/sim/grid/hex';
import type { PlanetBiosphere } from '../../biosphere/biosphereTypes';
import { enqueueDeferredDispose } from '../../core/deferredDispose';
import {
  BiomeOrchestrator,
  BiomeWorkerClient,
  buildBiomeOrchestratorConfig,
  serializeBiomeOrchestratorConfig,
  type BiomeGeneratedPayload,
  type BiomeOrchestratorConfig,
  type BugsOrchestrator,
} from '../../orchestrators';
import type { PlanetSpec } from '../PlanetSpec';
import { HEX_TERRAIN, type HexTileLayers } from './chunkMesh';
import type { HexPropScatter } from './chunkPropScatter';
import type { PrecomputedChunkEntry } from './chunkSet';
import type { HexFloraLayer } from './flora/HexFloraLayer';
import { rayGround, tileAt, tileXZ, waterSurfaceHit } from './hexMath';
import { HEX_WATER_LEVEL, type HexWater, type PrecomputedHexWater } from './hexWater';
import type { TerritoryBorderStats } from './territoryBorder';
import type { PrecomputedTileTintBuffers } from './tileTint';

export interface PrecomputedHexTerrainData {
  radius: number;
  kind: PlanetSpec['kind'];
  effHeights: Float32Array;
  tint: PrecomputedTileTintBuffers;
  water: PrecomputedHexWater | null;
  chunks: Record<string, PrecomputedChunkEntry>;
}

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
  readonly flora: HexFloraLayer;
  readonly biosphere: PlanetBiosphere;
  readonly biomeOrchestrator: BiomeOrchestrator;
  readonly borderMesh: THREE.Mesh;
  readonly radius: number;
  /** Deterministic 32-bit unsigned planet seed driving relief detail, tints, props, forest stands, and flora. */
  readonly seed: number;
  /** Half-extent (m) of the largest square inside the planet: a camera clamped to it never leaves the ground. */
  readonly halfSize: number;
  heightAt(x: number, z: number): number;
  /** Ray (or NDC point + camera) → tile under it, or null when it misses the planet. */
  pick(ray: THREE.Raycaster | THREE.Vector2, camera?: THREE.Camera): HexPick | null;
  updateTiles(tilesOrChanged?: HexTiles | ArrayLike<number>, changed?: ArrayLike<number>): void;
  setTileState(
    q: number,
    r: number,
    terrain?: number,
    prep?: number,
    height?: number,
    deposit?: number,
    richness?: number,
  ): void;
  refreshBorders(tiles?: HexTiles): void;
  tick(dt: number): void;
  getTerritoryBorderStats(): TerritoryBorderStats;
  setColorBlindMode(enabled: boolean): void;
  setColonyColors(colors: Record<number, number>): void;
  /** Advances progressive chunk/prop assembly within `budgetMs` when built with `progressive: true`; returns true when complete. */
  stepProgressiveBuild(budgetMs?: number): boolean;
  /** Immediately completes any remaining progressive chunks + prop meshes. */
  finishProgressiveBuild(): void;
  /** True once all chunk meshes and prop buckets have been assembled. */
  isBuildComplete(): boolean;
  /** Detaches immediately, unregisters from `activeTerrains`, and slices GPU disposal across deferred tasks. */
  disposeDeferred?(): void;
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
  /** Optional explicit JSON config (string or object) passed into `BiomeOrchestrator`. */
  biomeConfigJson?: string | BiomeOrchestratorConfig;
  /** Optional shared `BugsOrchestrator` (e.g. from `EntityMeshes`) managed by `BiomeOrchestrator`. */
  bugsOrchestrator?: BugsOrchestrator;
  /** Whether to eagerly prewarm `BugsOrchestrator` pools on level load. */
  prewarmBugs?: boolean;
  /** Optional Worker-generated payload (`BiomeWorkerClient.generate`) so creation skips main-thread CPU generation. */
  pregenerated?: BiomeGeneratedPayload;
  /** Optional worker-precomputed buffers (`@terra/render/planets/prep`). */
  precomputed?: PrecomputedHexTerrainData;
  /** When true, spreads initial chunk + prop mesh creation across frames via `stepProgressiveBuild()`. */
  progressive?: boolean;
  /** Spawn/camera focus tile built first when `progressive` is enabled. */
  priorityTile?: { q: number; r: number };
}

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

function pickHexTile(
  radius: number,
  input: THREE.Raycaster | THREE.Vector2,
  camera: THREE.Camera | undefined,
  sharedRay: THREE.Raycaster,
  heightAt: (x: number, z: number) => number,
  isWaterAt: (x: number, z: number) => boolean,
  props: HexPropScatter,
): HexPick | null {
  let r = input as THREE.Raycaster;
  if (input instanceof THREE.Vector2) {
    sharedRay.setFromCamera(input, camera!);
    r = sharedRay;
  }
  const ground = rayGround(r.ray.origin, r.ray.direction, heightAt);
  const hit = waterSurfaceHit(r.ray.origin, r.ray.direction, HEX_WATER_LEVEL, ground, isWaterAt) ?? ground;
  const prop = props.pickProp(r);
  if (prop && (!hit || prop.distance < r.ray.origin.distanceTo(new THREE.Vector3(hit.x, hit.y, hit.z)))) {
    const i = hexIndex(radius).indexOf(prop.q, prop.r);
    if (i >= 0) return { q: prop.q, r: prop.r, i };
  }
  return hit ? tileAt(radius, hit.x, hit.z) : null;
}

function emitTileHabitatDisturbances(
  hx: ReturnType<typeof hexIndex>,
  prevTerrain: Uint8Array,
  prevPrep: Uint8Array,
  layers: HexTileLayers,
  changed: ArrayLike<number> | undefined,
  biosphere: PlanetBiosphere,
): void {
  const n = changed ? changed.length : hx.count;
  for (let k = 0; k < n; k++) {
    const ti = changed ? changed[k]! : k;
    if (ti < 0 || ti >= hx.count) continue;
    const oldT = prevTerrain[ti]!;
    const newT = layers.terrain?.[ti] ?? 0;
    const oldP = prevPrep[ti]!;
    const newP = layers.prep?.[ti] ?? 0;
    if (
      (oldT === HEX_TERRAIN.forest && newT !== HEX_TERRAIN.forest) ||
      ((oldT === HEX_TERRAIN.shallow || oldT === HEX_TERRAIN.deep) && newT !== oldT) ||
      (oldP === 0 && newP !== 0)
    ) {
      const [dx, dz] = tileXZ(hx.q[ti]!, hx.r[ti]!);
      biosphere.noteHabitatDisturbance(dx, dz, 14, 7.0);
    }
    prevTerrain[ti] = newT;
    prevPrep[ti] = newP;
  }
}

/**
 * Hex terrain powered by `BiomeOrchestrator`: parses the unified biome JSON configuration and coordinates
 * `TerrainOrchestrator`, `TreesOrchestrator`, `GroundObjectsOrchestrator`, `ResourcesOrchestrator`,
 * `BirdsOrchestrator`, `AnimalsOrchestrator`, and `BugsOrchestrator` with pre-allocated object pools.
 */
export function createHexTerrain(opts: HexTerrainOptions): HexTerrain {
  const { radius } = opts;
  const planetSeed = hashGroundSeed(opts.look.seed, 17);
  const look: PlanetSpec = opts.look.seed === planetSeed ? opts.look : { ...opts.look, seed: planetSeed };
  const hx = hexIndex(radius);
  let tiles = opts.tiles;
  let elapsedTime = 0;
  const jsonOrConfig =
    opts.biomeConfigJson ??
    serializeBiomeOrchestratorConfig(buildBiomeOrchestratorConfig(look, radius, { edges: opts.edges }));
  const biomeOrchestrator = new BiomeOrchestrator(jsonOrConfig, { ...tiles, kind: look.kind, seed: planetSeed }, {
    look,
    colorBlindMode: opts.colorBlindMode ?? globalColorBlindMode,
    colonyColors: opts.colonyColors,
    bugsOrchestrator: opts.bugsOrchestrator,
    prewarmBugs: opts.prewarmBugs,
    pregenerated: opts.pregenerated,
  });

  const tOrch = biomeOrchestrator.terrainOrchestrator;
  const { group, material, uniforms, water, borderMesh, halfSize, heightAt } = tOrch;
  const { props, flora, biosphere } = biomeOrchestrator;
  const prevTerrainSnap = Uint8Array.from({ length: hx.count }, (_, i) => tiles.terrain[i] ?? 0);
  const prevPrepSnap = Uint8Array.from({ length: hx.count }, (_, i) => tiles.prep?.[i] ?? 0);
  const isWaterAt = (x: number, z: number): boolean => {
    const t = tileAt(radius, x, z);
    const code = t ? tiles.terrain[t.i] : undefined;
    return code === HEX_TERRAIN.shallow || code === HEX_TERRAIN.deep;
  };
  const ray = new THREE.Raycaster();
  let disposed = false;

  const handle: HexTerrain = {
    group,
    material,
    uniforms,
    water,
    props,
    flora,
    biosphere,
    biomeOrchestrator,
    borderMesh,
    radius,
    seed: biomeOrchestrator.config.planet.seed,
    halfSize,
    heightAt,
    get chunks() {
      return tOrch.chunks;
    },
    pick: (input, camera) => pickHexTile(radius, input, camera, ray, heightAt, isWaterAt, props),
    updateTiles(nextOrChanged, maybeChanged) {
      const resolved = resolveTilesAndChanged(tiles, nextOrChanged, maybeChanged);
      tiles = resolved.tiles;
      const changed = resolved.changed;
      if (!changed || changed.length > 0) {
        const layers: HexTileLayers = { ...tiles, kind: look.kind, seed: handle.seed };
        emitTileHabitatDisturbances(hx, prevTerrainSnap, prevPrepSnap, layers, changed, biosphere);
        biomeOrchestrator.updateTiles(layers, changed);
      }
      tOrch.rebuildBorders(tiles);
    },
    setTileState(q, r, terrainVal, prepVal, heightVal, depositVal, richnessVal) {
      const idx = hx.indexOf(q, r);
      if (idx < 0) return;
      applyTileStateMutation(tiles, hx.count, idx, terrainVal, prepVal, heightVal, depositVal, richnessVal);
      handle.updateTiles([idx]);
    },
    refreshBorders(next) {
      if (next) tiles = next;
      tOrch.rebuildBorders(tiles);
    },
    tick(dt) {
      elapsedTime += Math.max(0, dt);
      biomeOrchestrator.tick(dt, elapsedTime);
    },
    getTerritoryBorderStats: () => tOrch.getTerritoryBorderStats(),
    setColorBlindMode: (enabled) => tOrch.setColorBlindMode(enabled, tiles),
    setColonyColors: (colors) => tOrch.setColonyColors(colors, tiles),
    stepProgressiveBuild: () => true,
    finishProgressiveBuild() {},
    isBuildComplete: () => true,
    disposeDeferred() {
      if (disposed) return;
      disposed = true;
      activeTerrains.delete(handle);
      group.removeFromParent();
      enqueueDeferredDispose(() => biomeOrchestrator.dispose());
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      activeTerrains.delete(handle);
      biomeOrchestrator.dispose();
    },
  };
  activeTerrains.add(handle);
  return handle;
}

/**
 * Generates terrain chunks, trees, ground objects, resource deposits, habitat anchors, birds, and animals
 * inside the dedicated `biome.worker.ts` thread, then hydrates the `HexTerrain` GPU pools on the main thread.
 */
export async function createHexTerrainInWorker(
  opts: HexTerrainOptions & { workerClient?: BiomeWorkerClient },
): Promise<HexTerrain> {
  const planetSeed = hashGroundSeed(opts.look.seed, 17);
  const look: PlanetSpec = opts.look.seed === planetSeed ? opts.look : { ...opts.look, seed: planetSeed };
  const jsonConfig =
    typeof opts.biomeConfigJson === 'string'
      ? opts.biomeConfigJson
      : serializeBiomeOrchestratorConfig(
          opts.biomeConfigJson ?? buildBiomeOrchestratorConfig(look, opts.radius, { edges: opts.edges }),
        );
  const pregenerated = await BiomeOrchestrator.generateInWorker(
    jsonConfig,
    { ...opts.tiles, kind: look.kind, seed: planetSeed },
    opts.workerClient,
  );
  return createHexTerrain({ ...opts, look, biomeConfigJson: jsonConfig, pregenerated });
}

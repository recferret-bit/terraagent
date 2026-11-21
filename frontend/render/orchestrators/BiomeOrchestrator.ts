import * as THREE from 'three';
import { hexDistance, hexIndex } from '@terra/sim/grid/hex';
import type { BiosphereHabitatIndex, PlanetBiosphere } from '../biosphere/biosphereTypes';
import { buildHexHabitatIndex } from '../biosphere/habitatIndex';
import { PLANET_SPECS, type PlanetSpec } from '../planets/PlanetSpec';
import { HEX_TERRAIN, type HexTileLayers } from '../planets/hex/chunkMesh';
import type { HexPropScatter } from '../planets/hex/chunkPropScatter';
import type { HexFloraLayer } from '../planets/hex/flora/HexFloraLayer';
import { tileAt } from '../planets/hex/hexMath';
import { resetPropShadowLights } from '../planets/hex/propFocusCompaction';
import type { PoolStats } from '../pools';
import { AnimalsOrchestrator } from './AnimalsOrchestrator';
import {
  parseBiomeOrchestratorConfig,
  serializeBiomeOrchestratorConfig,
  type BiomeOrchestratorConfig,
} from './BiomeConfig';
import {
  buildBiosphereView,
  buildFloraView,
  buildPropsView,
  resyncChunkSubOrchestrators,
} from './biomeViews';
import { BirdsOrchestrator } from './BirdsOrchestrator';
import { BugsOrchestrator, type ArchetypeMeshFactory } from './BugsOrchestrator';
import { GroundObjectsOrchestrator } from './GroundObjectsOrchestrator';
import { ResourcesOrchestrator } from './ResourcesOrchestrator';
import { TerrainOrchestrator } from './TerrainOrchestrator';
import { TreesOrchestrator } from './TreesOrchestrator';
import { BiomeWorkerClient } from './worker/BiomeWorkerClient';
import { generateBiomeFromConfig } from './worker/BiomeWorkerController';
import type { BiomeGeneratedPayload, BiomeWorkerTileInput, SerializedHabitatSnapshot } from './worker/protocol';

export interface BiomeOrchestratorInitOptions {
  readonly look?: PlanetSpec;
  readonly colorBlindMode?: boolean;
  readonly colonyColors?: Record<number, number>;
  readonly makeBugMesh?: ArchetypeMeshFactory;
  readonly bugsOrchestrator?: BugsOrchestrator;
  readonly prewarmBugs?: boolean;
  readonly pregenerated?: BiomeGeneratedPayload;
}

function rehydrateHabitatIndex(
  config: BiomeOrchestratorConfig,
  snap: SerializedHabitatSnapshot,
  layers: HexTileLayers,
  heightAt: (x: number, z: number) => number,
): BiosphereHabitatIndex {
  const { radius, kind } = config.planet;
  const innerRadius = Math.max(2, radius - 2);
  const forestTileSet = new Set<number>(snap.forestTileIndices);
  const terrain = layers.terrain;
  return {
    halfSize: snap.halfSize,
    forestAnchors: snap.forestAnchors,
    forestTileSet,
    waterAnchors: snap.waterAnchors,
    grassAnchors: snap.grassAnchors,
    rockAnchors: snap.rockAnchors,
    colonizedAnchors: snap.colonizedAnchors,
    isInBounds(x, z) {
      const pick = tileAt(radius, x, z);
      return pick !== null && hexDistance(0, 0, pick.q, pick.r) <= innerRadius;
    },
    isPassableLand(x, z) {
      const pick = tileAt(radius, x, z);
      if (!pick || !terrain || hexDistance(0, 0, pick.q, pick.r) > innerRadius) return false;
      const t = terrain[pick.i] ?? 0;
      if (t === HEX_TERRAIN.hole) return false;
      if (kind !== 'dune' && (t === HEX_TERRAIN.shallow || t === HEX_TERRAIN.deep)) return false;
      return true;
    },
    heightAt,
  };
}

function normalizeWorkerTiles(tiles: HexTileLayers): BiomeWorkerTileInput {
  return {
    terrain: tiles.terrain instanceof Uint8Array ? tiles.terrain : Uint8Array.from(tiles.terrain ?? []),
    height: tiles.height instanceof Float32Array ? tiles.height : Float32Array.from(tiles.height),
    prep: tiles.prep ? (tiles.prep instanceof Uint8Array ? tiles.prep : Uint8Array.from(tiles.prep)) : undefined,
    deposit: tiles.deposit ? (tiles.deposit instanceof Uint8Array ? tiles.deposit : Uint8Array.from(tiles.deposit)) : undefined,
    richness: tiles.richness
      ? tiles.richness instanceof Float32Array || tiles.richness instanceof Uint16Array
        ? tiles.richness
        : Float32Array.from(tiles.richness)
      : undefined,
    depositTier: tiles.depositTier
      ? tiles.depositTier instanceof Uint8Array
        ? tiles.depositTier
        : Uint8Array.from(tiles.depositTier)
      : undefined,
    owner: tiles.owner
      ? tiles.owner instanceof Int8Array || tiles.owner instanceof Int16Array || tiles.owner instanceof Uint8Array
        ? tiles.owner
        : Int16Array.from(tiles.owner)
      : undefined,
  };
}

function initBugsSubOrchestrator(
  config: BiomeOrchestratorConfig,
  look: PlanetSpec,
  bugsGroup: THREE.Group,
  payload: BiomeGeneratedPayload,
  opts: BiomeOrchestratorInitOptions,
): { bugs: BugsOrchestrator; owns: boolean } {
  const owns = !opts.bugsOrchestrator;
  const bugs =
    opts.bugsOrchestrator ??
    new BugsOrchestrator(
      bugsGroup,
      { biomeKey: look.biomeKey, pools: payload.bugs.speciesPools, prewarmOnInit: false },
      opts.makeBugMesh,
    );
  if (config.bugs.enabled) {
    bugs.configureForBiome(look.biomeKey, payload.bugs.speciesPools, opts.prewarmBugs ?? true);
  } else {
    bugs.configureForBiome(look.biomeKey, {}, false);
  }
  return { bugs, owns };
}

/**
 * Central smart BiomeOrchestrator managing all planet biome sub-orchestrators and object pools:
 * - `terrain` (`TerrainOrchestrator`)
 * - `trees` (`TreesOrchestrator`)
 * - `groundObjects` (`GroundObjectsOrchestrator`)
 * - `resources` (`ResourcesOrchestrator`)
 * - `birds` (`BirdsOrchestrator` — 2 groups per species, biome-only, zero collision checks)
 * - `animals` (`AnimalsOrchestrator` — biome-only circadian mammals)
 * - `bugs` (`BugsOrchestrator` — pooled insect fauna)
 *
 * Parses a unified JSON configuration and supports off-main-thread Worker generation (`createInWorker`)
 * as well as direct hydration (`new BiomeOrchestrator(jsonConfig, tiles, { pregenerated })`).
 */
export class BiomeOrchestrator {
  readonly config: BiomeOrchestratorConfig;
  readonly jsonConfig: string;
  readonly look: PlanetSpec;
  readonly loadedViaWorker: boolean;

  readonly terrainOrchestrator: TerrainOrchestrator;
  readonly treesOrchestrator: TreesOrchestrator;
  readonly groundObjectsOrchestrator: GroundObjectsOrchestrator;
  readonly resourcesOrchestrator: ResourcesOrchestrator;
  readonly birdsOrchestrator: BirdsOrchestrator;
  readonly animalsOrchestrator: AnimalsOrchestrator;
  readonly bugsOrchestrator: BugsOrchestrator;

  readonly propsGroup = new THREE.Group();
  readonly floraGroup = new THREE.Group();
  readonly biosphereGroup = new THREE.Group();
  readonly bugsGroup = new THREE.Group();

  readonly props: HexPropScatter;
  readonly flora: HexFloraLayer;
  readonly biosphere: PlanetBiosphere;

  private readonly ownsBugsOrchestrator: boolean;
  private readonly propTimeU: THREE.IUniform<number> = { value: 0 };
  private readonly floraTimeU: THREE.IUniform<number> = { value: 0 };
  private readonly bioTimeU: THREE.IUniform<number> = { value: 0 };

  constructor(
    jsonOrConfig: string | BiomeOrchestratorConfig,
    initialTiles: HexTileLayers,
    opts: BiomeOrchestratorInitOptions = {},
  ) {
    this.config = opts.pregenerated?.config ?? parseBiomeOrchestratorConfig(jsonOrConfig);
    this.jsonConfig = typeof jsonOrConfig === 'string' ? jsonOrConfig : serializeBiomeOrchestratorConfig(this.config);
    const { kind, seed } = this.config.planet;
    this.look = opts.look ? { ...opts.look, kind, seed } : { ...PLANET_SPECS[kind], seed };

    const layers: HexTileLayers = { ...initialTiles, kind, seed };
    const payload =
      opts.pregenerated ?? generateBiomeFromConfig(this.config, normalizeWorkerTiles(layers), false).payload;
    this.loadedViaWorker = payload.generatedInWorker;

    this.propsGroup.name = 'hexProps';
    this.floraGroup.name = 'hexFlora';
    this.biosphereGroup.name = 'planetBiosphere';
    this.bugsGroup.name = 'biomeBugsPool';

    // 1. Terrain sub-orchestrator
    this.terrainOrchestrator = new TerrainOrchestrator(this.config, this.look, layers, {
      colorBlindMode: opts.colorBlindMode,
      colonyColors: opts.colonyColors,
      precomputedEffHeights: payload.terrain.effHeights,
    });
    this.terrainOrchestrator.hydrateFromWorkerChunks(payload.terrain.effHeights, payload.terrain.chunks);

    // 2. Trees, Ground Objects & Resources sub-orchestrators
    this.treesOrchestrator = new TreesOrchestrator(this.config, this.propsGroup, this.floraGroup, this.propTimeU);
    this.treesOrchestrator.hydrateFromWorker(payload.trees.chunkTrees, payload.trees.standByCell, payload.trees.wadiByCell);

    this.groundObjectsOrchestrator = new GroundObjectsOrchestrator(
      this.config,
      this.look,
      this.propsGroup,
      this.floraGroup,
      this.floraTimeU,
    );
    this.groundObjectsOrchestrator.hydrateFromWorker(
      payload.groundObjects.floraByCell,
      payload.groundObjects.rocksByCell,
      payload.groundObjects.chunkRocks,
    );

    this.resourcesOrchestrator = new ResourcesOrchestrator(this.config, this.propsGroup);
    this.resourcesOrchestrator.hydrateFromWorker(payload.resources.chunkDeposits);

    // 3. Birds, Animals & Bugs sub-orchestrators
    const habitat = rehydrateHabitatIndex(this.config, payload.habitat, layers, this.terrainOrchestrator.heightAt);
    this.birdsOrchestrator = new BirdsOrchestrator(
      this.config,
      habitat,
      this.biosphereGroup,
      this.bioTimeU,
      payload.birds.flocks,
    );
    this.animalsOrchestrator = new AnimalsOrchestrator(
      this.config,
      habitat,
      this.biosphereGroup,
      this.bioTimeU,
      payload.animals.agents,
    );
    const { bugs, owns } = initBugsSubOrchestrator(this.config, this.look, this.bugsGroup, payload, opts);
    this.bugsOrchestrator = bugs;
    this.ownsBugsOrchestrator = owns;

    this.terrainOrchestrator.group.add(this.propsGroup, this.floraGroup, this.biosphereGroup, this.bugsGroup);

    this.props = buildPropsView(
      this.propsGroup,
      this.propTimeU,
      this.treesOrchestrator,
      this.groundObjectsOrchestrator,
      this.resourcesOrchestrator,
    );
    this.flora = buildFloraView(
      this.floraGroup,
      this.floraTimeU,
      this.treesOrchestrator,
      this.groundObjectsOrchestrator,
    );
    this.biosphere = buildBiosphereView(
      this.biosphereGroup,
      this.bioTimeU,
      this.birdsOrchestrator,
      this.animalsOrchestrator,
      habitat,
      this.terrainOrchestrator.water.fauna,
    );
  }

  /** Runs JSON parsing + terrain/tree/flora/resource/bird/animal generation inside `biome.worker.ts`! */
  static async generateInWorker(
    jsonOrConfig: string | BiomeOrchestratorConfig,
    tiles: HexTileLayers,
    workerClient?: BiomeWorkerClient,
  ): Promise<BiomeGeneratedPayload> {
    const json =
      typeof jsonOrConfig === 'string'
        ? jsonOrConfig
        : serializeBiomeOrchestratorConfig(parseBiomeOrchestratorConfig(jsonOrConfig));
    const ownsClient = !workerClient;
    const client = workerClient ?? new BiomeWorkerClient();
    try {
      return await client.generate(json, normalizeWorkerTiles(tiles));
    } finally {
      if (ownsClient) client.dispose();
    }
  }

  /** Full async level loader: generates in Web Worker thread, then hydrates GPU pools on main thread. */
  static async createInWorker(
    jsonOrConfig: string | BiomeOrchestratorConfig,
    tiles: HexTileLayers,
    opts: Omit<BiomeOrchestratorInitOptions, 'pregenerated'> & { workerClient?: BiomeWorkerClient } = {},
  ): Promise<BiomeOrchestrator> {
    const pregenerated = await BiomeOrchestrator.generateInWorker(jsonOrConfig, tiles, opts.workerClient);
    return new BiomeOrchestrator(jsonOrConfig, tiles, { ...opts, pregenerated });
  }

  updateTiles(layers: HexTileLayers, changed?: ArrayLike<number>): void {
    const { radius, kind, seed } = this.config.planet;
    const fullLayers: HexTileLayers = { ...layers, kind, seed };
    const rebuiltChunks = this.terrainOrchestrator.updateDirtyChunks(fullLayers, changed);
    for (const def of rebuiltChunks) {
      resyncChunkSubOrchestrators(
        radius,
        `${def.cq},${def.cr}`,
        def.tiles,
        fullLayers,
        this.terrainOrchestrator.heightAt,
        this.treesOrchestrator,
        this.groundObjectsOrchestrator,
        this.resourcesOrchestrator,
      );
    }
    this.props.rebuildMeshes();
    this.flora.update(fullLayers, this.terrainOrchestrator.heightAt, changed);
    this.biosphere.onHabitatChanged(
      buildHexHabitatIndex(radius, fullLayers, this.look, this.terrainOrchestrator.heightAt),
    );
  }

  tick(dt: number, elapsedTime: number): void {
    this.propTimeU.value = elapsedTime;
    this.floraTimeU.value = elapsedTime;
    this.terrainOrchestrator.tick(elapsedTime);
    this.props.cullToFocus();
    this.flora.cullToFocus();
    this.biosphere.tick(dt);
  }

  /** Aggregated pool statistics across all biome sub-orchestrators. */
  poolStats(): Record<string, PoolStats[]> {
    return {
      trees: this.treesOrchestrator.poolStats(),
      groundObjects: this.groundObjectsOrchestrator.poolStats(),
      resources: this.resourcesOrchestrator.poolStats(),
      birds: this.birdsOrchestrator.poolStats(),
      animals: this.animalsOrchestrator.poolStats(),
      bugs: this.bugsOrchestrator.poolStats(),
    };
  }

  /** Ensure hex index stays warm for tile picking. */
  hexIndex() {
    return hexIndex(this.config.planet.radius);
  }

  dispose(): void {
    resetPropShadowLights();
    this.treesOrchestrator.dispose();
    this.groundObjectsOrchestrator.dispose();
    this.resourcesOrchestrator.dispose();
    this.birdsOrchestrator.dispose();
    this.animalsOrchestrator.dispose();
    if (this.ownsBugsOrchestrator) this.bugsOrchestrator.dispose();
    this.biosphere.dispose();
    this.terrainOrchestrator.dispose();
    this.propsGroup.removeFromParent();
    this.floraGroup.removeFromParent();
    this.biosphereGroup.removeFromParent();
    this.bugsGroup.removeFromParent();
    this.terrainOrchestrator.group.removeFromParent();
  }
}

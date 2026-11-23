import { hexIndex } from '@terra/sim/grid/hex';
import { BirdFlockSimulator } from '../../biosphere/BirdFlockSim';
import { buildHexHabitatIndex } from '../../biosphere/habitatIndex';
import { LandAnimalSimulator } from '../../biosphere/LandAnimalSim';
import { worldCellKey } from '../../core/focusCull';
import { PLANET_SPECS, type PlanetSpec } from '../../planets/PlanetSpec';
import { buildChunk, computeEffectiveHeights, type HexTileLayers } from '../../planets/hex/chunkMesh';
import { scatterChunkProps, type TilePropInstance } from '../../planets/hex/chunkPropScatter';
import { chunkLayout } from '../../planets/hex/chunks';
import { placeFloraByCellsWithExclusion } from '../../planets/hex/flora/floraPlacementPipeline';
import { makeHeightSampler } from '../../planets/hex/heightSampler';
import { tileXZ } from '../../planets/hex/hexMath';
import { tilePropCellKey } from '../../planets/hex/propBuckets';
import type { Place } from '../../visuals/terrain/Scatter';
import { parseBiomeOrchestratorConfig, type BiomeOrchestratorConfig } from '../BiomeConfig';
import type {
  BiomeGeneratedPayload,
  BiomeWorkerTileInput,
  FromBiomeWorker,
  ToBiomeWorker,
  WorkerChunkGeometryData,
} from './protocol';

export type BiomeWorkerPost = (msg: FromBiomeWorker, transfer: ArrayBuffer[]) => void;

function pushCell<T>(map: Record<string, T[]>, cell: string, item: T): void {
  let arr = map[cell];
  if (!arr) map[cell] = arr = [];
  arr.push(item);
}

function pushNestedCell<T>(
  map: Record<string, Record<string, T[]>>,
  cell: string,
  kind: string,
  item: T,
): void {
  let byKind = map[cell];
  if (!byKind) map[cell] = byKind = {};
  let arr = byKind[kind];
  if (!arr) byKind[kind] = arr = [];
  arr.push(item);
}

function generateChunksAndProps(
  config: BiomeOrchestratorConfig,
  layers: HexTileLayers,
  effHeights: Float32Array,
  heightAt: (x: number, z: number) => number,
  transfer: ArrayBuffer[],
) {
  const { radius } = config.planet;
  const chunks: WorkerChunkGeometryData[] = [];
  const standByCell: Record<string, TilePropInstance[]> = {};
  const chunkTrees: Record<string, TilePropInstance[]> = {};
  const rocksByCell: Record<string, Record<'boulder' | 'spire', TilePropInstance[]>> = {};
  const chunkRocks: Record<string, { boulder: TilePropInstance[]; spire: TilePropInstance[] }> = {};
  const depositsByCell: Record<string, Record<'metals' | 'minerals' | 'oil', TilePropInstance[]>> = {};
  const chunkDeposits: Record<string, { metals: TilePropInstance[]; minerals: TilePropInstance[]; oil: TilePropInstance[] }> = {};

  for (const def of chunkLayout(radius)) {
    const key = `${def.cq},${def.cr}`;
    const b = buildChunk(radius, def.tiles, layers, undefined, effHeights);
    chunks.push({
      key, cq: def.cq, cr: def.cr,
      position: b.position, normal: b.normal, aAO: b.aAO, aRock: b.aRock, aHexShore: b.aHexShore, index: b.index,
    });
    transfer.push(
      b.position.buffer as ArrayBuffer, b.normal.buffer as ArrayBuffer, b.aAO.buffer as ArrayBuffer,
      b.aRock.buffer as ArrayBuffer, b.aHexShore.buffer as ArrayBuffer, b.index.buffer as ArrayBuffer,
    );

    const pb = scatterChunkProps(radius, def.tiles, layers, heightAt);
    if (config.trees.enabled) {
      const standList = pb[config.trees.standPropKind];
      chunkTrees[key] = standList;
      for (const inst of standList) {
        pushCell(standByCell, tilePropCellKey(config.trees.standPropKind, inst.tileQ, inst.tileR), inst);
      }
    }
    if (config.groundObjects.enabled) {
      chunkRocks[key] = { boulder: pb.boulder, spire: pb.spire };
      for (const rk of config.groundObjects.rockKinds) {
        for (const inst of pb[rk]) pushNestedCell(rocksByCell, tilePropCellKey(rk, inst.tileQ, inst.tileR), rk, inst);
      }
    }
    if (config.resources.enabled) {
      chunkDeposits[key] = { metals: pb.metals, minerals: pb.minerals, oil: pb.oil };
      for (const dk of config.resources.depositKinds) {
        for (const inst of pb[dk]) pushNestedCell(depositsByCell, tilePropCellKey(dk, inst.tileQ, inst.tileR), dk, inst);
      }
    }
  }
  return { chunks, standByCell, chunkTrees, rocksByCell, chunkRocks, depositsByCell, chunkDeposits };
}

function generateFloraAndWadi(
  config: BiomeOrchestratorConfig,
  look: PlanetSpec,
  layers: HexTileLayers,
  heightAt: (x: number, z: number) => number,
) {
  const wadiByCell: Record<string, Place[]> = {};
  const floraByCell: Record<string, Record<string, Place[]>> = {};
  if (!config.groundObjects.enabled && !config.trees.includeWadiTrees) return { wadiByCell, floraByCell };

  const hx = hexIndex(config.planet.radius);
  const allTiles = new Array<number>(hx.count);
  const tileCell = new Array<string>(hx.count);
  for (let i = 0; i < hx.count; i++) {
    allTiles[i] = i;
    const [x, z] = tileXZ(hx.q[i]!, hx.r[i]!);
    tileCell[i] = worldCellKey(x, z, config.groundObjects.cellSizeM);
  }
  const rawCells = placeFloraByCellsWithExclusion(allTiles, null, tileCell, hx, config.planet.radius, layers, heightAt, look);
  for (const [cell, byKind] of rawCells.entries()) {
    if (config.trees.includeWadiTrees && byKind.duneTree.length > 0) wadiByCell[cell] = byKind.duneTree;
    if (config.groundObjects.enabled) {
      const filtered: Record<string, Place[]> = {};
      for (const fk of config.groundObjects.floraKinds) {
        if (byKind[fk].length > 0) filtered[fk] = byKind[fk];
      }
      if (Object.keys(filtered).length > 0) floraByCell[cell] = filtered;
    }
  }
  return { wadiByCell, floraByCell };
}

/**
 * Pure WebGL-free, DOM-free planet generation pipeline executed inside `biome.worker.ts`
 * (or synchronously when hydrating without an async boundary).
 */
export function generateBiomeFromConfig(
  jsonOrConfig: string | BiomeOrchestratorConfig,
  tiles: BiomeWorkerTileInput,
  generatedInWorker: boolean,
): { payload: BiomeGeneratedPayload; transfer: ArrayBuffer[] } {
  const config = parseBiomeOrchestratorConfig(jsonOrConfig);
  const { radius, seed, kind } = config.planet;
  const look: PlanetSpec = { ...PLANET_SPECS[kind], seed };
  const layers: HexTileLayers = { ...tiles, kind, seed };

  const effHeights = computeEffectiveHeights(radius, layers);
  const heightAt = makeHeightSampler(radius, () => effHeights);
  const transfer: ArrayBuffer[] = [effHeights.buffer as ArrayBuffer];

  const cp = generateChunksAndProps(config, layers, effHeights, heightAt, transfer);
  const fw = generateFloraAndWadi(config, look, layers, heightAt);
  const hab = buildHexHabitatIndex(radius, layers, look, heightAt);

  const birdSim = config.birds.enabled
    ? new BirdFlockSimulator(kind, seed, hab, { groupsPerSpecies: config.birds.groupsPerType, speciesOverride: config.birds.species })
    : null;
  const animalSim = config.animals.enabled
    ? new LandAnimalSimulator(kind, seed, hab, { groupsPerSpecies: config.animals.groupsPerType, speciesOverride: config.animals.species })
    : null;
  const flocks = birdSim ? birdSim.flocks.map((f) => ({ ...f, members: f.members.map((m) => ({ ...m })) })) : [];
  const agents = animalSim ? animalSim.agents.map((a) => ({ ...a })) : [];
  birdSim?.dispose();
  animalSim?.dispose();

  return {
    transfer,
    payload: {
      config,
      generatedInWorker,
      terrain: { effHeights, chunks: cp.chunks },
      trees: { standByCell: cp.standByCell, wadiByCell: fw.wadiByCell, chunkTrees: cp.chunkTrees },
      groundObjects: { floraByCell: fw.floraByCell, rocksByCell: cp.rocksByCell, chunkRocks: cp.chunkRocks },
      resources: { depositsByCell: cp.depositsByCell, chunkDeposits: cp.chunkDeposits },
      habitat: {
        halfSize: hab.halfSize,
        forestAnchors: hab.forestAnchors,
        forestTileIndices: [...hab.forestTileSet],
        waterAnchors: hab.waterAnchors,
        grassAnchors: hab.grassAnchors,
        rockAnchors: hab.rockAnchors,
        colonizedAnchors: hab.colonizedAnchors,
      },
      birds: { flocks },
      animals: { agents },
      bugs: { speciesPools: config.bugs.enabled ? config.bugs.pools : {} },
    },
  };
}

export class BiomeWorkerController {
  private stopped = false;

  constructor(private readonly post: BiomeWorkerPost) {}

  handle(msg: ToBiomeWorker): void {
    if (this.stopped) return;
    if (msg.t === 'stop') {
      this.stopped = true;
      return;
    }
    try {
      const { payload, transfer } = generateBiomeFromConfig(msg.jsonConfig, msg.tiles, true);
      this.post({ t: 'generated', id: msg.id, payload }, transfer);
    } catch (err) {
      this.post({ t: 'error', id: msg.id, message: err instanceof Error ? err.message : String(err) }, []);
    }
  }
}

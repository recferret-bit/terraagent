import * as THREE from 'three';
import { hexDistance, hexIndex, mixGroundSeed } from '@terra/sim/grid/hex';
import { worldCellKey } from '../core/focusCull';
import type { PlanetSpec } from '../planets/PlanetSpec';
import type { HexTileLayers } from '../planets/hex/chunkMesh';
import type { TilePropInstance } from '../planets/hex/chunkPropScatter';
import {
  GROUND_FLORA_KINDS,
  placeFloraByCellsWithExclusion,
  type GroundFloraKind,
} from '../planets/hex/flora/floraPlacementPipeline';
import { tileXZ } from '../planets/hex/hexMath';
import { PROP_BOUNDS_PAD, tilePropCellKey } from '../planets/hex/propBuckets';
import {
  ObjectPool,
  PooledSlotObject,
  resolveRockNodePoolThreshold,
  type PoolStats,
} from '../pools';
import {
  buildBoulderAtlasGeo,
  buildSpireAtlasGeo,
  createFoliageMaterial,
  createRockMaterial,
  jitterBotanicalTint,
  type InstOpts,
  type Place,
} from '../visuals/terrain/Scatter';
import { buildGroundFloraAtlasGeo } from '../visuals/terrain/groundFloraGeos';
import type { BiomeOrchestratorConfig } from './BiomeConfig';
import { PooledCellLayer, type PooledCellKindSpec } from './PooledCellLayer';
import type { TreesOrchestrator } from './TreesOrchestrator';

type PureFloraKind = Exclude<GroundFloraKind, 'duneTree'>;
export type RockPropKind = 'boulder' | 'spire';
const ROCK_KINDS: readonly RockPropKind[] = ['boulder', 'spire'];

const FLORA_INST_OPTS: Record<PureFloraKind, InstOpts> = {
  grassTuft: { sx: [0.55, 0.95], sy: [0.55, 1.15], sink: 0.03, tilt: 0.14, tint: jitterBotanicalTint(0.22, 0.16), encodeBreedInColor: true, castShadow: false },
  wildflower: { sx: [0.65, 1.05], sy: [0.65, 1.15], sink: 0.03, tilt: 0.12, tint: jitterBotanicalTint(0.20, 0.18), encodeBreedInColor: true, castShadow: false },
  bush: { sx: [0.58, 1.02], sy: [0.62, 1.08], sink: 0.06, tilt: 0.14, tint: jitterBotanicalTint(0.20, 0.12), encodeBreedInColor: true, castShadow: true },
  saguaro: { sx: [0.55, 0.92], sy: [0.58, 1.08], sink: 0.08, tilt: 0.08, tint: jitterBotanicalTint(0.16, 0.08), encodeBreedInColor: true, castShadow: true },
  barrelCactus: { sx: [0.62, 1.08], sy: [0.62, 1.06], sink: 0.06, tilt: 0.16, tint: jitterBotanicalTint(0.18, 0.10), encodeBreedInColor: true, castShadow: true },
  reeds: { sx: [0.68, 1.08], sy: [0.72, 1.25], sink: 0.06, tilt: 0.12, tint: jitterBotanicalTint(0.18, 0.10), encodeBreedInColor: true, castShadow: false },
};

const FLORA_SALTS: Record<PureFloraKind, number> = {
  grassTuft: 11, wildflower: 23, bush: 37, saguaro: 53, barrelCactus: 67, reeds: 79,
};
const FLORA_SWAY: Record<PureFloraKind, [number, boolean]> = {
  grassTuft: [1.35, true], wildflower: [1.15, true], bush: [0.65, false],
  saguaro: [0.18, false], barrelCactus: [0.12, false], reeds: [1.65, true],
};

const ROCK_INST_OPTS: Record<RockPropKind, InstOpts> = {
  boulder: { sx: [0.34, 0.60], sy: [0.42, 0.68], sink: 0.06, tilt: 0.20, tint: jitterBotanicalTint(0.22), encodeBreedInColor: true },
  spire: { sx: [0.32, 0.52], sy: [0.74, 1.38], sink: 0.10, tilt: 0.12, tint: jitterBotanicalTint(0.2), encodeBreedInColor: true },
};

function makeEmptyRockNode(): TilePropInstance {
  return {
    kind: 'boulder',
    tileQ: 0,
    tileR: 0,
    tileIndex: 0,
    x: 0,
    y: 0,
    z: 0,
    rot: 0,
    s: 0.5,
    r: 0.5,
    breedIndex: 0,
  };
}

function sameRock(a: TilePropInstance, b: TilePropInstance): boolean {
  return (
    a.kind === b.kind && a.tileIndex === b.tileIndex &&
    a.x === b.x && a.y === b.y && a.z === b.z && a.rot === b.rot &&
    a.s === b.s && a.r === b.r && a.breedIndex === b.breedIndex
  );
}

function sameRockList(a: readonly TilePropInstance[] = [], b: readonly TilePropInstance[] = []): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!sameRock(a[i]!, b[i]!)) return false;
  return true;
}

/**
 * Sub-orchestrator managing biome-filtered ground flora + rock props via pooled rock node slots
 * (`ObjectPool<PooledSlotObject<TilePropInstance>>`) and `ObjectPool<PooledInstancedBucket>`.
 * Allocates geometries, materials, and pools ONLY for ground objects valid on `config.planet.kind`.
 */
export class GroundObjectsOrchestrator {
  readonly floraLayer: PooledCellLayer<Place>;
  readonly rockLayer: PooledCellLayer<TilePropInstance>;
  readonly rockNodePool: ObjectPool<PooledSlotObject<TilePropInstance>>;
  private readonly chunkRockNodes = new Map<string, Map<string, PooledSlotObject<TilePropInstance>[]>>();
  private readonly rockSplits = new Map<string, Map<string, Record<RockPropKind, TilePropInstance[]>>>();
  private readonly dirtyRockBuckets = new Set<string>();
  private readonly tileX: Float32Array;
  private readonly tileZ: Float32Array;
  private readonly tileCell: string[];
  private readonly cellBounds = new Map<string, { minX: number; maxX: number; minZ: number; maxZ: number }>();

  constructor(
    private readonly config: BiomeOrchestratorConfig,
    private readonly look: PlanetSpec,
    propsGroup: THREE.Group,
    floraGroup: THREE.Group,
    floraTimeU: THREE.IUniform<number>,
  ) {
    const rockThreshold =
      config.groundObjects.rockNodePoolThreshold ?? resolveRockNodePoolThreshold(config.planet.radius);
    this.rockNodePool = new ObjectPool<PooledSlotObject<TilePropInstance>>({
      key: 'groundObject:rockNode',
      initialSize: Math.min(128, rockThreshold),
      threshold: rockThreshold,
      create: (idx, key) => new PooledSlotObject<TilePropInstance>(key, idx, makeEmptyRockNode()),
    });

    const hx = hexIndex(config.planet.radius);
    this.tileX = new Float32Array(hx.count);
    this.tileZ = new Float32Array(hx.count);
    this.tileCell = new Array<string>(hx.count);
    for (let i = 0; i < hx.count; i++) {
      const [x, z] = tileXZ(hx.q[i]!, hx.r[i]!);
      this.tileX[i] = x;
      this.tileZ[i] = z;
      const cell = worldCellKey(x, z, config.groundObjects.cellSizeM);
      this.tileCell[i] = cell;
      const b = this.cellBounds.get(cell);
      if (!b) this.cellBounds.set(cell, { minX: x, maxX: x, minZ: z, maxZ: z });
      else {
        if (x < b.minX) b.minX = x;
        if (x > b.maxX) b.maxX = x;
        if (z < b.minZ) b.minZ = z;
        if (z > b.maxZ) b.maxZ = z;
      }
    }

    const floraSpecs: PooledCellKindSpec<Place>[] = config.groundObjects.enabled
      ? config.groundObjects.floraKinds.map((fk) => {
          const [sway, dbl] = FLORA_SWAY[fk];
          return {
            kind: fk,
            namePrefix: 'hexFlora',
            geometry: buildGroundFloraAtlasGeo(fk, look.kind, mixGroundSeed(look.seed, FLORA_SALTS[fk])),
            material: createFoliageMaterial(floraTimeU, sway, dbl, true),
            instOpts: FLORA_INST_OPTS[fk],
            boundsPad: 1.6,
            poolConfig: config.groundObjects.pools[fk]!,
            compactFocus: false,
          };
        })
      : [];
    this.floraLayer = new PooledCellLayer<Place>(floraGroup, floraSpecs, GROUND_FLORA_KINDS);

    const rockTint = new THREE.Color(look.palette.rock);
    const darkTint = new THREE.Color(look.palette.rockDark);
    const rockSpecs: PooledCellKindSpec<TilePropInstance>[] = config.groundObjects.enabled
      ? config.groundObjects.rockKinds.map((rk) => ({
          kind: rk,
          namePrefix: 'hexProp',
          geometry:
            rk === 'boulder'
              ? buildBoulderAtlasGeo(11 + (look.seed % 7), rockTint, darkTint)
              : buildSpireAtlasGeo(7 + (look.seed % 5), rockTint.clone().lerp(darkTint, 0.25), darkTint),
          material: createRockMaterial({ rough: rk === 'boulder' ? 0.92 : 0.88, multiBreed: true }),
          instOpts: ROCK_INST_OPTS[rk],
          boundsPad: PROP_BOUNDS_PAD,
          poolConfig: config.groundObjects.pools[rk]!,
          compactFocus: true,
        }))
      : [];
    this.rockLayer = new PooledCellLayer<TilePropInstance>(propsGroup, rockSpecs, ROCK_KINDS);
  }

  private acquireBucketRockSlots(sources: readonly TilePropInstance[]): {
    slots: PooledSlotObject<TilePropInstance>[];
    data: TilePropInstance[];
  } {
    const slots: PooledSlotObject<TilePropInstance>[] = [];
    const data: TilePropInstance[] = [];
    for (const src of sources) {
      const slot = this.rockNodePool.acquire();
      Object.assign(slot.data, src);
      if (src.scaleX === undefined) delete slot.data.scaleX;
      if (src.scaleY === undefined) delete slot.data.scaleY;
      if (src.scaleZ === undefined) delete slot.data.scaleZ;
      if (src.tintMul === undefined) delete slot.data.tintMul;
      if (src.breedId === undefined) delete slot.data.breedId;
      if (src.breedIndex === undefined) delete slot.data.breedIndex;
      if (src.stage === undefined) delete slot.data.stage;
      if (src.windMul === undefined) delete slot.data.windMul;
      slots.push(slot);
      data.push(slot.data);
    }
    return { slots, data };
  }

  private acquireChunkRockSlots(
    chunkKey: string,
    rocks: { boulder: readonly TilePropInstance[]; spire: readonly TilePropInstance[] },
  ): Map<string, Record<RockPropKind, TilePropInstance[]>> {
    const activeRockKinds = this.config.groundObjects.enabled ? this.config.groundObjects.rockKinds : [];
    const candidate = new Map<string, Record<RockPropKind, TilePropInstance[]>>();
    for (const rk of activeRockKinds) {
      for (const src of rocks[rk]) {
        const cell = tilePropCellKey(rk, src.tileQ, src.tileR);
        let entry = candidate.get(cell);
        if (!entry) candidate.set(cell, (entry = { boulder: [], spire: [] }));
        entry[rk].push(src);
      }
    }
    const prevBuckets = this.chunkRockNodes.get(chunkKey);
    const nextBuckets = new Map<string, PooledSlotObject<TilePropInstance>[]>();
    const split = new Map<string, Record<RockPropKind, TilePropInstance[]>>();
    for (const [cell, rec] of candidate) {
      const cellOut: Record<RockPropKind, TilePropInstance[]> = { boulder: [], spire: [] };
      for (const rk of ROCK_KINDS) {
        if (rec[rk].length === 0) continue;
        const { slots, data } = this.acquireBucketRockSlots(rec[rk]);
        nextBuckets.set(`${rk}|${cell}`, slots);
        cellOut[rk] = data;
      }
      split.set(cell, cellOut);
    }
    if (prevBuckets) {
      for (const prevSlots of prevBuckets.values()) {
        for (const s of prevSlots) this.rockNodePool.release(s);
      }
    }
    this.chunkRockNodes.set(chunkKey, nextBuckets);
    return split;
  }

  hydrateFromWorker(
    floraByCell: Readonly<Record<string, Record<string, Place[]>>>,
    _rocksByCell: Readonly<Record<string, Record<RockPropKind, TilePropInstance[]>>>,
    chunkRocks: Readonly<Record<string, { boulder: TilePropInstance[]; spire: TilePropInstance[] }>>,
  ): void {
    this.rockLayer.releaseAll();
    this.floraLayer.releaseAll();
    this.rockSplits.clear();
    this.dirtyRockBuckets.clear();
    for (const prevBuckets of this.chunkRockNodes.values()) {
      for (const prevSlots of prevBuckets.values()) {
        for (const s of prevSlots) this.rockNodePool.release(s);
      }
    }
    this.chunkRockNodes.clear();

    const byCell = new Map<string, Record<RockPropKind, TilePropInstance[]>>();
    for (const [chunkKey, r] of Object.entries(chunkRocks)) {
      const split = this.acquireChunkRockSlots(chunkKey, r);
      this.rockSplits.set(chunkKey, split);
      for (const [cell, rec] of split) {
        let agg = byCell.get(cell);
        if (!agg) byCell.set(cell, (agg = { boulder: [], spire: [] }));
        for (const rk of ROCK_KINDS) agg[rk].push(...rec[rk]);
      }
    }
    for (const [cell, byKind] of byCell) {
      for (const rk of this.config.groundObjects.rockKinds) {
        if (byKind[rk].length > 0) this.rockLayer.updateCell(rk, cell, byKind[rk], false);
      }
    }
    this.rockLayer.rebuildMeshLists(this.config.groundObjects.rockKinds);

    for (const [cell, byKind] of Object.entries(floraByCell)) {
      for (const fk of this.config.groundObjects.floraKinds) {
        if ((byKind[fk]?.length ?? 0) > 0) this.floraLayer.updateCell(fk, cell, byKind[fk]!, false);
      }
    }
    this.floraLayer.rebuildMeshLists(this.config.groundObjects.floraKinds);
  }

  setChunkRocks(chunkKey: string, rocks: { boulder: readonly TilePropInstance[]; spire: readonly TilePropInstance[] }): void {
    if (!this.config.groundObjects.enabled) return;
    const activeRockKinds = this.config.groundObjects.rockKinds;
    const prev = this.rockSplits.get(chunkKey);
    const prevBuckets = this.chunkRockNodes.get(chunkKey);
    const candidate = new Map<string, Record<RockPropKind, TilePropInstance[]>>();
    for (const rk of activeRockKinds) {
      for (const inst of rocks[rk]) {
        const cell = tilePropCellKey(rk, inst.tileQ, inst.tileR);
        let entry = candidate.get(cell);
        if (!entry) candidate.set(cell, (entry = { boulder: [], spire: [] }));
        entry[rk].push(inst);
      }
    }
    const changedBuckets = new Set<string>();
    const allCells = new Set([...(prev?.keys() ?? []), ...candidate.keys()]);
    for (const cell of allCells) {
      for (const rk of ROCK_KINDS) {
        if (!sameRockList(prev?.get(cell)?.[rk], candidate.get(cell)?.[rk])) {
          const id = `${rk}|${cell}`;
          this.dirtyRockBuckets.add(id);
          changedBuckets.add(id);
        }
      }
    }
    if (changedBuckets.size === 0 && prev) return;

    const nextBuckets = new Map<string, PooledSlotObject<TilePropInstance>[]>();
    const nextSplit = new Map<string, Record<RockPropKind, TilePropInstance[]>>();
    for (const cell of allCells) {
      const cellOut: Record<RockPropKind, TilePropInstance[]> = { boulder: [], spire: [] };
      let anyNonEmpty = false;
      for (const rk of ROCK_KINDS) {
        const id = `${rk}|${cell}`;
        const prevList = prev?.get(cell)?.[rk];
        const prevSlots = prevBuckets?.get(id);
        if (!changedBuckets.has(id) && prevList && prevList.length > 0 && prevSlots) {
          nextBuckets.set(id, prevSlots);
          cellOut[rk] = prevList;
          anyNonEmpty = true;
          continue;
        }
        const candList = candidate.get(cell)?.[rk];
        if (candList && candList.length > 0) {
          // Acquire new slots BEFORE releasing `prevSlots` so callers holding prior `slot.data` never see LIFO mutation!
          const { slots, data } = this.acquireBucketRockSlots(candList);
          nextBuckets.set(id, slots);
          cellOut[rk] = data;
          anyNonEmpty = true;
        }
        if (prevSlots) {
          for (const s of prevSlots) this.rockNodePool.release(s);
        }
      }
      if (anyNonEmpty) nextSplit.set(cell, cellOut);
    }
    this.chunkRockNodes.set(chunkKey, nextBuckets);
    this.rockSplits.set(chunkKey, nextSplit);
  }

  rebuildDirtyRocks(): void {
    if (this.dirtyRockBuckets.size === 0) return;
    const touchedKinds = new Set<string>();
    for (const id of this.dirtyRockBuckets) {
      const sep = id.indexOf('|');
      const rk = id.slice(0, sep) as RockPropKind;
      const cell = id.slice(sep + 1);
      const merged: TilePropInstance[] = [];
      for (const split of this.rockSplits.values()) {
        for (const inst of split.get(cell)?.[rk] ?? []) merged.push(inst);
      }
      this.rockLayer.updateCell(rk, cell, merged, false);
      touchedKinds.add(rk);
    }
    this.dirtyRockBuckets.clear();
    this.rockLayer.rebuildMeshLists(touchedKinds);
  }

  updateFlora(
    layers: HexTileLayers,
    heightAt: (x: number, z: number) => number,
    trees: TreesOrchestrator,
    changed?: ArrayLike<number>,
  ): void {
    if (!this.config.groundObjects.enabled && (!this.config.trees.enabled || !this.config.trees.includeWadiTrees)) return;
    const hx = hexIndex(this.config.planet.radius);
    if (!changed) {
      const all = Array.from({ length: hx.count }, (_, i) => i);
      const byCell = placeFloraByCellsWithExclusion(all, null, this.tileCell, hx, this.config.planet.radius, layers, heightAt, this.look);
      for (const cell of this.cellBounds.keys()) {
        const b = byCell.get(cell);
        for (const fk of this.config.groundObjects.floraKinds) {
          this.floraLayer.updateCell(fk, cell, b?.[fk] ?? [], false);
        }
        if (this.config.trees.includeWadiTrees) trees.updateWadiCell(cell, b?.duneTree ?? [], false);
      }
      this.floraLayer.rebuildMeshLists(this.config.groundObjects.floraKinds);
      trees.refreshWadiMeshes();
      return;
    }

    const dirtyCells = new Set<string>();
    const reach = this.config.terrain.dirtyReach;
    for (let k = 0; k < changed.length; k++) {
      const idx = changed[k]!;
      if (idx < 0 || idx >= hx.count) continue;
      const q = hx.q[idx]!, r = hx.r[idx]!;
      for (let dq = -reach; dq <= reach; dq++) {
        for (let dr = -reach; dr <= reach; dr++) {
          if (hexDistance(0, 0, dq, dr) > reach) continue;
          const j = hx.indexOf(q + dq, r + dr);
          if (j >= 0) dirtyCells.add(this.tileCell[j]!);
        }
      }
    }
    if (dirtyCells.size === 0) return;

    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const c of dirtyCells) {
      const b = this.cellBounds.get(c);
      if (!b) continue;
      if (b.minX < minX) minX = b.minX;
      if (b.maxX > maxX) maxX = b.maxX;
      if (b.minZ < minZ) minZ = b.minZ;
      if (b.maxZ > maxZ) maxZ = b.maxZ;
    }
    const evalTiles: number[] = [];
    for (let i = 0; i < hx.count; i++) {
      const x = this.tileX[i]!, z = this.tileZ[i]!;
      if (x >= minX - 16 && x <= maxX + 16 && z >= minZ - 16 && z <= maxZ + 16) evalTiles.push(i);
    }
    const byCell = placeFloraByCellsWithExclusion(evalTiles, dirtyCells, this.tileCell, hx, this.config.planet.radius, layers, heightAt, this.look);
    for (const cell of dirtyCells) {
      const b = byCell.get(cell);
      for (const fk of this.config.groundObjects.floraKinds) {
        this.floraLayer.updateCell(fk, cell, b?.[fk] ?? [], false);
      }
      if (this.config.trees.includeWadiTrees) trees.updateWadiCell(cell, b?.duneTree ?? [], false);
    }
    this.floraLayer.rebuildMeshLists(this.config.groundObjects.floraKinds);
    trees.refreshWadiMeshes();
  }

  poolStats(): PoolStats[] {
    return [this.rockNodePool.stats(), ...this.floraLayer.poolStats(), ...this.rockLayer.poolStats()];
  }

  dispose(): void {
    this.floraLayer.dispose(true);
    this.rockLayer.dispose(true);
    this.rockNodePool.dispose();
    this.chunkRockNodes.clear();
    this.rockSplits.clear();
    this.dirtyRockBuckets.clear();
  }
}

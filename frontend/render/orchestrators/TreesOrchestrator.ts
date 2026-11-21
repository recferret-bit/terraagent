import * as THREE from 'three';
import { mixGroundSeed } from '@terra/sim/grid/hex';
import type { TilePropInstance } from '../planets/hex/chunkPropScatter';
import { PROP_BOUNDS_PAD, tilePropCellKey } from '../planets/hex/propBuckets';
import { ObjectPool, PooledSlotObject, type PoolStats } from '../pools';
import { createFoliageMaterial, jitterBotanicalTint, type InstOpts, type Place } from '../visuals/terrain/Scatter';
import { buildBiomeTreeAtlasGeo } from '../visuals/terrain/treeBreeds';
import type { BiomeOrchestratorConfig } from './BiomeConfig';
import { PooledCellLayer } from './PooledCellLayer';

const STAND_OPTS: Record<'pine' | 'duneTree', InstOpts> = {
  pine: { sx: [0.32, 0.48], sy: [0.40, 0.64], sink: 0.08, tilt: 0.06, tint: jitterBotanicalTint(0.18, 0.12), encodeBreedInColor: true },
  duneTree: { sx: [0.32, 0.48], sy: [0.40, 0.64], sink: 0.08, tilt: 0.06, tint: jitterBotanicalTint(0.16, 0.08), encodeBreedInColor: true },
};

const WADI_FLORA_OPTS: InstOpts = {
  sx: [0.32, 0.48], sy: [0.40, 0.64], sink: 0.08, tilt: 0.06,
  tint: jitterBotanicalTint(0.16, 0.08), encodeBreedInColor: true, castShadow: true,
};

function makeEmptyTreeNode(kind: 'pine' | 'duneTree'): TilePropInstance {
  return {
    kind,
    tileQ: 0,
    tileR: 0,
    tileIndex: 0,
    x: 0,
    y: 0,
    z: 0,
    rot: 0,
    s: 0.5,
    r: 0.5,
    scaleX: 1,
    scaleY: 1,
    scaleZ: 1,
    breedIndex: 0,
    windMul: 1,
  };
}

function samePropInstance(a: TilePropInstance, b: TilePropInstance): boolean {
  return (
    a.kind === b.kind && a.tileIndex === b.tileIndex &&
    a.x === b.x && a.y === b.y && a.z === b.z && a.rot === b.rot &&
    a.s === b.s && a.r === b.r && a.scaleX === b.scaleX && a.scaleY === b.scaleY &&
    a.scaleZ === b.scaleZ && a.tintMul === b.tintMul && a.breedIndex === b.breedIndex && a.windMul === b.windMul
  );
}

function sameList(a: readonly TilePropInstance[] = [], b: readonly TilePropInstance[] = []): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!samePropInstance(a[i]!, b[i]!)) return false;
  return true;
}

/**
 * Sub-orchestrator managing all planet trees via pooled tree node slots (`ObjectPool<PooledSlotObject>`)
 * and pooled spatial `InstancedMesh` cell buckets (`PooledCellLayer`).
 * Builds ONLY the tree breed atlas & foliage material belonging to `config.planet.kind`
 * (`pine` on `forestRock`/`oceanForest`, `duneTree` shared across oasis & wadi trees on `dune`).
 */
export class TreesOrchestrator {
  readonly standKind: 'pine' | 'duneTree';
  readonly timeU: THREE.IUniform<number>;
  readonly nodePool: ObjectPool<PooledSlotObject<TilePropInstance>>;
  private readonly treeGeo: THREE.BufferGeometry;
  private readonly treeMat: THREE.Material;
  private readonly standLayer: PooledCellLayer<TilePropInstance>;
  private readonly wadiLayer: PooledCellLayer<Place> | null;
  private readonly chunkNodes = new Map<string, Map<string, PooledSlotObject<TilePropInstance>[]>>();
  private readonly chunkSplits = new Map<string, Map<string, TilePropInstance[]>>();
  private readonly dirtyStandCells = new Set<string>();

  constructor(
    private readonly config: BiomeOrchestratorConfig,
    propsGroup: THREE.Group,
    floraGroup: THREE.Group,
    sharedPropTimeU: THREE.IUniform<number>,
  ) {
    this.standKind = config.trees.standPropKind;
    this.timeU = sharedPropTimeU;
    const { kind, seed } = config.planet;

    this.nodePool = new ObjectPool<PooledSlotObject<TilePropInstance>>({
      key: `tree:${this.standKind}:node`,
      initialSize: Math.min(256, config.trees.nodePoolThreshold),
      threshold: config.trees.nodePoolThreshold,
      create: (idx, key) => new PooledSlotObject<TilePropInstance>(key, idx, makeEmptyTreeNode(this.standKind)),
    });

    this.treeGeo =
      kind === 'dune'
        ? buildBiomeTreeAtlasGeo('dune', mixGroundSeed(seed, 97))
        : buildBiomeTreeAtlasGeo(kind, seed);
    this.treeMat = createFoliageMaterial(
      this.timeU,
      kind === 'dune' ? 0.80 : 0.72,
      kind === 'dune' || kind === 'oceanForest',
      true,
    );

    this.standLayer = new PooledCellLayer<TilePropInstance>(
      propsGroup,
      config.trees.enabled
        ? [
            {
              kind: this.standKind,
              namePrefix: 'hexProp',
              geometry: this.treeGeo,
              material: this.treeMat,
              instOpts: STAND_OPTS[this.standKind],
              boundsPad: PROP_BOUNDS_PAD,
              poolConfig: config.trees.pool,
              compactFocus: true,
            },
          ]
        : [],
      ['pine', 'duneTree'],
    );

    this.wadiLayer =
      config.trees.enabled && config.trees.includeWadiTrees
        ? new PooledCellLayer<Place>(floraGroup, [
            {
              kind: 'duneTree',
              namePrefix: 'hexFlora',
              geometry: this.treeGeo,
              material: this.treeMat,
              instOpts: WADI_FLORA_OPTS,
              boundsPad: 1.6,
              poolConfig: {
                initialSize: Math.max(4, Math.floor(config.trees.pool.initialSize * 0.5)),
                threshold: config.trees.pool.threshold,
                instanceCapacity: config.trees.pool.instanceCapacity,
              },
              compactFocus: false,
            },
          ])
        : null;
  }

  private acquireCellTreeSlots(sources: readonly TilePropInstance[]): {
    slots: PooledSlotObject<TilePropInstance>[];
    data: TilePropInstance[];
  } {
    const slots: PooledSlotObject<TilePropInstance>[] = [];
    const data: TilePropInstance[] = [];
    for (const src of sources) {
      const slot = this.nodePool.acquire();
      Object.assign(slot.data, src);
      if (src.tintMul === undefined) delete slot.data.tintMul;
      if (src.breedId === undefined) delete slot.data.breedId;
      slots.push(slot);
      data.push(slot.data);
    }
    return { slots, data };
  }

  private acquireChunkTreeSlots(chunkKey: string, instances: readonly TilePropInstance[]): Map<string, TilePropInstance[]> {
    const candidate = new Map<string, TilePropInstance[]>();
    for (const src of instances) {
      const cell = tilePropCellKey(this.standKind, src.tileQ, src.tileR);
      let arr = candidate.get(cell);
      if (!arr) candidate.set(cell, (arr = []));
      arr.push(src);
    }
    const prevCells = this.chunkNodes.get(chunkKey);
    const nextCells = new Map<string, PooledSlotObject<TilePropInstance>[]>();
    const split = new Map<string, TilePropInstance[]>();
    for (const [cell, list] of candidate) {
      const { slots, data } = this.acquireCellTreeSlots(list);
      nextCells.set(cell, slots);
      split.set(cell, data);
    }
    if (prevCells) {
      for (const prevSlots of prevCells.values()) {
        for (const s of prevSlots) this.nodePool.release(s);
      }
    }
    this.chunkNodes.set(chunkKey, nextCells);
    return split;
  }

  hydrateFromWorker(
    chunkTrees: Readonly<Record<string, TilePropInstance[]>>,
    _standByCell: Readonly<Record<string, TilePropInstance[]>>,
    wadiByCell: Readonly<Record<string, Place[]>>,
  ): void {
    this.standLayer.releaseAll();
    this.wadiLayer?.releaseAll();
    this.chunkSplits.clear();
    this.dirtyStandCells.clear();
    for (const prevCells of this.chunkNodes.values()) {
      for (const prevSlots of prevCells.values()) {
        for (const s of prevSlots) this.nodePool.release(s);
      }
    }
    this.chunkNodes.clear();

    const byCell = new Map<string, TilePropInstance[]>();
    for (const [chunkKey, list] of Object.entries(chunkTrees)) {
      const split = this.acquireChunkTreeSlots(chunkKey, list);
      this.chunkSplits.set(chunkKey, split);
      for (const [cell, cellList] of split) {
        let agg = byCell.get(cell);
        if (!agg) byCell.set(cell, (agg = []));
        agg.push(...cellList);
      }
    }
    for (const [cell, list] of byCell) {
      if (list.length > 0) this.standLayer.updateCell(this.standKind, cell, list, false);
    }
    this.standLayer.rebuildMeshLists([this.standKind]);

    if (this.wadiLayer) {
      for (const [cell, list] of Object.entries(wadiByCell)) {
        if (list.length > 0) this.wadiLayer.updateCell('duneTree', cell, list, false);
      }
      this.wadiLayer.rebuildMeshLists(['duneTree']);
    }
  }

  setChunkTrees(chunkKey: string, instances: readonly TilePropInstance[]): void {
    if (!this.config.trees.enabled) return;
    const prev = this.chunkSplits.get(chunkKey);
    const prevCells = this.chunkNodes.get(chunkKey);
    const candidate = new Map<string, TilePropInstance[]>();
    for (const inst of instances) {
      const cell = tilePropCellKey(this.standKind, inst.tileQ, inst.tileR);
      let arr = candidate.get(cell);
      if (!arr) candidate.set(cell, (arr = []));
      arr.push(inst);
    }
    const changedCells = new Set<string>();
    const allCells = new Set([...(prev?.keys() ?? []), ...candidate.keys()]);
    for (const cell of allCells) {
      if (!sameList(prev?.get(cell), candidate.get(cell))) {
        this.dirtyStandCells.add(cell);
        changedCells.add(cell);
      }
    }
    if (changedCells.size === 0 && prev) return;

    const nextCells = new Map<string, PooledSlotObject<TilePropInstance>[]>();
    const nextSplit = new Map<string, TilePropInstance[]>();
    for (const cell of allCells) {
      if (!changedCells.has(cell) && prev?.has(cell) && prevCells?.has(cell)) {
        nextCells.set(cell, prevCells.get(cell)!);
        nextSplit.set(cell, prev.get(cell)!);
        continue;
      }
      const candList = candidate.get(cell);
      if (candList && candList.length > 0) {
        // Acquire new slots BEFORE releasing `prevCellSlots` so callers/snapshots holding old `slot.data` are never overwritten!
        const { slots, data } = this.acquireCellTreeSlots(candList);
        nextCells.set(cell, slots);
        nextSplit.set(cell, data);
      }
      const oldSlots = prevCells?.get(cell);
      if (oldSlots) {
        for (const s of oldSlots) this.nodePool.release(s);
      }
    }
    this.chunkNodes.set(chunkKey, nextCells);
    this.chunkSplits.set(chunkKey, nextSplit);
  }

  rebuildDirtyStands(): void {
    if (this.dirtyStandCells.size === 0) return;
    for (const cell of this.dirtyStandCells) {
      const merged: TilePropInstance[] = [];
      for (const split of this.chunkSplits.values()) {
        for (const inst of split.get(cell) ?? []) merged.push(inst);
      }
      this.standLayer.updateCell(this.standKind, cell, merged, false);
    }
    this.dirtyStandCells.clear();
    this.standLayer.rebuildMeshLists([this.standKind]);
  }

  updateWadiCell(cell: string, places: Place[], refresh = false): void {
    this.wadiLayer?.updateCell('duneTree', cell, places, refresh);
  }

  refreshWadiMeshes(): void {
    this.wadiLayer?.rebuildMeshLists(['duneTree']);
  }

  standMeshes(kind: 'pine' | 'duneTree'): readonly THREE.InstancedMesh[] {
    return this.standLayer.getMeshes(kind);
  }

  wadiMeshes(): readonly THREE.InstancedMesh[] {
    return this.wadiLayer ? this.wadiLayer.getMeshes('duneTree') : [];
  }

  standCount(kind: 'pine' | 'duneTree'): number {
    return this.standLayer.countKind(kind);
  }

  wadiCount(): number {
    return this.wadiLayer ? this.wadiLayer.countKind('duneTree') : 0;
  }

  instancesForTile(tileIndex: number, into: TilePropInstance[]): void {
    this.standLayer.instancesForTile(tileIndex, into);
  }

  pickTree(ray: THREE.Raycaster): { q: number; r: number; distance: number } | null {
    return this.standLayer.pickTileProp(ray);
  }

  cullStandsToFocus(): void {
    this.standLayer.cullToFocus();
  }

  cullWadiToFocus(): void {
    this.wadiLayer?.cullToFocus();
  }

  poolStats(): PoolStats[] {
    return [this.nodePool.stats(), ...this.standLayer.poolStats(), ...(this.wadiLayer?.poolStats() ?? [])];
  }

  dispose(): void {
    this.standLayer.dispose(false);
    this.wadiLayer?.dispose(false);
    this.nodePool.dispose();
    this.chunkNodes.clear();
    this.chunkSplits.clear();
    this.dirtyStandCells.clear();
    this.treeGeo.dispose();
    this.treeMat.dispose();
  }
}

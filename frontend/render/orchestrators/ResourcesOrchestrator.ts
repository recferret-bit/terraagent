import * as THREE from 'three';
import type { TilePropInstance } from '../planets/hex/chunkPropScatter';
import { PROP_BOUNDS_PAD, tilePropCellKey } from '../planets/hex/propBuckets';
import { ObjectPool, type PoolStats, PooledSlotObject } from '../pools';
import {
  createRockMaterial,
  jitterBotanicalTint,
  makeBoulderGeo,
  makeSpireGeo,
  type InstOpts,
} from '../visuals/terrain/Scatter';
import type { BiomeOrchestratorConfig } from './BiomeConfig';
import { PooledCellLayer, type PooledCellKindSpec } from './PooledCellLayer';

export type DepositKind = 'metals' | 'minerals' | 'oil';
const DEPOSIT_KINDS: readonly DepositKind[] = ['metals', 'minerals', 'oil'];

const DEPOSIT_INST_OPTS: Record<DepositKind, InstOpts> = {
  metals: { sx: [0.32, 0.50], sy: [0.44, 0.68], sink: 0.06, tilt: 0.18, tint: jitterBotanicalTint(0.15, 0.08) },
  minerals: { sx: [0.32, 0.50], sy: [0.78, 1.32], sink: 0.10, tilt: 0.12, tint: jitterBotanicalTint(0.15, -0.08) },
  oil: { sx: [0.32, 0.50], sy: [0.36, 0.54], sink: 0.05, tilt: 0.12, tint: jitterBotanicalTint(0.12) },
};

function makeEmptyDepositNode(): TilePropInstance {
  return {
    kind: 'metals',
    tileQ: 0,
    tileR: 0,
    tileIndex: 0,
    x: 0,
    y: 0,
    z: 0,
    rot: 0,
    s: 0.5,
    r: 0.5,
    stage: 'full',
    scaleX: 1,
    scaleY: 1,
    scaleZ: 1,
  };
}

function sameDepositNode(a: TilePropInstance, b: TilePropInstance): boolean {
  return (
    a.kind === b.kind && a.tileIndex === b.tileIndex &&
    a.x === b.x && a.y === b.y && a.z === b.z && a.rot === b.rot &&
    a.s === b.s && a.r === b.r && a.stage === b.stage &&
    a.scaleX === b.scaleX && a.scaleY === b.scaleY && a.scaleZ === b.scaleZ && a.tintMul === b.tintMul
  );
}

function sameDepositList(a: readonly TilePropInstance[] = [], b: readonly TilePropInstance[] = []): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!sameDepositNode(a[i]!, b[i]!)) return false;
  return true;
}

/**
 * Sub-orchestrator managing planet resource deposits (`metals`, `minerals`, `oil`) across
 * `full` / `half` / `depleted` stages and tiers `1..3` using both pooled deposit node slots
 * (`ObjectPool<PooledSlotObject<TilePropInstance>>`) and pooled spatial `InstancedMesh` buckets.
 */
export class ResourcesOrchestrator {
  readonly layer: PooledCellLayer<TilePropInstance>;
  readonly nodePool: ObjectPool<PooledSlotObject<TilePropInstance>>;
  private readonly enabledKinds: readonly DepositKind[];
  private readonly chunkNodes = new Map<string, Map<string, PooledSlotObject<TilePropInstance>[]>>();
  private readonly splits = new Map<string, Map<string, Record<DepositKind, TilePropInstance[]>>>();
  private readonly dirtyBuckets = new Set<string>();

  constructor(config: BiomeOrchestratorConfig, propsGroup: THREE.Group) {
    this.enabledKinds = config.resources.enabled ? config.resources.depositKinds : [];
    this.nodePool = new ObjectPool<PooledSlotObject<TilePropInstance>>({
      key: 'resource:depositNode',
      initialSize: this.enabledKinds.length > 0 ? Math.min(128, config.resources.nodePoolThreshold) : 0,
      threshold: config.resources.nodePoolThreshold,
      create: (idx, key) => new PooledSlotObject<TilePropInstance>(key, idx, makeEmptyDepositNode()),
    });

    const allSpecs: Record<DepositKind, PooledCellKindSpec<TilePropInstance>> = {
      metals: {
        kind: 'metals',
        namePrefix: 'hexProp',
        geometry: makeBoulderGeo(29, new THREE.Color(0xc86d28)),
        material: createRockMaterial({ rough: 0.48, metal: 0.65 }),
        instOpts: DEPOSIT_INST_OPTS.metals,
        boundsPad: PROP_BOUNDS_PAD,
        poolConfig: config.resources.pools.metals,
        compactFocus: true,
      },
      minerals: {
        kind: 'minerals',
        namePrefix: 'hexProp',
        geometry: makeSpireGeo(43, new THREE.Color(0x38c8dc)),
        material: createRockMaterial({ rough: 0.28, metal: 0.25 }),
        instOpts: DEPOSIT_INST_OPTS.minerals,
        boundsPad: PROP_BOUNDS_PAD,
        poolConfig: config.resources.pools.minerals,
        compactFocus: true,
      },
      oil: {
        kind: 'oil',
        namePrefix: 'hexProp',
        geometry: makeBoulderGeo(61, new THREE.Color(0x1e1928)),
        material: createRockMaterial({ rough: 0.22, metal: 0.35 }),
        instOpts: DEPOSIT_INST_OPTS.oil,
        boundsPad: PROP_BOUNDS_PAD,
        poolConfig: config.resources.pools.oil,
        compactFocus: true,
      },
    };
    const specs: PooledCellKindSpec<TilePropInstance>[] = this.enabledKinds.map((dk) => allSpecs[dk]);
    for (const dk of DEPOSIT_KINDS) {
      if (!this.enabledKinds.includes(dk)) {
        allSpecs[dk].geometry.dispose();
        allSpecs[dk].material.dispose();
      }
    }

    this.layer = new PooledCellLayer<TilePropInstance>(propsGroup, specs, DEPOSIT_KINDS);
  }

  private acquireBucketDepositSlots(sources: readonly TilePropInstance[]): {
    slots: PooledSlotObject<TilePropInstance>[];
    data: TilePropInstance[];
  } {
    const slots: PooledSlotObject<TilePropInstance>[] = [];
    const data: TilePropInstance[] = [];
    for (const src of sources) {
      const slot = this.nodePool.acquire();
      Object.assign(slot.data, src);
      if (src.tintMul === undefined) delete slot.data.tintMul;
      slots.push(slot);
      data.push(slot.data);
    }
    return { slots, data };
  }

  private acquireChunkSlotList(
    chunkKey: string,
    deposits: { metals: readonly TilePropInstance[]; minerals: readonly TilePropInstance[]; oil: readonly TilePropInstance[] },
  ): Map<string, Record<DepositKind, TilePropInstance[]>> {
    const candidate = new Map<string, Record<DepositKind, TilePropInstance[]>>();
    for (const dk of this.enabledKinds) {
      for (const src of deposits[dk]) {
        const cell = tilePropCellKey(dk, src.tileQ, src.tileR);
        let entry = candidate.get(cell);
        if (!entry) candidate.set(cell, (entry = { metals: [], minerals: [], oil: [] }));
        entry[dk].push(src);
      }
    }
    const prevBuckets = this.chunkNodes.get(chunkKey);
    const nextBuckets = new Map<string, PooledSlotObject<TilePropInstance>[]>();
    const split = new Map<string, Record<DepositKind, TilePropInstance[]>>();
    for (const [cell, rec] of candidate) {
      const cellOut: Record<DepositKind, TilePropInstance[]> = { metals: [], minerals: [], oil: [] };
      for (const dk of DEPOSIT_KINDS) {
        if (rec[dk].length === 0) continue;
        const { slots, data } = this.acquireBucketDepositSlots(rec[dk]);
        nextBuckets.set(`${dk}|${cell}`, slots);
        cellOut[dk] = data;
      }
      split.set(cell, cellOut);
    }
    if (prevBuckets) {
      for (const prevSlots of prevBuckets.values()) {
        for (const s of prevSlots) this.nodePool.release(s);
      }
    }
    this.chunkNodes.set(chunkKey, nextBuckets);
    return split;
  }

  hydrateFromWorker(
    chunkDeposits: Readonly<Record<string, { metals: TilePropInstance[]; minerals: TilePropInstance[]; oil: TilePropInstance[] }>>,
  ): void {
    this.layer.releaseAll();
    this.splits.clear();
    this.dirtyBuckets.clear();
    for (const prevBuckets of this.chunkNodes.values()) {
      for (const prevSlots of prevBuckets.values()) {
        for (const s of prevSlots) this.nodePool.release(s);
      }
    }
    this.chunkNodes.clear();

    const byCell = new Map<string, Record<DepositKind, TilePropInstance[]>>();
    for (const [chunkKey, dep] of Object.entries(chunkDeposits)) {
      const split = this.acquireChunkSlotList(chunkKey, dep);
      this.splits.set(chunkKey, split);
      for (const [cell, rec] of split) {
        let agg = byCell.get(cell);
        if (!agg) byCell.set(cell, (agg = { metals: [], minerals: [], oil: [] }));
        for (const dk of DEPOSIT_KINDS) agg[dk].push(...rec[dk]);
      }
    }
    for (const [cell, rec] of byCell) {
      for (const dk of DEPOSIT_KINDS) {
        if (rec[dk].length > 0) this.layer.updateCell(dk, cell, rec[dk], false);
      }
    }
    this.layer.rebuildMeshLists(DEPOSIT_KINDS);
  }

  setChunkDeposits(
    chunkKey: string,
    deposits: { metals: readonly TilePropInstance[]; minerals: readonly TilePropInstance[]; oil: readonly TilePropInstance[] },
  ): void {
    if (this.enabledKinds.length === 0) return;
    const prev = this.splits.get(chunkKey);
    const prevBuckets = this.chunkNodes.get(chunkKey);
    const candidate = new Map<string, Record<DepositKind, TilePropInstance[]>>();
    for (const dk of this.enabledKinds) {
      for (const src of deposits[dk]) {
        const cell = tilePropCellKey(dk, src.tileQ, src.tileR);
        let entry = candidate.get(cell);
        if (!entry) candidate.set(cell, (entry = { metals: [], minerals: [], oil: [] }));
        entry[dk].push(src);
      }
    }
    const changedBuckets = new Set<string>();
    const allCells = new Set([...(prev?.keys() ?? []), ...candidate.keys()]);
    for (const cell of allCells) {
      for (const dk of DEPOSIT_KINDS) {
        if (!sameDepositList(prev?.get(cell)?.[dk], candidate.get(cell)?.[dk])) {
          const id = `${dk}|${cell}`;
          this.dirtyBuckets.add(id);
          changedBuckets.add(id);
        }
      }
    }
    if (changedBuckets.size === 0 && prev) return;

    const nextBuckets = new Map<string, PooledSlotObject<TilePropInstance>[]>();
    const nextSplit = new Map<string, Record<DepositKind, TilePropInstance[]>>();
    for (const cell of allCells) {
      const cellOut: Record<DepositKind, TilePropInstance[]> = { metals: [], minerals: [], oil: [] };
      let anyNonEmpty = false;
      for (const dk of DEPOSIT_KINDS) {
        const id = `${dk}|${cell}`;
        const prevList = prev?.get(cell)?.[dk];
        const prevSlots = prevBuckets?.get(id);
        if (!changedBuckets.has(id) && prevList && prevList.length > 0 && prevSlots) {
          nextBuckets.set(id, prevSlots);
          cellOut[dk] = prevList;
          anyNonEmpty = true;
          continue;
        }
        const candList = candidate.get(cell)?.[dk];
        if (candList && candList.length > 0) {
          // Acquire new slots BEFORE releasing `prevSlots` so callers holding prior `slot.data` never see LIFO mutation!
          const { slots, data } = this.acquireBucketDepositSlots(candList);
          nextBuckets.set(id, slots);
          cellOut[dk] = data;
          anyNonEmpty = true;
        }
        if (prevSlots) {
          for (const s of prevSlots) this.nodePool.release(s);
        }
      }
      if (anyNonEmpty) nextSplit.set(cell, cellOut);
    }
    this.chunkNodes.set(chunkKey, nextBuckets);
    this.splits.set(chunkKey, nextSplit);
  }

  rebuildDirtyDeposits(): void {
    if (this.dirtyBuckets.size === 0) return;
    const touchedKinds = new Set<DepositKind>();
    for (const id of this.dirtyBuckets) {
      const sep = id.indexOf('|');
      const dk = id.slice(0, sep) as DepositKind;
      const cell = id.slice(sep + 1);
      const merged: TilePropInstance[] = [];
      for (const split of this.splits.values()) {
        for (const inst of split.get(cell)?.[dk] ?? []) merged.push(inst);
      }
      this.layer.updateCell(dk, cell, merged, false);
      touchedKinds.add(dk);
    }
    this.dirtyBuckets.clear();
    this.layer.rebuildMeshLists(touchedKinds);
  }

  meshes(kind: DepositKind): readonly THREE.InstancedMesh[] {
    return this.layer.getMeshes(kind);
  }

  count(kind: DepositKind): number {
    return this.layer.countKind(kind);
  }

  instancesForTile(tileIndex: number, into: TilePropInstance[]): void {
    this.layer.instancesForTile(tileIndex, into);
  }

  pickResource(ray: THREE.Raycaster): { q: number; r: number; distance: number } | null {
    return this.layer.pickTileProp(ray);
  }

  cullToFocus(): void {
    this.layer.cullToFocus();
  }

  poolStats(): PoolStats[] {
    return [this.nodePool.stats(), ...this.layer.poolStats()];
  }

  dispose(): void {
    this.layer.dispose(true);
    this.nodePool.dispose();
    this.chunkNodes.clear();
    this.splits.clear();
    this.dirtyBuckets.clear();
  }
}

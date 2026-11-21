import * as THREE from 'three';
import { sphereInViewFocus, viewFocusBounded } from '../core/focusCull';
import type { TilePropInstance } from '../planets/hex/chunkPropScatter';
import { bucketMeta } from '../planets/hex/propBuckets';
import { bucketShadowPad, compactBucketToFocus, placedIndex } from '../planets/hex/propFocusCompaction';
import { ObjectPool, type PoolStats, PooledInstancedBucket } from '../pools';
import type { InstOpts, Place } from '../visuals/terrain/Scatter';
import type { CellPoolConfig } from './BiomeConfig';

export interface PooledCellKindSpec<TPlace extends Place = Place> {
  readonly kind: string;
  readonly namePrefix: string;
  readonly geometry: THREE.BufferGeometry;
  readonly material: THREE.Material;
  readonly instOpts: InstOpts;
  readonly boundsPad: number;
  readonly poolConfig: CellPoolConfig;
  readonly compactFocus?: boolean;
  readonly _phantom?: TPlace;
}

/**
 * Spatial cell-bucket layer backed by `ObjectPool<PooledInstancedBucket>` per kind.
 * Used by `TreesOrchestrator`, `GroundObjectsOrchestrator`, and `ResourcesOrchestrator` so
 * dirty cells swap/update pre-allocated pooled `InstancedMesh` buckets without `new` or `dispose()`.
 */
export class PooledCellLayer<TPlace extends Place = Place> {
  private readonly pools = new Map<string, ObjectPool<PooledInstancedBucket<TPlace>>>();
  private readonly specs = new Map<string, PooledCellKindSpec<TPlace>>();
  private readonly activeById = new Map<string, PooledInstancedBucket<TPlace>>();
  private readonly meshesByKind = new Map<string, THREE.InstancedMesh[]>();

  constructor(
    readonly group: THREE.Group,
    kindSpecs: readonly PooledCellKindSpec<TPlace>[],
    allKnownKinds?: readonly string[],
  ) {
    for (const k of allKnownKinds ?? kindSpecs.map((s) => s.kind)) {
      this.meshesByKind.set(k, []);
    }
    for (const spec of kindSpecs) {
      this.specs.set(spec.kind, spec);
      this.pools.set(
        spec.kind,
        new ObjectPool<PooledInstancedBucket<TPlace>>({
          key: `${spec.namePrefix}:${spec.kind}`,
          initialSize: spec.poolConfig.initialSize,
          threshold: spec.poolConfig.threshold,
          create: (slotIdx, key) =>
            new PooledInstancedBucket<TPlace>(
              key,
              slotIdx,
              spec.geometry,
              spec.material,
              this.group,
              spec.poolConfig.instanceCapacity,
            ),
        }),
      );
    }
  }

  getMeshes(kind: string): readonly THREE.InstancedMesh[] {
    return this.meshesByKind.get(kind) ?? [];
  }

  /** Replaces cell `(kind, cellKey)` using a pooled bucket (acquire-before-release swaps cleanly!). */
  updateCell(kind: string, cellKey: string, places: TPlace[], refreshList = true): void {
    const spec = this.specs.get(kind);
    const pool = this.pools.get(kind);
    if (!spec || !pool) return;
    const id = `${kind}|${cellKey}`;
    const prev = this.activeById.get(id);

    if (places.length === 0) {
      if (prev) {
        pool.release(prev);
        this.activeById.delete(id);
        if (refreshList) this.rebuildMeshListForKind(kind);
      }
      return;
    }

    // Acquire the next pooled bucket BEFORE releasing `prev` so `next.mesh !== prev.mesh` while `prev` returns warm to the pool!
    const next = pool.acquire();
    next.writeCell(spec.namePrefix, kind, cellKey, places, spec.instOpts, spec.boundsPad);
    if (prev) {
      pool.release(prev);
    }
    this.activeById.set(id, next);
    if (refreshList) this.rebuildMeshListForKind(kind);
  }

  rebuildMeshLists(kinds?: Iterable<string>): void {
    for (const kind of kinds ?? this.specs.keys()) {
      this.rebuildMeshListForKind(kind);
    }
  }

  /** Releases all currently active cell buckets back into their warm pools without disposing GPU buffers. */
  releaseAll(): void {
    for (const [id, bucket] of [...this.activeById]) {
      const kind = id.slice(0, id.indexOf('|'));
      this.pools.get(kind)?.release(bucket);
    }
    this.activeById.clear();
    for (const k of this.meshesByKind.keys()) {
      this.meshesByKind.set(k, []);
    }
  }

  private rebuildMeshListForKind(kind: string): void {
    const prefix = `${kind}|`;
    const list = [...this.activeById.entries()]
      .filter(([id]) => id.startsWith(prefix))
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([, b]) => b.mesh);
    this.meshesByKind.set(kind, list);
  }

  countKind(kind: string): number {
    const prefix = `${kind}|`;
    let total = 0;
    for (const [id, b] of this.activeById) {
      if (id.startsWith(prefix)) total += b.placed.length;
    }
    return total;
  }

  cullToFocus(): void {
    const bounded = viewFocusBounded();
    for (const [id, b] of this.activeById) {
      const kind = id.slice(0, id.indexOf('|'));
      const spec = this.specs.get(kind);
      const m = b.mesh;
      if (spec?.compactFocus) {
        if (!bounded) {
          compactBucketToFocus(m);
          m.visible = b.placed.length > 0;
        } else {
          m.visible = sphereInViewFocus(m, m.boundingSphere!, bucketShadowPad(m)) && compactBucketToFocus(m);
        }
      } else {
        m.visible = b.placed.length > 0 && (!bounded || sphereInViewFocus(m, m.boundingSphere!, 6));
      }
    }
  }

  pickTileProp(ray: THREE.Raycaster): { q: number; r: number; distance: number } | null {
    const visibleMeshes: THREE.InstancedMesh[] = [];
    for (const b of this.activeById.values()) {
      if (b.mesh.visible && b.mesh.count > 0) visibleMeshes.push(b.mesh);
    }
    if (visibleMeshes.length === 0) return null;
    for (const hit of ray.intersectObjects(visibleMeshes, false)) {
      const im = hit.object as THREE.InstancedMesh;
      const inst =
        hit.instanceId !== undefined
          ? (bucketMeta(im).placed?.[placedIndex(im, hit.instanceId)] as TilePropInstance | undefined)
          : undefined;
      if (!inst) continue;
      const breedAttr = im.geometry.getAttribute('aBreed') as THREE.BufferAttribute | undefined;
      if (breedAttr && inst.breedIndex !== undefined && hit.faceIndex != null) {
        if (Math.abs(breedAttr.getX(hit.faceIndex * 3) - inst.breedIndex) > 0.4) continue;
      }
      return { q: inst.tileQ, r: inst.tileR, distance: hit.distance };
    }
    return null;
  }

  instancesForTile(tileIndex: number, into: TilePropInstance[]): void {
    for (const b of this.activeById.values()) {
      for (const p of b.placed as unknown as TilePropInstance[]) {
        if (p.tileIndex === tileIndex) into.push(p);
      }
    }
  }

  poolStats(): PoolStats[] {
    return [...this.pools.values()].map((p) => p.stats());
  }

  dispose(disposeGeosAndMats = true): void {
    this.activeById.clear();
    for (const p of this.pools.values()) p.dispose();
    this.pools.clear();
    if (disposeGeosAndMats) {
      const geos = new Set<THREE.BufferGeometry>();
      const mats = new Set<THREE.Material>();
      for (const s of this.specs.values()) {
        geos.add(s.geometry);
        mats.add(s.material);
      }
      geos.forEach((g) => g.dispose());
      mats.forEach((m) => m.dispose());
    }
    this.specs.clear();
    for (const k of this.meshesByKind.keys()) this.meshesByKind.set(k, []);
  }
}

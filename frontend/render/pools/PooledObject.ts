import * as THREE from 'three';
import { getInsectAnimator } from '../animation/insects/InsectAnimationController';
import { getWeaponRig } from '../combat/WeaponRig';
import { setArchetypeBuildProgress, setArchetypeRuin } from '../kitbash/catalog';
import { updateEntityProjectorRig } from '../lighting/EntityProjectorRig';
import { applyHubPrestige, hubPrestigeTier, hubUplinkBeam } from '../prestige/hubPrestige';
import type { ObjectPool } from './ObjectPool';

/**
 * Base pooled item contract shared across all visual, entity, building, unit, and biome pools.
 * Pooled objects stay pre-allocated in memory and scene containers; `release()` parks/deactivates
 * them without real deletion, and `dispose()` runs only on full level/session teardown.
 */
export abstract class PooledObject {
  active = false;
  acquireCount = 0;

  constructor(
    readonly poolKey: string,
    readonly slotIndex: number,
  ) {}

  /** Marks the object active and invokes `onAcquire()`. */
  acquire(): this {
    this.active = true;
    this.acquireCount++;
    this.onAcquire();
    return this;
  }

  /** Marks the object inactive and invokes `onRelease()` without disposing GPU resources. */
  release(): void {
    if (!this.active) return;
    this.active = false;
    this.onRelease();
  }

  protected abstract onAcquire(): void;
  protected abstract onRelease(): void;
  abstract reset(): void;
  abstract dispose(): void;
}

/**
 * Lightweight pooled slot holding structured state (used for pooled birds, warm-blooded land
 * animals, resource cluster nodes, and instanced swarm entries — zero runtime heap allocations).
 */
export class PooledSlotObject<TData> extends PooledObject {
  data: TData;

  constructor(
    poolKey: string,
    slotIndex: number,
    initialData: TData,
    private readonly resetter?: (data: TData, slotIndex: number) => void,
  ) {
    super(poolKey, slotIndex);
    this.data = initialData;
  }

  protected onAcquire(): void {
    this.reset();
  }

  protected onRelease(): void {
    this.reset();
  }

  reset(): void {
    this.resetter?.(this.data, this.slotIndex);
  }

  dispose(): void {
    this.active = false;
  }
}

function disposeMeshResources(root: THREE.Object3D): void {
  const geos = new Set<THREE.BufferGeometry>();
  const mats = new Set<THREE.Material>();
  root.traverse((obj) => {
    const m = obj as THREE.Mesh;
    if (m.geometry) geos.add(m.geometry);
    if (Array.isArray(m.material)) m.material.forEach((mt) => mats.add(mt));
    else if (m.material) mats.add(m.material);
    if (m.customDepthMaterial) mats.add(m.customDepthMaterial);
  });
  geos.forEach((g) => g.dispose());
  mats.forEach((mt) => mt.dispose());
}

/**
 * Pooled Three.js mesh wrapper used by `BuildingsOrchestrator`, `UnitsOrchestrator`, and `BugsOrchestrator`.
 * Resets shader uniforms, ruin/scaffold states, selection rings, projector lights, and insect animators cleanly on reuse.
 */
export class PooledMeshEntry<TMesh extends THREE.Object3D = THREE.Object3D> extends PooledObject {
  entityId: number | null = null;

  constructor(
    poolKey: string,
    slotIndex: number,
    readonly archetypeId: string,
    readonly biomeKey: string,
    readonly mesh: TMesh,
  ) {
    super(poolKey, slotIndex);
    if (this.mesh.userData) (this.mesh.userData as Record<string, unknown>).biomeKey = biomeKey;
    this.parkMesh();
  }

  bindEntity(entityId: number): TMesh {
    this.entityId = entityId;
    this.mesh.userData.entityId = entityId;
    return this.mesh;
  }

  protected onAcquire(): void {
    this.reset();
    this.mesh.visible = true;
  }

  protected onRelease(): void {
    this.entityId = null;
    this.reset();
    this.parkMesh();
  }

  private detachTransientAttachments(): void {
    const podFlames = this.mesh.getObjectByName('pod-retro-flames');
    podFlames?.removeFromParent();
  }

  private parkMesh(): void {
    this.detachTransientAttachments();
    this.mesh.visible = false;
    delete this.mesh.userData.entityId;
    delete this.mesh.userData.faunaPhase;
    this.mesh.position.set(0, -10000, 0);
    this.mesh.rotation.set(0, 0, 0);
    this.mesh.scale.setScalar(1);
    updateEntityProjectorRig(this.mesh, 0, 1);
  }

  reset(): void {
    this.detachTransientAttachments();
    if (hubPrestigeTier(this.mesh) > 0 || hubUplinkBeam(this.mesh) !== null) {
      applyHubPrestige(this.mesh, 0);
    }
    const u = (this.mesh.userData as { uniforms?: Record<string, { value: unknown }> })?.uniforms;
    if (u) {
      if (u.uSelected) u.uSelected.value = 0;
      if (u.uSelectionTime) u.uSelectionTime.value = 0;
      if (u.uWalkWeight) u.uWalkWeight.value = 0;
      if (u.uWorkWeight) u.uWorkWeight.value = 0;
      if (u.uTime) u.uTime.value = 0;
    }
    setArchetypeRuin(this.mesh, false);
    setArchetypeBuildProgress(this.mesh, 1);
    const stdMat = (this.mesh as unknown as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
    if (stdMat?.color) stdMat.color.setHex(0xffffff);
    getWeaponRig(this.mesh)?.reset();
    getInsectAnimator(this.mesh)?.revive();
  }

  dispose(): void {
    this.active = false;
    this.entityId = null;
    this.detachTransientAttachments();
    hubUplinkBeam(this.mesh)?.dispose();
    const userData = this.mesh.userData as { projectorRig?: { dispose?: () => void }; hubPrestige?: unknown } | undefined;
    if (userData) delete userData.hubPrestige;
    userData?.projectorRig?.dispose?.();
    if (userData) delete userData.projectorRig;
    this.mesh.removeFromParent();
    disposeMeshResources(this.mesh);
  }
}

export function pruneStaleBiomePools<T extends PooledObject>(
  pools: Map<string, ObjectPool<T>>,
  keepBiomeKey: string,
): void {
  const prefix = `${keepBiomeKey}:`;
  for (const [key, pool] of [...pools]) {
    if (!key.startsWith(prefix) && pool.activeCount === 0) {
      pool.dispose();
      pools.delete(key);
    }
  }
}

export function releaseBiomeMeshEntry(
  pools: Map<string, ObjectPool<PooledMeshEntry>>,
  activeBiomeKey: string,
  entry: PooledMeshEntry,
): void {
  const poolKey = `${entry.biomeKey}:${entry.archetypeId}`;
  const pool = pools.get(poolKey);
  if (!pool) {
    entry.dispose();
    return;
  }
  pool.release(entry);
  if (entry.biomeKey !== activeBiomeKey && pool.activeCount === 0) {
    pool.dispose();
    pools.delete(poolKey);
  }
}

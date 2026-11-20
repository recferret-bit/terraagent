import type * as THREE from 'three';
import { INSECT_SPECIES } from '../animation/insects/rig';
import { ArchetypeCatalog, createArchetypeMesh } from '../kitbash';
import { attachEntityProjectorRig } from '../lighting';
import {
  BUG_POOL_THRESHOLDS,
  ObjectPool,
  PooledMeshEntry,
  pruneStaleBiomePools,
  releaseBiomeMeshEntry,
  resolveBugPoolThreshold,
  type PoolStats,
  type PoolThresholdSpec,
} from '../pools';

export type ArchetypeMeshFactory = (archetypeId: string, biomeKey: string) => THREE.Object3D;

export interface BugsOrchestratorConfig {
  readonly biomeKey: string;
  readonly pools?: Readonly<Record<string, PoolThresholdSpec>>;
  readonly prewarmOnInit?: boolean;
}

export function isBugArchetypeId(archetypeId: string): boolean {
  return Boolean(INSECT_SPECIES[archetypeId]) || archetypeId in BUG_POOL_THRESHOLDS;
}

function canonicalBugId(archetypeId: string): string {
  return ArchetypeCatalog.has(archetypeId) ? ArchetypeCatalog.get(archetypeId).id : archetypeId;
}

/**
 * Sub-orchestrator managing pooled insect fauna (`fauna.blackAnt`, `fauna.blueBeetle`, `fauna.greenSpitter`).
 * Pre-allocates & recycles bug proxy meshes inside `targetGroup` so waves of bugs never trigger runtime
 * `createArchetypeMesh` or `disposeObject3D` churn.
 */
export class BugsOrchestrator {
  private biomeKey: string;
  private readonly poolConfigs: Record<string, PoolThresholdSpec>;
  private readonly pools = new Map<string, ObjectPool<PooledMeshEntry>>();
  private readonly activeByEntityId = new Map<number, PooledMeshEntry>();

  constructor(
    private readonly targetGroup: THREE.Group,
    configOrJson?: string | BugsOrchestratorConfig,
    private readonly makeMesh: ArchetypeMeshFactory = (id, biome) => createArchetypeMesh(id, biome),
  ) {
    const parsed: BugsOrchestratorConfig =
      typeof configOrJson === 'string'
        ? (JSON.parse(configOrJson) as BugsOrchestratorConfig)
        : (configOrJson ?? { biomeKey: 'forestRock' });
    this.biomeKey = parsed.biomeKey || 'forestRock';
    this.poolConfigs = { ...BUG_POOL_THRESHOLDS, ...(parsed.pools ?? {}) };
    if (parsed.prewarmOnInit) {
      this.prewarmForBiome(this.biomeKey);
    }
  }

  /** Synchronizes biome key & species pool specs (and optionally prewarms) from `BiomeOrchestrator`. */
  configureForBiome(biomeKey: string, pools?: Readonly<Record<string, PoolThresholdSpec>>, prewarm = true): void {
    this.biomeKey = biomeKey || this.biomeKey;
    if (pools !== undefined) {
      for (const k of Object.keys(this.poolConfigs)) delete this.poolConfigs[k];
      Object.assign(this.poolConfigs, pools);
      const allowedKeys = new Set(Object.keys(pools).map((id) => `${this.biomeKey}:${canonicalBugId(id)}`));
      for (const [key, pool] of [...this.pools]) {
        if (!allowedKeys.has(key) && pool.activeCount === 0) {
          pool.dispose();
          this.pools.delete(key);
        }
      }
    }
    pruneStaleBiomePools(this.pools, this.biomeKey);
    for (const speciesId of Object.keys(this.poolConfigs)) {
      const pool = this.ensurePool(speciesId, this.biomeKey, prewarm);
      if (prewarm) pool.prewarm(this.getThreshold(speciesId).initialSize);
    }
  }

  setActiveBiome(biomeKey: string): void {
    if (biomeKey) this.biomeKey = biomeKey;
  }

  prewarmForBiome(biomeKey: string): void {
    this.biomeKey = biomeKey;
    pruneStaleBiomePools(this.pools, biomeKey);
    for (const speciesId of Object.keys(this.poolConfigs)) {
      const pool = this.ensurePool(speciesId, biomeKey, true);
      pool.prewarm(this.getThreshold(speciesId).initialSize);
    }
  }

  pruneStaleBiomes(keepBiomeKey = this.biomeKey): void {
    pruneStaleBiomePools(this.pools, keepBiomeKey);
  }

  getThreshold(archetypeId: string): PoolThresholdSpec {
    const id = canonicalBugId(archetypeId);
    return this.poolConfigs[id] ?? resolveBugPoolThreshold(id);
  }

  private ensurePool(archetypeId: string, biomeKey: string, prewarm = true): ObjectPool<PooledMeshEntry> {
    const id = canonicalBugId(archetypeId);
    const key = `${biomeKey}:${id}`;
    let pool = this.pools.get(key);
    if (!pool) {
      const spec = this.getThreshold(id);
      pool = new ObjectPool<PooledMeshEntry>({
        key: `bug:${key}`,
        initialSize: prewarm ? spec.initialSize : 0,
        threshold: spec.threshold,
        hardCap: spec.hardCap,
        create: (slotIdx, poolKey) => {
          const mesh = this.makeMesh(id, biomeKey);
          attachEntityProjectorRig(mesh, id);
          this.targetGroup.add(mesh);
          return new PooledMeshEntry(poolKey, slotIdx, id, biomeKey, mesh);
        },
      });
      this.pools.set(key, pool);
    }
    return pool;
  }

  acquire(entityId: number, archetypeId: string, biomeKey = this.biomeKey): THREE.Object3D {
    const id = canonicalBugId(archetypeId);
    if (this.pools.size === 0 && biomeKey) this.biomeKey = biomeKey;
    const existing = this.activeByEntityId.get(entityId);
    if (existing) {
      if (existing.archetypeId === id && existing.biomeKey === biomeKey) {
        return existing.mesh;
      }
      this.release(entityId);
    }
    const pool = this.ensurePool(id, biomeKey, true);
    const entry = pool.acquire();
    this.activeByEntityId.set(entityId, entry);
    return entry.bindEntity(entityId);
  }

  release(entityId: number, expectedMesh?: THREE.Object3D): boolean {
    const entry = this.activeByEntityId.get(entityId);
    if (!entry) return false;
    if (expectedMesh && entry.mesh !== expectedMesh) return false;
    this.activeByEntityId.delete(entityId);
    releaseBiomeMeshEntry(this.pools, this.biomeKey, entry);
    return true;
  }

  hasEntity(entityId: number): boolean {
    return this.activeByEntityId.has(entityId);
  }

  get activeCount(): number {
    return this.activeByEntityId.size;
  }

  poolStats(): PoolStats[] {
    return [...this.pools.values()].map((p) => p.stats());
  }

  dispose(): void {
    this.activeByEntityId.clear();
    for (const pool of this.pools.values()) {
      pool.dispose();
    }
    this.pools.clear();
  }
}

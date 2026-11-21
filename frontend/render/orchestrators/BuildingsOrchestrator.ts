import type * as THREE from 'three';
import { ArchetypeCatalog, createArchetypeMesh, stripBuildingPlinth } from '../kitbash';
import { attachEntityProjectorRig } from '../lighting';
import {
  BUILDING_POOL_THRESHOLDS,
  ObjectPool,
  PooledMeshEntry,
  pruneStaleBiomePools,
  releaseBiomeMeshEntry,
  resolveBuildingPoolThreshold,
  type PoolStats,
  type PoolThresholdSpec,
} from '../pools';
import type { ArchetypeMeshFactory } from './BugsOrchestrator';

export interface BuildingsOrchestratorConfig {
  readonly version?: 1;
  readonly biomeKey: string;
  /** Strip square foundation plinths once at pool allocation when placed on hex terrain pads (default `true`). */
  readonly stripConstructiblePlinths?: boolean;
  /** Eagerly pre-allocate `initialSize` pooled meshes for every configured building archetype on init. */
  readonly prewarmOnInit?: boolean;
  readonly pools?: Readonly<Record<string, PoolThresholdSpec>>;
}

export function buildBuildingsOrchestratorConfig(
  biomeKey = 'forestRock',
  overrides: Partial<BuildingsOrchestratorConfig> = {},
): BuildingsOrchestratorConfig {
  return {
    version: 1,
    biomeKey,
    stripConstructiblePlinths: overrides.stripConstructiblePlinths ?? true,
    prewarmOnInit: overrides.prewarmOnInit ?? false,
    pools: { ...BUILDING_POOL_THRESHOLDS, ...(overrides.pools ?? {}) },
  };
}

export function isBuildingOrHiveArchetypeId(archetypeId: string): boolean {
  return archetypeId.startsWith('building.') || archetypeId.startsWith('fauna.hive.');
}

function canonicalBuildingId(archetypeId: string): string {
  return ArchetypeCatalog.has(archetypeId) ? ArchetypeCatalog.get(archetypeId).id : archetypeId;
}

/**
 * Orchestrator managing pooled Three.js meshes for ALL kinds of colony buildings and species hives.
 * Uses smart domain thresholds (`10` for Command Hub / Trade Hub, `6` for Rocket vs `120` for Pylons / `96` for Solar),
 * strips plinths once on pool entry creation, and recycles dismantled structures without `dispose()`.
 */
export class BuildingsOrchestrator {
  readonly config: BuildingsOrchestratorConfig;
  private biomeKey: string;
  private readonly poolSpecs: Record<string, PoolThresholdSpec>;
  private readonly pools = new Map<string, ObjectPool<PooledMeshEntry>>();
  private readonly activeByEntityId = new Map<number, PooledMeshEntry>();
  private nextAnonymousId = -1;

  constructor(
    private readonly targetGroup: THREE.Group,
    configOrJson?: string | Partial<BuildingsOrchestratorConfig>,
    private readonly makeMesh: ArchetypeMeshFactory = (id, biome) => createArchetypeMesh(id, biome),
  ) {
    const raw: Partial<BuildingsOrchestratorConfig> =
      typeof configOrJson === 'string'
        ? (JSON.parse(configOrJson) as Partial<BuildingsOrchestratorConfig>)
        : (configOrJson ?? {});
    this.config = buildBuildingsOrchestratorConfig(raw.biomeKey ?? 'forestRock', raw);
    this.biomeKey = this.config.biomeKey;
    this.poolSpecs = { ...BUILDING_POOL_THRESHOLDS, ...(this.config.pools ?? {}) };
    if (this.config.prewarmOnInit) {
      this.prewarmForBiome(this.biomeKey);
    }
  }

  setActiveBiome(biomeKey: string): void {
    if (biomeKey) this.biomeKey = biomeKey;
  }

  prewarmForBiome(biomeKey: string): void {
    this.biomeKey = biomeKey;
    pruneStaleBiomePools(this.pools, biomeKey);
    for (const archetypeId of Object.keys(this.poolSpecs)) {
      const pool = this.ensurePool(archetypeId, biomeKey);
      pool.prewarm(this.getThreshold(archetypeId).initialSize);
    }
  }

  pruneStaleBiomes(keepBiomeKey = this.biomeKey): void {
    pruneStaleBiomePools(this.pools, keepBiomeKey);
  }

  getThreshold(archetypeId: string): PoolThresholdSpec {
    const id = canonicalBuildingId(archetypeId);
    return this.poolSpecs[id] ?? resolveBuildingPoolThreshold(id);
  }

  private ensurePool(archetypeId: string, biomeKey: string): ObjectPool<PooledMeshEntry> {
    const id = canonicalBuildingId(archetypeId);
    const key = `${biomeKey}:${id}`;
    let pool = this.pools.get(key);
    if (!pool) {
      const spec = this.getThreshold(id);
      const shouldStripPlinth =
        this.config.stripConstructiblePlinths !== false && id.startsWith('building.');
      pool = new ObjectPool<PooledMeshEntry>({
        key: `building:${key}`,
        initialSize: spec.initialSize,
        threshold: spec.threshold,
        hardCap: spec.hardCap,
        create: (slotIdx, poolKey) => {
          const mesh = this.makeMesh(id, biomeKey);
          if (shouldStripPlinth) stripBuildingPlinth(mesh);
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
    const id = canonicalBuildingId(archetypeId);
    if (this.pools.size === 0 && biomeKey) this.biomeKey = biomeKey;
    const existing = this.activeByEntityId.get(entityId);
    if (existing) {
      if (existing.archetypeId === id && existing.biomeKey === biomeKey) {
        return existing.mesh;
      }
      this.release(entityId);
    }
    const pool = this.ensurePool(id, biomeKey);
    const entry = pool.acquire();
    this.activeByEntityId.set(entityId, entry);
    return entry.bindEntity(entityId);
  }

  /** Acquires a pooled building mesh without an external ECS entity id (e.g. offline starter colony). */
  acquireStandalone(archetypeId: string, biomeKey = this.biomeKey): { handleId: number; mesh: THREE.Object3D } {
    const handleId = this.nextAnonymousId--;
    const mesh = this.acquire(handleId, archetypeId, biomeKey);
    delete mesh.userData.entityId;
    return { handleId, mesh };
  }

  release(entityId: number, expectedMesh?: THREE.Object3D): boolean {
    const entry = this.activeByEntityId.get(entityId);
    if (!entry) return false;
    if (expectedMesh && entry.mesh !== expectedMesh) return false;
    this.activeByEntityId.delete(entityId);
    releaseBiomeMeshEntry(this.pools, this.biomeKey, entry);
    return true;
  }

  releaseAll(): void {
    for (const id of [...this.activeByEntityId.keys()]) {
      this.release(id);
    }
  }

  get activeCount(): number {
    return this.activeByEntityId.size;
  }

  hasEntity(entityId: number): boolean {
    return this.activeByEntityId.has(entityId);
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

export { BuildingsOrchestrator as BuildingsOrchestator };

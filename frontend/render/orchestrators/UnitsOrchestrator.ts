import type * as THREE from 'three';
import { ArchetypeCatalog, createArchetypeMesh } from '../kitbash';
import { attachEntityProjectorRig } from '../lighting';
import {
  ObjectPool,
  PooledMeshEntry,
  pruneStaleBiomePools,
  releaseBiomeMeshEntry,
  resolveUnitPoolThreshold,
  UNIT_POOL_THRESHOLDS,
  type PoolStats,
  type PoolThresholdSpec,
} from '../pools';
import type { ArchetypeMeshFactory } from './BugsOrchestrator';

export interface UnitsOrchestratorConfig {
  readonly version?: 1;
  readonly biomeKey: string;
  readonly prewarmOnInit?: boolean;
  readonly pools?: Readonly<Record<string, PoolThresholdSpec>>;
}

export function buildUnitsOrchestratorConfig(
  biomeKey = 'forestRock',
  overrides: Partial<UnitsOrchestratorConfig> = {},
): UnitsOrchestratorConfig {
  return {
    version: 1,
    biomeKey,
    prewarmOnInit: overrides.prewarmOnInit ?? false,
    pools: { ...UNIT_POOL_THRESHOLDS, ...(overrides.pools ?? {}) },
  };
}

export function isRobotOrShipArchetypeId(archetypeId: string): boolean {
  return archetypeId.startsWith('robot.') || archetypeId.startsWith('ship.') || archetypeId.startsWith('unit.');
}

function canonicalUnitId(archetypeId: string): string {
  return ArchetypeCatalog.has(archetypeId) ? ArchetypeCatalog.get(archetypeId).id : archetypeId;
}

/**
 * Orchestrator managing pooled Three.js meshes for ALL kinds of robots and ships.
 * Configures smart thresholds (`10` for HQ `robot.hero` & `ship.dropPod` vs `100` for worker drones
 * `robot.miner` & `robot.builder`), keeping units warm in pools without runtime spawn/delete churn.
 */
export class UnitsOrchestrator {
  readonly config: UnitsOrchestratorConfig;
  private biomeKey: string;
  private readonly poolSpecs: Record<string, PoolThresholdSpec>;
  private readonly pools = new Map<string, ObjectPool<PooledMeshEntry>>();
  private readonly activeByEntityId = new Map<number, PooledMeshEntry>();
  private nextAnonymousId = -1;

  constructor(
    private readonly targetGroup: THREE.Group,
    configOrJson?: string | Partial<UnitsOrchestratorConfig>,
    private readonly makeMesh: ArchetypeMeshFactory = (id, biome) => createArchetypeMesh(id, biome),
  ) {
    const raw: Partial<UnitsOrchestratorConfig> =
      typeof configOrJson === 'string'
        ? (JSON.parse(configOrJson) as Partial<UnitsOrchestratorConfig>)
        : (configOrJson ?? {});
    this.config = buildUnitsOrchestratorConfig(raw.biomeKey ?? 'forestRock', raw);
    this.biomeKey = this.config.biomeKey;
    this.poolSpecs = { ...UNIT_POOL_THRESHOLDS, ...(this.config.pools ?? {}) };
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
    const id = canonicalUnitId(archetypeId);
    return this.poolSpecs[id] ?? resolveUnitPoolThreshold(id);
  }

  private ensurePool(archetypeId: string, biomeKey: string): ObjectPool<PooledMeshEntry> {
    const id = canonicalUnitId(archetypeId);
    const key = `${biomeKey}:${id}`;
    let pool = this.pools.get(key);
    if (!pool) {
      const spec = this.getThreshold(id);
      pool = new ObjectPool<PooledMeshEntry>({
        key: `unit:${key}`,
        initialSize: spec.initialSize,
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
    const id = canonicalUnitId(archetypeId);
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

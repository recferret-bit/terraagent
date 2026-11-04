import * as THREE from 'three';
import { SELECTION_PULSE } from '../visuals/unified/selectionPulse';
import '../visuals/biomes';
import { getDayNightParams } from '../core/dayNightConfig';
import { getColonyVisionUniforms } from '../lighting/ColonyVisionAndLights';
import { attachEntityProjectorRig, updateEntityProjectorRig } from '../lighting/EntityProjectorRig';
import { createUnifiedColonyMaterial } from '../visuals/UnifiedColonyMaterial';
import { BUILD_SCAFFOLD } from '../visuals/unified/buildScaffold';

export type DepositVisualStage = 'full' | 'half' | 'depleted';
export const DEPOSIT_STAGES: readonly DepositVisualStage[] = ['full', 'half', 'depleted'];
export type CanonicalDepositId = 'resource.metalDeposit' | 'resource.crystalDeposit' | 'resource.oilDeposit';

let currentDepositPreviewStage: DepositVisualStage = 'full';
const depositStageBuilders = new Map<CanonicalDepositId, (stage: DepositVisualStage) => THREE.BufferGeometry>();

const DEPOSIT_ALIAS_MAP: Record<string, CanonicalDepositId> = {
  'resource.metalDeposit': 'resource.metalDeposit',
  'resource.crystalDeposit': 'resource.crystalDeposit',
  'resource.oilDeposit': 'resource.oilDeposit',
  deposit_metals: 'resource.metalDeposit',
  deposit_minerals: 'resource.crystalDeposit',
  deposit_oil: 'resource.oilDeposit',
  metals: 'resource.metalDeposit',
  minerals: 'resource.crystalDeposit',
  oil: 'resource.oilDeposit',
  petroleum: 'resource.oilDeposit',
};

export function setDepositPreviewStage(stage: DepositVisualStage): void {
  if (stage === 'full' || stage === 'half' || stage === 'depleted') {
    currentDepositPreviewStage = stage;
  }
}

export function getDepositPreviewStage(): DepositVisualStage {
  return currentDepositPreviewStage;
}

export function resolveDepositArchetype(
  rawId: string,
): { id: CanonicalDepositId; stage?: DepositVisualStage } | null {
  const direct = DEPOSIT_ALIAS_MAP[rawId];
  if (direct) return { id: direct };
  for (const st of DEPOSIT_STAGES) {
    for (const sep of ['_', ':', '.']) {
      const suffix = `${sep}${st}`;
      if (rawId.endsWith(suffix)) {
        const base = rawId.slice(0, -suffix.length);
        const mapped = DEPOSIT_ALIAS_MAP[base];
        if (mapped) return { id: mapped, stage: st };
      }
    }
  }
  return null;
}

export function isDepositArchetype(id: string): boolean {
  return resolveDepositArchetype(id) !== null;
}

export function registerDepositStageBuilder(
  id: CanonicalDepositId,
  fn: (stage: DepositVisualStage) => THREE.BufferGeometry,
): void {
  depositStageBuilders.set(id, fn);
}

export function buildDepositArchetypeStage(
  id: string,
  stage: DepositVisualStage = currentDepositPreviewStage,
): THREE.BufferGeometry {
  const resolved = resolveDepositArchetype(id);
  const canonicalId = resolved?.id ?? 'resource.metalDeposit';
  const effStage = resolved?.stage ?? stage;
  const builder = depositStageBuilders.get(canonicalId);
  if (!builder) throw new Error(`No deposit stage builder registered for "${canonicalId}"`);
  return builder(effStage);
}

export type ArchetypeCategory = 'robot' | 'building' | 'ship' | 'resource' | 'fauna' | 'prop';

export interface ArchetypeEntry {
  /** Dotted id, e.g. 'robot.hero', 'building.solar', 'ship.carrier'. */
  id: string;
  label: string;
  category: ArchetypeCategory;
  /** One merged BufferGeometry (vertex attrs: color(vec4), aSurfacePBR, aPartAnim). minY must be ~0. */
  create: () => THREE.BufferGeometry;
  /** Footprint in 1m tiles (w,d) for the grid pedestal / placement. */
  footprint?: [number, number];
  /** Free-text: sub-part count, notes. */
  notes?: string;
}

/** Ids other systems rely on. Keep them registered. */
export const REQUIRED_IDS = ['robot.hero', 'ship.carrier', 'ship.dropPod'] as const;

const entries = new Map<string, ArchetypeEntry>();
const geometryCache = new Map<string, THREE.BufferGeometry>();

export const ArchetypeCatalog = {
  register(entry: ArchetypeEntry) {
    entries.set(entry.id, entry);
    geometryCache.delete(entry.id);
  },
  list(category?: ArchetypeCategory): ArchetypeEntry[] {
    return [...entries.values()].filter((e) => !category || e.category === category);
  },
  get(id: string): ArchetypeEntry {
    const e = entries.get(id) ?? entries.get(resolveDepositArchetype(id)?.id ?? '');
    if (!e) throw new Error(`ArchetypeCatalog: unknown "${id}". Have: ${[...entries.keys()].join(', ')}`);
    return e;
  },
  /** Returns a clone of the cached merged BufferGeometry so runtime unit spawns skip procedural generation. */
  getGeometry(id: string, stage?: DepositVisualStage): THREE.BufferGeometry {
    const dep = resolveDepositArchetype(id);
    if (dep) {
      const effStage = stage ?? dep.stage ?? getDepositPreviewStage();
      const cacheKey = `${dep.id}:${effStage}`;
      let cached = geometryCache.get(cacheKey);
      if (!cached) {
        cached = buildDepositArchetypeStage(dep.id, effStage);
        geometryCache.set(cacheKey, cached);
      }
      return cached.clone();
    }
    let cached = geometryCache.get(id);
    if (!cached) {
      cached = this.get(id).create();
      geometryCache.set(id, cached);
    }
    const cloned = cached.clone();
    if (cached.userData?.partRanges) {
      cloned.userData = { ...cloned.userData, partRanges: cached.userData.partRanges };
    }
    return cloned;
  },
  has: (id: string) => entries.has(id) || resolveDepositArchetype(id) !== null,
};

/** Uniforms of an archetype mesh: the unified material plus the `buildScaffold` modifier's per-mesh state. */
export type ArchetypeUniforms = ReturnType<typeof createUnifiedColonyMaterial>['uniforms'] & {
  /** Quantized stage the scaffold shader reads (0, 0.33, 0.66, 1). */
  uBuildStage: THREE.IUniform<number>;
  /** Model height (m) the scaffold cut fractions refer to. */
  uBuildHeight: THREE.IUniform<number>;
};

export interface ArchetypeMesh extends THREE.Mesh {
  userData: { archetypeId: string; uniforms: ArchetypeUniforms };
}

/** Builds a ready-to-render mesh with the Unifier material for a biome (PlanetKind) and optional deposit stage. */
export function createArchetypeMesh(id: string, biomeKey = 'dune', stage?: DepositVisualStage): ArchetypeMesh {
  const made = createUnifiedColonyMaterial({ biome: biomeKey, plugins: [BUILD_SCAFFOLD, SELECTION_PULSE] });
  const { material, depthMaterial } = made;
  const uniforms = made.uniforms as ArchetypeUniforms; // the scaffold plugin adds uBuild*
  const geometry = ArchetypeCatalog.getGeometry(id, stage);
  if (!geometry.boundingBox) geometry.computeBoundingBox();
  // Scaffold cut heights are fractions of the model's own height (RN-14).
  uniforms.uBuildHeight.value = Math.max(0.1, geometry.boundingBox!.max.y);
  const mesh = new THREE.Mesh(geometry, material) as unknown as ArchetypeMesh;
  mesh.customDepthMaterial = depthMaterial;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = id;
  mesh.userData = { archetypeId: id, uniforms };
  attachEntityProjectorRig(mesh, id);
  return mesh;
}

/** Call once per frame with elapsed seconds (and optional 0..1 walkWeight / workWeight) so aPartAnim GPU animation advances. */
export function tickArchetypeMesh(mesh: THREE.Object3D, time: number, walkWeight?: number, workWeight?: number) {
  const u = (mesh.userData as any)?.uniforms ?? (mesh.children?.[0]?.userData as any)?.uniforms;
  if (u?.uTime) u.uTime.value = time;
  if (walkWeight !== undefined && u?.uWalkWeight) u.uWalkWeight.value = walkWeight;
  if (workWeight !== undefined && u?.uWorkWeight) u.uWorkWeight.value = workWeight;
  const stage = typeof (mesh.userData as any)?.buildStage === 'number' ? (mesh.userData as any).buildStage : 1;
  const nightFactor = (getColonyVisionUniforms().uNightFactor.value as number) ?? 0;
  updateEntityProjectorRig(mesh, (0.22 + 0.78 * nightFactor) * getDayNightParams().projectorIntensity, stage);
}

/** Quantizes a normalized construction progress (0..1) into one of the 4 scaffold stages (0, 0.33, 0.66, 1). */
export function quantizeBuildStage(progress: number): 0 | 0.33 | 0.66 | 1 {
  const p = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));
  if (p >= 0.999) return 1;
  if (p >= 0.66) return 0.66;
  if (p >= 0.33) return 0.33;
  return 0;
}

/**
 * Updates the construction scaffold (0 / 33 / 66 / 100 %) on an archetype mesh and returns the quantized stage. The
 * shader reads only `uBuildStage` (quantized here, once).
 */
export function setArchetypeBuildProgress(mesh: THREE.Object3D, progress: number): 0 | 0.33 | 0.66 | 1 {
  const stage = quantizeBuildStage(progress);
  const u = (mesh.userData as any)?.uniforms ?? (mesh.children?.[0]?.userData as any)?.uniforms;
  if (u?.uBuildStage) u.uBuildStage.value = stage;
  if (mesh.userData) (mesh.userData as any).buildStage = stage;
  const nightFactor = (getColonyVisionUniforms().uNightFactor.value as number) ?? 0;
  updateEntityProjectorRig(mesh, (0.22 + 0.78 * nightFactor) * getDayNightParams().projectorIntensity, stage);
  return stage;
}

/**
 * Removes the square `plinth` / `plinthDetail` foundation slab from a building mesh when placed on the hex terrain
 * so the building stands directly on the hex terrain's metal hexagonal foundation pads without covering them up.
 */
export function stripBuildingPlinth(mesh: THREE.Object3D): void {
  const m = mesh as THREE.Mesh;
  if (!m.isMesh || !m.geometry) return;
  const ranges = m.geometry.userData?.partRanges as Array<{ role?: string; start: number; count: number }> | undefined;
  if (!ranges || !ranges.some((r) => r.role === 'plinth' || r.role === 'plinthDetail')) return;
  const kept = ranges.filter((r) => r.role !== 'plinth' && r.role !== 'plinthDetail');
  if (kept.length === 0) return;

  const oldGeo = m.geometry;
  const totalVerts = kept.reduce((acc, r) => acc + r.count, 0);
  const newGeo = new THREE.BufferGeometry();
  for (const name of Object.keys(oldGeo.attributes)) {
    const attr = oldGeo.getAttribute(name) as THREE.BufferAttribute;
    const itemSize = attr.itemSize;
    const src = attr.array as Float32Array;
    const dst = new Float32Array(totalVerts * itemSize);
    let offset = 0;
    for (const r of kept) {
      const start = r.start * itemSize;
      const len = r.count * itemSize;
      dst.set(src.subarray(start, start + len), offset);
      offset += len;
    }
    newGeo.setAttribute(name, new THREE.BufferAttribute(dst, itemSize));
  }

  const pos = newGeo.getAttribute('position') as THREE.BufferAttribute;
  let minY = Infinity;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y < minY) minY = y;
  }
  if (Number.isFinite(minY) && minY > 0) {
    for (let i = 0; i < pos.count; i++) pos.setY(i, pos.getY(i) - minY);
    const anim = newGeo.getAttribute('aPartAnim') as THREE.BufferAttribute | undefined;
    if (anim) {
      for (let i = 0; i < anim.count; i++) anim.setZ(i, anim.getZ(i) - minY);
    }
  }
  newGeo.computeBoundingBox();
  newGeo.computeBoundingSphere();
  // How far the model moved down (model-space anchors such as the grid cable insulators subtract it).
  newGeo.userData = { stripOffsetY: Number.isFinite(minY) && minY > 0 ? minY : 0 };
  m.geometry = newGeo;
  oldGeo.dispose();
  const u = (m.userData as any)?.uniforms;
  if (u?.uBuildHeight && newGeo.boundingBox) {
    u.uBuildHeight.value = Math.max(0.1, newGeo.boundingBox.max.y);
  }
}

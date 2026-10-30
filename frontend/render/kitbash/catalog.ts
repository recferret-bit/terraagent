import * as THREE from 'three';
import '../visuals/biomes';
import { createUnifiedColonyMaterial } from '../visuals/UnifiedColonyMaterial';

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
    const e = entries.get(id);
    if (!e) throw new Error(`ArchetypeCatalog: unknown "${id}". Have: ${[...entries.keys()].join(', ')}`);
    return e;
  },
  /** Returns a clone of the cached merged BufferGeometry so runtime unit spawns skip procedural generation. */
  getGeometry(id: string): THREE.BufferGeometry {
    let cached = geometryCache.get(id);
    if (!cached) {
      cached = this.get(id).create();
      geometryCache.set(id, cached);
    }
    return cached.clone();
  },
  has: (id: string) => entries.has(id),
};

export interface ArchetypeMesh extends THREE.Mesh {
  userData: { archetypeId: string; uniforms: ReturnType<typeof createUnifiedColonyMaterial>['uniforms'] };
}

/** Builds a ready-to-render mesh with the Unifier material for a biome (PlanetKind). */
export function createArchetypeMesh(id: string, biomeKey = 'dune'): ArchetypeMesh {
  const { material, uniforms } = createUnifiedColonyMaterial({ biome: biomeKey });
  const mesh = new THREE.Mesh(ArchetypeCatalog.getGeometry(id), material) as unknown as ArchetypeMesh;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = id;
  mesh.userData = { archetypeId: id, uniforms };
  return mesh;
}

/** Call once per frame with elapsed seconds (and optional 0..1 walkWeight / workWeight) so aPartAnim GPU animation advances. */
export function tickArchetypeMesh(mesh: THREE.Object3D, time: number, walkWeight?: number, workWeight?: number) {
  const u = (mesh.userData as any)?.uniforms ?? (mesh.children?.[0]?.userData as any)?.uniforms;
  if (u?.uTime) u.uTime.value = time;
  if (walkWeight !== undefined && u?.uWalkWeight) u.uWalkWeight.value = walkWeight;
  if (workWeight !== undefined && u?.uWorkWeight) u.uWorkWeight.value = workWeight;
}

/** Quantizes a normalized construction progress (0..1) into one of the 4 scaffold stages (0, 0.33, 0.66, 1). */
export function quantizeBuildStage(progress: number): 0 | 0.33 | 0.66 | 1 {
  const p = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));
  if (p >= 0.999) return 1;
  if (p >= 0.66) return 0.66;
  if (p >= 0.33) return 0.33;
  return 0;
}

/** Updates the construction scaffold shader uniforms (0 / 33 / 66 / 100 %) on an archetype mesh and returns the quantized stage. */
export function setArchetypeBuildProgress(mesh: THREE.Object3D, progress: number): 0 | 0.33 | 0.66 | 1 {
  const stage = quantizeBuildStage(progress);
  const u = (mesh.userData as any)?.uniforms ?? (mesh.children?.[0]?.userData as any)?.uniforms;
  if (u?.uBuildProgress) u.uBuildProgress.value = stage;
  if (u?.uBuildStage) u.uBuildStage.value = stage;
  if (mesh.userData) (mesh.userData as any).buildStage = stage;
  return stage;
}

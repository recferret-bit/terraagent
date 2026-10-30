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

export const ArchetypeCatalog = {
  register(entry: ArchetypeEntry) { entries.set(entry.id, entry); },
  list(category?: ArchetypeCategory): ArchetypeEntry[] {
    return [...entries.values()].filter((e) => !category || e.category === category);
  },
  get(id: string): ArchetypeEntry {
    const e = entries.get(id);
    if (!e) throw new Error(`ArchetypeCatalog: unknown "${id}". Have: ${[...entries.keys()].join(', ')}`);
    return e;
  },
  has: (id: string) => entries.has(id),
};

export interface ArchetypeMesh extends THREE.Mesh {
  userData: { archetypeId: string; uniforms: ReturnType<typeof createUnifiedColonyMaterial>['uniforms'] };
}

/** Builds a ready-to-render mesh with the Unifier material for a biome (PlanetKind). */
export function createArchetypeMesh(id: string, biomeKey = 'dune'): ArchetypeMesh {
  const entry = ArchetypeCatalog.get(id);
  const { material, uniforms } = createUnifiedColonyMaterial({ biome: biomeKey });
  const mesh = new THREE.Mesh(entry.create(), material) as unknown as ArchetypeMesh;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = id;
  mesh.userData = { archetypeId: id, uniforms };
  return mesh;
}

/** Call once per frame with elapsed seconds so aPartAnim GPU animation advances. */
export function tickArchetypeMesh(mesh: THREE.Object3D, time: number) {
  const u = (mesh.userData as any)?.uniforms;
  if (u?.uTime) u.uTime.value = time;
}

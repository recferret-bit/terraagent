import * as THREE from 'three';
import { ArchetypeCatalog, stripBuildingPlinth, type ArchetypeMesh } from '../kitbash/catalog';
import { HUB_UPLINK_ORIGIN } from '../kitbash/archetypes/buildings/hub';
import { createUplinkBeam, type UplinkBeam } from './uplinkBeam';
import {
  baseHubArchetypeId, hubArchetypeForTier, HUB_BASE_ID, prestigeVisualsForTier, type PrestigeVisuals,
} from './tierVisuals';

interface HubPrestigeState { tier: number; beam: UplinkBeam | null }
type HubUserData = { archetypeId?: string; uniforms?: { uBuildHeight?: { value: number } }; hubPrestige?: HubPrestigeState };

const stateOf = (mesh: THREE.Object3D): HubPrestigeState | undefined => (mesh.userData as HubUserData).hubPrestige;

/** True for the Command Hub mesh and its tier variants (they differ only in baked geometry and colours). */
export function isHubMesh(mesh: THREE.Object3D): boolean {
  const id = (mesh.userData as HubUserData).archetypeId;
  return typeof id === 'string' && baseHubArchetypeId(id) === HUB_BASE_ID;
}

/** The tier last applied to `mesh` (0 when none). */
export function hubPrestigeTier(mesh: THREE.Object3D): number {
  return stateOf(mesh)?.tier ?? 0;
}

/** The beam attached to `mesh`, if any (tests, previews). */
export function hubUplinkBeam(mesh: THREE.Object3D): UplinkBeam | null {
  return stateOf(mesh)?.beam ?? null;
}

function swapHubGeometry(mesh: ArchetypeMesh, id: string): void {
  const old = mesh.geometry;
  const wasStripped = typeof old.userData?.stripOffsetY === 'number';
  mesh.geometry = ArchetypeCatalog.getGeometry(id);
  old.dispose();
  mesh.userData.archetypeId = id;
  mesh.name = id;
  if (wasStripped) {
    stripBuildingPlinth(mesh); // also refreshes `uBuildHeight`
  } else {
    mesh.geometry.computeBoundingBox();
    const u = mesh.userData.uniforms.uBuildHeight;
    if (u) u.value = Math.max(0.1, mesh.geometry.boundingBox!.max.y);
  }
}

function placeBeam(mesh: THREE.Object3D, beam: UplinkBeam): void {
  const strip = ((mesh as THREE.Mesh).geometry?.userData?.stripOffsetY as number | undefined) ?? 0;
  beam.group.position.set(HUB_UPLINK_ORIGIN[0], HUB_UPLINK_ORIGIN[1] - strip, HUB_UPLINK_ORIGIN[2]);
}

/**
 * Dress an existing Command Hub mesh for a staking tier: swap its baked variant (Quantum Dish from Tier 1, gold trim
 * from Tier 3) and attach or drop the uplink beam. Works before or after `stripBuildingPlinth` (game) and on an
 * unstripped pedestal model (playground), and is idempotent. Not a hub mesh: nothing happens, tier 0 result returned.
 */
export function applyHubPrestige(mesh: THREE.Object3D, tier: unknown): PrestigeVisuals {
  const v = prestigeVisualsForTier(tier);
  if (!isHubMesh(mesh)) return prestigeVisualsForTier(0);
  const prev = stateOf(mesh);
  const want = hubArchetypeForTier(v.tier);
  const m = mesh as ArchetypeMesh;
  if (m.userData.archetypeId !== want) swapHubGeometry(m, want);
  let beam = prev?.beam ?? null;
  if (v.uplinkBeam && !beam) { beam = createUplinkBeam(); mesh.add(beam.group); }
  if (!v.uplinkBeam && beam) { beam.dispose(); beam = null; }
  if (beam) placeBeam(mesh, beam);
  (mesh.userData as HubUserData).hubPrestige = { tier: v.tier, beam };
  return v;
}

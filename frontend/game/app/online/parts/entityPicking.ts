import * as THREE from 'three';
import type { ColonyViewport } from '@terra/render/core/createColonyViewport';
import { tileXZ, type HexPick, type HexTerrain } from '@terra/render/planets/hex';
import { ENTITY_KIND, ENTITY_STATE, hexIndex, inHex, isUnitKind } from '@terra/sim';
import { isConstructibleBuilding } from '../entityKinds';
import type { EntityMeshRecord } from '../EntityMeshRecord';

export type EntityAwareHexPick = HexPick & { entityId?: number };

const RAYCASTER = new THREE.Raycaster();
const NDC = new THREE.Vector2();
const INV_WORLD = new THREE.Matrix4();
const LOCAL_RAY = new THREE.Ray();
const LOCAL_BOX = new THREE.Box3();
const LOCAL_HIT = new THREE.Vector3();
const WORLD_HIT = new THREE.Vector3();

function testEntityRayHit(
  rec: EntityMeshRecord,
  isBuilding: boolean,
): { dist: number; point: THREE.Vector3 } | null {
  const meshObj = rec.mesh as THREE.Mesh;
  const geo = meshObj.geometry;
  if (geo) {
    if (!geo.boundingBox) geo.computeBoundingBox();
    const bb = geo.boundingBox;
    if (!bb) return null;
    LOCAL_BOX.copy(bb);
    LOCAL_BOX.min.y = Math.min(LOCAL_BOX.min.y, -0.05);
    LOCAL_BOX.expandByScalar(isBuilding ? 0.08 : 0.22);
    INV_WORLD.copy(rec.mesh.matrixWorld).invert();
    LOCAL_RAY.copy(RAYCASTER.ray).applyMatrix4(INV_WORLD);
    if (!LOCAL_RAY.intersectBox(LOCAL_BOX, LOCAL_HIT)) return null;

    const hits = RAYCASTER.intersectObject(rec.mesh, false);
    if (hits.length > 0) {
      return { dist: hits[0]!.distance, point: hits[0]!.point.clone() };
    }
    LOCAL_BOX.copy(bb);
    if (isBuilding) {
      LOCAL_BOX.expandByScalar(0.02);
    } else {
      LOCAL_BOX.min.y = Math.min(LOCAL_BOX.min.y, -0.05);
      LOCAL_BOX.expandByScalar(0.18);
    }
    const tightHit = LOCAL_RAY.intersectBox(LOCAL_BOX, LOCAL_HIT);
    if (!tightHit) return null;
    WORLD_HIT.copy(tightHit).applyMatrix4(rec.mesh.matrixWorld);
    return { dist: RAYCASTER.ray.origin.distanceTo(WORLD_HIT) + 0.08, point: WORLD_HIT.clone() };
  }

  LOCAL_BOX.setFromObject(rec.mesh).expandByScalar(isBuilding ? 0.04 : 0.18);
  const worldBoxHit = RAYCASTER.ray.intersectBox(LOCAL_BOX, WORLD_HIT);
  if (!worldBoxHit) return null;
  return { dist: RAYCASTER.ray.origin.distanceTo(worldBoxHit), point: worldBoxHit.clone() };
}

/**
 * Raycasts live rendered 3D entity meshes under screen coordinates `(clientX, clientY)` so hovering or clicking
 * the upper silhouette of tall buildings, moving robots, insects, or hives in the 28-deg isometric camera
 * resolves directly to that entity instead of the terrain hex behind it.
 */
export function pickEntityAtViewport(
  entries: Iterable<EntityMeshRecord>,
  isWrecked: (id: number) => boolean,
  terrain: HexTerrain | null,
  vp: ColonyViewport,
  clientX: number,
  clientY: number,
): (HexPick & { entityId: number }) | null {
  const dom = vp.renderer?.domElement;
  if (!dom || typeof dom.getBoundingClientRect !== 'function') return null;
  const rect = dom.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;

  NDC.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
  if (!vp.camera) return null;
  RAYCASTER.setFromCamera(NDC, vp.camera);

  const groundPick = terrain ? terrain.pick(NDC, vp.camera) : null;
  let maxDist = Infinity;
  if (groundPick && terrain) {
    const [gx, gz] = tileXZ(groundPick.q, groundPick.r);
    const gy = terrain.heightAt(gx, gz);
    maxDist = RAYCASTER.ray.origin.distanceTo(WORLD_HIT.set(gx, gy, gz)) + 0.65;
  }

  let bestUnitRec: EntityMeshRecord | null = null;
  let bestUnitDist = Infinity;
  let bestStructRec: EntityMeshRecord | null = null;
  let bestStructDist = Infinity;

  for (const rec of entries) {
    if (!rec.mesh.visible || rec.hp <= 0 || isWrecked(rec.id)) continue;
    if (rec.kind === ENTITY_KIND.pod || rec.state === ENTITY_STATE.descending || rec.state === ENTITY_STATE.inert) {
      continue;
    }
    rec.mesh.updateMatrixWorld(true);
    const isUnit = isUnitKind(rec.kind);
    const isBuilding = !isUnit && isConstructibleBuilding(rec.kind);
    const hit = testEntityRayHit(rec, !isUnit && isBuilding);
    if (!hit || hit.dist > maxDist) continue;
    if (isUnit) {
      if (hit.dist < bestUnitDist) {
        bestUnitDist = hit.dist;
        bestUnitRec = rec;
      }
    } else if (hit.dist < bestStructDist) {
      bestStructDist = hit.dist;
      bestStructRec = rec;
    }
  }

  const bestRec = bestUnitRec ?? bestStructRec;
  if (!bestRec) return null;
  const q = Number.isFinite(bestRec.x) ? Math.round(bestRec.x) : Math.round(bestRec.q);
  const r = Number.isFinite(bestRec.y) ? Math.round(bestRec.y) : Math.round(bestRec.r);
  const idx = terrain && inHex(q, r, terrain.radius) ? hexIndex(terrain.radius).indexOf(q, r) : (groundPick?.i ?? -1);
  return {
    q,
    r,
    i: idx,
    entityId: bestRec.id,
  };
}

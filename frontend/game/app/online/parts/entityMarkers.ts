import * as THREE from 'three';
import { classifySuspensionArchetype, createSuspensionState, stepUnitTerrainSuspension } from '@terra/render/motion/terrainSuspension';
import type { PlanetKind } from '@terra/render/planets/PlanetSpec';
import { tileXZ, type HexTerrain } from '@terra/render/planets/hex';
import { ENTITY_KIND, ENTITY_STATE } from '@terra/sim';
import type { EntityMeshRecord } from '../EntityMeshRecord';
import { archetypeForKind, entityWorldXZ, is2x2BuildingKind, is3x3FootprintKind, isConstructibleBuilding } from '../entityKinds';
import type { PodTouchdownFx, PodTouchdownState } from '../PodTouchdownFx';
import { alignGroundRingToTerrain } from './selectionRings';

export function planetKindForBiome(biomeKey: string): PlanetKind {
  if (biomeKey === 'desert' || biomeKey === 'dune') return 'dune';
  if (biomeKey === 'ocean' || biomeKey === 'oceanForest') return 'oceanForest';
  return 'forestRock';
}

export function makeGroundRing(innerR: number, outerR: number, color: number, name: string): THREE.Mesh {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(innerR, outerR, 32).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false, fog: false }),
  );
  ring.name = name;
  ring.visible = false;
  return ring;
}

export function findOwnedPodMesh(entries: Iterable<EntityMeshRecord>, ownerColonyIndex: number): THREE.Object3D | null {
  let best: EntityMeshRecord | undefined;
  for (const rec of entries) {
    if (rec.kind === ENTITY_KIND.pod && rec.owner === ownerColonyIndex) {
      if (!best || rec.state === ENTITY_STATE.descending || rec.id > best.id) best = rec;
    }
  }
  return best?.mesh ?? null;
}

export function stepPodTouchdownForEntries(
  podTouchdown: PodTouchdownFx,
  entries: Iterable<EntityMeshRecord>,
  ownerColonyIndex: number,
  biomeKey: string,
  dt: number,
  terrain: HexTerrain | null,
): PodTouchdownState {
  const list = [...entries];
  let podRec: EntityMeshRecord | undefined;
  for (const rec of list) {
    if (rec.kind === ENTITY_KIND.pod && rec.owner === ownerColonyIndex) {
      if (!podRec || rec.state === ENTITY_STATE.descending || rec.id > podRec.id) {
        podRec = rec;
      }
    }
  }
  let hubCoversCrater = false;
  if (podRec) {
    for (const rec of list) {
      if (isConstructibleBuilding(rec.kind) && rec.state !== ENTITY_STATE.waiting) {
        const coverRadius = rec.kind === ENTITY_KIND.commandHub ? 4.2 : 3.2;
        if (Math.hypot(rec.targetPos.x - podRec.targetPos.x, rec.targetPos.z - podRec.targetPos.z) <= coverRadius) {
          hubCoversCrater = true;
          break;
        }
      }
    }
  }
  const podGroundY = podRec && terrain ? terrain.heightAt(podRec.targetPos.x, podRec.targetPos.z) : 0;
  const tdState = podTouchdown.update(
    dt, podRec?.mesh ?? null, podGroundY,
    podRec?.state === ENTITY_STATE.descending, podRec?.progress ?? 1,
    planetKindForBiome(biomeKey),
  );
  if (hubCoversCrater && tdState.state === 'done') {
    podTouchdown.impactRig.craterGroup.visible = false;
    podTouchdown.impactRig.egressGroup.visible = false;
  }
  return tdState;
}

/** Draws a unit / building at its interpolated pose for `t`, facing where it walks (or its sim heading at rest). */
export function placeMeshOnTrack(rec: EntityMeshRecord, t: number, follow: number): void {
  const pose = rec.track.at(t) ?? { x: rec.x, y: rec.y, rot: rec.rot };
  const [wx, wz] = entityWorldXZ(rec.kind, pose.x, pose.y);
  const p = rec.mesh.position;
  const baseX = rec.trackWorldX ?? p.x;
  const baseZ = rec.trackWorldZ ?? p.z;
  const snap = Math.hypot(wx - baseX, wz - baseZ) > 4.5 ? 1 : follow;
  const nextX = baseX + (wx - baseX) * snap;
  const nextZ = baseZ + (wz - baseZ) * snap;
  rec.trackWorldX = nextX;
  rec.trackWorldZ = nextZ;
  p.x = nextX;
  p.z = nextZ;
  const before = rec.track.at(t - 0.5);
  const [bx, bz] = before ? entityWorldXZ(rec.kind, before.x, before.y) : [wx, wz];
  rec.trackMoving = Math.hypot(wx - bx, wz - bz) > 0.02;
  rec.targetYaw = rec.trackMoving ? Math.atan2(wx - bx, wz - bz) : Math.PI / 2 - pose.rot;
}

export function stepTargetMarker(
  targetMarker: THREE.Mesh,
  sel: EntityMeshRecord | undefined,
  markerT: number,
  markerTile: { q: number; r: number } | null,
  dt: number,
  terrain: HexTerrain | null,
): { markerT: number; markerTile: { q: number; r: number } | null } {
  if (!targetMarker.visible) return { markerT, markerTile };
  const nextT = markerT + dt;
  targetMarker.scale.setScalar(1 + 0.22 * Math.sin(nextT * 8));
  const stillMoving = sel?.state === ENTITY_STATE.moving;
  if (!stillMoving && nextT > 0.6) {
    targetMarker.visible = false;
    return { markerT: nextT, markerTile: null };
  }
  if (terrain && markerTile) {
    const [wx, wz] = tileXZ(markerTile.q, markerTile.r);
    targetMarker.position.set(wx, terrain.heightAt(wx, wz) + 0.08, wz);
    alignGroundRingToTerrain(targetMarker, terrain, wx, wz);
  }
  return { markerT: nextT, markerTile };
}

/**
 * Applies terrain height + 4-corner spring-damper attitude (`YXZ` Euler order) to mobile units on non-flat ground,
 * while keeping constructible buildings and hives anchored horizontally at their foundation height.
 */
export function applyEntityTerrainPose(
  rec: EntityMeshRecord,
  terrain: HexTerrain | null,
  baseWy: number,
  dt: number,
): number | null {
  if (
    rec.kind === ENTITY_KIND.pod ||
    isConstructibleBuilding(rec.kind) ||
    is2x2BuildingKind(rec.kind) ||
    is3x3FootprintKind(rec.kind)
  ) {
    rec.mesh.position.y = baseWy;
    return null;
  }
  const arch = rec.archetypeId ?? archetypeForKind(rec.kind, rec.tier);
  if (!classifySuspensionArchetype(arch)) {
    rec.mesh.position.y = terrain ? terrain.heightAt(rec.mesh.position.x, rec.mesh.position.z) : baseWy;
    return null;
  }
  const susp = (rec.suspension ??= createSuspensionState());
  const baseX = rec.trackWorldX ?? rec.mesh.position.x;
  const baseZ = rec.trackWorldZ ?? rec.mesh.position.z;
  const out = stepUnitTerrainSuspension({
    state: susp,
    terrain,
    archetypeId: arch,
    wx: baseX,
    wz: baseZ,
    yaw: rec.mesh.rotation.y,
    fallbackY: baseWy,
    dt,
  });
  rec.mesh.position.x = baseX + out.surgeX;
  rec.mesh.position.z = baseZ + out.surgeZ;
  rec.mesh.position.y = out.y;
  rec.mesh.rotation.order = 'YXZ';
  rec.mesh.rotation.x = out.pitch;
  rec.mesh.rotation.z = out.roll;
  return out.animTime;
}

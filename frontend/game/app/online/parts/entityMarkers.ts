import * as THREE from 'three';
import type { PlanetKind } from '@terra/render/planets/PlanetSpec';
import { tileXZ, type HexTerrain } from '@terra/render/planets/hex';
import { ENTITY_KIND, ENTITY_STATE } from '@terra/sim';
import type { EntityMeshRecord } from '../EntityMeshes';
import { entityWorldXZ, isConstructibleBuilding } from '../entityKinds';
import type { PodTouchdownFx, PodTouchdownState } from '../PodTouchdownFx';

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
  p.x += (wx - p.x) * follow;
  p.z += (wz - p.z) * follow;
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
  }
  return { markerT: nextT, markerTile };
}

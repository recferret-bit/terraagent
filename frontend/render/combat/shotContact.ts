import * as THREE from 'three';
import type { VfxPoint3D } from '../visuals/projectiles/types';

export interface ShotContact { at: THREE.Vector3; normal: THREE.Vector3 }
export function point3(p: VfxPoint3D): THREE.Vector3 { return new THREE.Vector3(p.x, p.y, p.z ?? 0); }

/** Stable across gallery/local/online event delivery, without consuming simulation randomness. */
export function shotRandom(key: string): () => number {
  let seed = 2166136261;
  for (const char of key) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619);
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

export function meshAimPoint(mesh: THREE.Object3D): THREE.Vector3 {
  const geometry = (mesh as THREE.Mesh).geometry;
  if (geometry && !geometry.boundingBox) geometry.computeBoundingBox();
  mesh.updateWorldMatrix(true, false);
  const box = geometry?.boundingBox;
  return mesh.localToWorld(box ? box.getCenter(new THREE.Vector3()) : new THREE.Vector3(0, 0.55, 0));
}

/** Presentation contact only: ray onto the authored surface, never an authoritative damage test. */
export function surfaceContact(mesh: THREE.Object3D | undefined, from: THREE.Vector3,
  aim: THREE.Vector3, lift: number, key: string): ShotContact {
  const random = shotRandom(key);
  const incoming = aim.clone().sub(from);
  incoming.y -= lift; // Arrival tangent of the parabolic arc.
  incoming.normalize();
  if (incoming.lengthSq() === 0) incoming.set(0, -1, 0);
  const side = new THREE.Vector3().crossVectors(incoming, new THREE.Vector3(0, 1, 0));
  if (side.lengthSq() < 0.001) side.set(1, 0, 0);
  side.normalize();
  const up = new THREE.Vector3().crossVectors(side, incoming).normalize();
  const desired = aim.clone().addScaledVector(side, (random() - 0.5) * 0.07)
    .addScaledVector(up, (random() - 0.5) * 0.07);
  const normal = incoming.clone().negate();
  if (!mesh) return { at: desired, normal };
  mesh.updateWorldMatrix(true, true);
  const geometry = (mesh as THREE.Mesh).geometry;
  const bounds = geometry?.boundingBox?.clone().applyMatrix4(mesh.matrixWorld) ?? new THREE.Box3().setFromObject(mesh);
  const distance = Math.max(2, bounds.getSize(new THREE.Vector3()).length() * 2);
  const ray = new THREE.Raycaster(desired.clone().addScaledVector(incoming, -distance), incoming, 0, distance * 2);
  const surfaces: THREE.Object3D[] = [];
  if ((mesh as THREE.Mesh).isMesh) surfaces.push(mesh);
  else mesh.traverse(child => { if ((child as THREE.Mesh).isMesh && child.visible) surfaces.push(child); });
  const hit = ray.intersectObjects(surfaces, false)[0];
  if (hit) {
    if (hit.face) normal.copy(hit.face.normal).transformDirection(hit.object.matrixWorld);
    if (normal.dot(incoming) > 0) normal.negate();
    return { at: hit.point.addScaledVector(normal, 0.07), normal };
  }
  const at = ray.ray.intersectBox(bounds, new THREE.Vector3());
  return { at: at ? at.addScaledVector(normal, 0.07) : desired, normal };
}

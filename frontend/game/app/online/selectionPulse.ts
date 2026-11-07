import * as THREE from 'three';
import type { EntityMeshRecord } from './EntityMeshRecord';

export function updateSelectionPulse(mesh: THREE.Object3D, selected: boolean, time: number): void {
  const u = mesh.userData.uniforms;
  if (u?.uSelected) u.uSelected.value = selected ? 1 : 0;
  if (u?.uSelectionTime) u.uSelectionTime.value = time;
}

/** Shared ground selection presentation; the entity orchestrator only supplies selection and clock. */
export function updateGroundSelection(ring: THREE.Mesh, sel: EntityMeshRecord | undefined, time: number): void {
  if (!sel || !sel.mesh.visible) {
    ring.visible = false;
    return;
  }
  ring.visible = true;
  const geometry = (sel.mesh as THREE.Mesh).geometry;
  if (geometry && !geometry.boundingBox) geometry.computeBoundingBox();
  const box = geometry?.boundingBox;
  const radius = box ? Math.max(box.max.x - box.min.x, box.max.z - box.min.z) * sel.mesh.scale.x * 0.65 : 1;
  ring.scale.setScalar(Math.max(1, radius) * (1 + 0.06 * Math.sin(time * 4)));
  (ring.material as THREE.MeshBasicMaterial).opacity = 0.65 + 0.3 * Math.sin(time * 4);
  ring.position.set(sel.mesh.position.x, sel.mesh.position.y + 0.06, sel.mesh.position.z);
}

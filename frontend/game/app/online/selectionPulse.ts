import type * as THREE from 'three';

export function updateSelectionPulse(mesh: THREE.Object3D, selected: boolean, time: number): void {
  const u = mesh.userData.uniforms;
  if (u?.uSelected) u.uSelected.value = selected ? 1 : 0;
  if (u?.uSelectionTime) u.uSelectionTime.value = time;
}

import * as THREE from 'three';
import { getInsectAnimator } from '../animation/insects/InsectAnimationController';
import { evalSpiderBodyPoint } from '../particles/toolOrigins';

const MOUTHS: Record<string, THREE.Vector3Tuple> = {
  'fauna.blackAnt': [0, 0.61, 1.1],
  'fauna.blueBeetle': [0, 0.64, 1.05],
  'fauna.greenSpitter': [0, 0.64, 0.88],
};
/** Insect sockets follow the GPU jaw/horn or rear-sac pose; older meshes use their mouth carrier. */
export function faunaMuzzle(mesh: THREE.Object3D, target: THREE.Vector3, side?: number): THREE.Vector3 | null {
  const socket = MOUTHS[mesh.userData.archetypeId ?? mesh.name];
  if (!socket) return null;
  const point = mesh.parent ? mesh.parent.worldToLocal(target.clone()) : target;
  mesh.rotation.y = Math.atan2(point.x - mesh.position.x, point.z - mesh.position.z);
  const animator = getInsectAnimator(mesh);
  if (animator) return animator.socket(mesh.userData.archetypeId === 'fauna.greenSpitter' ? 'projectile' : 'melee', side);
  const u = mesh.userData.uniforms;
  const local = evalSpiderBodyPoint(...socket, (u?.uTime?.value ?? 0) * 5, u?.uWalkWeight?.value ?? 0, u?.uWorkWeight?.value ?? 0);
  mesh.updateWorldMatrix(true, false);
  return mesh.localToWorld(new THREE.Vector3(...local));
}

import type * as THREE from 'three';
import { inViewFocus } from '@terra/render/core/viewFocus';

/**
 * Radius (m) around an entity's origin that its visuals can reach: a 3×3 Hub (~4 m) plus its projector cones and
 * ground pools. An entity whose disc misses the view focus (`core/viewFocus.ts`: camera footprint × margin) is
 * off-screen by at least the margin.
 */
export const ENTITY_FOCUS_PAD_M = 8;

/**
 * True while the entity can be on screen. Off-focus entities keep their pose (position, heading, walk/work weights
 * follow the sim every frame, so nothing jumps when the camera comes back) but skip the purely visual per-frame
 * work: shader animation clock, projector-rig power, health-bar layout. Draw culling itself is three's frustum test
 * (colour pass) and the view-fitted shadow camera (shadow pass); `mesh.visible` stays the gameplay visibility
 * (fog of war, pod phases) that vision and selection read.
 */
export function isEntityInViewFocus(mesh: THREE.Object3D): boolean {
  return inViewFocus(mesh.position.x, mesh.position.z, ENTITY_FOCUS_PAD_M);
}

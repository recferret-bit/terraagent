import type { Object3D } from 'three';

/** A planar pose: callers may use metres or tiles, consistently within a track. */
export interface Pose { x: number; y: number; rot: number }

/** Shortest-arc interpolation, including turns across -pi/pi. */
export function lerpAngle(a: number, b: number, k: number): number {
  return a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * k;
}

/** Position comes directly from the interpolated tick. Only heading eases through corners.
 * dt=0 freezes heading; explicit steps/resets may request an exact heading. */
export function placeTickPose(mesh: Object3D, pose: Pose, dt: number, snapHeading = false): void {
  mesh.position.x = pose.x;
  mesh.position.z = pose.y;
  mesh.rotation.y = snapHeading ? pose.rot : lerpAngle(mesh.rotation.y, pose.rot, 1 - Math.exp(-Math.max(0, dt) * 12));
}

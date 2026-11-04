import * as THREE from 'three';
import type { CableSpan } from '@terra/render/lighting/gridCables';

/** Raise a span above intervening buildings, with clearance around their model bounds. */
export function clearCableRoofs(span: CableSpan, obstacles: Iterable<THREE.Object3D>): CableSpan {
  let lift = Math.max(0, -span.sag);
  for (const mesh of obstacles) {
    mesh.updateWorldMatrix(true, false);
    const geometry = (mesh as THREE.Mesh).geometry;
    if (!geometry) continue;
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    const box = geometry.boundingBox!.clone().applyMatrix4(mesh.matrixWorld).expandByScalar(0.35);
    let lo = 0, hi = 1;
    for (const axis of [0, 2] as const) {
      const key = axis === 0 ? 'x' : 'z';
      const delta = span.b[axis] - span.a[axis];
      if (Math.abs(delta) < 1e-6) {
        if (span.a[axis] < box.min[key] || span.a[axis] > box.max[key]) hi = -1;
      } else {
        const a = (box.min[key] - span.a[axis]) / delta;
        const b = (box.max[key] - span.a[axis]) / delta;
        lo = Math.max(lo, Math.min(a, b));
        hi = Math.min(hi, Math.max(a, b));
      }
    }
    if (lo >= hi) continue;
    // A concave parabola's minimum over the crossing interval occurs at an endpoint.
    for (const t of [Math.max(0.05, lo), Math.min(0.95, hi)]) {
      const lineY = span.a[1] + (span.b[1] - span.a[1]) * t;
      lift = Math.max(lift, (box.max.y - lineY) / (4 * t * (1 - t)));
    }
  }
  return { ...span, sag: -capLift(lift, span) };
}

/** Tallest arc a span may have: proportional to its length (tiny for short spans), never above `MAX_LIFT_M`. */
export const MAX_LIFT_M = 8;
export function capLift(lift: number, span: CableSpan): number {
  const len = Math.hypot(span.b[0] - span.a[0], span.b[1] - span.a[1], span.b[2] - span.a[2]);
  const cap = Math.min(MAX_LIFT_M, Math.max(0.1, 0.6 * len));
  return Number.isFinite(lift) ? Math.min(lift, cap) : cap;
}

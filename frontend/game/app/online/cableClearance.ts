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
    for (const t of [Math.max(0.001, lo), Math.min(0.999, hi)]) {
      const lineY = span.a[1] + (span.b[1] - span.a[1]) * t;
      lift = Math.max(lift, (box.max.y - lineY) / (4 * t * (1 - t)));
    }
  }
  return { ...span, sag: -lift };
}

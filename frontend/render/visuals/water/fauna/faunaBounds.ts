import * as THREE from 'three';
import { BOB_AMP, FAUNA_SINK_MAX, PATH_WOBBLE, type FaunaBuffers } from './faunaPlacement';
import { JELLY_BOB, JELLY_TENTACLE_LEN, type JellyBuffers } from './jellyPlacement';

/** Slack (m) on top of the analytic reach: the school's vertical spread, fin flex, the bell's width. */
const SLACK = 0.25;
/** Extra horizontal slack (m): the wave refraction shift of the image (`faunaWater.ts`, slope × depth × 1.4). */
const XZ_SLACK = 1.5;

const grow = (box: THREE.Box3, cx: number, cz: number, reach: number, yLo: number, yHi: number) => {
  box.expandByPoint(new THREE.Vector3(cx - reach, yLo, cz - reach));
  box.expandByPoint(new THREE.Vector3(cx + reach, yHi, cz + reach));
};

/**
 * Local-space box every placed fish can reach over its whole loop (centre ± wobbled loop radius + school offset +
 * body length; from the surface down to its depth + the deepest wave sink). Instance matrices are identity, so the
 * mesh bounds come from here, not from three's `computeBoundingBox`.
 */
export function fishBounds(b: FaunaBuffers, placed: number, out = new THREE.Box3()): THREE.Box3 {
  out.makeEmpty();
  for (let i = 0; i < placed; i++) {
    const [cx, cz, r] = [b.swim[i * 4]!, b.swim[i * 4 + 1]!, b.swim[i * 4 + 2]!];
    const [depth, length] = [b.fish[i * 4 + 1]!, b.fish[i * 4 + 2]!];
    const [along, side, dy] = [b.offset[i * 4]!, b.offset[i * 4 + 1]!, b.offset[i * 4 + 2]!];
    const reach = r * (1 + PATH_WOBBLE) + Math.hypot(along, side) + length + XZ_SLACK;
    grow(out, cx, cz, reach, -depth - FAUNA_SINK_MAX - Math.abs(dy) - BOB_AMP - length - SLACK, SLACK);
  }
  return out;
}

/** Local-space box of every placed jellyfish's drift loop, bell and tentacles at the deepest wave sink. */
export function jellyBounds(b: JellyBuffers, placed: number, out = new THREE.Box3()): THREE.Box3 {
  out.makeEmpty();
  for (let i = 0; i < placed; i++) {
    const [cx, cz, r] = [b.drift[i * 4]!, b.drift[i * 4 + 1]!, b.drift[i * 4 + 2]!];
    const [depth, scale] = [b.jelly[i * 4 + 1]!, b.jelly[i * 4 + 2]!];
    const body = (JELLY_TENTACLE_LEN + 0.1 + JELLY_BOB) * scale;
    grow(out, cx, cz, r + 0.3 * scale + XZ_SLACK, -depth - FAUNA_SINK_MAX - body - SLACK, 0.3 * scale + SLACK);
  }
  return out;
}

/** Writes `box` as the mesh's bounds (an empty box gives a zero sphere, so nothing is drawn by mistake). */
export function setMeshBounds(mesh: THREE.InstancedMesh, box: THREE.Box3): void {
  mesh.boundingBox = box.clone();
  mesh.boundingSphere = box.isEmpty() ? new THREE.Sphere(new THREE.Vector3(), 0) : box.getBoundingSphere(new THREE.Sphere());
}

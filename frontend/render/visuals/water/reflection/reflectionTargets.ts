import * as THREE from 'three';
import type { ReflectiveWater } from './reflectionRegistry';

/**
 * Per-frame choice of what the mirror pass reflects: the registered waters that are in the rendered scene and shown,
 * and of their surface parts the ones inside the main camera's frustum. No on-screen part = no pass (the main win:
 * the dune planet and every view without water skip it entirely).
 */
export interface ReflectionTarget {
  /** Mirror plane level: the first on-screen water's (waters at another level are not mirrored this frame). */
  level: number;
  /** World bounds of the on-screen parts at `level` (bound the scissor rect). */
  readonly boxes: THREE.Box3[];
  /** How many of `boxes` are live this frame. */
  boxCount: number;
  /** Every shown registered water in the scene: hidden during the mirror render. */
  readonly hide: THREE.Object3D[];
}

export const createReflectionTarget = (): ReflectionTarget => ({ level: 0, boxes: [], boxCount: 0, hide: [] });

const LEVEL_EPS = 1e-3;
const frustum = new THREE.Frustum();
const planePoint = new THREE.Vector3();
const viewProj = new THREE.Matrix4();

/** True when `obj` is `root` or a descendant of it and it and every ancestor below `root` are visible. */
export function shownUnder(obj: THREE.Object3D, root: THREE.Object3D): boolean {
  for (let o: THREE.Object3D | null = obj; o; o = o.parent) {
    if (o === root) return true;
    if (!o.visible) return false;
  }
  return false;
}

/** World Y of `w`'s mirror plane (its object's world matrix refreshed with its ancestors). */
function worldLevel(w: ReflectiveWater): number {
  w.object.updateWorldMatrix(true, false);
  return planePoint.set(0, w.planeY ?? 0, 0).applyMatrix4(w.object.matrixWorld).y;
}

function nextBox(t: ReflectionTarget): THREE.Box3 {
  const box = t.boxes[t.boxCount] ?? (t.boxes[t.boxCount] = new THREE.Box3());
  t.boxCount++;
  return box;
}

function* defaultParts(w: ReflectiveWater): Iterable<THREE.Mesh> {
  if ((w.object as THREE.Mesh).isMesh) yield w.object as THREE.Mesh;
}

/** Adds the world boxes of `w`'s shown parts that intersect the frustum; returns how many it added. */
function addOnScreenParts(w: ReflectiveWater, t: ReflectionTarget): number {
  let added = 0;
  for (const part of (w.parts ?? (() => defaultParts(w)))()) {
    if (!shownUnder(part, w.object)) continue; // `object` itself is known to be shown
    const geo = part.geometry;
    if (!geo.boundingBox) geo.computeBoundingBox();
    const box = nextBox(t).copy(geo.boundingBox!).applyMatrix4(part.matrixWorld);
    if (frustum.intersectsBox(box)) added++;
    else t.boxCount--;
  }
  return added;
}

/**
 * Fills `t` for rendering `scene` through `camera` (world matrices current). Returns false when there is nothing to
 * reflect: no registered water in the scene and shown, or none of its parts in the camera frustum.
 */
export function selectReflectionTarget(
  waters: Iterable<ReflectiveWater>, scene: THREE.Object3D, camera: THREE.Camera, t: ReflectionTarget,
): boolean {
  t.boxCount = 0;
  t.hide.length = 0;
  let levelSet = false;
  viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  frustum.setFromProjectionMatrix(viewProj);
  for (const w of waters) {
    if (!shownUnder(w.object, scene)) continue;
    t.hide.push(w.object);
    const level = worldLevel(w);
    if (levelSet && Math.abs(level - t.level) > LEVEL_EPS) continue;
    if (addOnScreenParts(w, t) > 0 && !levelSet) { t.level = level; levelSet = true; }
  }
  return levelSet;
}

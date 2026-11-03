import * as THREE from 'three';
import { getViewFocus, inViewFocus, VIEW_FOCUS_MAX_RADIUS } from './viewFocus';

/**
 * Shared helpers for spatially bucketed meshes (hex props, hex water, water fauna): a square world-cell key, so each
 * bucket's bounds stay small and three frustum-culls off-screen buckets, and the per-frame "hide what lies off the
 * view focus" test (`core/viewFocus.ts`).
 */

/** Key of the square `cell`-metre world cell holding (x, z). */
export const worldCellKey = (x: number, z: number, cell: number): string => `${Math.floor(x / cell)},${Math.floor(z / cell)}`;

/**
 * False while the focus is clamped to `VIEW_FOCUS_MAX_RADIUS` (camera looking toward the horizon): it may then not
 * cover the whole screen, so focus culling must not hide anything (three's frustum culling still applies).
 */
export const viewFocusBounded = (): boolean => getViewFocus().radius < VIEW_FOCUS_MAX_RADIUS;

const tmpCentre = new THREE.Vector3();

/**
 * True when the local-space sphere `s` of `obj` (world matrix up to date, unscaled), grown by `pad` metres (e.g. a
 * shadow's reach), touches the view focus.
 */
export function sphereInViewFocus(obj: THREE.Object3D, s: THREE.Sphere, pad = 0): boolean {
  tmpCentre.copy(s.center).applyMatrix4(obj.matrixWorld);
  return inViewFocus(tmpCentre.x, tmpCentre.z, s.radius + pad);
}

/**
 * Sets `visible` on every object: hidden when `wanted` says so or its bounds (`sphereOf`) lie wholly outside the view
 * focus; shown otherwise (and always while the focus is unbounded). Call once per frame, after `updateViewFocus`.
 */
export function cullToViewFocus<T extends THREE.Object3D>(
  objs: Iterable<T>,
  sphereOf: (o: T) => THREE.Sphere | null | undefined,
  wanted: (o: T) => boolean = () => true,
): void {
  const bounded = viewFocusBounded();
  for (const o of objs) {
    if (!wanted(o)) { o.visible = false; continue; }
    const s = sphereOf(o);
    o.visible = !bounded || !s || sphereInViewFocus(o, s);
  }
}

import * as THREE from 'three';

/**
 * Planar-mirror camera maths for the water reflection pass (`WaterReflectionPass.ts`), ported from three's
 * `examples/jsm/objects/Reflector.js` for a horizontal plane y = level (normal +Y). Pure: no renderer, no scene.
 *
 * The mirror camera is built the Reflector way (position, look target and up reflected, then `lookAt`), so it stays a
 * right-handed camera and triangle winding is unchanged. Side effect of that: its image is the reflected view
 * mirrored horizontally (a water point P lands at u = 1 − u_screen(P), v = v_screen(P)). Nothing depends on that:
 * the shader looks up through `uReflMatrix`, which is built from the same camera.
 */

/** Metres the oblique clip plane sits below the water level, so shore geometry at the waterline is never cut. */
export const MIRROR_CLIP_SINK = 0.05;

/** Clip space → 0..1 texture space (the Reflector "bias" matrix). No Y flip: RT texel row 0 is NDC y = −1. */
const BIAS = new THREE.Matrix4().set(
  0.5, 0, 0, 0.5,
  0, 0.5, 0, 0.5,
  0, 0, 0.5, 0.5,
  0, 0, 0, 1,
);
const UP = new THREE.Vector3(0, 1, 0);
const camPos = new THREE.Vector3();
const target = new THREE.Vector3();
const rot = new THREE.Matrix4();
const plane = new THREE.Plane();
const planePoint = new THREE.Vector3();
const clip = new THREE.Vector4();
const q = new THREE.Vector4();

export interface MirrorOptions {
  /** Clip plane depth below the level (m), default `MIRROR_CLIP_SINK`. */
  clipSink?: number;
  /** Reflector's `clipBias` (depth bias on the oblique near plane), default 0. */
  clipBias?: number;
}

/**
 * Points `mirror` at the reflection of `main` about the plane y = `level`, copies its projection, layers, near and
 * far, writes the texture matrix `bias · projection · view` (world → 0..1 mirror UV after the divide by w) into
 * `texMatrix`, and then replaces the projection's near plane with the water plane (oblique clipping) so nothing below
 * the water is drawn. `main`'s world matrix must be current. Returns false (and touches nothing) when the camera is
 * at or below the plane: there is no reflection to see.
 */
export function updateMirrorCamera(
  main: THREE.PerspectiveCamera, mirror: THREE.PerspectiveCamera, level: number, texMatrix: THREE.Matrix4,
  opts: MirrorOptions = {},
): boolean {
  camPos.setFromMatrixPosition(main.matrixWorld);
  if (camPos.y <= level) return false;
  rot.extractRotation(main.matrixWorld);
  target.set(0, 0, -1).applyMatrix4(rot).add(camPos);
  target.y = 2 * level - target.y;
  mirror.position.set(camPos.x, 2 * level - camPos.y, camPos.z);
  mirror.up.copy(UP).applyMatrix4(rot);
  mirror.up.y = -mirror.up.y;
  mirror.lookAt(target);
  mirror.near = main.near;
  mirror.far = main.far; // WebGLBackground reads it
  mirror.layers.mask = main.layers.mask;
  mirror.updateMatrixWorld();
  mirror.projectionMatrix.copy(main.projectionMatrix);
  texMatrix.copy(BIAS).multiply(mirror.projectionMatrix).multiply(mirror.matrixWorldInverse);
  applyObliqueClip(mirror, level - (opts.clipSink ?? MIRROR_CLIP_SINK), opts.clipBias ?? 0);
  return true;
}

/**
 * Lengyel's oblique near plane (http://www.terathon.com/code/oblique.html): only the projection's third row changes,
 * so x, y and w (and therefore the texture matrix) are unaffected. Keeps points with y > `clipY`.
 */
function applyObliqueClip(mirror: THREE.PerspectiveCamera, clipY: number, clipBias: number): void {
  plane.setFromNormalAndCoplanarPoint(UP, planePoint.set(0, clipY, 0)).applyMatrix4(mirror.matrixWorldInverse);
  clip.set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
  const e = mirror.projectionMatrix.elements;
  q.x = (Math.sign(clip.x) + e[8]!) / e[0]!;
  q.y = (Math.sign(clip.y) + e[9]!) / e[5]!;
  q.z = -1;
  q.w = (1 + e[10]!) / e[14]!;
  clip.multiplyScalar(2 / clip.dot(q));
  e[2] = clip.x;
  e[6] = clip.y;
  e[10] = clip.z + 1 - clipBias;
  e[14] = clip.w;
  mirror.projectionMatrixInverse.copy(mirror.projectionMatrix).invert();
}

/** A pixel rectangle of the render target, origin bottom-left (WebGL viewport / scissor convention). */
export interface PixelRect { x: number; y: number; w: number; h: number }

const crop = new THREE.Matrix4();

/**
 * Narrows the mirror projection to the pixel rect `r` of a `width`×`height` target: drawn with the target's viewport
 * set to `r`, every pixel lands exactly where the uncropped projection over the whole target puts it (so
 * `uReflMatrix` stays valid), but three's frustum culling now drops every object outside the rect.
 */
export function cropProjection(mirror: THREE.PerspectiveCamera, r: PixelRect, width: number, height: number): void {
  const x0 = (2 * r.x) / width - 1, x1 = (2 * (r.x + r.w)) / width - 1;
  const y0 = (2 * r.y) / height - 1, y1 = (2 * (r.y + r.h)) / height - 1;
  const sx = 2 / (x1 - x0), sy = 2 / (y1 - y0);
  crop.set(
    sx, 0, 0, -(x1 + x0) / (x1 - x0),
    0, sy, 0, -(y1 + y0) / (y1 - y0),
    0, 0, 1, 0,
    0, 0, 0, 1,
  );
  mirror.projectionMatrix.premultiply(crop);
  mirror.projectionMatrixInverse.copy(mirror.projectionMatrix).invert();
}

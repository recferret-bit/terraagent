import * as THREE from 'three';
import type { PixelRect } from './mirrorCamera';

/**
 * The part of the mirror texture the reflection pass renders: the screen rectangle of the visible water (its world
 * bounds projected through `uReflMatrix`), grown by room for the shader's distortion, snapped outward to whole texels.
 */

/** UV room around the water's rect for the distorted lookups (the shader clamps into `uReflRect` beyond it). */
export const REFLECT_RECT_PAD_UV = 0.03;
/** Extra texels around the rect (bilinear footprint + rounding). */
export const REFLECT_RECT_PAD_TEXELS = 2;

/** Running UV bounds of projected points; `behind` = a point projected with w <= 0 (the rect is then unknown). */
export interface UvBounds { u0: number; v0: number; u1: number; v1: number; behind: boolean }

export const emptyUvBounds = (): UvBounds => ({ u0: Infinity, v0: Infinity, u1: -Infinity, v1: -Infinity, behind: false });

export function resetUvBounds(b: UvBounds): UvBounds {
  b.u0 = b.v0 = Infinity;
  b.u1 = b.v1 = -Infinity;
  b.behind = false;
  return b;
}

const corner = new THREE.Vector4();

/** Grows `b` by the 8 corners of the world box `box` projected through `texMatrix` (world → 0..1 UV · w). */
export function addBoxToUvBounds(b: UvBounds, box: THREE.Box3, texMatrix: THREE.Matrix4): UvBounds {
  for (let i = 0; i < 8; i++) {
    corner.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z, 1);
    corner.applyMatrix4(texMatrix);
    if (corner.w <= 1e-6) { b.behind = true; continue; }
    const u = corner.x / corner.w, v = corner.y / corner.w;
    if (u < b.u0) b.u0 = u;
    if (u > b.u1) b.u1 = u;
    if (v < b.v0) b.v0 = v;
    if (v > b.v1) b.v1 = v;
  }
  return b;
}

/**
 * The pixel rect of a `width`×`height` target covering `b` plus the pads, clamped to the target; the whole target
 * when a corner was behind the camera; null when the bounds miss the target entirely (or are empty).
 */
export function uvBoundsToPixelRect(b: UvBounds, width: number, height: number, out: PixelRect): PixelRect | null {
  if (b.behind) return setRect(out, 0, 0, width, height);
  if (!(b.u1 >= b.u0 && b.v1 >= b.v0)) return null;
  const pu = REFLECT_RECT_PAD_UV + REFLECT_RECT_PAD_TEXELS / width;
  const pv = REFLECT_RECT_PAD_UV + REFLECT_RECT_PAD_TEXELS / height;
  const x0 = Math.max(0, Math.floor((b.u0 - pu) * width)), x1 = Math.min(width, Math.ceil((b.u1 + pu) * width));
  const y0 = Math.max(0, Math.floor((b.v0 - pv) * height)), y1 = Math.min(height, Math.ceil((b.v1 + pv) * height));
  if (x1 <= x0 || y1 <= y0) return null;
  return setRect(out, x0, y0, x1 - x0, y1 - y0);
}

function setRect(out: PixelRect, x: number, y: number, w: number, h: number): PixelRect {
  out.x = x; out.y = y; out.w = w; out.h = h;
  return out;
}

/**
 * `uReflRect` (u0, v0, u1, v1) for a rendered pixel rect: the rect inset by half a texel, so a bilinear lookup clamped
 * into it never blends a texel the pass did not render this frame.
 */
export function pixelRectToUv(r: PixelRect, width: number, height: number, out: THREE.Vector4): THREE.Vector4 {
  const hu = 0.5 / width, hv = 0.5 / height;
  return out.set(r.x / width + hu, r.y / height + hv, (r.x + r.w) / width - hu, (r.y + r.h) / height - hv);
}

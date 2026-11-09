import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  addBoxToUvBounds, emptyUvBounds, pixelRectToUv, REFLECT_RECT_PAD_TEXELS, REFLECT_RECT_PAD_UV, resetUvBounds,
  uvBoundsToPixelRect,
} from './reflectionRect';

const W = 400, H = 200;
const rect = () => ({ x: -1, y: -1, w: -1, h: -1 });

/** A texture matrix that maps world x/z straight to u/v (w = 1): easy expectations. */
const flat = new THREE.Matrix4().set(
  1, 0, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 0,
  0, 0, 0, 1,
);

describe('reflection scissor rect', () => {
  it('bounds the projected box corners, padded for distortion + texels, snapped outward to whole texels', () => {
    const b = addBoxToUvBounds(emptyUvBounds(), new THREE.Box3(new THREE.Vector3(0.4, -1, 0.3), new THREE.Vector3(0.6, 1, 0.5)), flat);
    expect([b.u0, b.v0, b.u1, b.v1]).toEqual([0.4, 0.3, 0.6, 0.5]);
    const r = uvBoundsToPixelRect(b, W, H, rect())!;
    const pu = REFLECT_RECT_PAD_UV * W + REFLECT_RECT_PAD_TEXELS;
    const pv = REFLECT_RECT_PAD_UV * H + REFLECT_RECT_PAD_TEXELS;
    expect(r.x).toBe(Math.floor(0.4 * W - pu));
    expect(r.y).toBe(Math.floor(0.3 * H - pv));
    expect(r.x + r.w).toBe(Math.ceil(0.6 * W + pu));
    expect(r.y + r.h).toBe(Math.ceil(0.5 * H + pv));
  });

  it('clamps to the target', () => {
    const b = addBoxToUvBounds(emptyUvBounds(), new THREE.Box3(new THREE.Vector3(-3, 0, 0.2), new THREE.Vector3(0.5, 0, 9)), flat);
    expect(uvBoundsToPixelRect(b, W, H, rect())).toMatchObject({ x: 0, w: Math.ceil((0.5 + REFLECT_RECT_PAD_UV) * W + REFLECT_RECT_PAD_TEXELS), y: Math.floor((0.2 - REFLECT_RECT_PAD_UV) * H - REFLECT_RECT_PAD_TEXELS) });
    const r = uvBoundsToPixelRect(b, W, H, rect())!;
    expect(r.y + r.h).toBe(H);
  });

  it('falls back to the whole target when a corner is behind the camera (w <= 0)', () => {
    const behind = new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, -1, 0, 0); // w = −y
    const b = addBoxToUvBounds(emptyUvBounds(), new THREE.Box3(new THREE.Vector3(0, -1, 0), new THREE.Vector3(1, 1, 1)), behind);
    expect(b.behind).toBe(true);
    expect(uvBoundsToPixelRect(b, W, H, rect())).toEqual({ x: 0, y: 0, w: W, h: H });
  });

  it('is null for empty bounds or bounds wholly off the target', () => {
    expect(uvBoundsToPixelRect(emptyUvBounds(), W, H, rect())).toBeNull();
    const b = addBoxToUvBounds(emptyUvBounds(), new THREE.Box3(new THREE.Vector3(2, 0, 2), new THREE.Vector3(3, 0, 3)), flat);
    expect(uvBoundsToPixelRect(b, W, H, rect())).toBeNull();
    expect(resetUvBounds(b)).toEqual(emptyUvBounds());
  });

  it('uReflRect is the rendered rect inset by half a texel (clamped bilinear lookups stay inside it)', () => {
    const v = pixelRectToUv({ x: 40, y: 20, w: 100, h: 50 }, W, H, new THREE.Vector4());
    expect(v.x).toBeCloseTo((40 + 0.5) / W, 9);
    expect(v.y).toBeCloseTo((20 + 0.5) / H, 9);
    expect(v.z).toBeCloseTo((140 - 0.5) / W, 9);
    expect(v.w).toBeCloseTo((70 - 0.5) / H, 9);
  });
});

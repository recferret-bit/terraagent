import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { cropProjection, MIRROR_CLIP_SINK, updateMirrorCamera } from './mirrorCamera';

const LEVEL = 0.5;

function mainCamera(): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(28, 16 / 9, 1, 600);
  cam.position.set(42, 46, 42);
  cam.lookAt(3, 0, -2);
  cam.updateMatrixWorld();
  return cam;
}

function mirrored(main = mainCamera()) {
  const mirror = new THREE.PerspectiveCamera();
  const tex = new THREE.Matrix4();
  const ok = updateMirrorCamera(main, mirror, LEVEL, tex);
  return { main, mirror, tex, ok };
}

/** World point → 0..1 UV through a texture matrix (what the shader does). */
function texUv(tex: THREE.Matrix4, p: THREE.Vector3): THREE.Vector2 {
  const c = new THREE.Vector4(p.x, p.y, p.z, 1).applyMatrix4(tex);
  return new THREE.Vector2(c.x / c.w, c.y / c.w);
}

/** World point → 0..1 screen UV of the main camera. */
function screenUv(cam: THREE.Camera, p: THREE.Vector3): THREE.Vector2 {
  const n = p.clone().project(cam);
  return new THREE.Vector2(n.x * 0.5 + 0.5, n.y * 0.5 + 0.5);
}

const reflect = (p: THREE.Vector3) => new THREE.Vector3(p.x, 2 * LEVEL - p.y, p.z);

/** NDC depth of `p` through the mirror camera's (oblique) projection. */
function mirrorNdcZ(mirror: THREE.PerspectiveCamera, p: THREE.Vector3): number {
  const c = new THREE.Vector4(p.x, p.y, p.z, 1).applyMatrix4(mirror.matrixWorldInverse).applyMatrix4(mirror.projectionMatrix);
  return c.z / c.w;
}

describe('mirror camera (planar reflection about y = level)', () => {
  it('sits at the reflected position, looking up, with the main camera layers / near / far', () => {
    const main = mainCamera();
    main.layers.enable(3);
    const { mirror, ok } = mirrored(main);
    expect(ok).toBe(true);
    expect(mirror.position.x).toBeCloseTo(42, 6);
    expect(mirror.position.y).toBeCloseTo(2 * LEVEL - 46, 6);
    expect(mirror.position.z).toBeCloseTo(42, 6);
    expect(mirror.getWorldDirection(new THREE.Vector3()).y).toBeGreaterThan(0);
    expect(mirror.layers.mask).toBe(main.layers.mask);
    expect([mirror.near, mirror.far]).toEqual([main.near, main.far]);
  });

  it('a water-plane point maps through uReflMatrix to its own screen position, mirrored left-right, no Y flip', () => {
    const { main, tex } = mirrored();
    for (const p of [new THREE.Vector3(3, LEVEL, -2), new THREE.Vector3(-6, LEVEL, 4), new THREE.Vector3(12, LEVEL, 9)]) {
      const uv = texUv(tex, p), s = screenUv(main, p);
      expect(uv.x).toBeCloseTo(1 - s.x, 5);
      expect(uv.y).toBeCloseTo(s.y, 5);
    }
  });

  it('a point above the water lands where the main camera sees its reflection below the plane', () => {
    const { main, tex } = mirrored();
    const p = new THREE.Vector3(5, 7, -4);
    const uv = texUv(tex, p), s = screenUv(main, reflect(p));
    expect(uv.x).toBeCloseTo(1 - s.x, 5);
    expect(uv.y).toBeCloseTo(s.y, 5);
  });

  it('oblique near plane: keeps what is above the water, clips what is below it (lake bed)', () => {
    const { mirror } = mirrored();
    const above = new THREE.Vector3(3, LEVEL + 2, -2);
    const onPlane = new THREE.Vector3(3, LEVEL - MIRROR_CLIP_SINK, -2);
    const below = new THREE.Vector3(3, LEVEL - 1.5, -2);
    const zAbove = mirrorNdcZ(mirror, above);
    expect(zAbove).toBeGreaterThan(-1);
    expect(zAbove).toBeLessThan(1);
    expect(mirrorNdcZ(mirror, onPlane)).toBeCloseTo(-1, 4);
    expect(mirrorNdcZ(mirror, below)).toBeLessThan(-1);
  });

  it('the oblique clip leaves x, y and w alone (uReflMatrix is valid before and after it)', () => {
    const { mirror, tex } = mirrored();
    const p = new THREE.Vector3(-4, 3, 6);
    const c = new THREE.Vector4(p.x, p.y, p.z, 1).applyMatrix4(mirror.matrixWorldInverse).applyMatrix4(mirror.projectionMatrix);
    const uv = texUv(tex, p);
    expect(c.x / c.w * 0.5 + 0.5).toBeCloseTo(uv.x, 6);
    expect(c.y / c.w * 0.5 + 0.5).toBeCloseTo(uv.y, 6);
  });

  it('rejects reflection (returns false) when the camera is at or below the water plane', () => {
    const cam = new THREE.PerspectiveCamera(28, 1, 1, 600);
    cam.position.set(0, LEVEL - 1, 0);
    cam.lookAt(0, LEVEL - 1, -10);
    cam.updateMatrixWorld();
    expect(updateMirrorCamera(cam, new THREE.PerspectiveCamera(), LEVEL, new THREE.Matrix4())).toBe(false);

    cam.position.set(0, LEVEL, 0);
    cam.updateMatrixWorld();
    expect(updateMirrorCamera(cam, new THREE.PerspectiveCamera(), LEVEL, new THREE.Matrix4())).toBe(false);
  });

  it('cropping to a pixel rect keeps every pixel where the full projection puts it', () => {
    const { mirror, tex } = mirrored();
    const W = 480, H = 270;
    const r = { x: 100, y: 40, w: 200, h: 120 };
    cropProjection(mirror, r, W, H);
    for (const p of [new THREE.Vector3(3, LEVEL, -2), new THREE.Vector3(1, 2, 0)]) {
      const uv = texUv(tex, p); // full-target UV
      const c = new THREE.Vector4(p.x, p.y, p.z, 1).applyMatrix4(mirror.matrixWorldInverse).applyMatrix4(mirror.projectionMatrix);
      const px = r.x + (c.x / c.w * 0.5 + 0.5) * r.w; // viewport = the rect
      const py = r.y + (c.y / c.w * 0.5 + 0.5) * r.h;
      expect(px).toBeCloseTo(uv.x * W, 4);
      expect(py).toBeCloseTo(uv.y * H, 4);
    }
    const id = mirror.projectionMatrix.clone().multiply(mirror.projectionMatrixInverse).elements;
    new THREE.Matrix4().elements.forEach((e, i) => expect(id[i]).toBeCloseTo(e, 6));
  });
});

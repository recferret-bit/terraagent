import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  getViewFocus, getViewFocusEdgesUniform, getViewFocusQuad, getViewFocusUniform, inViewFocus, setViewFocusEnabled,
  setViewFocusMargin, updateViewFocus, VIEW_FOCUS_EDGE_PAD, VIEW_FOCUS_MARGIN, VIEW_FOCUS_MAX_RADIUS,
  viewFocusQuadDistance,
} from './viewFocus';
import { viewFocusBounded } from './focusCull';

function topDownCamera(x: number, h: number, z: number, groundY = 0): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(28, 16 / 9, 1, 600);
  cam.position.set(x, groundY + h, z);
  cam.up.set(0, 0, -1);
  cam.lookAt(x, groundY, z);
  cam.updateProjectionMatrix();
  return cam;
}

describe('view focus (padded camera footprint quad + bounding circle)', () => {
  afterEach(() => setViewFocusEnabled(true));

  it('a camera looking straight down: the padded footprint rectangle, bounded by a circle', () => {
    const f = updateViewFocus(topDownCamera(10, 50, -5));
    const halfH = 50 * Math.tan(THREE.MathUtils.degToRad(14));
    const halfW = halfH * 16 / 9;
    const expected = Math.hypot(halfH, halfW);
    const pad = VIEW_FOCUS_EDGE_PAD;
    expect(f.x).toBeCloseTo(10, 3);
    expect(f.z).toBeCloseTo(-5, 3);
    expect(f.visibleRadius).toBeCloseTo(expected, 2);
    expect(f.radius).toBeCloseTo(expected * VIEW_FOCUS_MARGIN + pad, 2);
    // the quad: screen edge + pad, not the circle (the circle reaches ~2.3 × halfH up/down)
    expect(inViewFocus(10 + halfW + pad - 0.5, -5)).toBe(true);
    expect(inViewFocus(10 + halfW + pad + 0.5, -5)).toBe(false);
    expect(inViewFocus(10, -5 + halfH + pad + 0.5)).toBe(false);
    expect(inViewFocus(10, -5 - halfH - pad + 0.5)).toBe(true);
    expect(inViewFocus(10 + halfW + pad + 0.5, -5, 1)).toBe(true);
    expect(viewFocusQuadDistance(10, -5)).toBeCloseTo(-(halfH + pad), 3);
    const u = getViewFocusUniform().value;
    expect([u.x, u.y, u.z, u.w]).toEqual([f.x, f.z, f.radius, 1]);
    // the shader's mat4 gives the same signed distances: column i = (nx, nz, c, 0)
    const e = getViewFocusEdgesUniform().value.elements;
    const d = (x: number, z: number) => Math.max(...[0, 4, 8, 12].map((i) => e[i]! * x + e[i + 1]! * z + e[i + 2]!));
    expect(d(10 + halfW + pad, -5)).toBeCloseTo(0, 3);
  });

  it('a tilted camera: the trapezoid is wider far away than near, and the margin scales it', () => {
    const cam = new THREE.PerspectiveCamera(40, 16 / 9, 1, 2000);
    cam.position.set(0, 40, 40);
    cam.lookAt(0, 0, 0);
    cam.updateProjectionMatrix();
    updateViewFocus(cam);
    const q = getViewFocusQuad().map(([x, z]) => [x, z]);
    const near = q.filter(([, z]) => z > 0), far = q.filter(([, z]) => z < 0);
    const width = (pts: number[][]) => Math.abs(pts[0]![0]! - pts[1]![0]!);
    expect(width(far)).toBeGreaterThan(width(near) * 1.2);
    const nearZ = Math.max(...q.map(([, z]) => z!));
    expect(inViewFocus(0, nearZ + VIEW_FOCUS_EDGE_PAD + 1)).toBe(false); // just below the screen's bottom edge
    setViewFocusMargin(1.5);
    updateViewFocus(cam);
    expect(inViewFocus(0, nearZ + VIEW_FOCUS_EDGE_PAD + 1)).toBe(true);
    setViewFocusMargin(VIEW_FOCUS_MARGIN);
  });

  it('honours the ground height', () => {
    const f = updateViewFocus(topDownCamera(0, 30, 0, 12), 12);
    const halfH = 30 * Math.tan(THREE.MathUtils.degToRad(14));
    expect(f.visibleRadius).toBeCloseTo(Math.hypot(halfH, halfH * 16 / 9), 2);
  });

  it('caps the radius when the camera looks at the horizon', () => {
    const cam = new THREE.PerspectiveCamera(28, 16 / 9, 1, 600);
    cam.position.set(0, 5, 0);
    cam.lookAt(100, 5, 0);
    const f = updateViewFocus(cam);
    expect(f.radius).toBeLessThanOrEqual(VIEW_FOCUS_MAX_RADIUS);
    expect(f.visibleRadius).toBeLessThanOrEqual(VIEW_FOCUS_MAX_RADIUS);
    expect(Number.isFinite(f.x) && Number.isFinite(f.z)).toBe(true);
  });

  it('a grazing camera (top edge just below the horizon) keeps the screen centre and bottom corners in focus', () => {
    const groundAt = (cam: THREE.Camera, nx: number, ny: number): [number, number] => {
      const o = new THREE.Vector3(nx, ny, -1).unproject(cam);
      const d = new THREE.Vector3(nx, ny, 1).unproject(cam).sub(o).normalize();
      const t = -o.y / d.y;
      return [o.x + d.x * t, o.z + d.z * t];
    };
    // pitch 14.3–16° with a 28° FOV: the top corners hit the ground 0.3–2° below the horizon (hundreds of metres out)
    for (const [h, pitch] of [[10, 14.3], [10, 14.6], [10, 15.5], [40, 14.6], [40, 16], [40, 20]] as const) {
      const cam = new THREE.PerspectiveCamera(28, 16 / 9, 1, 2000);
      cam.position.set(0, h, 0);
      cam.lookAt(100, h - 100 * Math.tan(THREE.MathUtils.degToRad(pitch)), 0);
      cam.updateMatrixWorld();
      const f = updateViewFocus(cam);
      expect(f.radius).toBeLessThanOrEqual(VIEW_FOCUS_MAX_RADIUS);
      if (pitch < 18) expect(viewFocusBounded(), `h ${h} pitch ${pitch}`).toBe(false); // grazing: no focus culling
      for (const [nx, ny] of [[0, 0], [-0.95, -0.95], [0.95, -0.95], [0, -0.95]] as const) {
        const [x, z] = groundAt(cam, nx, ny);
        expect(inViewFocus(x, z), `h ${h} pitch ${pitch} ndc (${nx}, ${ny})`).toBe(true);
      }
    }
  });

  it('disabled: the focus covers everything', () => {
    setViewFocusEnabled(false);
    const f = updateViewFocus(topDownCamera(0, 20, 0));
    expect(f.enabled).toBe(false);
    expect(f.radius).toBeGreaterThan(1e5);
    expect(inViewFocus(5000, -5000)).toBe(true);
    expect(getViewFocusUniform().value.w).toBe(0);
    expect(getViewFocus().enabled).toBe(false);
  });
});

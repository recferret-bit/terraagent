// @vitest-environment jsdom
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { axialToCanvasPixel, createNoop2dContext } from './rasterCache';
import {
  computeCameraTrapezoid,
  drawCameraTrapezoid,
} from './cameraTrapezoid';

describe('W04-09 Camera footprint trapezoid', () => {
  const view = {
    axialToPixel: (q: number, r: number) => axialToCanvasPixel(q, r, 180, 12),
  };

  it('follows camera pan and rotates 90 degrees when yaw changes by PI/2 (Q/E)', () => {
    const base = computeCameraTrapezoid(view, {
      targetX: 0,
      targetZ: 0,
      yaw: 0,
      dist: 40,
    });
    expect(base).toHaveLength(4);

    // Pan target by (+12, +8) metres -> trapezoid centroid shifts accordingly
    const panned = computeCameraTrapezoid(view, {
      targetX: 12,
      targetZ: 8,
      yaw: 0,
      dist: 40,
    });
    const baseCx = base.reduce((s, c) => s + c.worldX, 0) / 4;
    const baseCz = base.reduce((s, c) => s + c.worldZ, 0) / 4;
    const panCx = panned.reduce((s, c) => s + c.worldX, 0) / 4;
    const panCz = panned.reduce((s, c) => s + c.worldZ, 0) / 4;
    expect(panCx - baseCx).toBeCloseTo(12, 4);
    expect(panCz - baseCz).toBeCloseTo(8, 4);

    // Rotate yaw by +90 degrees (PI / 2): each corner (wx, wz) around (0, 0) rotates to (-wz, wx)
    const rotated = computeCameraTrapezoid(view, {
      targetX: 0,
      targetZ: 0,
      yaw: Math.PI / 2,
      dist: 40,
    });
    for (let i = 0; i < 4; i++) {
      expect(rotated[i]!.worldX).toBeCloseTo(-base[i]!.worldZ, 4);
      expect(rotated[i]!.worldZ).toBeCloseTo(base[i]!.worldX, 4);
    }
  });

  it('projects a real THREE.PerspectiveCamera frustum onto the ground plane and rotates 90 degrees', () => {
    const cam = new THREE.PerspectiveCamera(28, 16 / 9, 0.5, 500);
    const dist = 50;
    const pitch = Math.PI / 4;
    const hDist = Math.cos(pitch) * dist;
    const y = Math.sin(pitch) * dist;

    cam.position.set(hDist, y, 0);
    cam.lookAt(0, 0, 0);
    const c0 = computeCameraTrapezoid(view, { camera: cam });

    // Rotate camera 90 degrees around Y axis (yaw = PI/2)
    cam.position.set(0, y, hDist);
    cam.lookAt(0, 0, 0);
    const canvas = document.createElement('canvas');
    const ctx = createNoop2dContext(canvas);
    const c90 = drawCameraTrapezoid(ctx, view, { camera: cam });

    for (let i = 0; i < 4; i++) {
      expect(c90[i]!.worldX).toBeCloseTo(-c0[i]!.worldZ, 3);
      expect(c90[i]!.worldZ).toBeCloseTo(c0[i]!.worldX, 3);
    }
  });
});

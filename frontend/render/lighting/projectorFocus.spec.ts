import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { setViewFocusEnabled, updateViewFocus } from '../core/viewFocus';
import {
  getColonyVisionUniforms, MAX_COLONY_PROJECTORS, resetColonyVisionAndLights, selectFocusedProjectors,
  updateColonyProjectorsAndVision, type ColonyProjectorDesc,
} from './ColonyVisionAndLights';

const proj = (x: number, z: number, range = 10): ColonyProjectorDesc =>
  ({ x, y: 2, z, range, dirX: 0, dirY: -1, dirZ: 0, cosAngle: 0.7, r: 1, g: 1, b: 1, intensity: 1 });

/** Top-down camera over the origin: footprint ±22.2 × ±12.5 m, focus quad (+ 4 m pad) ±26.2 × ±16.5 m. */
function focusOverOrigin(): void {
  const cam = new THREE.PerspectiveCamera(28, 16 / 9, 1, 600);
  cam.position.set(0, 50, 0);
  cam.up.set(0, 0, -1);
  cam.lookAt(0, 0, 0);
  updateViewFocus(cam);
}

describe('projector lights are culled to the view focus', () => {
  afterEach(() => { setViewFocusEnabled(true); resetColonyVisionAndLights(); });

  it('uploads only projectors whose light circle touches the focus', () => {
    focusOverOrigin();
    // (0, -30, 5) lies inside the focus' bounding circle but its light ends 8.5 m short of the quad (below the screen)
    const list = [proj(10, 0), proj(120, 0), proj(33, 0), proj(0, -40, 30), proj(0, -40, 5), proj(0, -30, 5)];
    expect(selectFocusedProjectors(list)).toEqual([0, 2, 3]);
    updateColonyProjectorsAndVision({ projectors: list, visionSources: [], fovEnabled: false });
    const u = getColonyVisionUniforms();
    expect(u.uProjectorCount.value).toBe(3);
    const pos = u.uProjectorPosRange.value as THREE.Vector4[];
    expect(pos.slice(0, 3).map((v) => v.x)).toEqual([10, 33, 0]);
  });

  it('keeps the nearest MAX_COLONY_PROJECTORS when more light the focus', () => {
    focusOverOrigin();
    const list = Array.from({ length: 60 }, (_, i) => proj(((i * 37) % 60) - 30, 0, 80));
    const sel = selectFocusedProjectors(list);
    expect(sel.length).toBe(MAX_COLONY_PROJECTORS);
    const d = (i: number) => Math.abs(list[i]!.x);
    const worstKept = Math.max(...sel.map(d));
    const rest = list.map((_, i) => i).filter((i) => !sel.includes(i));
    expect(Math.min(...rest.map(d))).toBeGreaterThanOrEqual(worstKept);
  });

  it('with the focus off every projector qualifies (up to the GPU cap)', () => {
    focusOverOrigin();
    setViewFocusEnabled(false);
    expect(selectFocusedProjectors([proj(10, 0), proj(5000, 5000)])).toEqual([0, 1]);
    const many = Array.from({ length: 40 }, (_, i) => proj(i * 100, 0));
    expect(selectFocusedProjectors(many).length).toBe(MAX_COLONY_PROJECTORS);
  });
});

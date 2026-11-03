// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { fitShadowBox, quantizeShadowHalf, SHADOW_FIT_MARGIN, SHADOW_FIT_MAX_SHRINK, SHADOW_FIT_MIN_HALF } from './shadowFit';
import { fitShadowToView, followShadowTarget, getShadowParams, registerShadowViewport } from './shadowConfig';
import type { ColonyViewport } from './createColonyViewport';
import type { ViewFocus } from './viewFocus';

const focus = (x: number, z: number, visibleRadius: number, enabled = true): ViewFocus =>
  ({ x, z, visibleRadius, radius: visibleRadius * 1.5, enabled });

function mockViewport(): ColonyViewport {
  const scene = new THREE.Scene();
  const sun = new THREE.DirectionalLight(0xffffff, 2);
  scene.add(sun, sun.target);
  return {
    renderer: { shadowMap: { enabled: true, type: THREE.PCFSoftShadowMap } } as unknown as THREE.WebGLRenderer,
    composer: { render: () => {} } as unknown as ColonyViewport['composer'],
    bloom: { strength: 0.4 } as unknown as ColonyViewport['bloom'],
    pixelArt: { enabled: false } as unknown as ColonyViewport['pixelArt'],
    scene, camera: new THREE.PerspectiveCamera(28, 1, 1, 600), sun,
    hemi: new THREE.HemisphereLight(), environment: new THREE.Texture(),
    setView: () => {}, applySky: () => {}, followShadow: () => {}, setResolution: () => {},
    resize: () => {}, render: () => {}, dispose: () => {},
  };
}

describe('shadow box fitted to the view focus', () => {
  it('quantises the half-size to 4 geometric steps per doubling, clamped to [min, max]', () => {
    expect(quantizeShadowHalf(5, 12, 60)).toBe(12);
    expect(quantizeShadowHalf(12, 12, 60)).toBeCloseTo(12, 6);
    expect(quantizeShadowHalf(13, 12, 60)).toBeCloseTo(12 * 2 ** 0.25, 6);
    expect(quantizeShadowHalf(23, 12, 60)).toBeCloseTo(24, 6);
    expect(quantizeShadowHalf(59, 12, 60)).toBe(60);
    expect(quantizeShadowHalf(500, 12, 60)).toBe(60);
    // small camera moves inside one step keep the exact same size (no swimming)
    expect(quantizeShadowHalf(20.5, 12, 60)).toBe(quantizeShadowHalf(23.5, 12, 60));
  });

  it('centres on the visible footprint and shrinks to it when zoomed in', () => {
    const f = fitShadowBox(focus(5, -3, 20), 0, 0, 60);
    expect(f.x).toBe(5);
    expect(f.z).toBe(-3);
    expect(f.half).toBeCloseTo(24 * 2 ** 0.25, 6);
    expect(f.half).toBeGreaterThanOrEqual(20 * SHADOW_FIT_MARGIN);
  });

  it('falls back to the user box around the target: focus off, never updated, or a view far wider than the box', () => {
    expect(fitShadowBox(null, 1, 2, 60)).toEqual({ x: 1, z: 2, half: 60 });
    expect(fitShadowBox(focus(5, 5, 10, false), 1, 2, 60)).toEqual({ x: 1, z: 2, half: 60 });
    expect(fitShadowBox(focus(5, 5, 1e6), 1, 2, 60)).toEqual({ x: 1, z: 2, half: 60 });
    expect(fitShadowBox(focus(40, 40, 200), 1, 2, 60)).toEqual({ x: 1, z: 2, half: 60 });
    expect(fitShadowBox(focus(0, 0, 1), 0, 0, 4).half).toBe(SHADOW_FIT_MIN_HALF);
    // close-ups: never more than SHADOW_FIT_MAX_SHRINK x smaller than the user box (penumbra kernel stays smooth)
    expect(fitShadowBox(focus(0, 0, 3), 0, 0, 60).half).toBeCloseTo(60 / SHADOW_FIT_MAX_SHRINK, 6);
  });

  it('fitShadowToView tightens both shadow cameras and keeps the world-space blur', () => {
    const vp = mockViewport();
    const off = registerShadowViewport(vp);
    followShadowTarget(vp, new THREE.Vector3(0, 0, 0));
    const d = Math.max(12, getShadowParams().frustumSize);
    expect(vp.sun.shadow.camera.right).toBe(d);
    const baseRadius = vp.sun.shadow.radius;

    fitShadowToView(vp, focus(10, 10, 20));
    const sec = vp.secondaryShadowLight!;
    const half = 24 * 2 ** 0.25;
    expect(vp.sun.shadow.camera.right).toBeCloseTo(half, 6);
    expect(sec.shadow.camera.right).toBeCloseTo(half, 6);
    expect(vp.sun.shadow.radius).toBeCloseTo(baseRadius * (d / half), 6);
    // box centre (light target) moved to the focus, within the 2-texel snap
    expect(Math.hypot(vp.sun.target.position.x - 10, vp.sun.target.position.z - 10)).toBeLessThan(1.5);

    fitShadowToView(vp, focus(10, 10, 20, false));
    expect(vp.sun.shadow.camera.right).toBe(d);
    expect(vp.sun.shadow.radius).toBeCloseTo(baseRadius, 6);
    off();
  });
});

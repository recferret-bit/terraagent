// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import {
  isShadowOn,
  registerShadowViewport,
  resetShadowParams,
  setShadow,
} from './shadowConfig';
import {
  effectiveShadowMapSize,
  getShadowQuality,
  getShadowSwayScale,
  parseShadowQuality,
  resetShadowCameraTelemetry,
  setShadowQuality,
  shouldCullSmallShadowCasters,
  shouldRefreshShadowsThisFrame,
  syncPooledShadowMapSize,
  updateShadowCameraTelemetry,
} from './shadowQuality';
import { applyRenderShadowRadiusLod, restoreRenderShadowRadiusLod } from './shadowShaderPatch';
import type { ColonyViewport } from './createColonyViewport';

function makeMockViewport(): { vp: ColonyViewport; mat: THREE.MeshStandardMaterial } {
  const scene = new THREE.Scene();
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat);
  scene.add(mesh);
  const sun = new THREE.DirectionalLight(0xfff1d6, 3.0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  scene.add(sun, sun.target);
  const secondaryShadowLight = new THREE.DirectionalLight(0x9cc4ff, 1.35);
  secondaryShadowLight.castShadow = true;
  secondaryShadowLight.shadow.mapSize.set(1024, 1024);
  scene.add(secondaryShadowLight, secondaryShadowLight.target);
  const vp: ColonyViewport = {
    renderer: { shadowMap: { enabled: true, autoUpdate: true, needsUpdate: false, type: THREE.PCFSoftShadowMap } } as unknown as THREE.WebGLRenderer,
    composer: { render: vi.fn() } as unknown as ColonyViewport['composer'],
    bloom: { strength: 0.45 } as unknown as ColonyViewport['bloom'],
    pixelArt: { enabled: true } as unknown as ColonyViewport['pixelArt'],
    scene,
    camera: new THREE.PerspectiveCamera(28, 16 / 9, 1, 600),
    sun,
    secondaryShadowLight,
    hemi: new THREE.HemisphereLight(),
    environment: new THREE.Texture(),
    setView: () => {},
    applySky: () => {},
    followShadow: () => {},
    setResolution: () => {},
    resize: () => {},
    render: () => {},
    dispose: () => {},
  };
  return { vp, mat };
}

describe('shadowQuality presets & zero-recompile invariance', () => {
  afterEach(() => {
    setShadowQuality('auto');
    resetShadowCameraTelemetry();
    resetShadowParams();
    localStorage.clear();
  });

  it('persists preset selection and rejects invalid tokens', () => {
    expect(parseShadowQuality('MED')).toBe('med');
    expect(parseShadowQuality('ultra')).toBeNull();
    setShadowQuality('low');
    expect(getShadowQuality()).toBe('low');
    expect(localStorage.getItem('terraagent.shadowQuality')).toBe('low');

    setShadow(false);
    expect(isShadowOn()).toBe(false);
    expect(getShadowQuality()).toBe('off');
    setShadow(true);
    expect(isShadowOn()).toBe(true);
    expect(getShadowQuality()).toBe('low');
  });

  it('keeps shadowMap.enabled and castShadow constant in mode 0 without marking materials dirty', () => {
    const { vp, mat } = makeMockViewport();
    const off = registerShadowViewport(vp);
    const verBefore = mat.version;

    setShadowQuality('off');
    expect(vp.renderer.shadowMap.enabled).toBe(true);
    expect(vp.sun.castShadow).toBe(true);
    expect(vp.secondaryShadowLight!.castShadow).toBe(true);
    expect(vp.sun.shadow.intensity).toBe(0);
    expect(vp.secondaryShadowLight!.shadow.intensity).toBe(0);
    expect(vp.renderer.shadowMap.autoUpdate).toBe(false);
    expect(mat.version).toBe(verBefore);

    setShadowQuality('high');
    expect(vp.sun.shadow.intensity).toBeGreaterThan(0);
    expect(vp.renderer.shadowMap.autoUpdate).toBe(true);
    expect(mat.version).toBe(verBefore);
    off();
  });
});

describe('shadowQuality LOD telemetry & pooled targets', () => {
  afterEach(() => {
    setShadowQuality('auto');
    resetShadowCameraTelemetry();
    resetShadowParams();
    localStorage.clear();
  });

  it('applies zoom hysteresis (68..72m), filter LOD transitions, foliage sway freeze, and half-rate pan refresh in auto', () => {
    setShadowQuality('auto');
    let state = updateShadowCameraTelemetry(40, 0, 0, 0.016);
    expect(state.filterLod).toBe(2);
    expect(effectiveShadowMapSize(2048)).toBe(2048);
    expect(getShadowSwayScale()).toBe(1);
    expect(shouldCullSmallShadowCasters()).toBe(false);

    // Mid zoom -> 5-tap PCF
    state = updateShadowCameraTelemetry(56, 0, 0, 0.016);
    expect(state.filterLod).toBe(1);
    expect(effectiveShadowMapSize(2048)).toBe(2048);

    // Zoom out past 72m -> 1024 map size, 4-tap filter, small casters culled, sway frozen
    state = updateShadowCameraTelemetry(78, 0, 0, 0.016);
    expect(state.filterLod).toBe(0);
    expect(effectiveShadowMapSize(2048)).toBe(1024);
    expect(getShadowSwayScale()).toBe(0);
    expect(shouldCullSmallShadowCasters()).toBe(true);

    // Hysteresis holds 1024 inside 68..72m band until below 68m
    updateShadowCameraTelemetry(70, 0, 0, 0.016);
    expect(effectiveShadowMapSize(2048)).toBe(1024);
    updateShadowCameraTelemetry(65, 0, 0, 0.016);
    expect(effectiveShadowMapSize(2048)).toBe(2048);

    // Zoomed-out fast pan triggers half-rate shadow map updates (alternating true/false frames)
    for (let i = 0; i < 6; i++) {
      updateShadowCameraTelemetry(70, (i + 1) * 5, 0, 0.016);
    }
    const r0 = shouldRefreshShadowsThisFrame();
    updateShadowCameraTelemetry(70, 35, 0, 0.016);
    const r1 = shouldRefreshShadowsThisFrame();
    expect(r0).not.toBe(r1);
  });

  it('encodes filterLod via shadow.radius and swaps pooled shadow targets without dispose', () => {
    const light = new THREE.DirectionalLight();
    light.shadow.radius = 1.4;
    const s0 = applyRenderShadowRadiusLod(light, 0);
    expect(light.shadow.radius).toBeCloseTo(101.4, 5);
    restoreRenderShadowRadiusLod(light, s0);
    expect(light.shadow.radius).toBeCloseTo(1.4, 5);

    const s1 = applyRenderShadowRadiusLod(light, 1);
    expect(light.shadow.radius).toBeCloseTo(51.4, 5);
    restoreRenderShadowRadiusLod(light, s1);
    expect(light.shadow.radius).toBeCloseTo(1.4, 5);

    light.shadow.mapSize.set(2048, 2048);
    const rt2048 = new THREE.WebGLRenderTarget(2048, 2048);
    const disposeSpy = vi.spyOn(rt2048, 'dispose');
    light.shadow.map = rt2048;

    syncPooledShadowMapSize(light, 1024);
    expect(light.shadow.mapSize.x).toBe(1024);
    expect(disposeSpy).not.toHaveBeenCalled();

    // Zooming back in reuses the pooled 2048 target directly
    syncPooledShadowMapSize(light, 2048);
    expect(light.shadow.map).toBe(rt2048);
    expect(disposeSpy).not.toHaveBeenCalled();
    rt2048.dispose();
  });
});

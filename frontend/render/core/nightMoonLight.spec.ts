// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { resetDayNightParams, setDayNight, setDayNightParams } from './dayNightConfig';
import { DEFAULT_SHADOW_PARAMS, resetShadowParams, setShadow, syncViewportShadow } from './shadowConfig';
import type { ColonyViewport } from './createColonyViewport';
import { resetPerfParams, setPerf, setPerfParams } from './perfConfig';

/** Minimal colony viewport with a planet sky dome, so `syncViewportShadow` takes the day/night path. */
function mockPlanetViewport(): ColonyViewport {
  const scene = new THREE.Scene();
  const sun = new THREE.DirectionalLight(0xfff1d6, 3.0);
  const hemi = new THREE.HemisphereLight(0x9ccfff, 0x4a5a3a, 0.85);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(10, 4, 4), new THREE.ShaderMaterial());
  dome.name = 'planetSkyDome';
  scene.add(sun, sun.target, hemi, dome);
  return {
    renderer: { shadowMap: { enabled: true } } as unknown as THREE.WebGLRenderer,
    composer: { render: () => {} } as unknown as ColonyViewport['composer'],
    bloom: { strength: 0.4 } as unknown as ColonyViewport['bloom'],
    scene,
    sun,
    hemi,
  } as unknown as ColonyViewport;
}

describe('Night moon (secondary shadow light, shadowSourceMode 0)', () => {
  beforeEach(() => {
    resetDayNightParams('sync');
    setDayNight(true);
    resetShadowParams();
    setShadow(true);
    resetPerfParams();
    setPerf(true);
  });

  it('keeps the noon fill unchanged, scales the night moon with NIGHT MOONLIGHT and blends dusk without a pop', () => {
    const vp = mockPlanetViewport();
    const sec = () => vp.secondaryShadowLight!;
    setDayNightParams({ timeOfDay: 12.0, nightBrightness: 0.12 }, 'sync');
    syncViewportShadow(vp, 0xfff5e4);
    expect(sec().intensity).toBeCloseTo(DEFAULT_SHADOW_PARAMS.secondaryIntensity * 0.18, 4);
    // F8 → PERF default: the faint daytime secondary shadow is faded out by day (its fill light stays).
    expect(sec().shadow.intensity).toBe(0);

    setDayNightParams({ timeOfDay: 0.0 }, 'sync');
    syncViewportShadow(vp, 0xfff5e4);
    const dimMoon = sec().intensity;
    const dimShadow = sec().shadow.intensity;
    expect(dimMoon).toBeLessThan(DEFAULT_SHADOW_PARAMS.sunIntensity * 0.08);
    expect(dimShadow).toBeLessThan(0.12);
    expect(sec().castShadow).toBe(true); // never toggled with the time of day (would recompile every material)

    setDayNightParams({ nightBrightness: 1.0 }, 'sync');
    syncViewportShadow(vp, 0xfff5e4);
    expect(sec().intensity).toBeGreaterThan(dimMoon * 4);
    expect(sec().shadow.intensity).toBeGreaterThan(dimShadow * 2);

    setDayNightParams({ nightBrightness: 0.12 }, 'sync');
    let prev = -1;
    for (let h = 16.5; h <= 20.0; h += 0.05) {
      setDayNightParams({ timeOfDay: h }, 'sync');
      syncViewportShadow(vp, 0xfff5e4);
      if (prev >= 0) expect(Math.abs(sec().intensity - prev)).toBeLessThan(0.02);
      prev = sec().intensity;
    }
  });

  it('PERF: daytime secondary shadow fades out by day (map frozen once made), fades back across dusk, OFF = always on', () => {
    const vp = mockPlanetViewport();
    const sec = () => vp.secondaryShadowLight!;
    setDayNightParams({ timeOfDay: 12.0, nightBrightness: 0.12 }, 'sync');
    syncViewportShadow(vp, 0xfff5e4);
    expect(sec().shadow.intensity).toBe(0);
    expect(sec().shadow.autoUpdate).toBe(true); // no map yet: render it once before freezing
    sec().shadow.map = {} as THREE.WebGLRenderTarget;
    syncViewportShadow(vp, 0xfff5e4);
    expect(sec().shadow.autoUpdate).toBe(false);
    expect(sec().castShadow).toBe(true);

    let prev = -1;
    for (let h = 16.5; h <= 21.0; h += 0.05) {
      setDayNightParams({ timeOfDay: h }, 'sync');
      syncViewportShadow(vp, 0xfff5e4);
      if (prev >= 0) expect(Math.abs(sec().shadow.intensity - prev)).toBeLessThan(0.02);
      prev = sec().shadow.intensity;
    }
    expect(sec().shadow.intensity).toBeGreaterThan(0);
    expect(sec().shadow.autoUpdate).toBe(true);

    setDayNightParams({ timeOfDay: 12.0 }, 'sync');
    setPerfParams({ daySecondaryShadow: 1 });
    syncViewportShadow(vp, 0xfff5e4);
    expect(sec().shadow.intensity).toBeCloseTo(DEFAULT_SHADOW_PARAMS.nightShadowIntensity * 0.15, 4);
    expect(sec().shadow.autoUpdate).toBe(true);
    setPerfParams({ daySecondaryShadow: 0 });
    setPerf(false);
    syncViewportShadow(vp, 0xfff5e4);
    expect(sec().shadow.intensity).toBeCloseTo(DEFAULT_SHADOW_PARAMS.nightShadowIntensity * 0.15, 4);
    sec().shadow.map = null;
  });
});

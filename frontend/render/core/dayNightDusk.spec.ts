// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { PLANET_KINDS, PLANET_SPECS, type PlanetKind } from '../planets/PlanetSpec';
import type { ColonyViewport } from './createColonyViewport';
import {
  applyDayNightAtmosphere,
  colonyNightBlend,
  computeSolarState,
  recordViewportPlanetBase,
  resetDayNightParams,
  setDayNight,
  setDayNightParams,
} from './dayNightConfig';

function mockPlanetViewport(): ColonyViewport {
  const scene = new THREE.Scene();
  const sun = new THREE.DirectionalLight(0xfff1d6, 3.0);
  const hemi = new THREE.HemisphereLight(0x9ccfff, 0x4a5a3a, 0.85);
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(10, 4, 4),
    new THREE.ShaderMaterial({
      uniforms: {
        uTop: { value: new THREE.Color() },
        uHorizon: { value: new THREE.Color() },
        uSunCol: { value: new THREE.Color() },
        uSun: { value: new THREE.Vector3() },
      },
    }),
  );
  dome.name = 'planetSkyDome';
  scene.add(sun, sun.target, hemi, dome);
  scene.fog = new THREE.FogExp2(0xffffff, 0.004);
  return {
    renderer: { shadowMap: { enabled: true } } as unknown as THREE.WebGLRenderer,
    composer: { render: () => {} } as unknown as ColonyViewport['composer'],
    bloom: { strength: 0.4 } as unknown as ColonyViewport['bloom'],
    scene,
    sun,
    hemi,
  } as unknown as ColonyViewport;
}

function horizonHex(vp: ColonyViewport): string {
  const dome = vp.scene.getObjectByName('planetSkyDome') as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  return `#${(dome.material.uniforms.uHorizon.value as THREE.Color).getHexString()}`;
}

describe('evening to night stays continuous on every planet', () => {
  beforeEach(() => {
    resetDayNightParams('sync');
    setDayNight(true);
  });

  it('does not floor colony night at 88% in the minutes after sunset', () => {
    let prevFactor = -1;
    let prevGate = -1;
    for (let h = 16; h <= 21; h += 0.05) {
      setDayNightParams({ timeOfDay: h }, 'sync');
      const solar = computeSolarState();
      const blend = colonyNightBlend(h, solar.daylight);
      expect(blend.nightFactor).toBeCloseTo(1 - solar.daylight, 5);
      if (prevFactor >= 0) {
        expect(Math.abs(blend.nightFactor - prevFactor)).toBeLessThan(0.06);
        expect(Math.abs(blend.nightGate - prevGate)).toBeLessThan(0.12);
      }
      prevFactor = blend.nightFactor;
      prevGate = blend.nightGate;
    }
    setDayNightParams({ timeOfDay: 18.25 }, 'sync');
    const dusk = colonyNightBlend(18.25, computeSolarState().daylight);
    expect(dusk.nightFactor).toBeGreaterThan(0.5);
    expect(dusk.nightFactor).toBeLessThan(0.75);
    expect(dusk.nightGate).toBeLessThan(0.7);
  });

  it.each(PLANET_KINDS)('keeps the %s sky, sun, and elevation smooth from evening into night', (kind: PlanetKind) => {
    const vp = mockPlanetViewport();
    recordViewportPlanetBase(vp, PLANET_SPECS[kind]);
    let prevElev = -1;
    let prevNight = -1;
    let prevIntensity = -1;
    let prevHor = new THREE.Color();
    const hor = new THREE.Color();
    for (let h = 16; h <= 21; h += 0.05) {
      setDayNightParams({ timeOfDay: h }, 'sync');
      const solar = applyDayNightAtmosphere(vp);
      hor.set(horizonHex(vp));
      if (prevElev >= 0) {
        expect(Math.abs(solar.sunElevation - prevElev)).toBeLessThan(2);
        expect(Math.abs(1 - solar.daylight - prevNight)).toBeLessThan(0.06);
        expect(Math.abs(solar.sunIntensityMult - prevIntensity)).toBeLessThan(0.08);
        expect(hor.r - prevHor.r).toBeLessThan(0.08);
        expect(prevHor.r - hor.r).toBeLessThan(0.08);
      }
      prevElev = solar.sunElevation;
      prevNight = 1 - solar.daylight;
      prevIntensity = solar.sunIntensityMult;
      prevHor.copy(hor);
    }
    setDayNightParams({ timeOfDay: 17.98 }, 'sync');
    const before = applyDayNightAtmosphere(vp).sunElevation;
    setDayNightParams({ timeOfDay: 18.02 }, 'sync');
    const after = applyDayNightAtmosphere(vp).sunElevation;
    expect(Math.abs(after - before)).toBeLessThan(1.5);
  });
});

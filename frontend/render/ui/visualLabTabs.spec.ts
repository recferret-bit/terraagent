// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createLabStore } from '../core/labStore';
import {
  getWindParams, getWindUniforms, isWindOn, resetWindParams, setWind, setWindParams, tickWindClock, WIND_RANGES,
} from '../core/windConfig';
import { getWaterParams, isWaterFxOn, resetWaterParams, setWaterFx, WATER_RANGES } from '../visuals/water/waterConfig';
import { createFoliageMaterial } from '../visuals/terrain/Scatter';
import { createParticles } from '../visuals/terrain/Particles';
import { AMBIENT_FOLLOW_BOX, createHexAmbient } from '../planets/hex/hexAmbient';
import { getViewFocus, setViewFocusEnabled, updateViewFocus } from '../core/viewFocus';
import { PLANET_SPECS } from '../planets/PlanetSpec';
import { disposePixelDialog, initPixelDialog, selectVisualTab, togglePixelDialog } from './pixelDialog';
import { WATER_SLIDERS, WEATHER_SLIDERS, WIND_SLIDERS } from './visualLabSpecs';
import { getVisualLabTab, VISUAL_LAB_TABS } from './visualLabTabs';
import {
  getWeatherParams, isTwisterAvailable, onWeatherAction, resetWeatherParams, setWeather, setWeatherParams, WEATHER_RANGES,
} from '../core/weatherConfig';
import { createRainAndStormPass } from '../weather/RainAndStormPass';

const RANGES: Partial<Record<string, Readonly<Record<string, readonly [number, number]>>>> = {
  wind: WIND_RANGES,
  water: WATER_RANGES,
  weather: WEATHER_RANGES,
};

function restore() {
  resetWindParams(); setWind(true);
  resetWaterParams(); setWaterFx(true);
  resetWeatherParams(); setWeather(true);
}

describe('F8 Visual Shader Lab tab registry', () => {
  beforeEach(restore);
  afterEach(restore);

  it('registers the eight tabs once, in order, with unknown ids falling back to SHADOW', () => {
    expect(VISUAL_LAB_TABS.map((t) => t.id)).toEqual(['crt', 'pixel', 'shadow', 'daynight', 'wind', 'water', 'weather', 'perf']);
    expect(getVisualLabTab('nope').id).toBe('shadow');
    expect(getVisualLabTab('wind').head).toBeDefined();
    expect(getVisualLabTab('weather').head).toBeDefined();
  });

  it('keeps every slider inside its tab params and, for lab stores, inside the clamp range', () => {
    for (const tab of VISUAL_LAB_TABS) {
      const keys = Object.keys(tab.getParams());
      expect(tab.sliders.length).toBeGreaterThan(0);
      for (const s of tab.sliders) {
        expect(keys, `${tab.id}.${s.key}`).toContain(s.key);
        expect(s.min).toBeLessThan(s.max);
        expect(s.step).toBeGreaterThan(0);
        const r = RANGES[tab.id]?.[s.key];
        if (r) {
          expect(s.min).toBeGreaterThanOrEqual(r[0]);
          expect(s.max).toBeLessThanOrEqual(r[1]);
        }
      }
    }
    expect(WIND_SLIDERS.map((s) => s.key).sort()).toEqual(Object.keys(WIND_RANGES).sort());
    expect(WATER_SLIDERS.map((s) => s.key).sort()).toEqual(Object.keys(WATER_RANGES).sort());
    expect(WATER_SLIDERS.find((s) => s.key === 'quality')!.fmt(0)).toBe('LOW');
    const water = (k: string) => WATER_SLIDERS.find((s) => s.key === k)!;
    expect(water('reflection').fmt(0)).toBe('OFF');
    expect(water('reflection').fmt(0.8)).toBe('80%');
    expect(water('reflectDistort').fmt(1)).toBe('100%');
    expect([0, 1, 2].map(water('reflectRes').fmt)).toEqual(['×0.25', '×0.50', '×1.00']);
    expect(water('reflectRes').step).toBe(1);
    expect(water('reflectDebug').label).toBe('REFLECTION DEBUG');
    expect([0, 1].map(water('reflectDebug').fmt)).toEqual(['OFF', 'MIRROR ONLY']);
    expect(water('reflectDebug').step).toBe(1);
    // the mirror sliders sit in the REFLECTIONS group, consecutive (one group heading)
    expect(WATER_SLIDERS.filter((s) => s.group === 'REFLECTIONS').map((s) => s.key))
      .toEqual(['sunGlint', 'projectorReflect', 'reflection', 'reflectDistort', 'reflectRes', 'reflectDebug']);
  });

  it('setParam reaches the wind / water stores and switches a bypassed effect back on', () => {
    setWind(false);
    getVisualLabTab('wind').setParam('strength', 1.5);
    expect(isWindOn()).toBe(true);
    expect(getWindParams().strength).toBe(1.5);
    expect(getWindUniforms().uWindStrength.value).toBe(1.5);

    setWaterFx(false);
    getVisualLabTab('water').setParam('foamWidth', 3);
    expect(isWaterFxOn()).toBe(true);
    expect(getWaterParams().foamWidth).toBe(3);
    getVisualLabTab('water').setParam('foamWidth', 99);
    expect(getWaterParams().foamWidth).toBe(WATER_RANGES.foamWidth[1]);

    getVisualLabTab('wind').toggle();
    expect(isWindOn()).toBe(false);
    expect(getWindUniforms().uWindStrength.value).toBe(0);
    getVisualLabTab('wind').reset();
    expect(getWindParams().strength).toBe(0.8);
  });

  it('notifies tab listeners on store changes', () => {
    let calls = 0;
    const off = getVisualLabTab('water').onChange((always) => { if (always) calls++; });
    setWaterFx(false);
    off();
    setWaterFx(true);
    expect(calls).toBe(1);
  });
});

describe('labStore', () => {
  it('clamps, ignores non-numbers, persists params and the on flag', () => {
    localStorage.clear();
    const opts = { key: 'test.lab', version: 1, urlFlag: 'testlab', defaultOn: false, defaults: { a: 1, b: 0 }, ranges: { a: [0, 2], b: [-1, 1] } as const };
    const s = createLabStore<{ a: number; b: number }>(opts);
    expect(s.isOn()).toBe(false);
    s.set({ a: 5, b: Number.NaN });
    expect(s.get()).toEqual({ a: 2, b: 0 });
    s.setOn(true);
    const again = createLabStore<{ a: number; b: number }>(opts);
    expect(again.isOn()).toBe(true);
    expect(again.get().a).toBe(2);
    again.reset();
    expect(again.get()).toEqual({ a: 1, b: 0 });
  });
});

describe('wind clocks', () => {
  beforeEach(restore);

  it('integrate phase and drift on the CPU, so a strength change never jumps the gust field', () => {
    const u = getWindUniforms();
    setWindParams({ directionDeg: 0, strength: 1 });
    let t = 5e6;
    tickWindClock(t);
    const p0 = u.uWindPhase.value, d0 = u.uWindDrift.value.clone();
    tickWindClock((t += 100));
    expect(u.uWindPhase.value - p0).toBeCloseTo(0.6, 5); // 1 * 6 m/s * 0.1 s
    expect(u.uWindDrift.value.x - d0.x).toBeCloseTo(0.6, 5);
    expect(u.uWindDrift.value.y - d0.y).toBeCloseTo(0, 5);

    const before = u.uWindPhase.value;
    setWindParams({ strength: 2 });
    expect(u.uWindPhase.value).toBe(before);
    tickWindClock((t += 100));
    expect(u.uWindPhase.value - before).toBeCloseTo(1.2, 5);

    setWind(false);
    const frozen = u.uWindPhase.value;
    tickWindClock((t += 100));
    expect(u.uWindPhase.value).toBe(frozen);
    tickWindClock(t + 60_000); // long frame: dt clamped, no leap
    expect(u.uWindPhase.value).toBe(frozen);
  });
});

describe('wind consumers share the uniform objects', () => {
  it('foliage colour and shadow-depth programs both get the same wind displacement', () => {
    const mat = createFoliageMaterial({ value: 0 }, 0.7);
    const depth = mat.userData.depthMaterial as THREE.MeshDepthMaterial;
    const color = { uniforms: {} as Record<string, THREE.IUniform>, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader };
    const dep = { uniforms: {} as Record<string, THREE.IUniform>, vertexShader: THREE.ShaderLib.depth.vertexShader, fragmentShader: THREE.ShaderLib.depth.fragmentShader };
    mat.onBeforeCompile(color as never, null as never);
    depth.onBeforeCompile(dep as never, null as never);
    for (const sh of [color, dep]) {
      expect(sh.vertexShader).toContain('windGustAt(fwP + uWindDir');
      expect(sh.vertexShader).toContain('uWindPhase *');
      expect(sh.uniforms.uWindPhase).toBe(getWindUniforms().uWindPhase);
      expect(sh.uniforms.uWindDir).toBe(getWindUniforms().uWindDir);
    }
    const sway = (src: string) => src.slice(src.indexOf('float fwH'), src.indexOf('transformed += fwL'));
    expect(sway(color.vertexShader)).toBe(sway(dep.vertexShader));
    mat.dispose();
  });

  it('particles ride uWindDrift by reference and the hex ambient layer stays cheap', () => {
    const layer = createParticles({ count: 10, box: 20, height: 5, size: 1, color: new THREE.Color(1, 1, 1), drift: new THREE.Vector3(), windDrift: 0.5, wobble: 1, additive: true, alpha: 1, seed: 1 });
    const m = layer.points.material as THREE.ShaderMaterial;
    expect(m.uniforms.uWindDrift).toBe(getWindUniforms().uWindDrift);
    expect(m.uniforms.uWindK.value).toBe(0.5);
    expect(m.uniforms.uTime).toBe(layer.uniforms.uTime);
    layer.dispose();
    for (const look of Object.values(PLANET_SPECS)) {
      const amb = createHexAmbient(look, 97);
      const n = amb.points.geometry.getAttribute('position').count;
      expect(n).toBeGreaterThan(0);
      expect(n).toBeLessThanOrEqual(700);
      amb.dispose();
    }
  });

  it('the hex ambient box follows the view focus on a big planet (edge-faded, sized for the box) and stays put on a small one', () => {
    const look = PLANET_SPECS.forestRock;
    const big = createHexAmbient(look, 400), small = createHexAmbient(look, 40);
    const u = (a: typeof big) => (a.points.material as THREE.ShaderMaterial).uniforms;
    expect(u(big).uBox.value).toBe(AMBIENT_FOLLOW_BOX);
    expect(u(big).uEdge.value).toBeGreaterThan(0);
    expect(u(small).uBox.value).toBe(80);
    expect(u(small).uEdge.value).toBe(0);
    const cam = new THREE.PerspectiveCamera(30, 16 / 9, 0.5, 400);
    cam.position.set(120, 50, 160);
    cam.lookAt(120, 0, 110);
    updateViewFocus(cam);
    const scene = new THREE.Scene();
    big.points.position.set(10, 0, 0); // an offset terrain group: the centre is converted to local space
    scene.add(big.points);
    scene.updateMatrixWorld(true);
    big.points.onBeforeRender({} as THREE.WebGLRenderer, scene, cam, big.points.geometry, big.points.material as THREE.Material, new THREE.Group());
    const f = getViewFocus();
    expect(u(big).uCenter.value.x).toBeCloseTo(f.x - 10, 5);
    expect(u(big).uCenter.value.y).toBeCloseTo(f.z, 5);
    setViewFocusEnabled(false);
    updateViewFocus(cam);
    setViewFocusEnabled(true);
    big.dispose(); small.dispose();
  });
});

describe('F8 dialog WIND / WATER tabs', () => {
  beforeEach(() => { restore(); document.body.innerHTML = ''; });
  afterEach(() => disposePixelDialog());

  it('renders the compass and grouped water sliders and writes through the sliders', () => {
    initPixelDialog();
    togglePixelDialog(true);
    const dlg = document.getElementById('pixel-dlg')!;
    selectVisualTab('wind');
    expect(dlg.querySelector('#pd-wind-pad')).not.toBeNull();
    expect(dlg.querySelectorAll('#pd-sliders input[type=range]').length).toBe(WIND_SLIDERS.length);
    const dir = dlg.querySelector<HTMLInputElement>('input[data-key="directionDeg"]')!;
    dir.value = '120';
    dir.dispatchEvent(new Event('input'));
    expect(getWindParams().directionDeg).toBe(120);
    expect(dlg.querySelector('#pd-wind-read')?.textContent).toContain('120°');
    dlg.querySelector<HTMLButtonElement>('[data-wind-strength="2"]')!.click();
    expect(getWindParams().strength).toBe(2);
    dlg.querySelector<HTMLButtonElement>('[data-wind-rotate="45"]')!.click();
    expect(getWindParams().directionDeg).toBe(165);

    selectVisualTab('water');
    expect(dlg.querySelectorAll('#pd-sliders input[type=range]').length).toBe(WATER_SLIDERS.length);
    expect([...dlg.querySelectorAll('.pd-group')].map((g) => g.textContent)).toEqual(['WAVES', 'SURFACE', 'FOAM', 'REFLECTIONS', 'FAUNA & QUALITY']);
    setWaterFx(false);
    expect(dlg.querySelector('#pd-enable')?.textContent).toContain('OFF');
    const q = dlg.querySelector<HTMLInputElement>('input[data-key="quality"]')!;
    q.value = '1';
    q.dispatchEvent(new Event('input'));
    expect(getWaterParams().quality).toBe(1);
    expect(isWaterFxOn()).toBe(true);
    expect(dlg.querySelector('[data-val="quality"]')?.textContent).toBe('MED');

    selectVisualTab('weather');
    expect(WEATHER_SLIDERS.map((s) => s.key)).not.toContain('screenRaindrops');
    expect(dlg.querySelector('#pd-weather-screen-drops-btn')).toBeNull();
    expect(dlg.querySelectorAll('#pd-sliders input[type=range]').length).toBe(WEATHER_SLIDERS.length);
    const twisterBtn = dlg.querySelector<HTMLButtonElement>('[data-weather-act="twister"]')!;
    expect(twisterBtn.disabled).toBe(false);
    expect(dlg.querySelector('#pd-weather-twister-hint')?.textContent).toContain('LOCKED');
    const actions: string[] = [];
    const offAct = onWeatherAction((a) => actions.push(a));
    dlg.querySelector<HTMLButtonElement>('[data-weather-preset="twister-ready"]')!.click();
    expect(isTwisterAvailable()).toBe(true);
    expect(twisterBtn.disabled).toBe(false);
    twisterBtn.click();
    dlg.querySelector<HTMLButtonElement>('[data-weather-act="meteor"]')!.click();
    dlg.querySelector<HTMLButtonElement>('[data-weather-act="lightning"]')!.click();
    expect(actions).toEqual(['twister-ready', 'twister', 'meteor', 'lightning']);
    offAct();
  });

  it('updates RainAndStormPass streak count, wind tilt, and storm fog darkening', () => {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xb9dcef);
    scene.fog = new THREE.FogExp2(0xb9dcef, 0.007);
    const cam = new THREE.PerspectiveCamera(28, 1, 1, 600);
    cam.position.set(42, 46, 42);
    cam.lookAt(0, 0, 0);
    const pass = createRainAndStormPass(scene, cam);

    pass.update(0.016);
    expect(pass.group.visible).toBe(false);
    expect(pass.getActiveStreakCount()).toBe(0);

    setWindParams({ directionDeg: 0, strength: 1.4 });
    setWeatherParams({ rainIntensity: 0.35, stormDarkness: 0.6, stormActive: true });
    pass.update(0.016);
    expect(pass.group.visible).toBe(true);
    expect(pass.getActiveStreakCount()).toBeGreaterThan(100);
    expect(pass.getWindTilt().dx).toBeGreaterThan(0.5);
    expect((scene.fog as THREE.FogExp2).density).toBeGreaterThan(0.012);

    setWeatherParams({ rainIntensity: 0, stormDarkness: 0, stormActive: false });
    pass.update(0.016);
    expect(pass.group.visible).toBe(false);
    expect((scene.fog as THREE.FogExp2).density).toBeCloseTo(0.007, 4);
    expect(getWeatherParams().rainIntensity).toBe(0);
    pass.dispose();
  });
});

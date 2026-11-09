import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { getColonyVisionUniforms } from '../../lighting/ColonyVisionAndLights';
import { getWeatherUniforms, tickWeatherClock, triggerPuddleElectrocution, triggerWaterElectrocution } from '../../core/weatherConfig';
import { getWindUniforms } from '../../core/windConfig';
import { getViewFocusEdgesUniform, getViewFocusUniform } from '../../core/viewFocus';
import { applyTerrainShader } from '../terrain/terrainShader';
import { createWater } from '../terrain/Liquids';
import { createWaterMaterial, waterProgramKey } from './WaterMaterial';
import { captureMirrorSky, getMirrorSkyUniforms, setMirrorSky, SKY_DOME_NAME } from './mirrorSky';
import {
  DEFAULT_WATER_PARAMS, getReflectionStrength, getWaterUniforms, parseWaterUrl, REFLECT_DEBUG_MIN_STRENGTH,
  resetWaterParams, setWaterFx, setWaterParams, WATER_RANGES,
} from './waterConfig';
import { MIRROR_FRESNEL_FLOOR } from './glsl/mirror';
import { getReflectionUniforms } from './reflection/reflectionUniforms';

type Shader = { vertexShader: string; fragmentShader: string; uniforms: Record<string, THREE.IUniform> };

/** Exactly what three hands to `onBeforeCompile` for a MeshStandardMaterial: unresolved `#include`s. */
function standardShader(): Shader {
  const lib = THREE.ShaderLib.standard;
  return { vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader, uniforms: THREE.UniformsUtils.clone(lib.uniforms) };
}

function compile(material: THREE.Material): Shader {
  const sh = standardShader();
  material.onBeforeCompile(sh as unknown as THREE.WebGLProgramParametersWithUniforms, null as unknown as THREE.WebGLRenderer);
  return sh;
}

const opts = (shoreField: boolean) => ({
  shallow: 0x38858f, deep: 0x10344a, sky: 0x8ec5ff, heightTex: new THREE.Texture(), span: 120, level: 0, shoreField,
});

const count = (src: string, needle: string) => src.split(needle).length - 1;

const CMP: Record<string, (a: number, b: number) => boolean> = {
  '>=': (a, b) => a >= b, '<=': (a, b) => a <= b, '==': (a, b) => a === b, '!=': (a, b) => a !== b, '>': (a, b) => a > b, '<': (a, b) => a < b,
};

/**
 * Minimal GLSL preprocessor for the tier checks: `#define`, `#ifdef`, `#ifndef`, `#if` / `#elif` on `NAME op int`
 * or `defined(NAME)` (an undefined NAME is 0); any other condition (three's own `||` chains) counts as true.
 */
function preprocess(src: string, defines: Record<string, unknown>): string {
  const defs = new Map(Object.entries(defines).map(([k, v]) => [k, String(v)]));
  const cond = (e: string): boolean => {
    const m = /^(\w+)\s*(>=|<=|==|!=|>|<)\s*(\d+)$/.exec(e.trim());
    if (m) return CMP[m[2]!]!(Number(defs.get(m[1]!) ?? 0), Number(m[3]));
    const d = /^defined\s*\(\s*(\w+)\s*\)$/.exec(e.trim());
    return d ? defs.has(d[1]!) : true;
  };
  const stack: { active: boolean; taken: boolean }[] = [];
  const out: string[] = [];
  for (const line of src.split('\n')) {
    const m = /^\s*#\s*(\w+)\s*(.*)$/.exec(line);
    const on = stack.every((f) => f.active);
    if (!m) { if (on) out.push(line); continue; }
    const [, dir, rest = ''] = m;
    const top = stack[stack.length - 1]!;
    if (dir === 'if' || dir === 'ifdef' || dir === 'ifndef') {
      const c = dir === 'if' ? cond(rest) : defs.has(rest.trim()) === (dir === 'ifdef');
      stack.push({ active: c, taken: c });
    } else if (dir === 'elif') { top.active = !top.taken && cond(rest); top.taken ||= top.active; }
    else if (dir === 'else') { top.active = !top.taken; top.taken = true; }
    else if (dir === 'endif') stack.pop();
    else if (on) {
      if (dir === 'define') { const [name = '', ...v] = rest.split(/\s+/); defs.set(name, v.join(' ') || '1'); }
      out.push(line);
    }
  }
  return out.join('\n');
}

afterEach(() => {
  resetWaterParams();
  setWaterFx(true);
});

describe('water surface material', () => {
  it('finds every injection anchor in three\'s standard shader (both field modes)', () => {
    for (const shoreField of [false, true]) {
      const w = createWaterMaterial(opts(shoreField));
      const sh = compile(w.material);
      expect(sh.vertexShader).toContain('if (waFocusV > 0.0) transformed.y += waterSwellHeight(wp.xz) * waFocusV;');
      // the view-focus fade: declared once per stage, the expensive work skipped where the weight is 0
      for (const src of [sh.vertexShader, sh.fragmentShader]) expect(count(src, 'uniform vec4 uViewFocus;')).toBe(1);
      expect(sh.fragmentShader).toContain('if (waFocus > 0.0) {');
      expect(sh.fragmentShader).toContain('waterDetailSlope(waP, waWind, waFootprint)');
      expect(sh.fragmentShader).toContain('waterHexClip(waP)');
      expect(sh.fragmentShader).toContain('roughnessFactor = waRough;');
      expect(sh.fragmentShader).toContain('normal = normalize((viewMatrix * vec4(waN, 0.0)).xyz);');
      expect(sh.fragmentShader).toContain('colonyProjectorLighting(vWaterWorldPos, waN, waV');
      expect(sh.fragmentShader).toContain('applyColonyFovShroud(vWaterWorldPos');
      // the alpha boost must run before three writes gl_FragColor
      expect(sh.fragmentShader.indexOf('totalSpecular + waSpecEmis')).toBeLessThan(sh.fragmentShader.indexOf('#include <opaque_fragment>'));
      w.dispose();
    }
  });

  it('assigns the shared uniform objects by reference, and the per-surface ones it returns', () => {
    const w = createWaterMaterial(opts(true));
    const sh = compile(w.material);
    expect(sh.uniforms.uWaterTime).toBe(getWaterUniforms().uWaterTime);
    expect(sh.uniforms.uFoamWidth).toBe(getWaterUniforms().uFoamWidth);
    expect(sh.uniforms.uWindDir).toBe(getWindUniforms().uWindDir);
    expect(sh.uniforms.uProjectorPosRange).toBe(getColonyVisionUniforms().uProjectorPosRange);
    expect(sh.uniforms.uHeightTex).toBe(w.uniforms.uHeightTex);
    expect(sh.uniforms.uViewFocus).toBe(getViewFocusUniform());
    expect(sh.uniforms.uViewFocusEdges).toBe(getViewFocusEdgesUniform());
    const refl = getReflectionUniforms();
    for (const k of ['uReflTex', 'uReflMatrix', 'uReflRect', 'uReflOn'] as const) expect(sh.uniforms[k]).toBe(refl[k]);
    for (const k of ['uReflSkyLo', 'uReflSkyHi', 'uReflBg', 'uReflSkyKey'] as const) expect(sh.uniforms[k]).toBe(getMirrorSkyUniforms()[k]);
    expect(w.uniforms.uTime).toBeDefined();
    w.dispose();
  });

  it('declares every waterConfig uniform in both stages', () => {
    const w = createWaterMaterial(opts(false));
    const sh = compile(w.material);
    for (const name of Object.keys(getWaterUniforms())) {
      expect(sh.vertexShader).toContain(name);
      expect(sh.fragmentShader).toContain(name);
    }
    w.dispose();
  });

  it('keeps the field fetch budget (1 base + 1 parallax, the latter only under WATER_PARALLAX)', () => {
    const w = createWaterMaterial(opts(true));
    const frag = compile(w.material).fragmentShader;
    expect(count(frag, 'texture2D(uHeightTex')).toBe(2);
    expect(frag.indexOf('#ifdef WATER_PARALLAX')).toBeLessThan(frag.lastIndexOf('texture2D(uHeightTex'));
    w.dispose();
  });

  it('sets quality + shore-field defines and the program cache key, and keeps STANDARD', () => {
    setWaterParams({ quality: 1 });
    const a = createWaterMaterial(opts(true));
    expect(a.material.defines).toMatchObject({ STANDARD: '', WATER_QUALITY: 1, WATER_SHORE_FIELD: '' });
    expect(a.material.customProgramCacheKey()).toBe(waterProgramKey(1, true));
    const b = createWaterMaterial(opts(false));
    expect(b.material.defines!.WATER_SHORE_FIELD).toBeUndefined();
    expect(b.material.customProgramCacheKey()).toBe('ta-water:q1:sf0');
    a.dispose(); b.dispose();
  });

  it('recompiles on a quality change (and LOW while the WATER tab is off); dispose unsubscribes', () => {
    setWaterParams({ quality: 2 });
    const w = createWaterMaterial(opts(false));
    const v0 = w.material.version;
    setWaterParams({ quality: 0 });
    expect(w.material.defines!.WATER_QUALITY).toBe(0);
    expect(w.material.version).toBeGreaterThan(v0);
    expect(w.material.customProgramCacheKey()).toBe('ta-water:q0:sf0');
    setWaterParams({ quality: 2 });
    expect(w.material.defines!.WATER_QUALITY).toBe(2);
    setWaterFx(false);
    expect(w.material.defines!.WATER_QUALITY).toBe(0);
    setWaterFx(true);
    w.dispose();
    const v1 = w.material.version;
    setWaterParams({ quality: 1 });
    expect(w.material.version).toBe(v1);
    expect(w.material.defines!.WATER_QUALITY).toBe(2);
  });

  it('createWater keeps the LiquidResult shape', () => {
    const tex = new THREE.Texture();
    const liquid = createWater({ level: 0.4, heightTex: tex, span: 64, coverage: 64 }, 0x1f9fb8, 0x0b3f66, 0x8ec5ff);
    expect(liquid.mesh.position.y).toBe(0.4);
    expect(liquid.uniforms.uHeightTex!.value).toBe(tex);
    expect(liquid.uniforms.uLevelW!.value).toBe(0.4);
    expect(liquid.uniforms.uDeepColor!.value).toBeInstanceOf(THREE.Color);
    const sh = compile(liquid.mesh.material as THREE.Material);
    expect(sh.uniforms.uHeightTex).toBe(liquid.uniforms.uHeightTex);
    liquid.dispose();
  });
});

/** The mirror composite of the patched fragment shader: the `if (uReflOn > 0.0)` block just before three's output. */
function mirrorComposite(frag: string): string {
  const end = frag.indexOf('#include <opaque_fragment>');
  const start = frag.lastIndexOf('if (uReflOn > 0.0) {', end);
  expect(start).toBeGreaterThan(0);
  return frag.slice(start, end);
}

describe('water mirror reflection', () => {
  it('compiles the mirror only at MED / HIGH (1 / 3 taps), from the undisplaced position, only while uReflOn > 0', () => {
    for (const [quality, taps] of [[0, 0], [1, 1], [2, 3]] as const) {
      setWaterParams({ quality });
      const w = createWaterMaterial(opts(true));
      const sh = compile(w.material);
      const frag = preprocess(sh.fragmentShader, w.material.defines!);
      const vert = preprocess(sh.vertexShader, w.material.defines!);
      expect(count(frag, 'texture2D(uReflTex')).toBe(taps);
      expect(count(frag, 'waterMirror(waN, waWind, waRough)')).toBe(taps ? 1 : 0);
      for (const src of [vert, frag]) expect(count(src, 'varying vec4 vWaterReflPos;')).toBe(taps ? 1 : 0);
      expect(count(vert, 'vWaterReflPos = uReflMatrix * vec4(wp, 1.0);')).toBe(taps ? 1 : 0);
      // the mirror keys out its flat sky, so the water's own sky tint stays whole at every tier
      expect(frag).toContain('totalEmissiveRadiance += uSky * waFr * 0.55 * (1.0 - clamp(uNightFactor');
      expect(frag).not.toContain('waSkyK');
      expect(count(frag, 'waterMirrorObject(mirror)')).toBe(taps ? 1 : 0);
      if (taps) {
        expect(vert.indexOf('vWaterReflPos = ')).toBeLessThan(vert.indexOf('transformed.y += waterSwellHeight'));
        expect(frag).toMatch(/if \(uReflOn > 0\.0\) \{[^}]*waterMirror\(/);
      }
      w.dispose();
    }
  });

  it('lays the mirror OVER the water: alpha rises by the cover, whatever the reflected luminance', () => {
    const w = createWaterMaterial(opts(true));
    const frag = preprocess(compile(w.material).fragmentShader, w.material.defines!);
    const block = mirrorComposite(frag);
    // cover = weight x bank fade; alpha = c + (1 - c) a: no luminance term, so a dark reflection hides the bed too
    expect(block).toContain('float waMc = waMirror.a * waBank;');
    expect(block).toContain('float waMa = waMc + (1.0 - waMc) * diffuseColor.a;');
    expect(block).toContain('diffuseColor.a = waMa;');
    const alphaLines = block.split('\n').filter((l) => /waM[ac] =|diffuseColor\.a = waMa/.test(l));
    for (const l of alphaLines) expect(l).not.toMatch(/dot\(|0\.587|waMirror\.rgb/);
    // premultiplied "over": mirror x c + water x a x (1 - c), the glints (not in the mirror texture) kept on top
    expect(block).toContain('outgoingLight = (waMirror.rgb * waMc + diffuseColor.a * ((1.0 - waMc) * outgoingLight + waMc * waGlint)) / max(waMa, 1e-4);');
    // the mirror is no longer folded into the luminance alpha bump, and the body colour no longer gives way twice
    expect(frag).not.toContain('waSpecEmis += waMirror');
    expect(frag).not.toMatch(/diffuseColor\.rgb \*= 1\.0 - min\(waMw/);
    expect(frag.indexOf('totalSpecular + waSpecEmis')).toBeLessThan(frag.indexOf('float waMc'));
    // the cover is Fresnel x strength x foam x sky key: no brightness in it either
    const weight = /float waterMirrorWeight\([^)]*\) \{([\s\S]*?)\n\}/.exec(frag)![1]!;
    expect(weight).toContain(`max(waterFresnel(ndv), ${MIRROR_FRESNEL_FLOOR})`);
    expect(weight).not.toMatch(/dot\(|0\.587/);
    // the sky key: distance to the dome gradient segment (horizon -> top) or the flat background
    expect(frag).toContain('min(waterSkyDistance(c, uReflSkyLo, uReflSkyHi), waterSkyDistance(c, uReflBg, uReflBg))');
    w.dispose();
  });

  it('REFLECTION DEBUG is a uniform branch: MIRROR ONLY, opaque, no recompile', () => {
    const w = createWaterMaterial(opts(true));
    const frag = preprocess(compile(w.material).fragmentShader, w.material.defines!);
    expect(mirrorComposite(frag)).toContain('if (uReflDebug > 0.5) { outgoingLight = waMirror.rgb; diffuseColor.a = 1.0; }');
    expect(frag).not.toMatch(/#\s*if.*REFLECT_DEBUG/);
    const key = w.material.customProgramCacheKey(), version = w.material.version;
    expect(getWaterUniforms().uReflDebug.value).toBe(0);
    setWaterParams({ reflectDebug: 1 });
    expect(getWaterUniforms().uReflDebug.value).toBe(1);
    expect(w.material.customProgramCacheKey()).toBe(key);
    expect(w.material.version).toBe(version);
    setWaterParams({ reflectDebug: 0.4 }); // the slider snaps; anything below 0.5 is OFF
    expect(getWaterUniforms().uReflDebug.value).toBe(0);
    w.dispose();
  });

});

describe('water reflection params', () => {
  it('defaults and ranges of the reflection params', () => {
    expect(DEFAULT_WATER_PARAMS.reflection).toBe(1);
    expect(DEFAULT_WATER_PARAMS.reflectDebug).toBe(0);
    expect(WATER_RANGES.reflection).toEqual([0, 1.5]);
    expect(WATER_RANGES.reflectDebug).toEqual([0, 1]);
    // default cover of a reflected object (strength x Fresnel floor) reads clearly but leaves room up to fully opaque
    expect(DEFAULT_WATER_PARAMS.reflection * MIRROR_FRESNEL_FLOOR).toBeGreaterThanOrEqual(0.6);
    expect(WATER_RANGES.reflection[1] * MIRROR_FRESNEL_FLOOR).toBeGreaterThanOrEqual(1);
    expect(setWaterParams({ reflectDebug: 3 }).reflectDebug).toBe(1);
  });

  it('getReflectionStrength keeps the pass running while the debug view is on', () => {
    setWaterParams({ reflection: 0 });
    expect(getReflectionStrength()).toBe(0);
    setWaterParams({ reflectDebug: 1 });
    expect(getReflectionStrength()).toBe(REFLECT_DEBUG_MIN_STRENGTH);
    expect(REFLECT_DEBUG_MIN_STRENGTH).toBeGreaterThan(0);
    setWaterParams({ reflection: 1.2 });
    expect(getReflectionStrength()).toBe(1.2);
    setWaterParams({ quality: 0 }); // LOW has no mirror code: nothing to debug, the pass stays off
    expect(getReflectionStrength()).toBe(0);
    setWaterParams({ quality: 2 });
    setWaterFx(false);
    expect(getReflectionStrength()).toBe(0);
  });

  it('?reflect=<strength> and ?reflectDebug=1 override the params for the page load', () => {
    expect(parseWaterUrl(new URLSearchParams('reflect=0.5'))).toEqual({ reflection: 0.5 });
    expect(parseWaterUrl(new URLSearchParams('reflect=0'))).toEqual({ reflection: 0 });
    expect(parseWaterUrl(new URLSearchParams('reflect=abc'))).toEqual({});
    expect(parseWaterUrl(new URLSearchParams('reflect='))).toEqual({});
    expect(parseWaterUrl(new URLSearchParams('reflectDebug=1'))).toEqual({ reflectDebug: 1 });
    expect(parseWaterUrl(new URLSearchParams('reflect=1.5&reflectDebug=0'))).toEqual({ reflection: 1.5, reflectDebug: 0 });
    expect(parseWaterUrl(new URLSearchParams('water=1'))).toEqual({});
  });

  it('keys the mirror sky on the sky dome gradient (or the background), captured on each water draw', () => {
    const sky = getMirrorSkyUniforms();
    const arr = (c: THREE.Color) => c.toArray().map((v) => +v.toFixed(3));
    setMirrorSky(null, new THREE.Color(0.2, 0.4, 0.6)); // no dome: the flat background is the whole sky
    expect(sky.uReflSkyKey.value).toBe(1);
    for (const c of [sky.uReflSkyLo, sky.uReflSkyHi, sky.uReflBg]) expect(arr(c.value)).toEqual([0.2, 0.4, 0.6]);
    setMirrorSky(null, new THREE.Texture()); // nothing flat to key on: every mirror texel counts as an object
    expect(sky.uReflSkyKey.value).toBe(0);
    setMirrorSky(null, null);
    expect(sky.uReflSkyKey.value).toBe(0);

    // the dome (a gradient horizon -> top) wins; the background stays as a second sky colour
    const w = createWaterMaterial(opts(true));
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0.5, 0.2, 0.2);
    const domeU = { uTop: { value: new THREE.Color(0.1, 0.2, 0.5) }, uHorizon: { value: new THREE.Color(0.4, 0.4, 0.4) } };
    const dome = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.ShaderMaterial({ uniforms: domeU }));
    dome.name = SKY_DOME_NAME;
    scene.add(dome);
    const m = w.material as unknown as { onBeforeRender(r: unknown, s: THREE.Scene): void };
    m.onBeforeRender({ info: { render: { frame: 1 } } }, scene);
    expect(sky.uReflSkyKey.value).toBe(1);
    expect(arr(sky.uReflSkyLo.value)).toEqual([0.4, 0.4, 0.4]);
    expect(arr(sky.uReflSkyHi.value)).toEqual([0.1, 0.2, 0.5]);
    expect(arr(sky.uReflBg.value)).toEqual([0.5, 0.2, 0.2]);
    // day/night animates the dome: the next draw copies the new colours (same dome, cached)
    domeU.uTop.value.setRGB(0.05, 0.05, 0.1);
    captureMirrorSky(scene, 2);
    expect(arr(sky.uReflSkyHi.value)).toEqual([0.05, 0.05, 0.1]);
    // a removed dome is looked up again: background only
    scene.remove(dome);
    captureMirrorSky(scene, 3);
    expect(arr(sky.uReflSkyHi.value)).toEqual([0.5, 0.2, 0.2]);
    w.dispose();
  });

  it('never uses GLSL ES 3.00 reserved words as variable names in patched water shaders', () => {
    const w = createWaterMaterial(opts(true));
    const sh = compile(w.material);
    for (const src of [sh.vertexShader, sh.fragmentShader]) {
      expect(src).not.toMatch(/\b(?:float|int|vec[234]|mat[234]|bool)\s+(?:active|filter|sample|input|output|common|partition|half|fixed)\b/);
    }
    w.dispose();
  });
});

describe('water & puddle radial electrocution', () => {
  it('separates waterElectrocutionField from interconnected terrain puddle electrocution and decays both at 0.95/s', () => {
    const w = createWaterMaterial(opts(true));
    const waterFrag = compile(w.material).fragmentShader;
    expect(waterFrag).toContain('const float MAX_R = 15.5;');
    expect(waterFrag).toContain('if (electroInt <= 0.001 || r > MAX_R) return vec3(0.0);');
    expect(waterFrag).toContain('float ang = atan(dp.y, dp.x);');
    expect(waterFrag).toContain('waterElectrocutionField(waP, uWaterElectroIntensity, uWaterElectroOrigin, uWeatherTime)');
    w.dispose();

    const terrainSh = standardShader();
    applyTerrainShader(terrainSh as unknown as THREE.WebGLProgramParametersWithUniforms, {});
    expect(terrainSh.fragmentShader).toContain('float evalPuddleNoiseField(vec2 wp)');
    expect(terrainSh.fragmentShader).toContain('vec3 evalPuddleElectrocution(vec2 p, float electroInt, vec2 origin, float t, float puddleThreshold)');
    expect(terrainSh.fragmentShader).toContain('float connectedPuddle = smoothstep(puddleThreshold - 0.06, puddleThreshold + 0.01, minPuddlePath);');
    expect(terrainSh.fragmentShader).toContain('evalPuddleElectrocution(wp, uPuddleElectroIntensity, uPuddleElectroOrigin, uTime, puddleThreshold) * puddleMask');
    expect(terrainSh.uniforms.uPuddleElectroIntensity).toBe(getWeatherUniforms().uPuddleElectroIntensity);
    expect(terrainSh.uniforms.uPuddleElectroOrigin).toBe(getWeatherUniforms().uPuddleElectroOrigin);

    getWeatherUniforms().uWaterElectroIntensity.value = 0;
    getWeatherUniforms().uPuddleElectroIntensity.value = 0;
    triggerWaterElectrocution(10, -6, 1.0);
    expect(getWeatherUniforms().uWaterElectroOrigin.value.x).toBe(10);
    expect(getWeatherUniforms().uWaterElectroOrigin.value.y).toBe(-6);
    expect(getWeatherUniforms().uWaterElectroIntensity.value).toBe(1.0);
    expect(getWeatherUniforms().uPuddleElectroIntensity.value).toBe(0);

    triggerPuddleElectrocution(-4, 8, 1.0);
    expect(getWeatherUniforms().uPuddleElectroOrigin.value.x).toBe(-4);
    expect(getWeatherUniforms().uPuddleElectroOrigin.value.y).toBe(8);
    expect(getWeatherUniforms().uPuddleElectroIntensity.value).toBe(1.0);

    tickWeatherClock(1000);
    tickWeatherClock(1100);
    expect(getWeatherUniforms().uWaterElectroIntensity.value).toBeCloseTo(1.0 - 0.1 * 0.95, 5);
    expect(getWeatherUniforms().uPuddleElectroIntensity.value).toBeCloseTo(1.0 - 0.1 * 0.95, 5);
  });
});

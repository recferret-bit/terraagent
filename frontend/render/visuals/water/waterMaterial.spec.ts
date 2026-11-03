import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { getColonyVisionUniforms } from '../../lighting/ColonyVisionAndLights';
import { getWindUniforms } from '../../core/windConfig';
import { getViewFocusEdgesUniform, getViewFocusUniform } from '../../core/viewFocus';
import { createWater } from '../terrain/Liquids';
import { createWaterMaterial, waterProgramKey } from './WaterMaterial';
import { getWaterUniforms, resetWaterParams, setWaterFx, setWaterParams } from './waterConfig';

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

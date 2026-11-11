import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createArchetypeMesh, isArchetypeRuin, setArchetypeRuin } from './index';
import { createUnifiedColonyMaterial, RUIN_VARIANT } from '../visuals/UnifiedColonyMaterial';

function compileSources(material: THREE.Material) {
  const sh = {
    uniforms: {},
    vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader,
  } as unknown as THREE.WebGLProgramParametersWithUniforms;
  material.onBeforeCompile(sh, null as unknown as THREE.WebGLRenderer);
  return sh;
}

describe('W18-22 ruin variant shader modifier (unit)', () => {
  it('injects uRuin vertex buckle, charred/cracked fragment color, dead emissive glass, and matte roughness when enabled', () => {
    const { material, uniforms } = createUnifiedColonyMaterial({ ruin: true });
    expect(uniforms.uRuin?.value).toBe(1);
    const sh = compileSources(material);
    expect(sh.vertexShader).toContain('uniform float uRuin;');
    expect(sh.vertexShader).toContain('if (uRuin > 0.001)');
    expect(sh.fragmentShader).toContain('uniform float uRuin;');
    expect(sh.fragmentShader).toContain('deadRuinGlass');
    expect(sh.fragmentShader).toContain('crackMask');
    expect(sh.fragmentShader).toContain('roughnessFactor = mix(roughnessFactor, 0.92, uRuin);');
    expect(sh.fragmentShader).toContain('metalnessFactor = mix(metalnessFactor, 0.08, uRuin);');
  });

  it('omits uRuin shader chunks when neither ruin option nor RUIN_VARIANT plugin is passed (negative case)', () => {
    const { material, uniforms } = createUnifiedColonyMaterial();
    const sh = compileSources(material);
    expect(sh.fragmentShader).not.toContain('uniform float uRuin;');
    expect(uniforms.uRuin).toBeUndefined();
  });

  it('clamps numeric ruin values to [0, 1] and handles NaN/out-of-range inputs cleanly (corner cases)', () => {
    const { uniforms: uHigh } = createUnifiedColonyMaterial({ plugins: [RUIN_VARIANT], ruin: 4.5 });
    expect(uHigh.uRuin.value).toBe(1);

    const { uniforms: uLow } = createUnifiedColonyMaterial({ ruin: -2 });
    expect(uLow.uRuin.value).toBe(0);

    const solar = createArchetypeMesh('building.solar');
    expect(isArchetypeRuin(solar)).toBe(false);
    expect(setArchetypeRuin(solar, Number.NaN)).toBe(0);
    expect(isArchetypeRuin(solar)).toBe(false);
    expect(setArchetypeRuin(solar, 0.75)).toBeCloseTo(0.75, 5);
    expect(isArchetypeRuin(solar)).toBe(true);
    expect(solar.userData.uniforms.uLit.value).toBe(0);
    expect(setArchetypeRuin(solar, false)).toBe(0);
    expect(isArchetypeRuin(solar)).toBe(false);
    expect(solar.userData.uniforms.uLit.value).toBe(1);
  });
});

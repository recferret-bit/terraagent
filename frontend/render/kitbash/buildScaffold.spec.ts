import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createArchetypeMesh, quantizeBuildStage, setArchetypeBuildProgress } from './index';
import { createUnifiedColonyMaterial } from '../visuals/UnifiedColonyMaterial';
import { BUILD_SCAFFOLD, SCAFFOLD_CUT_FRACTIONS } from '../visuals/unified/buildScaffold';

/** Runs a material's `onBeforeCompile` on three's real MeshStandardMaterial sources (throws if a marker is missing). */
function compileSources(material: THREE.Material) {
  const sh = {
    uniforms: {},
    vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader,
  } as unknown as THREE.WebGLProgramParametersWithUniforms;
  material.onBeforeCompile(sh, null as unknown as THREE.WebGLRenderer);
  return sh;
}

describe('construction scaffold (RN-14 / RN-15)', () => {
  it('is a registered shader modifier that reads only the CPU-quantized uBuildStage', () => {
    const { material } = createUnifiedColonyMaterial({ plugins: [BUILD_SCAFFOLD] });
    const sh = compileSources(material);
    expect(sh.fragmentShader).toContain('uniform float uBuildStage;');
    expect(sh.fragmentShader).toContain('if (uBuildStage < 0.999)');
    expect(sh.fragmentShader).not.toContain('uBuildProgress'); // no second quantization ladder in GLSL
    expect(sh.fragmentShader).toContain('float cutY = uBuildHeight * (');
  });

  it('a material without the plugin has no scaffold at all', () => {
    const { material, uniforms } = createUnifiedColonyMaterial();
    const sh = compileSources(material);
    expect(sh.fragmentShader).not.toContain('uBuildStage');
    expect(uniforms.uBuildStage).toBeUndefined();
  });

  it('cuts at the same fractions of every model height; on the Command Hub at 0.25 / 1.65 / 3.85 m as before', () => {
    const hub = createArchetypeMesh('building.commandHub');
    const turret = createArchetypeMesh('building.turret');
    const hubH = hub.userData.uniforms.uBuildHeight!.value;
    expect(hubH).toBeCloseTo(6.59, 4);
    expect(SCAFFOLD_CUT_FRACTIONS.map((f) => f * hubH)).toEqual([
      expect.closeTo(0.25, 4), expect.closeTo(1.65, 4), expect.closeTo(3.85, 4),
    ]);
    turret.geometry.computeBoundingBox();
    expect(turret.userData.uniforms.uBuildHeight!.value).toBe(turret.geometry.boundingBox!.max.y);
    // At 66 % the turret's cut sits inside the turret, not above it (it used to be cut at 3.85 m, above its 2.5 m top).
    expect(SCAFFOLD_CUT_FRACTIONS[2] * turret.userData.uniforms.uBuildHeight!.value).toBeLessThan(turret.geometry.boundingBox!.max.y);
  });

  it('keeps build state per mesh and quantizes on the CPU only', () => {
    const a = createArchetypeMesh('building.commandHub');
    const b = createArchetypeMesh('building.commandHub');
    expect(setArchetypeBuildProgress(a, 0.5)).toBe(0.33);
    expect(a.userData.uniforms.uBuildStage!.value).toBe(0.33);
    expect(a.userData.uniforms.uBuildProgress).toBeUndefined(); // RN-24: no mirror uniform
    expect(b.userData.uniforms.uBuildStage!.value).toBe(1);
    expect([0, 0.329, 0.33, 0.659, 0.66, 0.998, 0.999, 2].map(quantizeBuildStage)).toEqual([0, 0, 0.33, 0.33, 0.66, 0.66, 1, 1]);
  });
});

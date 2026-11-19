import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createArchetypeMesh, tickArchetypeMesh } from '../../kitbash';
import { useVertebrateInstanceAttributes } from './instanceShader';
import { vertebratePartMatrix } from './pose';
import { getVertebrateConfig } from './rig';

function compile(material: THREE.Material, lib: typeof THREE.ShaderLib.standard) {
  const shader = { uniforms: {}, vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader };
  material.onBeforeCompile(shader as THREE.WebGLProgramParametersWithUniforms, null as unknown as THREE.WebGLRenderer);
  return shader;
}

describe('vertebrate render integration & GPU/CPU shader parity', () => {
  for (const id of ['fauna.timberWolf', 'fauna.bird.highlandHawk']) {
    it(`${id} injects unified vertebrateTransform() in visible and depth materials`, () => {
      const mesh = createArchetypeMesh(id);
      tickArchetypeMesh(mesh, 1.25, 0.85, 0.3);

      const u = mesh.userData.uniforms;
      expect(u.uVertParams).toBeDefined();
      expect(u.uVertMeta).toBeDefined();
      expect(u.uWalkWeight.value).toBeCloseTo(0.85, 5);
      expect(u.uWorkWeight.value).toBeCloseTo(0.3, 5);

      const visible = compile(mesh.material as THREE.Material, THREE.ShaderLib.standard);
      const shadow = compile(mesh.customDepthMaterial!, THREE.ShaderLib.depth);
      expect(visible.vertexShader).toContain('objectNormal = normalize(mat3(vertebrateTransform()) * normal)');
      for (const s of [visible, shadow]) {
        expect(s.vertexShader).toContain('(vertebrateTransform() * vec4(position, 1.0)).xyz');
        expect(s.vertexShader).toContain('mat4 vertQuadLeg(mat4 body, float role)');
        expect(s.vertexShader).toContain('mat4 vertBirdWing(mat4 body, float role)');
        expect(s.uniforms).toHaveProperty('uVertParams', u.uVertParams);
        expect(s.uniforms).toHaveProperty('uVertMeta', u.uVertMeta);
      }

      const joints = mesh.geometry.getAttribute('aVertJoint');
      const tips = mesh.geometry.getAttribute('aVertTip');
      expect(joints).toBeDefined();
      expect(tips).toBeDefined();

      (mesh.material as THREE.Material).dispose();
      mesh.geometry.dispose();
    });
  }

  it('patches aBioState per-instance attributes on both visible and shadow passes', () => {
    const mesh = createArchetypeMesh('fauna.crownStag');
    const visMat = mesh.material as THREE.Material;
    const depthMat = mesh.customDepthMaterial!;
    useVertebrateInstanceAttributes(visMat, depthMat);

    const visible = compile(visMat, THREE.ShaderLib.standard);
    const shadow = compile(depthMat, THREE.ShaderLib.depth);
    for (const s of [visible, shadow]) {
      expect(s.vertexShader).toContain('attribute vec4 aBioState;');
      expect(s.vertexShader).toContain('clamp(aBioState.y - 1.0, 0.0, 1.0)');
      expect(s.vertexShader).toContain('clamp(aBioState.w, 0.0, 1.0)');
      expect(s.vertexShader).toContain('(uBioGlobalTime + aBioState.x)');
    }

    visMat.dispose();
    mesh.geometry.dispose();
  });

  it('keeps CPU body rest identity and sleep crouch strictly matching config sleepDrop', () => {
    const mesh = createArchetypeMesh('fauna.crownStag');
    const cfg = getVertebrateConfig(mesh.geometry);
    const bodyRig = { role: 1 as const, pivot: [0, 0, 0] as THREE.Vector3Tuple, joint: [0, 0, 0] as THREE.Vector3Tuple, tip: [0, 0, 0] as THREE.Vector3Tuple, meta: 0 };

    const restMat = vertebratePartMatrix(bodyRig, { time: 0, walk: 0, run: 0, work: 0, sleep: 0, config: cfg });
    const restPos = new THREE.Vector3(0, cfg.comY, 0).applyMatrix4(restMat);
    expect(restPos.y).toBeCloseTo(cfg.comY, 5);

    const sleepMat = vertebratePartMatrix(bodyRig, { time: 0, walk: 0, run: 0, work: 0, sleep: 1, config: cfg });
    const sleepPos = new THREE.Vector3(0, cfg.comY, 0).applyMatrix4(sleepMat);
    expect(sleepPos.y).toBeCloseTo(cfg.comY - cfg.sleepDrop, 5);

    (mesh.material as THREE.Material).dispose();
    mesh.geometry.dispose();
  });
});

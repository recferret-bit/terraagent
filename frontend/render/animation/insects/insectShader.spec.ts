import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createArchetypeMesh, tickArchetypeMesh } from '../../kitbash';
import { getInsectAnimator } from './InsectAnimationController';
import { insectPartMatrix } from './pose';

function compile(material: THREE.Material, lib: typeof THREE.ShaderLib.standard) {
  const shader = { uniforms: {}, vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader };
  material.onBeforeCompile(shader as THREE.WebGLProgramParametersWithUniforms, null as unknown as THREE.WebGLRenderer);
  return shader;
}
describe('insect render integration', () => {
  it('uses one action transform for visible geometry, surface normals and shadows', () => {
    const mesh = createArchetypeMesh('fauna.greenSpitter');
    const controller = getInsectAnimator(mesh)!;
    controller.sync({ state: 'windup', startedTick: 10, durationTicks: 3 }, 11);
    const before = controller.phase;
    tickArchetypeMesh(mesh, 2, 0, 0);
    expect(controller.phase).toBe(before); // catalog updates uniforms, never advances the action clock twice
    const visible = compile(mesh.material as THREE.Material, THREE.ShaderLib.standard);
    const shadow = compile(mesh.customDepthMaterial!, THREE.ShaderLib.depth);
    expect(visible.vertexShader).toContain('objectNormal = normalize(mat3(insectTransform()) * normal)');
    for (const shader of [visible, shadow]) {
      expect(shader.vertexShader).toContain('(insectTransform() * vec4(position, 1.0)).xyz');
      expect(shader.uniforms).toHaveProperty('uInsectAction', mesh.userData.uniforms.uInsectAction);
    }
    expect(new Set(mesh.geometry.getAttribute('aInsectPart').array)).toEqual(new Set([1, 2, 3, 4, 5, 6, 7, 8]));
    (mesh.material as THREE.Material).dispose(); mesh.geometry.dispose();
  });
  it('keeps projectile sockets on the charged sacs under world movement and rotation', () => {
    const mesh = createArchetypeMesh('fauna.greenSpitter');
    mesh.position.set(4, 0.5, -7); mesh.rotation.y = 1.7;
    const c = getInsectAnimator(mesh)!;
    c.sync({ state: 'windup', startedTick: 2, durationTicks: 3 }, 5);
    tickArchetypeMesh(mesh, 0.7, 0, 0);
    for (const side of [0, 1]) {
      const sign = side === 0 ? -1 : 1;
      const part = { group: 6, anim: 69, pivot: [sign * 0.18, 0.95, -0.77] as THREE.Vector3Tuple };
      const matrix = insectPartMatrix(part, c.pose);
      const local = c.socket('projectile', side).applyMatrix4(mesh.matrixWorld.clone().invert());
      const rest = local.applyMatrix4(matrix.clone().invert());
      expect(rest.distanceTo(new THREE.Vector3(sign * 0.28, 1.24, -0.84))).toBeLessThan(1e-7);
    }
    (mesh.material as THREE.Material).dispose(); mesh.geometry.dispose();
  });
});

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createArchetypeMesh, tickArchetypeMesh } from '../../kitbash';
import { InsectSwarmRenderer } from './InsectSwarmRenderer';
import { getInsectAnimator } from './InsectAnimationController';

describe('insect swarm batching', () => {
  it('batches species independently, retaining individual poses, selection, visibility and picking proxies', () => {
    const root = new THREE.Group(); root.position.set(5, 0, 3);
    const service = new InsectSwarmRenderer(root);
    const first = createArchetypeMesh('fauna.blackAnt');
    const second = createArchetypeMesh('fauna.blackAnt');
    const spitter = createArchetypeMesh('fauna.greenSpitter');
    root.add(first, second, spitter); second.position.x = 3;
    tickArchetypeMesh(first, 1, 1); tickArchetypeMesh(second, 2, 0);
    getInsectAnimator(second)!.die(); getInsectAnimator(second)!.update(0.5);
    second.userData.uniforms.uSelected.value = 1;
    service.sync('dune');
    expect(service.group.children).toHaveLength(2);
    const ants = service.group.children.find(m => m.name === 'swarm:fauna.blackAnt') as THREE.InstancedMesh;
    expect(ants.count).toBe(2);
    expect((first.material as THREE.Material).visible).toBe(false);
    expect(first.visible).toBe(true);
    expect(ants.geometry.getAttribute('aInsectMotion').getX(0)).not.toBe(ants.geometry.getAttribute('aInsectMotion').getX(1));
    expect(ants.geometry.getAttribute('aInsectAction').getW(0)).toBe(0);
    expect(ants.geometry.getAttribute('aInsectAction').getW(1)).toBeGreaterThan(0);
    expect(ants.geometry.getAttribute('aInsectFlags').getY(1)).toBe(1);
    const matrix = new THREE.Matrix4(); ants.getMatrixAt(1, matrix);
    expect(new THREE.Vector3().setFromMatrixPosition(matrix).x).toBe(3);
    second.visible = false; service.sync('dune');
    expect(ants.count).toBe(1);
    root.remove(first); service.sync('dune');
    expect(service.group.children).toHaveLength(1);
    expect((first.material as THREE.Material).visible).toBe(true);
    service.dispose(); expect((spitter.material as THREE.Material).visible).toBe(true);
  });

  it('uses identical per-instance pose inputs in visible and shadow shaders', () => {
    const root = new THREE.Group(), service = new InsectSwarmRenderer(root);
    root.add(createArchetypeMesh('fauna.blueBeetle')); service.sync('dune');
    const batch = service.group.children[0] as THREE.InstancedMesh;
    const attributeSlots = Object.values(batch.geometry.attributes).reduce((slots, attribute) => slots + Math.ceil(attribute.itemSize / 4), 4);
    expect(attributeSlots).toBeLessThanOrEqual(16); // WebGL2 minimum, including the four instance-matrix columns.
    const compile = (material: THREE.Material, lib: typeof THREE.ShaderLib.standard) => {
      const shader = { uniforms: {}, vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader };
      material.onBeforeCompile(shader as THREE.WebGLProgramParametersWithUniforms, null as unknown as THREE.WebGLRenderer);
      return shader;
    };
    const visible = compile(batch.material as THREE.Material, THREE.ShaderLib.standard);
    const shadow = compile(batch.customDepthMaterial!, THREE.ShaderLib.depth);
    for (const shader of [visible, shadow]) {
      expect(shader.vertexShader).toContain('attribute vec4 aInsectAction;');
      expect(shader.vertexShader).toContain('attribute vec4 aInsectMotion;');
      expect(shader.vertexShader).not.toContain('uniform float uTime;');
      expect(shader.vertexShader).toContain('taWorldPosition = instanceMatrix * taWorldPosition;');
      expect(shader.vertexShader).toContain('insectTransform() * vec4(position, 1.0)');
    }
    expect(visible.fragmentShader).toContain('varying float vInstanceSelected;');
    service.dispose();
  });
});

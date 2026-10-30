import * as THREE from 'three';
import { isShaderOptimized } from '../../../core/perfConfig';
import { NEB_VERT, NEB_FRAG } from './shaders';
import type { ParallaxCtx, ParallaxPart } from './types';

export interface Nebulae extends ParallaxPart { setTint(a: THREE.Color): void }

/** Additive nebula planes at three depths, tinted from the planet's atmosphere. */
export function createNebulae(ctx: ParallaxCtx): Nebulae {
  const parts: ParallaxPart[] = [];
  const mats: THREE.ShaderMaterial[] = [];
  const meshes: THREE.Mesh[] = [];
  const baseI: number[] = [];
  const nebula = (depth: number, a: number, b: number, i: number, seed: number, order: number) => {
    const { w, h } = ctx.slab(depth);
    const g = new THREE.PlaneGeometry(w * 2.1, h * 2.4);
    const m = new THREE.ShaderMaterial({
      vertexShader: NEB_VERT,
      fragmentShader: NEB_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uA: { value: new THREE.Color(a) }, uB: { value: new THREE.Color(b) }, uTime: { value: 0 }, uI: { value: i }, uSeed: { value: seed }, uOpt: { value: isShaderOptimized() ? 1 : 0 } },
    });
    const mesh = new THREE.Mesh(g, m); mesh.position.set(0, 0, -depth); mesh.renderOrder = order; mesh.frustumCulled = false; ctx.group.add(mesh);
    mats.push(m); meshes.push(mesh); baseI.push(i);
    parts.push({ dispose() { g.dispose(); m.dispose(); } });
  };
  nebula(650, 0x203a8a, 0x7a2a7a, 0.34, 3.1, -70);
  nebula(430, 0x1a5a7a, 0x2a2a8a, 0.2, 9.4, -69);
  nebula(270, 0x3a2a6a, 0x16527a, 0.12, 15.7, -68);
  return {
    setTint(a) { for (const m of mats) (m.uniforms.uA.value as THREE.Color).copy(a); },
    update(_dt, time) {
      const opt = isShaderOptimized();
      if (meshes[2]) meshes[2].visible = !opt;
      for (let k = 0; k < mats.length; k++) {
        mats[k].uniforms.uTime.value = time;
        mats[k].uniforms.uOpt.value = opt ? 1 : 0;
        mats[k].uniforms.uI.value = opt && k < 2 ? baseI[k] * 1.18 : baseI[k];
      }
    },
    dispose() { parts.forEach((p) => p.dispose()); },
  };
}

import * as THREE from 'three';
import { GLSL_NOISE } from '../../visuals/space/glslNoise';

/** Retro-thruster plumes (3 cones, shared HDR shader). Local space: pod base at y=0, flames point -y. */
export interface Flames {
  group: THREE.Group;
  u: { uI: THREE.IUniform<number>; uTime: THREE.IUniform<number> };
  dispose(): void;
}
export function createFlames(podRadius: number): Flames {
  const geo = new THREE.ConeGeometry(0.34, 5.2, 18, 8, true).translate(0, -2.6, 0).rotateX(Math.PI); // apex downwards? cone apex is +y by default
  // after rotateX(PI) apex points down, base (wide) at the nozzle — but translate was applied first: fix by rebuilding
  geo.dispose();
  const g2 = new THREE.ConeGeometry(0.34, 5.2, 18, 8, true); g2.rotateX(Math.PI); g2.translate(0, -2.6, 0);
  const u = { uI: { value: 0 }, uTime: { value: 0 } };
  const mat = new THREE.ShaderMaterial({
    uniforms: u, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
    vertexShader: /* glsl */ `varying vec3 vP; varying vec3 vN; varying vec3 vV; uniform float uTime, uI;
      void main(){ vP = position; vec3 p = position; float s = clamp(-p.y / 5.2, 0.0, 1.0); p.xz *= 1.0 + 0.08 * sin(uTime * 38.0 + p.y * 3.0); p.y *= (0.55 + 0.45 * uI) * (1.0 + 0.06 * sin(uTime * 51.0));
        vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(p, 1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */ `${GLSL_NOISE} uniform float uI, uTime; varying vec3 vP; varying vec3 vN; varying vec3 vV;
      void main(){ float s = clamp(-vP.y / 5.2, 0.0, 1.0); float n = vnoise3(vec3(vP.x * 3.0, vP.y * 1.2 + uTime * 22.0, vP.z * 3.0));
        float f = pow(abs(dot(normalize(vN), vV)), 1.2); float a = f * (1.0 - s) * (0.6 + 0.7 * n);
        vec3 c = mix(vec3(3.4, 3.0, 2.6), vec3(2.4, 0.7, 0.12), smoothstep(0.0, 0.7, s)); c = mix(c, vec3(0.5, 1.4, 3.0), (1.0 - smoothstep(0.0, 0.15, s)) * 0.35);
        gl_FragColor = vec4(c * a * uI, 1.0); }`,
  });
  const group = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const m = new THREE.Mesh(g2, mat); const a = (i / 3) * Math.PI * 2 + 0.5;
    m.position.set(Math.cos(a) * podRadius * 0.62, 0, Math.sin(a) * podRadius * 0.62); m.rotation.set(Math.sin(a) * 0.12, 0, -Math.cos(a) * 0.12);
    m.frustumCulled = false; m.renderOrder = 26; group.add(m);
  }
  group.visible = false;
  return { group, u, dispose() { g2.dispose(); mat.dispose(); group.removeFromParent(); } };
}

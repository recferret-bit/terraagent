import * as THREE from 'three';
import { mulberry32 } from '../math';

/** GPU speed-streaks: instanced camera-facing stretched quads that scroll past a moving anchor. Deterministic. */
export interface StreakField {
  mesh: THREE.Mesh;
  u: { uPod: THREE.IUniform<THREE.Vector3>; uScroll: THREE.IUniform<number>; uLen: THREE.IUniform<number>; uIntensity: THREE.IUniform<number>; uColA: THREE.IUniform<THREE.Color>; uColB: THREE.IUniform<THREE.Color> };
  dispose(): void;
}
export function createStreakField(count: number, radius: number, rMin: number, height: number, seed: number): StreakField {
  const base = new THREE.PlaneGeometry(1, 1);
  const g = new THREE.InstancedBufferGeometry();
  g.index = base.index; g.setAttribute('position', base.getAttribute('position'));
  const rnd = mulberry32(seed), a = new Float32Array(count * 4);
  for (let i = 0; i < count * 4; i++) a[i] = rnd();
  g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(a, 4));
  g.instanceCount = count;
  const u = {
    uPod: { value: new THREE.Vector3() }, uScroll: { value: 0 }, uLen: { value: 6 }, uIntensity: { value: 0 },
    uColA: { value: new THREE.Color(1, 0.55, 0.2) }, uColB: { value: new THREE.Color(1, 0.95, 0.85) },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...u, uRadius: { value: radius }, uRMin: { value: rMin }, uH: { value: height }, uWidth: { value: 0.035 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
    vertexShader: /* glsl */ `
      attribute vec4 aSeed; uniform vec3 uPod; uniform float uScroll, uLen, uRadius, uRMin, uH, uWidth;
      varying float vT; varying float vK;
      void main(){
        float r = uRMin + sqrt(aSeed.x) * (uRadius - uRMin); float ang = aSeed.y * 6.28318;
        float y = mod(aSeed.z * uH + uScroll * (0.65 + 0.7 * aSeed.w), uH) - uH * 0.5;
        vec3 c = uPod + vec3(cos(ang) * r, y, sin(ang) * r);
        float len = uLen * (0.45 + aSeed.w);
        vec4 mv = viewMatrix * vec4(c + vec3(0.0, position.y * len, 0.0), 1.0);
        vec3 axis = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
        vec3 side = normalize(cross(axis, normalize(mv.xyz)));
        mv.xyz += side * position.x * uWidth * (0.6 + aSeed.z);
        vT = position.y + 0.5; vK = aSeed.w * 0.7 + 0.3;
        // fade at the ends of the recycle volume to avoid pops
        vK *= smoothstep(0.0, 0.12, 1.0 - abs(y) / (uH * 0.5));
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColA, uColB; uniform float uIntensity; varying float vT; varying float vK;
      void main(){ float a = pow(vT, 2.0) * vK * uIntensity * 0.6; gl_FragColor = vec4(mix(uColA, uColB, vT) * a, 1.0); }`,
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false; mesh.renderOrder = 20; mesh.visible = false;
  return { mesh, u, dispose() { g.dispose(); base.dispose(); mat.dispose(); mesh.removeFromParent(); } };
}

import * as THREE from 'three';
import { GLSL_NOISE } from '@shared/engine/visuals/space/glslNoise';

/**
 * Retro-rocket jets, one per pod nozzle. Each jet = white-blue HDR core with standing shock diamonds (Mach disks)
 * + a wider turbulent orange plume + a nozzle-exit flare. Geometry is authored along −Y and oriented per nozzle.
 * `uI` drives length/brightness (ignition → full burn → cut-off); everything is HDR (> 1.1) for selective bloom.
 */
export interface Flames {
  group: THREE.Group;
  u: { uI: THREE.IUniform<number>; uTime: THREE.IUniform<number> };
  dispose(): void;
}
export interface Nozzle { pos: THREE.Vector3; dir: THREE.Vector3 }

const CORE_L = 2.6, PLUME_L = 6.5;

const VERT = /* glsl */ `
uniform float uTime, uI, uLen, uSeed;
varying vec3 vP; varying vec3 vN; varying vec3 vV; varying float vS;
void main(){
  vec3 p = position;
  float s = clamp(-p.y / uLen, 0.0, 1.0);
  float flick = 1.0 + 0.07 * sin(uTime * 47.0 + uSeed * 9.0) + 0.05 * sin(uTime * 83.0 + uSeed * 3.0);
  p.y *= (0.35 + 0.65 * uI) * flick;                       // ignition grows the jet, cut-off shrinks it
  p.xz *= 1.0 + 0.06 * sin(uTime * 39.0 + p.y * 2.7 + uSeed) * s;
  vP = position; vS = s;
  vN = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(p, 1.0); vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;

export function createFlames(nozzles: Nozzle[]): Flames {
  const group = new THREE.Group(); group.visible = false;
  const u = { uI: { value: 0 }, uTime: { value: 0 } };
  const geos: THREE.BufferGeometry[] = [], mats: THREE.Material[] = [];

  // open cones along −Y, wide end away from the nozzle (apex at the nozzle for the core, a throat for the plume)
  const coreGeo = new THREE.CylinderGeometry(0.2, 0.09, CORE_L, 20, 12, true).translate(0, -CORE_L / 2, 0);
  const plumeGeo = new THREE.CylinderGeometry(1.15, 0.2, PLUME_L, 24, 16, true).translate(0, -PLUME_L / 2, 0);
  const flareGeo = new THREE.SphereGeometry(0.26, 16, 10).scale(1, 0.6, 1);
  geos.push(coreGeo, plumeGeo, flareGeo);

  const mk = (frag: string, len: number, seed: number) => {
    const m = new THREE.ShaderMaterial({
      uniforms: { ...u, uLen: { value: len }, uSeed: { value: seed } }, vertexShader: VERT, fragmentShader: frag,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
    });
    mats.push(m); return m;
  };
  const CORE_FRAG = /* glsl */ `
    uniform float uI, uTime; varying vec3 vP; varying vec3 vN; varying vec3 vV; varying float vS;
    void main(){
      float f = pow(abs(dot(normalize(vN), vV)), 0.9);            // bright centre-line, soft edges
      float diamonds = 0.55 + 0.45 * pow(abs(cos(vS * 3.14159 * 4.5)), 5.0);
      float a = f * diamonds * (1.0 - smoothstep(0.45, 1.0, vS));
      vec3 c = mix(vec3(2.6, 2.9, 3.4), vec3(0.5, 1.2, 3.2), smoothstep(0.0, 0.4, vS));
      gl_FragColor = vec4(c * a * uI * 0.9, 1.0);
    }`;
  const PLUME_FRAG = /* glsl */ `
    ${GLSL_NOISE}
    uniform float uI, uTime, uSeed; varying vec3 vP; varying vec3 vN; varying vec3 vV; varying float vS;
    void main(){
      float ang = atan(vP.z, vP.x);
      float n = fbm3lo(vec3(cos(ang) * 1.8 + uSeed, vP.y * 0.8 + uTime * 26.0, sin(ang) * 1.8));
      float f = pow(abs(dot(normalize(vN), vV)), 1.4);
      float a = f * (0.35 + 0.95 * n) * pow(1.0 - vS, 1.6);
      vec3 hot = vec3(2.6, 1.05, 0.25), cool = vec3(1.3, 0.22, 0.03);
      vec3 c = mix(hot, cool, smoothstep(0.05, 0.6, vS)) * (0.8 + 0.4 * n);
      c = mix(c, vec3(0.6, 1.1, 2.6), (1.0 - smoothstep(0.0, 0.12, vS)) * 0.5);   // blue at the throat
      gl_FragColor = vec4(c * a * uI * 0.38, 1.0);
    }`;
  const FLARE_FRAG = /* glsl */ `
    uniform float uI, uTime; varying vec3 vP; varying vec3 vN; varying vec3 vV; varying float vS;
    void main(){
      float f = pow(abs(dot(normalize(vN), vV)), 2.0);
      gl_FragColor = vec4(vec3(2.6, 2.4, 2.8) * f * uI * (0.9 + 0.1 * sin(uTime * 60.0)), 1.0);
    }`;

  const down = new THREE.Vector3(0, -1, 0);
  nozzles.forEach((nz, i) => {
    const jet = new THREE.Group();
    jet.position.copy(nz.pos);
    jet.quaternion.setFromUnitVectors(down, nz.dir.clone().normalize());
    const parts: [THREE.BufferGeometry, THREE.Material, number][] = [
      [plumeGeo, mk(PLUME_FRAG, PLUME_L, i * 1.7), 26],
      [coreGeo, mk(CORE_FRAG, CORE_L, i * 1.7), 27],
      [flareGeo, mk(FLARE_FRAG, 1, i * 1.7), 28],
    ];
    for (const [g, m, order] of parts) { const mesh = new THREE.Mesh(g, m); mesh.frustumCulled = false; mesh.renderOrder = order; jet.add(mesh); }
    group.add(jet);
  });
  return { group, u, dispose() { geos.forEach((g) => g.dispose()); mats.forEach((m) => m.dispose()); group.removeFromParent(); } };
}

import * as THREE from 'three';
import { GLSL_NOISE } from '../../visuals/space/glslNoise';

/** Reentry plasma sheath: teardrop lathe wrapping the pod's heat shield with a long flame trail. HDR (>1.1 → bloom). */
export interface Plasma {
  group: THREE.Group;
  u: { uI: THREE.IUniform<number>; uTime: THREE.IUniform<number>; uHot: THREE.IUniform<THREE.Color>; uCool: THREE.IUniform<THREE.Color> };
  dispose(): void;
}
export function createPlasma(podRadius: number, podHeight: number): Plasma {
  const R = podRadius * 1.9, L = 26;
  const pts: THREE.Vector2[] = [];
  // profile: (radius, y) from the nose (below the shield) up along the trail
  const N = 28;
  for (let i = 0; i <= N; i++) {
    const s = i / N; // 0 nose → 1 tail tip
    const y = -podHeight * 0.55 + s * L;
    const bulge = Math.pow(Math.sin(Math.min(1, s * 5.5) * Math.PI * 0.5), 0.55) * (1 - Math.pow(s, 0.7) * 0.92);
    pts.push(new THREE.Vector2(Math.max(0.001, R * bulge), y));
  }
  const geo = new THREE.LatheGeometry(pts, 40);
  const u = { uI: { value: 0 }, uTime: { value: 0 }, uHot: { value: new THREE.Color(1.5, 1.0, 0.55) }, uCool: { value: new THREE.Color(1.4, 0.32, 0.05) } };
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...u, uLen: { value: L }, uY0: { value: -podHeight * 0.55 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
    vertexShader: /* glsl */ `varying vec3 vP; varying vec3 vN; varying vec3 vV; void main(){ vP = position; vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position,1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */ `
      ${GLSL_NOISE}
      uniform float uI, uTime, uLen, uY0; uniform vec3 uHot, uCool; varying vec3 vP; varying vec3 vN; varying vec3 vV;
      void main(){
        float s = clamp((vP.y - uY0) / uLen, 0.0, 1.0);
        float ang = atan(vP.z, vP.x);
        float n = fbm3lo(vec3(cos(ang) * 2.0, vP.y * 0.35 - uTime * 9.0, sin(ang) * 2.0));
        float n2 = vnoise3(vec3(ang * 3.0, vP.y * 1.3 - uTime * 16.0, 1.0));
        float rim = pow(1.0 - abs(dot(normalize(vN), vV)), 1.4);
        float body = (1.0 - s) * (0.35 + 0.9 * n) + rim * 0.5;
        float a = body * (0.55 + 0.6 * n2) * smoothstep(1.0, 0.55, s);
        vec3 c = mix(uHot, uCool, smoothstep(0.0, 0.5, s));
        gl_FragColor = vec4(c * a * uI * 0.22, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false; mesh.renderOrder = 25;
  const group = new THREE.Group(); group.add(mesh); group.visible = false;
  return { group, u, dispose() { geo.dispose(); mat.dispose(); group.removeFromParent(); } };
}

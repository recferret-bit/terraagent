import * as THREE from 'three';
import { GLSL_NOISE } from '../../visuals/space/glslNoise';

/**
 * Reentry plasma, built so the pod stays readable inside it (the camera is above/behind the pod for most of reentry):
 *  1. bow shock — glowing lens hugging the underside of the heat shield (white-hot centre → orange edge)
 *  2. shield-rim ring — plasma wrapping around the shield edge, the brightest signature seen from above
 *  3. sheath — hollow, rim-lit (Fresnel) teardrop trailing up behind the pod; its interior stays transparent
 *  4. ablation sparks — analytic particles shed from the rim and streaming up the wake
 *  5. halo — soft additive glow sprite so bloom has a clean source
 * All HDR (> 1.1 → selective bloom), additive, depthWrite off. Local space: pod centre at origin, the pod falls along −y.
 */
export interface Plasma {
  group: THREE.Group;
  u: {
    uI: THREE.IUniform<number>; uTime: THREE.IUniform<number>;
    uHot: THREE.IUniform<THREE.Color>; uCool: THREE.IUniform<THREE.Color>; uAtm: THREE.IUniform<THREE.Color>;
  };
  dispose(): void;
}

const VERT = /* glsl */ `
varying vec3 vP; varying vec3 vN; varying vec3 vV;
void main(){
  vP = position; vN = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(position, 1.0); vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;

export function createPlasma(podRadius: number, podHeight: number): Plasma {
  const group = new THREE.Group(); group.visible = false;
  const u = {
    uI: { value: 0 }, uTime: { value: 0 },
    uHot: { value: new THREE.Color(1.7, 0.95, 0.42) }, uCool: { value: new THREE.Color(1.4, 0.32, 0.05) },
    uAtm: { value: new THREE.Color(0.9, 0.35, 1.0) },
  };
  const base = -podHeight * 0.5;           // heat-shield plane
  const shieldR = podRadius * 1.12;
  const geos: THREE.BufferGeometry[] = [], mats: THREE.Material[] = [];
  const add = (g: THREE.BufferGeometry, m: THREE.Material, order: number) => {
    geos.push(g); mats.push(m);
    const mesh = new THREE.Mesh(g, m); mesh.frustumCulled = false; mesh.renderOrder = order; group.add(mesh); return mesh;
  };
  const shaderMat = (frag: string, extra: Record<string, THREE.IUniform> = {}, side: THREE.Side = THREE.DoubleSide) => new THREE.ShaderMaterial({
    uniforms: { ...u, ...extra }, vertexShader: VERT, fragmentShader: frag,
    // alpha-blended (not additive) so the plasma keeps its orange/violet hue over bright skies and clouds;
    // colours are still HDR so bloom picks them up
    transparent: true, depthWrite: false, blending: THREE.NormalBlending, side, fog: false,
  });

  // 1. bow shock: squashed lower hemisphere just under the shield
  {
    const g = new THREE.SphereGeometry(shieldR * 1.18, 40, 14, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
    g.scale(1, 0.42, 1); g.translate(0, base - 0.05, 0);
    add(g, shaderMat(/* glsl */ `
      ${GLSL_NOISE}
      uniform float uI, uTime; uniform vec3 uHot, uCool; varying vec3 vP; varying vec3 vN; varying vec3 vV;
      void main(){
        float r = length(vP.xz) / ${(shieldR * 1.18).toFixed(3)};
        float n = vnoise3(vec3(vP.xz * 2.6, uTime * 7.0));
        float f = pow(1.0 - abs(dot(normalize(vN), vV)), 1.6);
        vec3 c = mix(uHot * 1.6, uCool * 1.9, smoothstep(0.05, 0.7, r));
        float a = (0.5 + 0.5 * n) * (0.45 + 1.1 * f) * (1.0 - smoothstep(0.92, 1.0, r) * 0.5);
        gl_FragColor = vec4(c, clamp(a * uI * 0.85, 0.0, 1.0));
      }`), 24);
  }
  // 2. rim ring: plasma rolling around the shield edge, flaring up the sides
  {
    const g = new THREE.TorusGeometry(shieldR * 1.02, podRadius * 0.32, 14, 64);
    g.rotateX(Math.PI / 2); g.scale(1, 1.6, 1); g.translate(0, base + 0.12, 0);
    add(g, shaderMat(/* glsl */ `
      ${GLSL_NOISE}
      uniform float uI, uTime; uniform vec3 uHot, uCool; varying vec3 vP; varying vec3 vN; varying vec3 vV;
      void main(){
        float ang = atan(vP.z, vP.x);
        float n = fbm3lo(vec3(cos(ang) * 3.0, vP.y * 1.5 - uTime * 6.0, sin(ang) * 3.0));
        float f = pow(abs(dot(normalize(vN), vV)), 0.8);
        float a = smoothstep(0.25, 0.85, n) * (0.4 + 0.8 * f);
        gl_FragColor = vec4(mix(uHot * 2.2, uCool * 2.0, 1.0 - n), clamp(a * uI * 0.9, 0.0, 1.0));
      }`), 26);
  }
  // 3. sheath: hollow Fresnel teardrop trailing behind (up)
  {
    const L = 15, R = shieldR * 1.3, N = 32, pts: THREE.Vector2[] = [];
    for (let i = 0; i <= N; i++) {
      const s = i / N, y = base - 0.15 + s * L;
      const bulge = Math.pow(Math.sin(Math.min(1, s * 6.0) * Math.PI * 0.5), 0.5) * (1 - Math.pow(s, 0.65) * 0.94);
      pts.push(new THREE.Vector2(Math.max(0.001, R * bulge), y));
    }
    const g = new THREE.LatheGeometry(pts, 48);
    add(g, shaderMat(/* glsl */ `
      ${GLSL_NOISE}
      uniform float uI, uTime, uLen, uY0; uniform vec3 uHot, uCool, uAtm; varying vec3 vP; varying vec3 vN; varying vec3 vV;
      void main(){
        float s = clamp((vP.y - uY0) / uLen, 0.0, 1.0);
        float ang = atan(vP.z, vP.x);
        float n = fbm3lo(vec3(cos(ang) * 2.2, vP.y * 0.32 - uTime * 10.0, sin(ang) * 2.2));
        float streak = vnoise3(vec3(ang * 5.0, vP.y * 0.9 - uTime * 18.0, 3.0));
        float rim = pow(1.0 - abs(dot(normalize(vN), vV)), 3.2);          // hollow: only the silhouette glows
        float a = rim * (0.35 + 0.9 * n) * (0.6 + 0.6 * streak) * (1.0 - smoothstep(0.35, 1.0, s));
        vec3 c = mix(uHot * 1.4, uCool * 1.9, smoothstep(0.0, 0.18, s));
        c = mix(c, uAtm * 1.4, smoothstep(0.3, 0.75, s));
        gl_FragColor = vec4(c, clamp(a * uI * 0.7, 0.0, 1.0));
      }`, { uLen: { value: L }, uY0: { value: base - 0.15 } }), 25);
  }
  // 4. ablation sparks (analytic: spawn on the shield rim, stream up the wake, cool from white to red)
  {
    const n = 360, seed = new Float32Array(n * 4);
    let h = 12345;
    const rnd = () => ((h = (h * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < n; i++) seed.set([rnd(), rnd(), rnd(), rnd()], i * 4);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
    const m = new THREE.ShaderMaterial({
      uniforms: { ...u, uBase: { value: base }, uR: { value: shieldR }, uScale: { value: Math.min(window.devicePixelRatio, 2) } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      vertexShader: /* glsl */ `
        attribute vec4 aSeed; uniform float uTime, uBase, uR, uI, uScale; varying float vAge; varying float vK;
        void main(){
          float life = 0.55 + aSeed.z * 0.6;
          float age = fract(uTime / life + aSeed.w);
          float ang = aSeed.x * 6.2831853;
          float r = uR * (0.98 + 0.25 * age + 0.5 * age * age * aSeed.y);
          float y = uBase + 0.1 + age * (6.0 + 16.0 * aSeed.y) + age * age * 6.0;
          vec3 p = vec3(cos(ang) * r, y, sin(ang) * r);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          vAge = age; vK = aSeed.y;
          gl_PointSize = uScale * (2.0 + 5.0 * (1.0 - age)) * (14.0 / max(-mv.z, 1.0)) * step(0.02, uI);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uI; uniform vec3 uHot, uCool; varying float vAge; varying float vK;
        void main(){
          vec2 c = gl_PointCoord - 0.5; float d = length(c) * 2.0; if (d > 1.0) discard;
          float a = (1.0 - d * d) * (1.0 - vAge);
          vec3 col = mix(uHot * 3.0, uCool * 2.2, smoothstep(0.0, 0.45, vAge + vK * 0.2));
          gl_FragColor = vec4(col * a * uI, 1.0);
        }`,
    });
    geos.push(g); mats.push(m);
    const pts = new THREE.Points(g, m); pts.frustumCulled = false; pts.renderOrder = 27; group.add(pts);
  }
  // 5. halo sprite
  const haloTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const x = c.getContext('2d')!; const gr = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,190,120,.45)'); gr.addColorStop(1, 'rgba(255,120,60,0)');
    x.fillStyle = gr; x.fillRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const haloMat = new THREE.SpriteMaterial({ map: haloTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false, toneMapped: false });
  const halo = new THREE.Sprite(haloMat); halo.scale.setScalar(shieldR * 6); halo.position.y = base; halo.renderOrder = 23; group.add(halo);
  mats.push(haloMat);

  // keep the halo in step with the intensity
  const origI = u.uI;
  const api: Plasma = {
    group, u,
    dispose() { geos.forEach((g) => g.dispose()); mats.forEach((m) => m.dispose()); haloTex.dispose(); group.removeFromParent(); },
  };
  halo.onBeforeRender = () => { haloMat.color.setRGB(1.0, 0.42, 0.14).multiplyScalar(0.55 * origI.value); };
  return api;
}

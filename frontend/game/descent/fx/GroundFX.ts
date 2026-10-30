import * as THREE from 'three';
import type { PlanetKind } from '@terra/render/planets/PlanetSpec';
import { mulberry32 } from '../math';

/** Thruster-kicked dust / embers / spray. All motion is analytic in the vertex shader (deterministic, zero CPU per particle). */
export interface GroundFX {
  group: THREE.Group;
  /** pos = ground contact point under the pod; intensity 0..1; scale = px per world unit at depth 1. */
  update(time: number, pos: THREE.Vector3, intensity: number, pxScale: number): void;
  dispose(): void;
}
interface Layer {
  n: number; col: [number, number, number]; col2?: [number, number, number]; additive: boolean; size: [number, number]; speed: [number, number]; up: [number, number];
  gravity: number; life: number; alpha: number; soft: boolean; drag: number; spread: number;
}
const LAYERS: Record<PlanetKind, Layer[]> = {
  dune: [
    { n: 260, col: [0.78, 0.55, 0.32], col2: [0.95, 0.78, 0.5], additive: false, size: [2.5, 9], speed: [5, 15], up: [0.5, 3], gravity: -0.4, life: 3.2, alpha: 0.5, soft: true, drag: 0.7, spread: 1 },
    { n: 120, col: [1.0, 0.85, 0.6], additive: false, size: [0.5, 1.1], speed: [8, 20], up: [1, 5], gravity: 9, life: 1.6, alpha: 0.7, soft: false, drag: 0.4, spread: 1 },
  ],
  oceanForest: [
    { n: 240, col: [0.85, 0.95, 1.0], col2: [0.7, 0.88, 0.95], additive: false, size: [2, 7], speed: [4, 13], up: [0.5, 3], gravity: -0.2, life: 2.8, alpha: 0.38, soft: true, drag: 0.8, spread: 1 },
    { n: 220, col: [1.6, 1.9, 2.1], additive: true, size: [0.5, 1.0], speed: [6, 16], up: [4, 12], gravity: 11, life: 1.7, alpha: 0.85, soft: false, drag: 0.3, spread: 1 },
    { n: 60, col: [0.35, 0.5, 0.2], col2: [0.55, 0.4, 0.2], additive: false, size: [0.5, 0.9], speed: [5, 11], up: [2, 7], gravity: 3, life: 2.4, alpha: 0.9, soft: false, drag: 0.5, spread: 1 },
  ],
  forestRock: [
    { n: 230, col: [0.5, 0.47, 0.42], col2: [0.62, 0.6, 0.54], additive: false, size: [2.5, 8], speed: [4, 13], up: [0.5, 3], gravity: -0.3, life: 3.0, alpha: 0.5, soft: true, drag: 0.7, spread: 1 },
    { n: 90, col: [0.3, 0.45, 0.18], col2: [0.5, 0.36, 0.16], additive: false, size: [0.5, 0.9], speed: [5, 12], up: [2, 7], gravity: 3, life: 2.4, alpha: 0.9, soft: false, drag: 0.5, spread: 1 },
  ],
};

export function createGroundFX(kind: PlanetKind, seed: number): GroundFX {
  const group = new THREE.Group();
  const rnd = mulberry32(seed * 7 + 11);
  const tex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d')!; const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
  const mats: THREE.ShaderMaterial[] = [], geos: THREE.BufferGeometry[] = [];
  const shared = { uPos: { value: new THREE.Vector3() }, uTime: { value: 0 }, uI: { value: 0 }, uPx: { value: 800 } };
  for (const L of LAYERS[kind]) {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(L.n * 3), s = new Float32Array(L.n * 4);
    for (let i = 0; i < L.n * 4; i++) s[i] = rnd();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('aSeed', new THREE.BufferAttribute(s, 4));
    const mat = new THREE.ShaderMaterial({
      uniforms: { ...shared, uTex: { value: tex }, uC1: { value: new THREE.Color(...L.col) }, uC2: { value: new THREE.Color(...(L.col2 ?? L.col)) },
        uSize: { value: new THREE.Vector2(...L.size) }, uSpeed: { value: new THREE.Vector2(...L.speed) }, uUp: { value: new THREE.Vector2(...L.up) },
        uG: { value: L.gravity }, uLife: { value: L.life }, uAlpha: { value: L.alpha }, uDrag: { value: L.drag }, uSoft: { value: L.soft ? 1 : 0 } },
      transparent: true, depthWrite: false, blending: L.additive ? THREE.AdditiveBlending : THREE.NormalBlending, fog: false,
      vertexShader: /* glsl */ `
        attribute vec4 aSeed; uniform vec3 uPos; uniform float uTime, uI, uPx, uG, uLife, uDrag; uniform vec2 uSize, uSpeed, uUp;
        varying float vA; varying float vM;
        void main(){
          float ph = fract(aSeed.x + uTime / uLife); float age = ph * uLife;
          float ang = aSeed.y * 6.28318 + aSeed.z * 1.7; float spd = mix(uSpeed.x, uSpeed.y, aSeed.z);
          float horiz = spd * (1.0 - exp(-age * uDrag)) / uDrag;
          float vy = mix(uUp.x, uUp.y, aSeed.w);
          float y = vy * age - 0.5 * uG * age * age; y = max(y, 0.0);
          vec3 p = uPos + vec3(cos(ang) * horiz, 0.25 + y, sin(ang) * horiz);
          vec4 mv = viewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          float sz = mix(uSize.x, uSize.y, mix(aSeed.w, 1.0, ph) * (0.4 + 0.6 * ph));
          gl_PointSize = clamp(sz * uPx / max(-mv.z, 1.0), 1.0, 260.0);
          float on = step(aSeed.w * 0.999, uI * 1.0 + 0.0001) ; // thinning by intensity
          vA = on * uI * smoothstep(0.0, 0.07, ph) * pow(1.0 - ph, 1.4); vM = aSeed.z;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uTex; uniform vec3 uC1, uC2; uniform float uAlpha, uSoft; varying float vA; varying float vM;
        void main(){ float t = texture2D(uTex, gl_PointCoord).a; if (uSoft < 0.5) t = smoothstep(0.35, 0.8, t);
          float a = t * vA * uAlpha; if (a < 0.003) discard; gl_FragColor = vec4(mix(uC1, uC2, vM), a); }`,
    });
    // additive layers pre-multiply: handled by alpha in blend (SrcAlpha, One)
    const pts = new THREE.Points(geo, mat); pts.frustumCulled = false; pts.renderOrder = 30;
    group.add(pts); mats.push(mat); geos.push(geo);
  }
  group.visible = false;
  return {
    group,
    update(time, pos, intensity, pxScale) {
      shared.uTime.value = time; shared.uPos.value.copy(pos); shared.uI.value = intensity; shared.uPx.value = pxScale;
      group.visible = intensity > 0.002;
    },
    dispose() { tex.dispose(); mats.forEach((m) => m.dispose()); geos.forEach((g) => g.dispose()); group.removeFromParent(); },
  };
}

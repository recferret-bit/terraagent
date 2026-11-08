import * as THREE from 'three';

const SWIRL_TEX_SIZE = 256;
let sharedSwirlTex: THREE.DataTexture | null = null;

function wrapInt(n: number, period: number): number {
  return ((n % period) + period) % period;
}

function hashPeriodic(ix: number, iy: number, period: number, seed: number): number {
  const wx = wrapInt(ix, period);
  const wy = wrapInt(iy, period);
  const h = Math.sin(wx * 127.1 + wy * 311.7 + seed * 74.7) * 43758.5453123;
  return h - Math.floor(h);
}

function noisePeriodic(u: number, v: number, period: number, seed: number): number {
  const x = u * period;
  const y = v * period;
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hashPeriodic(ix, iy, period, seed);
  const b = hashPeriodic(ix + 1, iy, period, seed);
  const c = hashPeriodic(ix, iy + 1, period, seed);
  const d = hashPeriodic(ix + 1, iy + 1, period, seed);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

function fbmPeriodic(u: number, v: number, basePeriod: number, seed: number): number {
  let sum = 0;
  let amp = 0.5;
  let period = basePeriod;
  for (let i = 0; i < 4; i++) {
    sum += amp * noisePeriodic(u, v, period, seed + i * 19.3);
    period *= 2;
    amp *= 0.5;
  }
  return sum;
}

/**
 * Synthesizes and caches a tileable 256x256 RGBA DataTexture for the 3D Twister VFX:
 * - R: Multi-frequency turbulent cloud bands
 * - G: Diagonal helical vortex streaks (primary twist)
 * - B: Counter-shearing fibrous vortex ribbons (secondary twist)
 * - A: Fine high-frequency dust grain and turbulence
 */
export function getSharedTwisterSwirlTexture(): THREE.DataTexture {
  if (sharedSwirlTex) return sharedSwirlTex;
  const data = new Uint8Array(SWIRL_TEX_SIZE * SWIRL_TEX_SIZE * 4);
  const tau = Math.PI * 2;

  for (let py = 0; py < SWIRL_TEX_SIZE; py++) {
    const v = py / SWIRL_TEX_SIZE;
    for (let px = 0; px < SWIRL_TEX_SIZE; px++) {
      const u = px / SWIRL_TEX_SIZE;

      const cloudFbm = fbmPeriodic(u, v, 4, 1.1);
      const fineFbm = fbmPeriodic(u, v, 8, 7.9);
      const grainNoise = fbmPeriodic(u, v, 16, 23.4);

      const bandWave = 0.5 + 0.5 * Math.sin(v * tau * 3.0 + (cloudFbm - 0.5) * 3.4);
      const cloudBands = Math.max(0, Math.min(1, cloudFbm * 0.68 + bandWave * 0.32));

      const helixPhaseA = (u * 3.0 + v * 4.0) * tau + (cloudFbm - 0.5) * 4.2;
      const helixPhaseB = (u * 6.0 + v * 8.0) * tau + (fineFbm - 0.5) * 3.6;
      const helicalStreaks = Math.max(
        0,
        Math.min(1, (0.5 + 0.5 * Math.sin(helixPhaseA)) * 0.62 + (0.5 + 0.5 * Math.cos(helixPhaseB)) * 0.38),
      );

      const shearPhase = (u * 4.0 - v * 5.0) * tau + (fineFbm - 0.5) * 4.5;
      const counterFilaments = Math.max(
        0,
        Math.min(1, (0.5 + 0.5 * Math.sin(shearPhase)) * 0.58 + fineFbm * 0.42),
      );

      const dustGrain = Math.max(0, Math.min(1, grainNoise * 0.72 + fineFbm * 0.28));

      const idx = (py * SWIRL_TEX_SIZE + px) * 4;
      data[idx] = Math.round(cloudBands * 255);
      data[idx + 1] = Math.round(helicalStreaks * 255);
      data[idx + 2] = Math.round(counterFilaments * 255);
      data[idx + 3] = Math.round(dustGrain * 255);
    }
  }

  const tex = new THREE.DataTexture(data, SWIRL_TEX_SIZE, SWIRL_TEX_SIZE, THREE.RGBAFormat);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  sharedSwirlTex = tex;
  return tex;
}

/**
 * Evaluates the exact horizontal (X, Z) S-curve spine offset at normalized height `hRatio` (0..1),
 * matching the vertex shader so 3D debris chunks and sucked victims ride the bending funnel.
 */
export function spineOffsetAt(
  hRatio: number,
  time: number,
  bendX = 0,
  bendZ = 0,
): [number, number] {
  const h = Math.max(0, Math.min(1, hRatio));
  const spineEnv = Math.sin(h * Math.PI) * 0.85 + h * 0.45;
  const ox =
    (Math.sin(time * 2.7 - h * 4.8) * 0.55 + Math.cos(time * 1.4 + h * 7.2) * 0.22) * spineEnv +
    bendX * h * h;
  const oz =
    (Math.cos(time * 2.1 - h * 3.6) * 0.55 + Math.sin(time * 1.6 - h * 6.4) * 0.22) * spineEnv +
    bendZ * h * h;
  return [ox, oz];
}

const TWISTER_NOISE_GLSL = /* glsl */ `
float twHash(vec2 p) {
  p = fract(p * vec2(127.1, 311.7));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float twNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(twHash(i), twHash(i + vec2(1.0, 0.0)), f.x),
    mix(twHash(i + vec2(0.0, 1.0)), twHash(i + vec2(1.0, 1.0)), f.x),
    f.y
  );
}
float twFbm(vec2 p) {
  float val = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 4; i++) {
    val += amp * twNoise(p);
    p = p * 2.04 + vec2(1.9, -2.7);
    amp *= 0.5;
  }
  return val;
}
`;

const TWISTER_FUNNEL_VERT_GLSL = /* glsl */ `
uniform float uTime;
uniform float uFormProgress;
uniform float uDissolve;
uniform sampler2D uSwirlTex;
uniform float uBendX;
uniform float uBendZ;
uniform float uLayerSpeed;
uniform float uLayerTwist;

varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vViewDir;
varying float vRidge;

void main() {
  vUv = uv;
  float h = clamp(uv.y, 0.0, 1.0);

  float topFlare = pow(uv.y, 3.0) * 1.35;
  float footFlare = exp(-uv.y * 8.0) * 0.55;
  float formScale = mix(0.05, 1.0, clamp(uFormProgress, 0.0, 1.0));
  float dissolvePinch = mix(1.0, mix(0.28, 1.35, h), clamp(uDissolve, 0.0, 1.0));
  float profileFlare = (1.0 + topFlare + footFlare) * formScale * dissolvePinch;

  vec2 dispUv = vec2(
    uv.x * 2.0 + uv.y * uLayerTwist * 0.55 - uTime * uLayerSpeed * 0.42,
    uv.y * 2.2 - uTime * 0.48
  );
  vec4 swirlData = texture2D(uSwirlTex, dispUv);
  float ridgeWave = (swirlData.g - 0.5) * 0.48 + (swirlData.r - 0.5) * 0.34;
  vRidge = swirlData.g;

  vec3 radialDir = normalize(vec3(position.x, 0.0, position.z));
  vec3 pos = position;
  pos.xz *= profileFlare;
  pos += radialDir * ridgeWave * (0.28 + 0.55 * h) * formScale * dissolvePinch;

  float spineEnv = sin(uv.y * 3.14159265) * 0.85 + uv.y * 0.45;
  float wobbleX = (sin(uTime * 2.7 - uv.y * 4.8) * 0.55 + cos(uTime * 1.4 + uv.y * 7.2) * 0.22) * spineEnv + uBendX * uv.y * uv.y;
  float wobbleZ = (cos(uTime * 2.1 - uv.y * 3.6) * 0.55 + sin(uTime * 1.6 - uv.y * 6.4) * 0.22) * spineEnv + uBendZ * uv.y * uv.y;
  pos.x += wobbleX;
  pos.z += wobbleZ;

  vec4 worldPos = modelMatrix * vec4(pos, 1.0);
  vNormal = normalize(mat3(modelMatrix) * normal);
  vViewDir = normalize(cameraPosition - worldPos.xyz);
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

const TWISTER_FUNNEL_FRAG_GLSL = /* glsl */ `
uniform float uTime;
uniform float uFormProgress;
uniform float uDissolve;
uniform sampler2D uSwirlTex;
uniform float uLayerSpeed;
uniform float uLayerTwist;
uniform float uOpacity;
uniform vec3 uColorBottom;
uniform vec3 uColorTop;

varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vViewDir;
varying float vRidge;

${TWISTER_NOISE_GLSL}

void main() {
  vec2 helicalUv1 = vec2(
    vUv.x * 2.0 + vUv.y * uLayerTwist - uTime * uLayerSpeed,
    vUv.y * 2.5 - uTime * 0.65
  );
  vec2 helicalUv2 = vec2(
    vUv.x * 4.0 - vUv.y * (uLayerTwist * 1.35) + uTime * (uLayerSpeed * 0.72),
    vUv.y * 4.8 - uTime * 1.12
  );

  vec4 texA = texture2D(uSwirlTex, helicalUv1);
  vec4 texB = texture2D(uSwirlTex, helicalUv2);
  float procTurb = twFbm(helicalUv1 * 2.4 + vec2(texA.r * 0.65, -uTime * 0.45));

  float helicalCombined = texA.g * 0.46 + texB.b * 0.32 + procTurb * 0.22;
  float cloudRibbons = smoothstep(0.24, 0.78, helicalCombined);
  float dustFilaments = smoothstep(0.36, 0.86, texA.r * 0.55 + texB.a * 0.45);
  float density = clamp(cloudRibbons * 0.68 + dustFilaments * 0.48, 0.0, 1.0);

  float fresnel = pow(1.0 - abs(dot(normalize(vNormal), normalize(vViewDir))), 1.2);
  float edgeFeather = clamp(1.0 - fresnel, 0.0, 1.0);
  float silhouetteFade = smoothstep(0.0, 0.62, edgeFeather) * mix(1.0, 0.35, fresnel);

  float bottomAlpha = smoothstep(0.0, 0.08, vUv.y);
  float topAlpha = 1.0 - smoothstep(0.78, 1.0, vUv.y);
  float appearFade = smoothstep(0.0, 0.35, uFormProgress);
  float appearMask = smoothstep(0.0, 0.28, uFormProgress * 1.25 - vUv.y * 0.85);
  float erode = smoothstep(uDissolve * 0.92, min(1.0, uDissolve * 0.92 + 0.35), helicalCombined);
  float bottomLift = smoothstep(uDissolve * 0.55, uDissolve * 0.55 + 0.18, vUv.y);
  float dissolveFade = (1.0 - smoothstep(0.0, 1.0, uDissolve)) * erode * bottomLift;

  float heightGrad = smoothstep(0.04, 0.76, vUv.y);
  vec3 baseCol = mix(uColorBottom, uColorTop, heightGrad);
  vec3 ridgeHighlight = mix(uColorBottom * 1.25, uColorTop * 1.32, heightGrad);
  vec3 col = mix(baseCol * 0.74, ridgeHighlight, clamp(cloudRibbons * 0.75 + vRidge * 0.25, 0.0, 1.0));

  float stormFlash = pow(max(0.0, sin(uTime * 3.8 + vUv.y * 6.0 + texA.g * 4.0)), 6.0) * 0.22;
  col += vec3(0.38, 0.48, 0.62) * (fresnel * 0.28 + stormFlash * heightGrad);

  float alpha = density * silhouetteFade * bottomAlpha * topAlpha * appearFade * appearMask * dissolveFade * uOpacity;
  if (alpha < 0.005) discard;
  gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
}
`;

const TWISTER_SKIRT_VERT_GLSL = /* glsl */ `
uniform float uTime;
uniform float uFormProgress;
uniform float uDissolve;
uniform sampler2D uSwirlTex;

varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vViewDir;

void main() {
  vUv = uv;
  vec2 swirlUv = vec2(uv.x * 2.0 - uTime * 1.85, uv.y * 1.8 - uTime * 0.75);
  vec4 swirl = texture2D(uSwirlTex, swirlUv);
  float billow = (swirl.r - 0.45) * 0.55 + (swirl.g - 0.5) * 0.38;

  vec3 radial = normalize(vec3(position.x, 0.0, position.z));
  float formScale = mix(0.08, 1.0, clamp(uFormProgress, 0.0, 1.0)) * mix(1.0, 1.25, clamp(uDissolve, 0.0, 1.0));
  vec3 pos = position;
  pos.xz *= formScale;
  pos += radial * billow * (0.35 + (1.0 - uv.y) * 0.55) * formScale;
  pos.y += sin(uTime * 5.2 + uv.x * 18.8495) * 0.12 * (1.0 - uv.y);

  vec4 worldPos = modelMatrix * vec4(pos, 1.0);
  vNormal = normalize(mat3(modelMatrix) * normal);
  vViewDir = normalize(cameraPosition - worldPos.xyz);
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

const TWISTER_SKIRT_FRAG_GLSL = /* glsl */ `
uniform float uTime;
uniform float uFormProgress;
uniform float uDissolve;
uniform sampler2D uSwirlTex;
uniform float uOpacity;
uniform vec3 uColorSoil;
uniform vec3 uColorMist;

varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vViewDir;

${TWISTER_NOISE_GLSL}

void main() {
  vec2 uvA = vec2(vUv.x * 3.0 - uTime * 2.4, vUv.y * 2.2 - uTime * 0.9);
  vec2 uvB = vec2(vUv.x * 5.0 + uTime * 1.7, vUv.y * 3.5 - uTime * 1.3);
  vec4 texA = texture2D(uSwirlTex, uvA);
  vec4 texB = texture2D(uSwirlTex, uvB);
  float boil = twFbm(uvA * 2.2 + vec2(texA.g, -uTime * 0.8));

  float plume = smoothstep(0.22, 0.82, texA.r * 0.45 + texB.g * 0.35 + boil * 0.32);
  float fresnel = pow(1.0 - abs(dot(normalize(vNormal), normalize(vViewDir))), 1.2);
  float edgeFade = smoothstep(0.0, 0.55, clamp(1.0 - fresnel, 0.0, 1.0));

  float bottomFade = smoothstep(0.0, 0.14, vUv.y);
  float topFade = 1.0 - smoothstep(0.52, 1.0, vUv.y);
  float appearFade = smoothstep(0.0, 0.45, uFormProgress);
  float skirtErode = smoothstep(uDissolve * 0.85, min(1.0, uDissolve * 0.85 + 0.35), boil);
  float dissolveFade = (1.0 - smoothstep(0.0, 1.0, uDissolve)) * skirtErode;
  vec3 col = mix(uColorSoil, uColorMist, clamp(vUv.y * 0.65 + plume * 0.35, 0.0, 1.0));

  float alpha = plume * edgeFade * bottomFade * topFade * appearFade * dissolveFade * uOpacity;
  if (alpha < 0.005) discard;
  gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
}
`;

export interface TwisterFunnelMaterialOpts {
  layer: 'outer' | 'mid' | 'inner';
}

const LAYER_CONFIG: Record<
  TwisterFunnelMaterialOpts['layer'],
  { speed: number; twist: number; opacity: number; bottomHex: number; topHex: number }
> = {
  outer: { speed: 1.35, twist: 3.2, opacity: 0.62, bottomHex: 0x5c4b3b, topHex: 0x6c7a89 },
  mid: { speed: 1.9, twist: -4.6, opacity: 0.78, bottomHex: 0x47392c, topHex: 0x505c6a },
  inner: { speed: 2.6, twist: 6.1, opacity: 0.9, bottomHex: 0x33281e, topHex: 0x38424e },
};

export function createTwisterFunnelMaterial(opts: TwisterFunnelMaterialOpts): THREE.ShaderMaterial {
  const cfg = LAYER_CONFIG[opts.layer];
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uFormProgress: { value: 0 },
      uDissolve: { value: 0 },
      uSwirlTex: { value: getSharedTwisterSwirlTexture() },
      uBendX: { value: 0 },
      uBendZ: { value: 0 },
      uLayerSpeed: { value: cfg.speed },
      uLayerTwist: { value: cfg.twist },
      uOpacity: { value: cfg.opacity },
      uColorBottom: { value: new THREE.Color(cfg.bottomHex) },
      uColorTop: { value: new THREE.Color(cfg.topHex) },
    },
    vertexShader: TWISTER_FUNNEL_VERT_GLSL,
    fragmentShader: TWISTER_FUNNEL_FRAG_GLSL,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  return mat;
}

export function createTwisterDustSkirtMaterial(): THREE.ShaderMaterial {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uFormProgress: { value: 0 },
      uDissolve: { value: 0 },
      uSwirlTex: { value: getSharedTwisterSwirlTexture() },
      uOpacity: { value: 0.82 },
      uColorSoil: { value: new THREE.Color(0x4b3b2c) },
      uColorMist: { value: new THREE.Color(0x68727c) },
    },
    vertexShader: TWISTER_SKIRT_VERT_GLSL,
    fragmentShader: TWISTER_SKIRT_FRAG_GLSL,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  return mat;
}

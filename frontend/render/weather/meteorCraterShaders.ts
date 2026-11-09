import * as THREE from 'three';
import { getWeatherUniforms } from '../core/weatherConfig';
import { COLONY_VISION_AND_LIGHTS_GLSL, getColonyVisionUniforms } from '../lighting/ColonyVisionAndLights';

const CRATER_TEX_SIZE = 256;
let sharedCraterTex: THREE.DataTexture | null = null;

function hash2(x: number, y: number): number {
  const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return h - Math.floor(h);
}

function vnoise2(x: number, y: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy), b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1), d = hash2(ix + 1, iy + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

function fbmCpu(x: number, y: number): number {
  let v = 0, amp = 0.5, freq = 1;
  for (let i = 0; i < 4; i++) {
    v += amp * vnoise2(x * freq, y * freq);
    freq *= 2.05;
    amp *= 0.5;
  }
  return v;
}

/**
 * Synthesizes and caches a 256x256 RGBA DataTexture for meteor craters:
 * - R: Multi-octave scorched ejecta & ash variation
 * - G: Radial + branching tectonic crack intensity mask
 * - B: Central melted magma pit & vitrified obsidian ring pattern
 * - A: Feathered organic outer apron alpha mask
 */
export function getSharedCraterTexture(): THREE.DataTexture {
  if (sharedCraterTex) return sharedCraterTex;
  const data = new Uint8Array(CRATER_TEX_SIZE * CRATER_TEX_SIZE * 4);
  for (let py = 0; py < CRATER_TEX_SIZE; py++) {
    for (let px = 0; px < CRATER_TEX_SIZE; px++) {
      const u = (px / (CRATER_TEX_SIZE - 1)) * 2 - 1;
      const v = (py / (CRATER_TEX_SIZE - 1)) * 2 - 1;
      const r = Math.hypot(u, v);
      const ang = Math.atan2(v, u);
      const n1 = fbmCpu(u * 4.5 + 3.1, v * 4.5 - 1.7);
      const n2 = fbmCpu(u * 9.5 - 4.2, v * 9.5 + 2.3);
      const radialWave = Math.abs(Math.sin(ang * 9 + n1 * 4.2));
      const radialBranch = Math.abs(Math.sin(ang * 17 - r * 8 + n2 * 5.0));
      const crackMask =
        Math.max(0, 1 - radialWave * 3.8) * 0.7 +
        Math.max(0, 1 - radialBranch * 4.5) * 0.55;
      const crackEnv = r > 0.14 && r < 0.9 ? Math.sin(((r - 0.14) / 0.76) * Math.PI) : 0;
      const pitMask = Math.max(0, Math.min(1, (0.38 - r) / 0.38));
      const apronNoise = (n1 - 0.5) * 0.24 + (n2 - 0.5) * 0.12;
      const alpha = Math.max(0, Math.min(1, (0.96 - (r + apronNoise)) / 0.34));
      const idx = (py * CRATER_TEX_SIZE + px) * 4;
      data[idx] = Math.round(Math.max(0, Math.min(1, n1 * 0.65 + n2 * 0.35)) * 255);
      data[idx + 1] = Math.round(Math.max(0, Math.min(1, crackMask * crackEnv * 1.35)) * 255);
      data[idx + 2] = Math.round(Math.max(0, Math.min(1, pitMask * (0.65 + 0.35 * n2))) * 255);
      data[idx + 3] = Math.round(alpha * alpha * (3 - 2 * alpha) * 255);
    }
  }
  const tex = new THREE.DataTexture(data, CRATER_TEX_SIZE, CRATER_TEX_SIZE, THREE.RGBAFormat);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  sharedCraterTex = tex;
  return tex;
}

/**
 * Conforms a subdivided PlaneGeometry(2, 2, segs, segs).rotateX(-PI/2) to terrain height.
 * Because X and Z stay in [-1, 1] while the mesh is scaled by (radius, 1, radius),
 * every vertex follows hills, cliffs, and depressions with zero black triangles.
 */
export function conformTerrainGrid(
  geo: THREE.BufferGeometry, centerX: number, centerY: number, centerZ: number,
  radius: number, yOffset: number, heightAt?: (x: number, z: number) => number, pitDepth = 0, computeNormals = true,
): void {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const ux = pos.getX(i), uz = pos.getZ(i);
    const groundY = heightAt ? heightAt(centerX + ux * radius, centerZ + uz * radius) - centerY : 0;
    const r2 = ux * ux + uz * uz;
    const pit = pitDepth > 0 && r2 < 0.14 ? -pitDepth * (1 - r2 / 0.14) : 0;
    pos.setY(i, groundY + yOffset + pit);
  }
  pos.needsUpdate = true;
  if (computeNormals) geo.computeVertexNormals();
}

export function buildDrapedReticleRing(
  radius: number, tube: number, segs: number, target: THREE.Vector3, heightAt?: (x: number, z: number) => number,
): THREE.BufferGeometry {
  const geo = new THREE.TorusGeometry(radius, tube, 6, segs).rotateX(Math.PI / 2);
  if (heightAt) {
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const groundY = heightAt(target.x + pos.getX(i), target.z + pos.getZ(i)) - target.y;
      pos.setY(i, pos.getY(i) + groundY + 0.16);
    }
    pos.needsUpdate = true;
  }
  return geo;
}

export const NOISE_GLSL = /* glsl */ `
float mcHash(vec2 p) {
  p = fract(p * vec2(127.1, 311.7));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float mcNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mcHash(i), mcHash(i + vec2(1.0, 0.0)), f.x),
    mix(mcHash(i + vec2(0.0, 1.0)), mcHash(i + vec2(1.0, 1.0)), f.x),
    f.y
  );
}
float mcFbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * mcNoise(p);
    p = p * 2.07 + vec2(1.7, -2.3);
    a *= 0.5;
  }
  return v;
}
float mcVoronoiEdge(vec2 x) {
  vec2 n = floor(x), f = fract(x);
  float md1 = 8.0, md2 = 8.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 o = vec2(mcHash(n + g), mcHash(n + g + vec2(13.7, 29.3)));
      vec2 r = g + o - f;
      float d = dot(r, r);
      if (d < md1) { md2 = md1; md1 = d; }
      else if (d < md2) { md2 = d; }
    }
  }
  return sqrt(md2) - sqrt(md1);
}
`;

const LOCAL_UV_VERT_GLSL = /* glsl */ `
  varying vec2 vLocalUv;
  void main() {
    vLocalUv = position.xz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const CRATER_ROCK_VERT_GLSL = /* glsl */ `
  varying vec3 vLocalPos;
  varying vec3 vNormalW;
  varying vec3 vWorldPos;
  void main() {
    vLocalPos = position;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vec4 worldPos4 = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPos4.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPos4;
  }
`;

export const CRATER_LIGHTING_GLSL = /* glsl */ `
${COLONY_VISION_AND_LIGHTS_GLSL}
uniform float uStormDarkness;

float evalColonyFovVisibility(vec3 worldPos) {
  return uFovEnabled > 0.001 ? mix(1.0, evalColonyFovMask(worldPos).x, clamp(uFovEnabled, 0.0, 1.0)) : 1.0;
}

void evalCraterIlluminationWithFov(vec3 worldPos, vec3 worldNorm, float fovVis, out float dayAmb, out vec3 taProj) {
  float nightClamped = clamp(uNightFactor, 0.0, 1.0);
  float stormClamped = clamp(uStormDarkness, 0.0, 1.0);
  float solarCurve = pow(clamp(1.0 - nightClamped, 0.0, 1.0), 0.58);
  float deepNightCutoff = 1.0 - smoothstep(0.88, 0.98, nightClamped);
  dayAmb = (solarCurve * 0.96 + 0.04 * deepNightCutoff) * (1.0 - stormClamped * 0.52) * deepNightCutoff;
  taProj = evalColonyProjectorLight(worldPos, worldNorm) * fovVis;
}

void evalCraterIllumination(vec3 worldPos, vec3 worldNorm, out float dayAmb, out vec3 taProj, out float fovVis) {
  fovVis = evalColonyFovVisibility(worldPos);
  evalCraterIlluminationWithFov(worldPos, worldNorm, fovVis, dayAmb, taProj);
}

vec3 litCraterSurface(vec3 albedo, float specFill, float dayAmb, vec3 taProj) {
  vec3 dayLinear = albedo * dayAmb;
  vec3 daySrgb = mix(dayLinear, pow(max(dayLinear, vec3(0.0)), vec3(0.72)), 0.65);
  vec3 projLinear = albedo * taProj * 1.35 + taProj * specFill;
  vec3 projSrgb = pow(max(projLinear, vec3(0.0)), vec3(0.4545));
  return daySrgb + projSrgb;
}
`;

export function createEclipseShadowMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uOpacity: { value: 0.88 },
      uTime: { value: 0 },
    },
    vertexShader: LOCAL_UV_VERT_GLSL,
    fragmentShader: /* glsl */ `
      uniform float uOpacity;
      uniform float uTime;
      varying vec2 vLocalUv;
      ${NOISE_GLSL}
      void main() {
        float r = length(vLocalUv);
        if (r > 1.0) discard;
        float wisp = (mcFbm(vLocalUv * 3.6 + vec2(uTime * 0.18, -uTime * 0.14)) - 0.5) * 0.08;
        float rw = clamp(r + wisp * smoothstep(0.2, 0.9, r), 0.0, 1.0);
        float alpha = uOpacity * smoothstep(1.0, 0.18, rw);
        vec3 col = mix(vec3(0.02, 0.01, 0.04), vec3(0.18, 0.04, 0.01), smoothstep(0.45, 0.95, rw));
        gl_FragColor = vec4(col, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    side: THREE.DoubleSide,
  });
}

export function createBlastCarpetMaterial(): THREE.ShaderMaterial {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uProgress: { value: 0 },
      uTime: { value: 0 },
      uOpacity: { value: 1 },
    },
    vertexShader: LOCAL_UV_VERT_GLSL,
    fragmentShader: /* glsl */ `
      uniform float uProgress;
      uniform float uTime;
      uniform float uOpacity;
      varying vec2 vLocalUv;
      ${NOISE_GLSL}
      void main() {
        float r = length(vLocalUv);
        if (r > 1.0) discard;
        float ang = atan(vLocalUv.y, vLocalUv.x);
        float turb = mcFbm(vec2(ang * 3.8, r * 6.5 - uTime * 4.2));
        float streaks = mcFbm(vec2(ang * 9.5 + turb * 1.4, r * 3.5 - uProgress * 5.0));
        float front = uProgress * 0.92;
        float dr = r - (front + (turb - 0.5) * 0.16);
        float shockWall = smoothstep(0.16, 0.0, abs(dr)) * smoothstep(0.02, 0.1, r);
        float centerHole = smoothstep(0.15, 0.55, r);
        float wake = smoothstep(front + 0.06, 0.0, r) * (1.0 - uProgress * 0.72) * (0.3 + 0.7 * streaks) * centerHole;
        vec3 hotCore = vec3(4.8, 2.1, 0.52);
        vec3 fireMid = vec3(3.4, 0.78, 0.12);
        vec3 ashEdge = vec3(0.65, 0.12, 0.03);
        vec3 col = mix(ashEdge, fireMid, clamp(wake * 1.3, 0.0, 1.0)) + hotCore * shockWall;
        float alpha = (shockWall * 0.95 + wake * 0.55) * uOpacity * smoothstep(1.0, 0.8, r);
        if (alpha < 0.01) discard;
        gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
      }
    `,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -3,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  mat.userData.waterReflect = true;
  return mat;
}

export function createFireballPlumeMaterial(): THREE.ShaderMaterial {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uProgress: { value: 0 },
      uTime: { value: 0 },
      uOpacity: { value: 1 },
    },
    vertexShader: /* glsl */ `
      uniform float uProgress;
      uniform float uTime;
      varying float vHeat;
      varying vec3 vNormalW;
      varying vec3 vViewDir;
      void main() {
        vec3 p = position;
        float lobe1 = sin(p.x * 4.5 + uTime * 5.2) * cos(p.y * 3.9 - uTime * 4.6) * sin(p.z * 4.3 + uTime * 3.8);
        float lobe2 = sin(p.x * 8.2 - uTime * 6.5) * cos(p.z * 7.8 + uTime * 5.4) * 0.5;
        float billow = 0.5 + 0.5 * sin(p.y * 5.5 - uTime * 6.0 + (lobe1 + lobe2) * 2.2);
        float capExpand = smoothstep(-0.2, 0.7, p.y) * uProgress * 0.42;
        vec3 displaced = p + normal * (0.16 + 0.28 * billow + capExpand);
        displaced.y = max(-0.08, displaced.y + max(0.0, p.y) * uProgress * 0.55);
        vec4 worldPos = modelMatrix * vec4(displaced, 1.0);
        vNormalW = normalize(mat3(modelMatrix) * normal);
        vViewDir = normalize(cameraPosition - worldPos.xyz);
        vHeat = clamp(1.05 - uProgress * 0.78 + (lobe1 + lobe2) * 0.38 - max(0.0, p.y) * 0.22, 0.0, 1.0);
        gl_Position = projectionMatrix * viewMatrix * worldPos;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uOpacity;
      varying float vHeat;
      varying vec3 vNormalW;
      varying vec3 vViewDir;
      void main() {
        float fresnel = pow(1.0 - max(0.0, dot(normalize(vNormalW), normalize(vViewDir))), 2.5);
        vec3 darkAsh = vec3(0.07, 0.06, 0.065);
        vec3 crimsonFissure = vec3(2.5, 0.36, 0.05);
        vec3 blindingMagma = vec3(5.2, 2.2, 0.48);
        vec3 col = mix(darkAsh, crimsonFissure, smoothstep(0.18, 0.58, vHeat));
        col = mix(col, blindingMagma, smoothstep(0.58, 0.92, vHeat));
        col += vec3(3.2, 0.85, 0.15) * fresnel * vHeat * 0.65;
        gl_FragColor = vec4(col, uOpacity);
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,
    toneMapped: false,
  });
  mat.userData.waterReflect = true;
  return mat;
}

const CRATER_DECAL_FRAG_GLSL = /* glsl */ `
  uniform sampler2D uCraterMap;
  uniform float uTime, uOpacity, uHeatGlow;
  varying vec2 vLocalUv, vUv;
  varying vec3 vWorldPos;
  ${NOISE_GLSL}
  ${CRATER_LIGHTING_GLSL}
  void main() {
    float r = length(vLocalUv);
    if (r > 1.0) discard;
    float fovVis = evalColonyFovVisibility(vWorldPos);
    if (fovVis <= 0.001) discard;
    vec4 tex = texture2D(uCraterMap, vUv);
    float fbm = mcFbm(vLocalUv * 5.2);
    float ang = atan(vLocalUv.y, vLocalUv.x);
    float pulse = 0.5 + 0.5 * sin(uTime * 2.6 - r * 7.0 + fbm * 4.0);
    vec2 radDir = r > 1e-3 ? vLocalUv / r : vec2(0.0);
    float slopeR = smoothstep(0.05, 0.36, r) * (1.0 - smoothstep(0.36, 0.58, r)) * -0.55 + (r - 0.58) * smoothstep(0.42, 0.85, r) * 1.1;
    vec3 craterNorm = normalize(vec3(radDir.x * slopeR, 1.0, radDir.y * slopeR));
    float dayAmb;
    vec3 taProj;
    evalCraterIlluminationWithFov(vWorldPos, craterNorm, fovVis, dayAmb, taProj);

    float pitFactor = smoothstep(0.34, 0.08, r + (fbm - 0.5) * 0.06);
    float magmaPool = smoothstep(0.42, 0.68, mcFbm(vLocalUv * 7.5 + vec2(uTime * 0.22 * max(0.15, uHeatGlow), -uTime * 0.18 * max(0.15, uHeatGlow))));
    float obsidianRing = smoothstep(0.12, 0.0, abs(r - 0.28 + (fbm - 0.5) * 0.05));
    float pitHeat = clamp(uHeatGlow * 1.18 - r * 0.32, 0.0, 1.0);
    vec3 pitAlbedo = mix(vec3(0.025, 0.028, 0.036), vec3(0.28, 0.30, 0.35), obsidianRing);
    vec3 cooledPit = litCraterSurface(pitAlbedo, 0.015 + 0.085 * obsidianRing, dayAmb, taProj);
    vec3 moltenPit = mix(cooledPit, vec3(1.15, 0.14, 0.02), smoothstep(0.0, 0.42, pitHeat));
    moltenPit = mix(moltenPit, vec3(3.8, 0.85, 0.12) * (0.85 + 0.3 * pulse), smoothstep(0.38, 0.95, pitHeat));
    vec3 pitColor = mix(cooledPit, moltenPit, magmaPool * smoothstep(0.32, 0.04, r));

    float vorEdge = mcVoronoiEdge(vLocalUv * 6.2 + fbm * 0.65);
    float radialCrack = abs(sin(ang * 8.0 + fbm * 3.5));
    float cellCrack = smoothstep(0.09, 0.01, vorEdge);
    float branchCrack = smoothstep(0.14, 0.02, radialCrack) * smoothstep(0.18, 0.04, vorEdge * 0.8);
    float crackZone = smoothstep(0.16, 0.28, r) * smoothstep(0.92, 0.42, r);
    float crackMask = clamp((cellCrack * 0.85 + branchCrack * 0.9 + tex.g * 0.55) * crackZone, 0.0, 1.0);
    float crackLip = smoothstep(0.18, 0.07, vorEdge) * (1.0 - cellCrack) * crackZone;
    float crackHeat = clamp(uHeatGlow * 1.32 - r * 0.48, 0.0, 1.0);
    vec3 cooledCrack = litCraterSurface(vec3(0.012, 0.012, 0.018), 0.002, dayAmb, taProj);
    vec3 hotCrack = mix(vec3(2.8, 0.55, 0.06), vec3(4.2, 1.4, 0.2), pulse);
    vec3 crackGlow = mix(cooledCrack, vec3(0.95, 0.09, 0.015), smoothstep(0.0, 0.45, crackHeat));
    crackGlow = mix(crackGlow, hotCrack, smoothstep(0.40, 0.95, crackHeat));

    float rimRidge = smoothstep(0.22, 0.0, abs(r - 0.58 + (fbm - 0.5) * 0.08));
    float ridgeMix = clamp(fbm * 0.48 + rimRidge * 0.52 + crackLip * 0.55, 0.0, 1.0);
    vec3 crustAlbedo = mix(vec3(0.13, 0.125, 0.145), vec3(0.35, 0.32, 0.30), ridgeMix);
    crustAlbedo = mix(crustAlbedo, vec3(0.28, 0.30, 0.33), smoothstep(0.52, 0.88, r) * 0.65);
    vec3 basaltCrust = litCraterSurface(crustAlbedo, 0.028 + 0.055 * rimRidge + 0.05 * crackLip, dayAmb, taProj);
    basaltCrust += vec3(0.24, 0.06, 0.01) * (uHeatGlow * smoothstep(0.85, 0.15, r) * 0.45);
    vec3 col = mix(mix(basaltCrust, crackGlow, crackMask), pitColor, pitFactor) * fovVis;
    col = mix(col, applyColonyFovShroud(vWorldPos, col), 1.0 - smoothstep(0.05, 0.5, uHeatGlow));

    float apronAlpha = smoothstep(1.0, 0.62, r + (fbm - 0.5) * 0.18) * tex.a;
    float alpha = clamp(max(apronAlpha, smoothstep(0.78, 0.46, r)), 0.0, 1.0) * uOpacity * fovVis;
    if (alpha < 0.01) discard;
    gl_FragColor = vec4(col, alpha);
  }
`;

export function createCraterDecalMaterial(): THREE.ShaderMaterial {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      ...getColonyVisionUniforms(),
      ...getWeatherUniforms(),
      uCraterMap: { value: getSharedCraterTexture() },
      uTime: { value: 0 },
      uOpacity: { value: 1 },
      uHeatGlow: { value: 1 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vLocalUv, vUv;
      varying vec3 vWorldPos;
      void main() {
        vLocalUv = position.xz;
        vUv = position.xz * 0.5 + 0.5;
        vec4 worldPos4 = modelMatrix * vec4(position, 1.0);
        vWorldPos = worldPos4.xyz;
        gl_Position = projectionMatrix * viewMatrix * worldPos4;
      }
    `,
    fragmentShader: CRATER_DECAL_FRAG_GLSL,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  mat.userData.waterReflect = true;
  return mat;
}

export function createCraterRockMaterial(bodyGlsl: string): THREE.ShaderMaterial {
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...getColonyVisionUniforms(), ...getWeatherUniforms(), uTime: { value: 0 }, uOpacity: { value: 1 }, uHeatGlow: { value: 1 } },
    vertexShader: CRATER_ROCK_VERT_GLSL,
    fragmentShader: /* glsl */ `
      uniform float uTime, uOpacity, uHeatGlow;
      varying vec3 vLocalPos, vNormalW, vWorldPos;
      ${NOISE_GLSL}
      ${CRATER_LIGHTING_GLSL}
      void main() {
        float fovVis = evalColonyFovVisibility(vWorldPos);
        if (fovVis <= 0.001) discard;
        float dayAmb;
        vec3 taProj;
        evalCraterIlluminationWithFov(vWorldPos, normalize(vNormalW), fovVis, dayAmb, taProj);
        ${bodyGlsl}
        col *= fovVis;
        col = mix(col, applyColonyFovShroud(vWorldPos, col), 1.0 - smoothstep(0.05, 0.5, uHeatGlow));
        float alpha = uOpacity * fovVis;
        if (alpha < 0.01) discard;
        gl_FragColor = vec4(col, alpha);
      }
    `,
    transparent: true, depthWrite: true, toneMapped: false,
  });
  mat.userData.waterReflect = true;
  return mat;
}

export function createMeteoriteCoreMaterial(): THREE.ShaderMaterial {
  return createCraterRockMaterial(/* glsl */ `
    float vein = mcVoronoiEdge(vLocalPos.xz * 3.8 + vLocalPos.y * 2.4);
    float glowMask = smoothstep(0.11, 0.015, vein);
    float pulse = 0.75 + 0.25 * sin(uTime * 3.2 + vLocalPos.y * 4.0);
    float topLit = 0.55 + 0.45 * max(0.0, vNormalW.y);
    float underLit = clamp(0.65 - vLocalPos.y * 0.45, 0.0, 1.0);
    vec3 ironCrust = litCraterSurface(vec3(0.32, 0.30, 0.36) * topLit, 0.065 * topLit, dayAmb, taProj) + vec3(0.55, 0.16, 0.03) * (underLit * uHeatGlow * 0.65);
    vec3 cooledVein = litCraterSurface(vec3(0.05, 0.05, 0.07), 0.01, dayAmb, taProj);
    vec3 magmaVein = mix(cooledVein, vec3(0.95, 0.11, 0.015), smoothstep(0.0, 0.45, uHeatGlow));
    magmaVein = mix(magmaVein, vec3(3.6, 0.92, 0.14) * pulse, smoothstep(0.38, 0.95, uHeatGlow));
    vec3 col = mix(ironCrust, magmaVein, glowMask);
  `);
}

export function createCraterBoulderMaterial(): THREE.ShaderMaterial {
  return createCraterRockMaterial(/* glsl */ `
    float grain = mcFbm(vLocalPos.xz * 4.2 + vLocalPos.y * 3.1);
    float vein = mcVoronoiEdge(vLocalPos.xz * 4.8 - vLocalPos.y * 2.8);
    float fissure = smoothstep(0.075, 0.012, vein) * clamp(0.75 - vLocalPos.y * 0.5, 0.0, 1.0);
    float topLit = 0.48 + 0.52 * max(0.0, vNormalW.y);
    float sideGlow = clamp(0.72 - vNormalW.y * 0.45, 0.0, 1.0) * clamp(0.85 - vLocalPos.y * 0.4, 0.0, 1.0);
    float flicker = 0.88 + 0.12 * sin(uTime * 4.5 + vLocalPos.x * 3.0);
    vec3 rockAlbedo = mix(vec3(0.24, 0.22, 0.26), vec3(0.44, 0.41, 0.39), grain) * topLit;
    vec3 basalt = litCraterSurface(rockAlbedo, 0.055 * topLit, dayAmb, taProj);
    vec3 warmBounce = vec3(1.35, 0.38, 0.06) * (sideGlow * uHeatGlow * flicker);
    vec3 cooledFissure = litCraterSurface(vec3(0.04, 0.04, 0.055), 0.008, dayAmb, taProj);
    vec3 fissureGlow = mix(cooledFissure, vec3(2.4, 0.52, 0.07) * flicker, smoothstep(0.05, 0.85, uHeatGlow));
    vec3 col = mix(basalt + warmBounce, fissureGlow, fissure);
  `);
}

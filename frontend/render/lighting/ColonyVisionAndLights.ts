import * as THREE from 'three';
import { HEX_DIRS, hexIndex } from '@terra/sim/grid/hex';
import { planetExtent, tileAt } from '../planets/hex/hexMath';
import { getViewFocus, inViewFocus } from '../core/viewFocus';

/** Projectors uploaded to the GPU (the per-fragment loop length): the nearest ones lighting the view focus. */
export const MAX_COLONY_PROJECTORS = 32;
/** How many projector candidates a caller may hand to `updateColonyProjectorsAndVision` (whole colony). */
export const MAX_PROJECTOR_CANDIDATES = 256;
export const MAX_VISION_SOURCES = 16;
const VISION_TEX_SIZE = 128;

export interface ColonyProjectorDesc {
  x: number;
  y: number;
  z: number;
  range: number;
  dirX: number;
  dirY: number;
  dirZ: number;
  /** Cosine of outer spotlight half-angle (e.g. 0.76 for ~40°), or -1 for omnidirectional floodlight. */
  cosAngle: number;
  r: number;
  g: number;
  b: number;
  intensity: number;
}

export interface ColonyVisionSourceDesc {
  x: number;
  z: number;
  innerRadius: number;
  outerRadius: number;
}

export interface ColonyVisionTextureInput {
  radius: number;
  colonyIndex: number;
  owner?: ArrayLike<number>;
  explored?: ArrayLike<number>;
  baseCenters?: ReadonlyArray<{ x: number; z: number; innerRadius: number; outerRadius: number }>;
}

const visionData = new Uint8Array(VISION_TEX_SIZE * VISION_TEX_SIZE * 4);
visionData.fill(255);

const visionTexture = new THREE.DataTexture(
  visionData,
  VISION_TEX_SIZE,
  VISION_TEX_SIZE,
  THREE.RGBAFormat,
  THREE.UnsignedByteType,
);
visionTexture.magFilter = THREE.LinearFilter;
visionTexture.minFilter = THREE.LinearFilter;
visionTexture.wrapS = THREE.ClampToEdgeWrapping;
visionTexture.wrapT = THREE.ClampToEdgeWrapping;
visionTexture.needsUpdate = true;

const sharedUniforms = {
  uVisionMap: { value: visionTexture },
  uVisionWorldSpan: { value: 256.0 },
  uFovEnabled: { value: 0.0 },
  uFovDim: { value: 0.85 },
  uNightFactor: { value: 0.0 },
  uVisionSourceCount: { value: 0 },
  uVisionSources: { value: Array.from({ length: MAX_VISION_SOURCES }, () => new THREE.Vector4(0, 0, 0, 0)) },
  uProjectorCount: { value: 0 },
  uProjectorPosRange: { value: Array.from({ length: MAX_COLONY_PROJECTORS }, () => new THREE.Vector4(0, 0, 0, 1)) },
  uProjectorDirAngle: { value: Array.from({ length: MAX_COLONY_PROJECTORS }, () => new THREE.Vector4(0, -1, 0, -1)) },
  uProjectorColorInt: { value: Array.from({ length: MAX_COLONY_PROJECTORS }, () => new THREE.Vector4(1, 1, 1, 0)) },
};

let lastTexSignature = '';

/** Returns the shared GPU uniform dictionary for colony projector lights and Field-of-View shroud. */
export function getColonyVisionUniforms(): Record<string, THREE.IUniform> {
  return sharedUniforms;
}

let colonyLightingBlend = 1;

/**
 * How much the colony's own lighting (FoV shroud, night factor, projectors) applies, 0..1: 0 while the space phase /
 * descent cinematic renders, eased to 1 once the colony takes over. Every writer of `uNightFactor` scales by it.
 */
export function setColonyLightingBlend(blend: number): void {
  colonyLightingBlend = THREE.MathUtils.clamp(blend, 0, 1);
}

export function getColonyLightingBlend(): number {
  return colonyLightingBlend;
}

export const COLONY_VISION_AND_LIGHTS_GLSL = /* glsl */ `
#define MAX_COLONY_PROJECTORS ${MAX_COLONY_PROJECTORS}
uniform sampler2D uVisionMap;
uniform float uVisionWorldSpan;
uniform float uFovEnabled;
uniform float uFovDim;
uniform float uNightFactor;
uniform int uVisionSourceCount;
uniform vec4 uVisionSources[${MAX_VISION_SOURCES}];
uniform int uProjectorCount;
uniform vec4 uProjectorPosRange[${MAX_COLONY_PROJECTORS}];
uniform vec4 uProjectorDirAngle[${MAX_COLONY_PROJECTORS}];
uniform vec4 uProjectorColorInt[${MAX_COLONY_PROJECTORS}];

/**
 * One loop over the colony projectors accumulating world-space diffuse AND (when shininess > 0) normalised
 * Blinn-Phong specular toward the unit view vector V (fragment -> camera). Callers that only need diffuse use
 * evalColonyProjectorLight; the water passes its wave normal + roughness to get bots' lights reflected.
 */
void colonyProjectorLighting(vec3 worldPos, vec3 worldNormal, vec3 V, float shininess, inout vec3 diffuse, inout vec3 spec) {
  vec3 N = normalize(worldNormal);
  float specNorm = (shininess + 8.0) * 0.0397887; // (n + 8) / (8 pi)
  for (int i = 0; i < ${MAX_COLONY_PROJECTORS}; i++) {
    if (i >= uProjectorCount) break;
    vec4 posRange = uProjectorPosRange[i];
    float range = max(posRange.w, 0.1);
    vec3 toFrag = worldPos - posRange.xyz;
    float distSq = dot(toFrag, toFrag);
    if (distSq >= range * range) continue;
    float dist = sqrt(distSq);
    vec3 L = -toFrag / max(dist, 1e-4);
    float normDist = clamp(1.0 - dist / range, 0.0, 1.0);
    float distAtten = normDist * normDist;
    vec4 dirAngle = uProjectorDirAngle[i];
    float coneAtten = 1.0;
    if (dirAngle.w > -0.5) {
      float cosTheta = dot(-L, normalize(dirAngle.xyz));
      float innerCos = mix(dirAngle.w, 1.0, 0.42);
      float spot = smoothstep(dirAngle.w, innerCos, cosTheta);
      float nearSpill = smoothstep(range * 0.24, 0.0, dist) * 0.32;
      coneAtten = max(spot, nearSpill);
    }
    float ndl = max(0.26, dot(N, L));
    vec4 colInt = uProjectorColorInt[i];
    diffuse += colInt.rgb * (colInt.w * distAtten * coneAtten * ndl);
    if (shininess > 0.0) {
      float ndh = max(dot(N, normalize(L + V)), 0.0);
      spec += colInt.rgb * (colInt.w * distAtten * coneAtten * max(dot(N, L), 0.0) * pow(ndh, shininess) * specNorm);
    }
  }
}

vec3 evalColonyProjectorLight(vec3 worldPos, vec3 worldNormal) {
  vec3 diffuse = vec3(0.0), spec = vec3(0.0);
  colonyProjectorLighting(worldPos, worldNormal, vec3(0.0, 1.0, 0.0), 0.0, diffuse, spec);
  return diffuse;
}

vec2 evalColonyFovMask(vec3 worldPos) {
  vec2 uv = worldPos.xz / max(uVisionWorldSpan, 1.0) + 0.5;
  vec2 texVis = (uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0)
    ? texture2D(uVisionMap, uv).rg
    : vec2(0.0);
  float liveVis = texVis.r;
  float expVis = max(texVis.g, liveVis);
  for (int i = 0; i < ${MAX_VISION_SOURCES}; i++) {
    if (i >= uVisionSourceCount) break;
    vec4 vs = uVisionSources[i];
    float d = length(worldPos.xz - vs.xy);
    float unitVis = 1.0 - smoothstep(vs.z, vs.w, d);
    liveVis = max(liveVis, unitVis);
    expVis = max(expVis, step(d, vs.w));
  }
  return vec2(clamp(liveVis, 0.0, 1.0), clamp(expVis, 0.0, 1.0));
}

// uFovEnabled is the shroud strength 0..1 (eased in after the descent hands over, so there is no pop).
vec3 applyColonyFovShroud(vec3 worldPos, vec3 color) {
  if (uFovEnabled <= 0.001 || uFovDim <= 0.001) return color;
  vec2 fov = evalColonyFovMask(worldPos);
  float liveVis = fov.x;
  float expVis = fov.y;
  float dimOutside = clamp(1.0 - uFovDim, 0.03, 1.0);
  float unexpKeep = dimOutside * 0.35;
  float keep = mix(mix(unexpKeep, dimOutside, expVis), 1.0, liveVis);
  float luma = dot(color, vec3(0.299, 0.587, 0.114));
  vec3 desat = mix(color, vec3(luma) * vec3(0.62, 0.78, 1.0), (1.0 - liveVis) * 0.62);
  vec3 shroudTint = mix(vec3(0.004, 0.007, 0.015), vec3(0.012, 0.020, 0.036), expVis);
  float rimBand = smoothstep(0.05, 0.24, liveVis) * (1.0 - smoothstep(0.24, 0.55, liveVis));
  vec3 scannerRim = vec3(0.09, 0.42, 0.64) * (rimBand * 0.11 * uFovDim);
  return mix(color, mix(shroudTint, desat, keep) + scannerRim, clamp(uFovEnabled, 0.0, 1.0));
}
`;

function computeTerritoryDistanceField(radius: number, owner: ArrayLike<number> | undefined, colonyIndex: number): Uint8Array {
  const hx = hexIndex(radius);
  const dist = new Uint8Array(hx.count).fill(255);
  if (!owner) return dist;
  const queue: number[] = [];
  for (let i = 0; i < hx.count; i++) {
    if (owner[i] === colonyIndex) {
      dist[i] = 0;
      queue.push(i);
    }
  }
  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++]!;
    const d = dist[cur]!;
    if (d >= 3) continue;
    const q = hx.q[cur]!, r = hx.r[cur]!;
    for (const [dq, dr] of HEX_DIRS) {
      const nIdx = hx.indexOf(q + dq, r + dr);
      if (nIdx >= 0 && dist[nIdx]! > d + 1) {
        dist[nIdx] = d + 1;
        queue.push(nIdx);
      }
    }
  }
  return dist;
}

function buildTexSignature(input: ColonyVisionTextureInput): string {
  const { radius, colonyIndex, owner, explored, baseCenters } = input;
  let ownedCount = 0;
  let ownedHash = 0;
  let expCount = 0;
  const mask = colonyIndex >= 0 && colonyIndex < 8 ? 1 << colonyIndex : 0;
  if (owner) {
    for (let i = 0; i < owner.length; i++) {
      if (owner[i] === colonyIndex) {
        ownedCount++;
        ownedHash = (ownedHash * 31 + i) | 0;
      }
    }
  }
  if (explored && mask) {
    for (let i = 0; i < explored.length; i++) {
      if ((explored[i]! & mask) !== 0) expCount++;
    }
  }
  const centersKey = (baseCenters ?? [])
    .map((c) => `${Math.round(c.x)},${Math.round(c.z)},${Math.round(c.outerRadius)}`)
    .join(';');
  return `${radius}:${colonyIndex}:${ownedCount}:${ownedHash}:${expCount}:${centersKey}`;
}

/** Rasterizes user base territory (`owner === colonyIndex`), base centers, and `explored` into `uVisionMap`. */
export function updateColonyVisionTexture(input: ColonyVisionTextureInput): void {
  const sig = buildTexSignature(input);
  if (sig === lastTexSignature) return;
  lastTexSignature = sig;

  const { radius, colonyIndex, owner, explored, baseCenters = [] } = input;
  const worldSpan = Math.max(64, planetExtent(radius).x * 2.2);
  sharedUniforms.uVisionWorldSpan.value = worldSpan;

  const distField = computeTerritoryDistanceField(radius, owner, colonyIndex);
  const expMask = colonyIndex >= 0 && colonyIndex < 8 ? 1 << colonyIndex : 0;
  const step = worldSpan / VISION_TEX_SIZE;

  for (let py = 0; py < VISION_TEX_SIZE; py++) {
    const wz = -worldSpan * 0.5 + (py + 0.5) * step;
    for (let px = 0; px < VISION_TEX_SIZE; px++) {
      const wx = -worldSpan * 0.5 + (px + 0.5) * step;
      let live = 0;
      let exp = 0;
      const hit = tileAt(radius, wx, wz);
      if (hit) {
        const d = distField[hit.i]!;
        if (d === 0) live = 1.0;
        else if (d === 1) live = 0.86;
        else if (d === 2) live = 0.52;
        else if (d === 3) live = 0.18;
        if (explored && expMask && ((explored[hit.i] ?? 0) & expMask) !== 0) {
          exp = 1.0;
        }
      }
      for (let k = 0; k < baseCenters.length; k++) {
        const c = baseCenters[k]!;
        const dc = Math.hypot(wx - c.x, wz - c.z);
        if (dc < c.outerRadius) {
          const t = Math.max(0, Math.min(1, (dc - c.innerRadius) / Math.max(0.5, c.outerRadius - c.innerRadius)));
          const smooth = 1 - t * t * (3 - 2 * t);
          if (smooth > live) live = smooth;
          exp = 1.0;
        }
      }
      if (live > exp) exp = live;
      const idx = (py * VISION_TEX_SIZE + px) * 4;
      visionData[idx] = Math.round(live * 255);
      visionData[idx + 1] = Math.round(exp * 255);
      visionData[idx + 2] = 0;
      visionData[idx + 3] = 255;
    }
  }
  visionTexture.needsUpdate = true;
}

const picked: number[] = [];

/**
 * Indices of the projectors whose light circle (xz, range) touches the view focus, nearest to the focus centre first
 * when more than `MAX_COLONY_PROJECTORS` qualify. Off-screen lights never reach the GPU, so every terrain / water /
 * foliage / unit fragment loops over the on-screen ones only. With the focus off (`?focus=0`) all qualify.
 */
export function selectFocusedProjectors(projectors: ReadonlyArray<ColonyProjectorDesc>, out: number[] = picked): number[] {
  out.length = 0;
  const n = Math.min(projectors.length, MAX_PROJECTOR_CANDIDATES);
  for (let i = 0; i < n; i++) {
    const p = projectors[i]!;
    if (inViewFocus(p.x, p.z, p.range)) out.push(i);
  }
  if (out.length > MAX_COLONY_PROJECTORS) {
    const { x, z } = getViewFocus();
    const d2 = (i: number) => (projectors[i]!.x - x) ** 2 + (projectors[i]!.z - z) ** 2;
    out.sort((a, b) => d2(a) - d2(b));
    out.length = MAX_COLONY_PROJECTORS;
  }
  return out;
}

/**
 * Updates active projector light uniforms (only those lighting the view focus, `selectFocusedProjectors`) and live
 * unit/building vision circles in-place for the current frame. Vision sources are not culled: the CPU FoV test
 * `isWorldPointInColonyFov` reads them for off-screen points too.
 */
export function updateColonyProjectorsAndVision(opts: {
  projectors: ReadonlyArray<ColonyProjectorDesc>;
  visionSources: ReadonlyArray<ColonyVisionSourceDesc>;
  fovEnabled: boolean;
  /** Shroud strength 0..1 while `fovEnabled` (default 1); eases the shroud in instead of switching it on. */
  fovStrength?: number;
  fovDim?: number;
  nightFactor?: number;
}): void {
  sharedUniforms.uFovEnabled.value = opts.fovEnabled ? THREE.MathUtils.clamp(opts.fovStrength ?? 1, 0, 1) : 0.0;
  if (opts.fovDim !== undefined) sharedUniforms.uFovDim.value = opts.fovDim;
  if (opts.nightFactor !== undefined) sharedUniforms.uNightFactor.value = opts.nightFactor;

  const sel = selectFocusedProjectors(opts.projectors);
  const pCount = sel.length;
  sharedUniforms.uProjectorCount.value = pCount;
  const posArr = sharedUniforms.uProjectorPosRange.value;
  const dirArr = sharedUniforms.uProjectorDirAngle.value;
  const colArr = sharedUniforms.uProjectorColorInt.value;
  for (let i = 0; i < pCount; i++) {
    const p = opts.projectors[sel[i]!]!;
    posArr[i]!.set(p.x, p.y, p.z, p.range);
    dirArr[i]!.set(p.dirX, p.dirY, p.dirZ, p.cosAngle);
    colArr[i]!.set(p.r, p.g, p.b, p.intensity);
  }

  const vCount = Math.min(MAX_VISION_SOURCES, opts.visionSources.length);
  sharedUniforms.uVisionSourceCount.value = vCount;
  const vArr = sharedUniforms.uVisionSources.value;
  for (let i = 0; i < vCount; i++) {
    const v = opts.visionSources[i]!;
    vArr[i]!.set(v.x, v.z, v.innerRadius, v.outerRadius);
  }
}

/** Checks whether world coordinates `(wx, wz)` lie inside the active Field of View of the user's units or base. */
export function isWorldPointInColonyFov(wx: number, wz: number): boolean {
  if (sharedUniforms.uFovEnabled.value <= 0.001) return true;
  const vCount = sharedUniforms.uVisionSourceCount.value;
  const vArr = sharedUniforms.uVisionSources.value;
  for (let i = 0; i < vCount; i++) {
    const v = vArr[i]!;
    if (Math.hypot(wx - v.x, wz - v.y) <= v.w) return true;
  }
  const span = sharedUniforms.uVisionWorldSpan.value;
  const u = wx / Math.max(1, span) + 0.5;
  const v = wz / Math.max(1, span) + 0.5;
  if (u < 0 || u > 1 || v < 0 || v > 1) return false;
  const px = Math.min(VISION_TEX_SIZE - 1, Math.max(0, Math.floor(u * VISION_TEX_SIZE)));
  const py = Math.min(VISION_TEX_SIZE - 1, Math.max(0, Math.floor(v * VISION_TEX_SIZE)));
  return (visionData[(py * VISION_TEX_SIZE + px) * 4] ?? 0) >= 48;
}

/** Resets FoV shroud and projector lights to neutral defaults (used on session dispose and in unit tests). */
export function resetColonyVisionAndLights(): void {
  sharedUniforms.uFovEnabled.value = 0.0;
  sharedUniforms.uProjectorCount.value = 0;
  sharedUniforms.uVisionSourceCount.value = 0;
  sharedUniforms.uNightFactor.value = 0.0;
  colonyLightingBlend = 1;
  lastTexSignature = '';
  visionData.fill(255);
  visionTexture.needsUpdate = true;
}

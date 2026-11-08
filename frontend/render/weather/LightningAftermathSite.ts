import * as THREE from 'three';
import { getWeatherUniforms } from '../core/weatherConfig';
import { getColonyVisionUniforms } from '../lighting/ColonyVisionAndLights';
import { tileXZ } from '../planets/hex';
import type { SimCraterRef } from './MeteorCraterSite';
import {
  conformTerrainGrid,
  CRATER_LIGHTING_GLSL,
  NOISE_GLSL,
} from './meteorCraterShaders';

const AFTERMATH_RADIUS = 3.8;
const AFTERMATH_COOL_SEC = 18.0;
const AFTERMATH_FADE_SEC = 0.8;
const AFTERMATH_GRACE_SEC = 6.0;

export type SimLightningSiteRef = SimCraterRef & {
  tiles?: ReadonlyArray<{ q: number; r: number }>;
};

export interface LightningAftermathSiteInstance {
  key: string;
  q: number;
  r: number;
  tiles: Array<{ q: number; r: number }>;
  wx: number;
  wy: number;
  wz: number;
  radius: number;
  age: number;
  chargeGlow: number;
  syncedFromSim: boolean;
  fadingOut: boolean;
  fadeProgress: number;
  heightAt: (x: number, z: number) => number;
  root: THREE.Group;
  decalGeo: THREE.BufferGeometry;
  decalMat: THREE.ShaderMaterial;
  decalMesh: THREE.Mesh;
}

export function computeLightningChargeGlow(age: number): number {
  if (age <= 0) return 1;
  const u = Math.min(1, age / AFTERMATH_COOL_SEC);
  return Math.max(0, Math.pow(1 - u, 1.45));
}

function expandAftermathTiles(tiles: ReadonlyArray<{ q: number; r: number }>): Array<{ q: number; r: number }> {
  const base = tiles[0] ?? { q: 0, r: 0 };
  const defaults = [
    { q: base.q, r: base.r },
    { q: base.q + 1, r: base.r },
    { q: base.q, r: base.r + 1 },
    { q: base.q - 1, r: base.r + 1 },
  ];
  return [0, 1, 2, 3].map((i) => tiles[i] ?? defaults[i]!);
}

const LIGHTNING_AFTERMATH_FRAG_GLSL = /* glsl */ `
  uniform float uTime, uOpacity, uChargeGlow;
  uniform vec2 uHex0, uHex1, uHex2, uHex3;
  varying vec2 vLocalXZ;
  varying vec3 vWorldPos;
  ${NOISE_GLSL}
  ${CRATER_LIGHTING_GLSL}

  float hexMetric(vec2 q) {
    q = abs(q);
    return max(q.x * 0.8660254 + q.y * 0.5, q.y);
  }

  void main() {
    vec2 p = vLocalXZ;
    if (dot(p, p) > 1.05) discard;
    float fovVis = evalColonyFovVisibility(vWorldPos);
    if (fovVis <= 0.001) discard;

    vec2 dp0 = p - uHex0;
    vec2 dp1 = p - uHex1;
    vec2 dp2 = p - uHex2;
    vec2 dp3 = p - uHex3;
    float d0 = length(dp0);
    float d1 = length(dp1);
    float d2 = length(dp2);
    float d3 = length(dp3);

    vec2 nearDelta = dp0;
    float dHole = d0;
    if (d1 < dHole) { dHole = d1; nearDelta = dp1; }
    if (d2 < dHole) { dHole = d2; nearDelta = dp2; }
    if (d3 < dHole) { dHole = d3; nearDelta = dp3; }
    if (dHole > 0.46) discard;

    float fbm = mcFbm(p * 6.4);
    float fineNoise = mcNoise(p * 14.0 - vec2(1.9, 3.1));
    float warp = (fbm - 0.5) * 0.085 + (fineNoise - 0.5) * 0.035;

    float h0 = mix(d0, hexMetric(dp0), 0.65) + warp;
    float h1 = mix(d1, hexMetric(dp1), 0.65) + warp;
    float h2 = mix(d2, hexMetric(dp2), 0.65) + warp;
    float h3 = mix(d3, hexMetric(dp3), 0.65) + warp;
    float clusterDist = min(min(h0, h1), min(h2, h3));
    float clusterMask = smoothstep(0.35, 0.22, clusterDist);
    if (clusterMask < 0.01) discard;

    float dHoleW = dHole + (fbm - 0.5) * 0.032;
    vec2 holeDir = dHole > 1e-3 ? nearDelta / dHole : vec2(0.0);
    float slope = smoothstep(0.02, 0.14, dHoleW) * (1.0 - smoothstep(0.14, 0.22, dHoleW)) * -0.78
      + smoothstep(0.14, 0.21, dHoleW) * (1.0 - smoothstep(0.21, 0.28, dHoleW)) * 0.95;
    vec3 craterNorm = normalize(vec3(holeDir.x * slope, 1.0, holeDir.y * slope));

    float dayAmb;
    vec3 taProj;
    evalCraterIlluminationWithFov(vWorldPos, craterNorm, fovVis, dayAmb, taProj);

    float pitMask = smoothstep(0.185, 0.055, dHoleW);
    float deepVoid = smoothstep(0.11, 0.02, dHoleW);
    float fulguriteRim = smoothstep(0.055, 0.0, abs(dHoleW - 0.175));

    float vor1 = mcVoronoiEdge(p * 7.8 + fbm * 0.72);
    float vor2 = mcVoronoiEdge(p * 15.2 - fbm * 0.85);
    float holeAng = atan(nearDelta.y, nearDelta.x);
    float radialSpoke = abs(sin(holeAng * 7.0 + fbm * 4.2));
    float primaryVein = smoothstep(0.075, 0.008, vor1);
    float secondaryVein = smoothstep(0.085, 0.012, vor2) * smoothstep(0.22, 0.03, vor1);
    float spokeVein = smoothstep(0.14, 0.015, radialSpoke) * smoothstep(0.32, 0.07, dHoleW);
    float crackMask = clamp((primaryVein * 0.9 + secondaryVein * 0.65 + spokeVein * 0.85) * smoothstep(0.35, 0.08, clusterDist), 0.0, 1.0);
    float glassLip = smoothstep(0.15, 0.05, vor1) * (1.0 - primaryVein);

    float pulse = 0.65 + 0.35 * sin(uTime * 5.2 - dHole * 14.0 + fbm * 5.0);
    float localCharge = clamp(uChargeGlow * (1.25 - dHole * 1.15), 0.0, 1.0);

    vec3 padAlbedo = mix(vec3(0.11, 0.12, 0.15), vec3(0.24, 0.27, 0.33), clamp(fbm * 0.55 + glassLip * 0.45, 0.0, 1.0));
    vec3 rimAlbedo = vec3(0.28, 0.32, 0.40);
    vec3 crustAlbedo = mix(padAlbedo, rimAlbedo, fulguriteRim * 0.82);
    vec3 litCrust = litCraterSurface(crustAlbedo, 0.035 + 0.095 * fulguriteRim + 0.05 * glassLip, dayAmb, taProj);

    vec3 cooledCrack = litCraterSurface(vec3(0.08, 0.13, 0.19), 0.06, dayAmb, taProj);
    vec3 hotCyan = vec3(0.25, 0.88, 1.0) * 2.8;
    vec3 hotWhite = vec3(0.85, 0.96, 1.0) * 4.2;
    vec3 activePlasma = mix(hotCyan, hotWhite, pulse * primaryVein);
    vec3 crackCol = mix(cooledCrack, activePlasma, smoothstep(0.02, 0.85, localCharge));

    vec3 pitAlbedo = mix(vec3(0.035, 0.042, 0.058), vec3(0.014, 0.018, 0.028), deepVoid);
    vec3 cooledPit = litCraterSurface(pitAlbedo, 0.04, dayAmb, taProj);
    vec3 plasmaPool = mix(vec3(0.18, 0.68, 0.95) * 1.9, hotWhite * 0.95, deepVoid * pulse);
    vec3 pitCol = mix(cooledPit, plasmaPool, smoothstep(0.0, 0.9, localCharge));

    vec3 col = mix(litCrust, crackCol, crackMask);
    col = mix(col, pitCol, pitMask);
    col += vec3(0.08, 0.28, 0.42) * (uChargeGlow * fulguriteRim * 0.55);
    col *= fovVis;
    col = mix(col, applyColonyFovShroud(vWorldPos, col), 1.0 - smoothstep(0.05, 0.5, uChargeGlow));

    float alpha = clamp(max(clusterMask * 0.92, pitMask), 0.0, 1.0) * uOpacity * fovVis;
    if (alpha < 0.01) discard;
    gl_FragColor = vec4(col, alpha);
  }
`;

function createLightningAftermathDecalMaterial(hexOffsets: [THREE.Vector2, THREE.Vector2, THREE.Vector2, THREE.Vector2]): THREE.ShaderMaterial {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      ...getColonyVisionUniforms(),
      ...getWeatherUniforms(),
      uTime: { value: 0 },
      uOpacity: { value: 1 },
      uChargeGlow: { value: 1 },
      uHex0: { value: hexOffsets[0] },
      uHex1: { value: hexOffsets[1] },
      uHex2: { value: hexOffsets[2] },
      uHex3: { value: hexOffsets[3] },
    },
    vertexShader: /* glsl */ `
      varying vec2 vLocalXZ;
      varying vec3 vWorldPos;
      void main() {
        vLocalXZ = position.xz;
        vec4 worldPos4 = modelMatrix * vec4(position, 1.0);
        vWorldPos = worldPos4.xyz;
        gl_Position = projectionMatrix * viewMatrix * worldPos4;
      }
    `,
    fragmentShader: LIGHTNING_AFTERMATH_FRAG_GLSL,
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

/**
 * Manages persistent 4-hex lightning aftermath sites (`lightning-aftermath-sites`):
 * 4 vitrified fulgurite blast holes across the 4-hex cluster, branching Lichtenberg glass fractures,
 * cooling electric plasma glow (`18s`), and `0.8s` terraforming fade-out (zero 3D rocks spawned).
 */
export class LightningAftermathSiteManager {
  public readonly group = new THREE.Group();
  private readonly sites = new Map<string, LightningAftermathSiteInstance>();
  private hadSimSites = false;

  constructor(parent: THREE.Object3D) {
    this.group.name = 'lightning-aftermath-sites';
    parent.add(this.group);
  }

  private findMatchingSite(wx: number, wz: number, q: number, r: number): LightningAftermathSiteInstance | undefined {
    const exact = this.sites.get(`${q},${r}`);
    if (exact) return exact;
    for (const site of this.sites.values()) {
      if (Math.hypot(site.wx - wx, site.wz - wz) < 3.2) return site;
    }
    return undefined;
  }

  public spawnOrUpdateSite(
    tiles: ReadonlyArray<{ q: number; r: number }>,
    heightAt: (x: number, z: number) => number = () => 0,
    syncedFromSim = false,
    axialToWorld: (q: number, r: number) => { x: number; z: number } = (q, r) => {
      const [x, z] = tileXZ(q, r);
      return { x, z };
    },
  ): LightningAftermathSiteInstance {
    const fourTiles = expandAftermathTiles(tiles);
    const first = fourTiles[0]!;
    const worldPts = fourTiles.map((t) => axialToWorld(t.q, t.r));
    const wx = worldPts.reduce((acc, p) => acc + p.x, 0) / worldPts.length;
    const wz = worldPts.reduce((acc, p) => acc + p.z, 0) / worldPts.length;

    const existing = this.findMatchingSite(wx, wz, first.q, first.r);
    if (existing) {
      if (syncedFromSim) existing.syncedFromSim = true;
      existing.heightAt = heightAt;
      existing.fadingOut = false;
      existing.fadeProgress = 0;
      existing.decalMat.uniforms.uOpacity!.value = 1;
      if (!syncedFromSim) {
        existing.age = 0;
        existing.chargeGlow = 1;
        existing.decalMat.uniforms.uChargeGlow!.value = 1;
      }
      return existing;
    }

    const wy = heightAt(wx, wz);
    const key = `${first.q},${first.r}`;
    const root = new THREE.Group();
    root.name = `lightning-aftermath-${key}`;
    root.position.set(wx, wy, wz);
    this.group.add(root);

    const decalGeo = new THREE.PlaneGeometry(2, 2, 24, 24).rotateX(-Math.PI / 2);
    conformTerrainGrid(decalGeo, wx, wy, wz, AFTERMATH_RADIUS, 0.09, heightAt, 0.03, false);

    const hexOffsets = worldPts.map(
      (p) => new THREE.Vector2((p.x - wx) / AFTERMATH_RADIUS, (p.z - wz) / AFTERMATH_RADIUS),
    ) as [THREE.Vector2, THREE.Vector2, THREE.Vector2, THREE.Vector2];

    const decalMat = createLightningAftermathDecalMaterial(hexOffsets);
    const decalMesh = new THREE.Mesh(decalGeo, decalMat);
    decalMesh.renderOrder = 1;
    decalMesh.scale.set(AFTERMATH_RADIUS, 1, AFTERMATH_RADIUS);
    decalMesh.frustumCulled = false;
    decalMesh.userData.waterReflect = true;
    root.add(decalMesh);

    const site: LightningAftermathSiteInstance = {
      key,
      q: first.q,
      r: first.r,
      tiles: fourTiles,
      wx,
      wy,
      wz,
      radius: AFTERMATH_RADIUS,
      age: 0,
      chargeGlow: 1,
      syncedFromSim,
      fadingOut: false,
      fadeProgress: 0,
      heightAt,
      root,
      decalGeo,
      decalMat,
      decalMesh,
    };
    this.sites.set(key, site);
    return site;
  }

  public syncSites(
    simSites: ReadonlyArray<SimLightningSiteRef> | undefined,
    axialOrHeightAt?: ((q: number, r: number) => { x: number; z: number }) | ((x: number, z: number) => number),
    maybeHeightAt?: (x: number, z: number) => number,
  ): void {
    if (!simSites) return;
    if (simSites.length > 0) this.hadSimSites = true;

    let axialToWorld: (q: number, r: number) => { x: number; z: number } = (q, r) => {
      const [x, z] = tileXZ(q, r);
      return { x, z };
    };
    let heightAt: (x: number, z: number) => number = () => 0;

    if (typeof axialOrHeightAt === 'function') {
      const probe = (axialOrHeightAt as (a: number, b: number) => unknown)(0, 0);
      if (probe && typeof probe === 'object' && 'x' in probe && 'z' in probe) {
        axialToWorld = axialOrHeightAt as (q: number, r: number) => { x: number; z: number };
        if (maybeHeightAt) heightAt = maybeHeightAt;
      } else if (typeof probe === 'number') {
        heightAt = axialOrHeightAt as (x: number, z: number) => number;
      }
    } else if (maybeHeightAt) {
      heightAt = maybeHeightAt;
    }

    const activeSites = new Set<LightningAftermathSiteInstance>();
    for (const s of simSites) {
      const tiles = s.tiles && s.tiles.length > 0 ? s.tiles : [{ q: s.q, r: s.r }];
      const site = this.spawnOrUpdateSite(tiles, heightAt, true, axialToWorld);
      activeSites.add(site);
    }

    if (!this.hadSimSites) return;
    for (const site of this.sites.values()) {
      if (activeSites.has(site)) continue;
      if (site.syncedFromSim || site.age >= AFTERMATH_GRACE_SEC) {
        site.fadingOut = true;
      }
    }
  }

  public update(dt: number): void {
    const step = Math.max(0, dt);
    for (const [key, site] of [...this.sites]) {
      site.age += step;
      site.chargeGlow = computeLightningChargeGlow(site.age);
      site.decalMat.uniforms.uTime!.value = site.age;
      site.decalMat.uniforms.uChargeGlow!.value = site.chargeGlow;

      if (site.fadingOut) {
        site.fadeProgress += step / AFTERMATH_FADE_SEC;
        if (site.fadeProgress >= 1) {
          this.group.remove(site.root);
          site.decalGeo.dispose();
          site.decalMat.dispose();
          this.sites.delete(key);
          continue;
        }
      }

      const fade = site.fadingOut ? Math.max(0, 1 - site.fadeProgress) : 1;
      site.decalMat.uniforms.uOpacity!.value = fade;
    }
  }

  public getCount(): number {
    return this.sites.size;
  }

  public dispose(): void {
    this.group.removeFromParent();
    for (const site of this.sites.values()) {
      site.decalGeo.dispose();
      site.decalMat.dispose();
    }
    this.sites.clear();
  }
}

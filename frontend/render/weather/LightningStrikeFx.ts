import * as THREE from 'three';
import { triggerPuddleElectrocution, triggerWaterElectrocution } from '../core/weatherConfig';
import { LightningStrikeSystem } from '../lighting/LightningStrikeSystem';
import type { PlanetaryLightingSystem } from '../lighting/PlanetaryLightingSystem';
import { tileXZ } from '../planets/hex';
import { LightningAftermathSiteManager } from './LightningAftermathSite';
import type { SimCraterRef } from './MeteorCraterSite';
import { readWeatherParams, ScreenWeatherOverlay } from './ScreenWeatherOverlay';

const STAGGER_DELAYS_S = [0, 0.045, 0.09, 0.135] as const;
const OVERLOAD_ARC_INTERVAL_S = 0.11;
const SCORCH_DURATION_S = 1.8;
const SURFACE_CRACKLE_DURATION_S = 0.65;
const SURFACE_CRACKLE_INTERVAL_S = 0.075;

const ELECTRIC_SURFACE_VERT_GLSL = /* glsl */ `
varying vec2 vLocalXZ;
void main() {
  vLocalXZ = position.xz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const ELECTRIC_SURFACE_FRAG_GLSL = /* glsl */ `
uniform float uAge;
uniform float uDuration;
uniform float uSeed;
varying vec2 vLocalXZ;

float eHash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

vec2 eHash2(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return fract(sin(p) * 43758.5453);
}

float eNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(eHash(i), eHash(i + vec2(1.0, 0.0)), f.x),
    mix(eHash(i + vec2(0.0, 1.0)), eHash(i + vec2(1.0, 1.0)), f.x),
    f.y
  );
}

float eFbm(vec2 p) {
  float amp = 0.5;
  float sum = 0.0;
  for (int i = 0; i < 3; i++) {
    sum += amp * eNoise(p);
    p = p * 2.07 + vec2(13.7, 9.1);
    amp *= 0.5;
  }
  return sum / 0.875;
}

float eVoronoiEdge(vec2 x) {
  vec2 n = floor(x);
  vec2 f = fract(x);
  vec2 mg = vec2(0.0);
  vec2 mr = vec2(0.0);
  float md = 8.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 o = eHash2(n + g);
      vec2 r = g + o - f;
      float d = dot(r, r);
      if (d < md) {
        md = d;
        mr = r;
        mg = g;
      }
    }
  }
  md = 8.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = mg + vec2(float(i), float(j));
      vec2 o = eHash2(n + g);
      vec2 r = g + o - f;
      if (dot(mr - r, mr - r) > 0.00001) {
        md = min(md, dot(0.5 * (mr + r), normalize(r - mr)));
      }
    }
  }
  return md;
}

void main() {
  vec2 p = vLocalXZ;
  if (max(abs(p.x), abs(p.y)) > 3.05) discard;
  float life = clamp(uAge / max(uDuration, 0.001), 0.0, 1.0);
  float ang = atan(p.y, p.x);
  vec2 warp = vec2(
    eFbm(p * 1.6 + vec2(uSeed, uAge * 1.8)),
    eFbm(p * 1.6 - vec2(uSeed * 0.7, uAge * 1.5))
  ) - 0.5;
  float vEdge1 = eVoronoiEdge(p * 1.45 + warp * 0.65 + vec2(uSeed * 0.13, -uSeed * 0.19));
  float vEdge2 = eVoronoiEdge(p * 3.2 - warp * 0.9 + vec2(-uSeed * 0.29, uSeed * 0.17));
  float primaryBranch = 1.0 - smoothstep(0.0, 0.055, vEdge1);
  float primaryGlow = 1.0 - smoothstep(0.0, 0.16, vEdge1);
  float secondaryFork = (1.0 - smoothstep(0.0, 0.065, vEdge2)) * smoothstep(0.32, 0.02, vEdge1);
  float lobeMask = pow(eFbm(vec2(ang * 1.8 + uSeed, uSeed * 0.41)), 1.6) * 2.4 + 0.55;
  float fineLobe = eNoise(vec2(ang * 5.5 - uSeed * 1.3, uSeed * 0.9)) * 0.55;
  float asymLimit = clamp(lobeMask + fineLobe, 0.55, 2.95);
  float reach = mix(0.3, asymLimit, smoothstep(0.0, 0.22, life));
  float distWarped = length(p + warp * 0.45);
  float branchMask = (1.0 - smoothstep(reach * 0.68, reach, distWarped))
    * (1.0 - smoothstep(2.45, 3.02, max(abs(p.x), abs(p.y))));
  float cellPulse = smoothstep(0.22, 0.78, eNoise(p * 3.8 + vec2(uAge * 22.0, -uAge * 17.0) + uSeed));
  float segFlicker = step(0.18, eNoise(p * 2.4 - vec2(uAge * 15.0, uAge * 19.0)));
  float coreJagged = primaryBranch * (1.0 - smoothstep(0.15, asymLimit * 0.48, distWarped))
    * (1.0 - smoothstep(0.0, 0.45, life));
  float web = (primaryBranch * 1.45 + primaryGlow * 0.42 + secondaryFork * (0.65 + 0.55 * cellPulse))
    * branchMask * (0.55 + 0.45 * cellPulse * segFlicker) + coreJagged * 1.15;
  float fade = pow(1.0 - life, 1.35);
  float alpha = clamp(web * fade, 0.0, 1.0);
  if (alpha < 0.01) discard;
  vec3 hotCore = vec3(0.92, 0.98, 1.0) * 4.5;
  vec3 cyanArc = vec3(0.16, 0.84, 1.0) * 3.3;
  vec3 col = mix(cyanArc, hotCore, clamp(primaryBranch * 0.85 + coreJagged, 0.0, 1.0));
  gl_FragColor = vec4(col * alpha, alpha);
}
`;

export interface OverloadedBuildingTarget {
  entityId: number;
  x: number;
  y: number;
  z: number;
  radius?: number;
  height?: number;
}

export interface LightningStrikeFxOptions {
  screenOverlay?: ScreenWeatherOverlay;
  lightingSystem?: PlanetaryLightingSystem;
  lightningSystem?: LightningStrikeSystem;
  onShake?: (amplitude: number) => void;
}

interface PendingBoltStrike {
  pos: THREE.Vector3;
  delay: number;
}

interface ActiveSurfaceElectricWeb {
  mesh: THREE.Mesh;
  geo: THREE.PlaneGeometry;
  mat: THREE.ShaderMaterial;
  center: THREE.Vector3;
  surfaceY: (x: number, z: number) => number;
  age: number;
  crackleTimer: number;
}

interface OverloadedBuildingRig {
  entityId: number;
  x: number;
  y: number;
  z: number;
  radius: number;
  height: number;
  arcTimer: number;
}

function expandToFourHexes(tiles: ReadonlyArray<{ q: number; r: number }>): Array<{ q: number; r: number }> {
  const base = tiles.length > 0 ? tiles[0]! : { q: 0, r: 0 };
  const defaults = [
    { q: base.q, r: base.r },
    { q: base.q + 1, r: base.r },
    { q: base.q, r: base.r + 1 },
    { q: base.q - 1, r: base.r + 1 },
  ];
  const out: Array<{ q: number; r: number }> = [];
  for (let i = 0; i < 4; i++) {
    out.push(tiles[i] ?? defaults[i]!);
  }
  return out;
}

function buildConformedElectricPatch(
  center: THREE.Vector3,
  surfaceY: (x: number, z: number) => number,
): { geo: THREE.PlaneGeometry; mat: THREE.ShaderMaterial; mesh: THREE.Mesh } {
  const geo = new THREE.PlaneGeometry(6.2, 6.2, 24, 24);
  geo.rotateX(-Math.PI / 2);
  const posAttr = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < posAttr.count; i++) {
    const lx = posAttr.getX(i);
    const lz = posAttr.getZ(i);
    const wy = surfaceY(center.x + lx, center.z + lz);
    posAttr.setY(i, wy - center.y + 0.09);
  }
  posAttr.needsUpdate = true;

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uAge: { value: 0 },
      uDuration: { value: SCORCH_DURATION_S },
      uSeed: { value: Math.random() * 100 },
    },
    vertexShader: ELECTRIC_SURFACE_VERT_GLSL,
    fragmentShader: ELECTRIC_SURFACE_FRAG_GLSL,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  mat.userData.waterReflect = true;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(center);
  return { geo, mat, mesh };
}

/**
 * 3D Lightning Strike & Building Electrical Overload VFX (`weather-lightning-fx`):
 * - Wraps `LightningStrikeSystem` and `ScreenWeatherOverlay`.
 * - `strikeFourHexes`: triggers electric cyan-white screen flash, camera shake (`0.65`), and a 4-hex staggered
 *   thunderbolt barrage (`0ms, 45ms, 90ms, 135ms`) with Lichtenberg surface electricity and branching 3D water/ground arcs.
 * - `syncOverloadedBuildings`: renders persistent crackling 3D electric overload arcs (`spawnGridOverloadArc`)
 *   jumping across the base, walls, and roof of buildings disabled by lightning overload.
 */
export class LightningStrikeFx {
  public readonly group = new THREE.Group();
  public readonly lightningSystem: LightningStrikeSystem;
  public readonly aftermathManager: LightningAftermathSiteManager;
  private readonly screenOverlay?: ScreenWeatherOverlay;
  private readonly onShake?: (amplitude: number) => void;
  private readonly pendingBolts: PendingBoltStrike[] = [];
  private readonly scorches: ActiveSurfaceElectricWeb[] = [];
  private readonly overloadedRigs = new Map<number, OverloadedBuildingRig>();
  private shakeAmp = 0;
  private totalStrikesTriggered = 0;

  constructor(
    private readonly scene: THREE.Scene,
    optsOrOverlay?: LightningStrikeFxOptions | ScreenWeatherOverlay,
  ) {
    this.group.name = 'weather-lightning-fx';
    this.scene.add(this.group);
    this.aftermathManager = new LightningAftermathSiteManager(this.group);

    if (optsOrOverlay instanceof ScreenWeatherOverlay) {
      this.screenOverlay = optsOrOverlay;
      this.lightningSystem = new LightningStrikeSystem(this.scene);
    } else {
      this.screenOverlay = optsOrOverlay?.screenOverlay;
      this.onShake = optsOrOverlay?.onShake;
      this.lightningSystem =
        optsOrOverlay?.lightningSystem ?? new LightningStrikeSystem(this.scene, optsOrOverlay?.lightingSystem);
    }
  }

  public strikeFourHexes(
    tiles: ReadonlyArray<{ q: number; r: number }>,
    heightAt: (x: number, z: number) => number = () => 0,
    isWaterTile?: (q: number, r: number) => boolean,
  ): void {
    const fourTiles = expandToFourHexes(tiles);
    const tileIsWater = (t: { q: number; r: number }, wx: number, wz: number): boolean =>
      isWaterTile ? isWaterTile(t.q, t.r) : heightAt(wx, wz) < -0.05;
    const landTiles = fourTiles.filter((t) => {
      const [wx, wz] = tileXZ(t.q, t.r);
      return !tileIsWater(t, wx, wz);
    });
    if (landTiles.length > 0) {
      this.aftermathManager.spawnOrUpdateSite(landTiles, heightAt, false);
    }
    const flashScale = readWeatherParams().lightningFlash;
    this.screenOverlay?.triggerLightningScreenFlash(flashScale);
    this.shakeAmp = Math.max(this.shakeAmp, 0.65);
    this.onShake?.(0.65);
    this.totalStrikesTriggered++;

    const surfaceY = (x: number, z: number): number => Math.max(0, heightAt(x, z));
    const hexPositions: THREE.Vector3[] = [];
    const center = new THREE.Vector3();

    for (let i = 0; i < fourTiles.length; i++) {
      const t = fourTiles[i]!;
      const [wx, wz] = tileXZ(t.q, t.r);
      const wy = surfaceY(wx, wz);
      const pos = new THREE.Vector3(wx, wy, wz);
      hexPositions.push(pos);
      center.add(pos);
      const delay = STAGGER_DELAYS_S[i] ?? i * 0.045;

      if (delay <= 0) this.lightningSystem.strikeAt(pos);
      else this.pendingBolts.push({ pos, delay });
    }

    center.multiplyScalar(1 / fourTiles.length);
    center.y = surfaceY(center.x, center.z);
    const hitAnyWater = landTiles.length < fourTiles.length;
    if (hitAnyWater) {
      triggerWaterElectrocution(center.x, center.z, 1.0);
      for (let i = 0; i < 12; i++) {
        const a1 = (i / 12) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
        const a2 = a1 + (Math.random() - 0.5) * 0.55;
        const r1 = 2.5 + Math.random() * 4.5, r2 = r1 + 3.0 + Math.random() * 4.0;
        const p1 = new THREE.Vector3(center.x + Math.cos(a1) * r1, 0.08, center.z + Math.sin(a1) * r1);
        const p2 = new THREE.Vector3(center.x + Math.cos(a2) * r2, 0.08, center.z + Math.sin(a2) * r2);
        this.lightningSystem.spawnGridOverloadArc(p1, p2);
      }
    } else {
      triggerPuddleElectrocution(center.x, center.z, 1.0);
    }
    this.spawnSurfaceElectricWeb(center, hexPositions, surfaceY);
  }

  public syncLightningSites(
    simSites: ReadonlyArray<SimCraterRef & { tiles?: ReadonlyArray<{ q: number; r: number }> }> | undefined,
    heightAt?: (x: number, z: number) => number,
  ): void {
    this.aftermathManager.syncSites(simSites, heightAt);
  }

  private spawnSurfaceElectricWeb(
    center: THREE.Vector3,
    hexPositions: ReadonlyArray<THREE.Vector3>,
    surfaceY: (x: number, z: number) => number,
  ): void {
    const { geo, mat, mesh } = buildConformedElectricPatch(center, surfaceY);
    this.group.add(mesh);
    this.scorches.push({
      mesh,
      geo,
      mat,
      center: center.clone(),
      surfaceY,
      age: 0,
      crackleTimer: SURFACE_CRACKLE_INTERVAL_S,
    });

    // Spawn 9 splitting 3D electric arcs across the water/surface area around the 4 struck hexes
    const branchCount = 9;
    for (let i = 0; i < branchCount; i++) {
      const origin = hexPositions[i % hexPositions.length] ?? center;
      const baseAngle = (i / branchCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.45;
      const midDist = 0.9 + Math.random() * 0.85;
      const outerDist = 1.85 + Math.random() * 1.85;
      const forkAngle = baseAngle + (Math.random() - 0.5) * 0.75;
      const mx = center.x + Math.cos(baseAngle) * midDist;
      const mz = center.z + Math.sin(baseAngle) * midDist;
      const ex = center.x + Math.cos(forkAngle) * outerDist;
      const ez = center.z + Math.sin(forkAngle) * outerDist;
      const pStart = new THREE.Vector3(origin.x, origin.y + 0.12, origin.z);
      const pMid = new THREE.Vector3(mx, surfaceY(mx, mz) + 0.14, mz);
      const pEnd = new THREE.Vector3(ex, surfaceY(ex, ez) + 0.08, ez);
      this.lightningSystem.spawnGridOverloadArc(pStart, pMid);
      this.lightningSystem.spawnGridOverloadArc(pMid, pEnd);
    }
  }

  private spawnCracklingSurfaceArc(web: ActiveSurfaceElectricWeb): void {
    const a1 = Math.random() * Math.PI * 2;
    const a2 = a1 + (Math.random() - 0.5) * 1.15;
    const r1 = 0.25 + Math.random() * 1.4;
    const r2 = r1 + 0.85 + Math.random() * 1.45;
    const x1 = web.center.x + Math.cos(a1) * r1;
    const z1 = web.center.z + Math.sin(a1) * r1;
    const x2 = web.center.x + Math.cos(a2) * r2;
    const z2 = web.center.z + Math.sin(a2) * r2;
    const p1 = new THREE.Vector3(x1, web.surfaceY(x1, z1) + 0.11, z1);
    const p2 = new THREE.Vector3(x2, web.surfaceY(x2, z2) + 0.08, z2);
    this.lightningSystem.spawnGridOverloadArc(p1, p2);
  }

  private spawnBuildingOverloadArcs(rig: OverloadedBuildingRig, count: number): void {
    for (let i = 0; i < count; i++) {
      const a1 = Math.random() * Math.PI * 2;
      const a2 = a1 + Math.PI * (0.35 + Math.random() * 1.15);
      const r1 = rig.radius * (0.4 + Math.random() * 0.65);
      const r2 = rig.radius * (0.35 + Math.random() * 0.7);
      const y1 = rig.y + 0.12 + Math.random() * rig.height * 0.95;
      const y2 = rig.y + 0.12 + Math.random() * rig.height * 0.95;
      const p1 = new THREE.Vector3(rig.x + Math.cos(a1) * r1, y1, rig.z + Math.sin(a1) * r1);
      const p2 = new THREE.Vector3(rig.x + Math.cos(a2) * r2, y2, rig.z + Math.sin(a2) * r2);
      this.lightningSystem.spawnGridOverloadArc(p1, p2);
    }
  }

  public syncOverloadedBuildings(targets: ReadonlyArray<OverloadedBuildingTarget>): void {
    const activeIds = new Set<number>();
    for (const t of targets) {
      activeIds.add(t.entityId);
      let rig = this.overloadedRigs.get(t.entityId);
      if (!rig) {
        rig = {
          entityId: t.entityId,
          x: t.x,
          y: t.y,
          z: t.z,
          radius: t.radius ?? 1.35,
          height: t.height ?? 2.2,
          arcTimer: OVERLOAD_ARC_INTERVAL_S * 0.5,
        };
        this.overloadedRigs.set(t.entityId, rig);
        this.spawnBuildingOverloadArcs(rig, 3);
      } else {
        rig.x = t.x;
        rig.y = t.y;
        rig.z = t.z;
        rig.radius = t.radius ?? rig.radius;
        rig.height = t.height ?? rig.height;
      }
    }

    for (const id of [...this.overloadedRigs.keys()]) {
      if (!activeIds.has(id)) {
        this.overloadedRigs.delete(id);
      }
    }
  }

  public update(dt: number): void {
    const step = Math.max(0, dt);
    if (this.shakeAmp > 0) {
      this.shakeAmp = Math.max(0, this.shakeAmp - step * 1.4);
    }

    for (let i = this.pendingBolts.length - 1; i >= 0; i--) {
      const b = this.pendingBolts[i]!;
      b.delay -= step;
      if (b.delay <= 0) {
        this.lightningSystem.strikeAt(b.pos);
        this.pendingBolts.splice(i, 1);
      }
    }

    for (let i = this.scorches.length - 1; i >= 0; i--) {
      const s = this.scorches[i]!;
      s.age += step;
      if (s.age >= SCORCH_DURATION_S) {
        this.group.remove(s.mesh);
        s.geo.dispose();
        s.mat.dispose();
        this.scorches.splice(i, 1);
      } else {
        s.mat.uniforms.uAge!.value = s.age;
        if (s.age < SURFACE_CRACKLE_DURATION_S) {
          s.crackleTimer -= step;
          if (s.crackleTimer <= 0) {
            s.crackleTimer = SURFACE_CRACKLE_INTERVAL_S * (0.7 + Math.random() * 0.6);
            this.spawnCracklingSurfaceArc(s);
          }
        }
      }
    }

    for (const rig of this.overloadedRigs.values()) {
      rig.arcTimer -= step;
      if (rig.arcTimer <= 0) {
        rig.arcTimer = OVERLOAD_ARC_INTERVAL_S * (0.75 + Math.random() * 0.5);
        this.spawnBuildingOverloadArcs(rig, 2);
      }
    }

    this.aftermathManager.update(step);
    this.lightningSystem.update(step);
  }

  public getAftermathCount(): number { return this.aftermathManager.getCount(); }
  public getOverloadedCount(): number { return this.overloadedRigs.size; }
  public getTotalStrikesTriggered(): number { return this.totalStrikesTriggered; }
  public getCameraShake(): number { return this.shakeAmp; }

  public dispose(): void {
    this.aftermathManager.dispose();
    this.pendingBolts.length = 0;
    for (const s of this.scorches) { this.group.remove(s.mesh); s.geo.dispose(); s.mat.dispose(); }
    this.scorches.length = 0;
    this.overloadedRigs.clear();
    this.scene.remove(this.group);
  }
}

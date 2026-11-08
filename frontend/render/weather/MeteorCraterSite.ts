import * as THREE from 'three';
import {
  getColonyVisionUniforms,
  isWorldPointInColonyFov,
  setDynamicHazardLights,
  type ColonyProjectorDesc,
} from '../lighting/ColonyVisionAndLights';
import { tileXZ } from '../planets/hex';
import { makeBoulderGeo, makeSpireGeo } from '../visuals/terrain/Scatter';
import {
  conformTerrainGrid,
  createCraterBoulderMaterial,
  createCraterDecalMaterial,
  createMeteoriteCoreMaterial,
} from './meteorCraterShaders';

const DEFAULT_CRATER_RADIUS = 8.2;
const CRATER_FADE_DURATION = 0.8;
const CRATER_GRACE_SEC = 6.0;
const CRATER_PEAK_HEAT_SEC = 4.0;
const CRATER_COOL_DURATION = 34.0;
const BOULDER_COUNT = 12;
const SPIRE_COUNT = 4;
const EMBER_COUNT = 18;

export function computeCraterHeatGlow(age: number): number {
  if (age <= 0) return 1;
  if (age < CRATER_PEAK_HEAT_SEC) {
    return 1 - (age / CRATER_PEAK_HEAT_SEC) * 0.08;
  }
  const coolU = Math.min(1, (age - CRATER_PEAK_HEAT_SEC) / CRATER_COOL_DURATION);
  return Math.max(0, Math.pow(1 - coolU, 1.35) * 0.92);
}

function isCraterInFov(wx: number, wz: number, radius: number): boolean {
  const r = radius * 0.75;
  return (
    isWorldPointInColonyFov(wx, wz) ||
    isWorldPointInColonyFov(wx + r, wz) ||
    isWorldPointInColonyFov(wx - r, wz) ||
    isWorldPointInColonyFov(wx, wz + r) ||
    isWorldPointInColonyFov(wx, wz - r)
  );
}

export interface SimCraterRef {
  id?: number; q: number; r: number;
}

export interface CraterSpawnOpts {
  q?: number; r?: number; radius?: number;
  heightAt?: (x: number, z: number) => number;
  syncedFromSim?: boolean; resetHeat?: boolean;
}

interface CraterRockItem {
  mesh: THREE.Mesh; lx: number; lz: number; baseY: number; baseScale: THREE.Vector3;
}

interface CraterEmberItem {
  mesh: THREE.Mesh; r: number; ang: number; phase: number; speed: number; baseScale: number;
}

export interface CraterSiteInstance {
  key: string;
  q?: number;
  r?: number;
  wx: number;
  wy: number;
  wz: number;
  radius: number;
  age: number;
  heatGlow: number;
  lastConformAge: number;
  syncedFromSim: boolean;
  fadingOut: boolean;
  fadeProgress: number;
  heightAt: (x: number, z: number) => number;
  root: THREE.Group;
  decalGeo: THREE.BufferGeometry;
  decalMat: THREE.ShaderMaterial;
  decalMesh: THREE.Mesh;
  coreMat: THREE.ShaderMaterial;
  boulderMat: THREE.ShaderMaterial;
  pointLight: THREE.PointLight;
  rocks: CraterRockItem[];
  embers: CraterEmberItem[];
}

function buildCraterRocks(
  root: THREE.Group,
  wx: number,
  wy: number,
  wz: number,
  heightAt: (x: number, z: number) => number,
  boulderGeos: THREE.BufferGeometry[],
  spireGeos: THREE.BufferGeometry[],
  boulderMat: THREE.Material,
  coreMat: THREE.ShaderMaterial,
): CraterRockItem[] {
  const rocks: CraterRockItem[] = [];

  for (let i = 0; i < SPIRE_COUNT; i++) {
    const ang = (i / SPIRE_COUNT) * Math.PI * 2 + 0.35;
    const dist = 1.25 + (i % 2) * 0.85;
    const lx = Math.cos(ang) * dist;
    const lz = Math.sin(ang) * dist;
    const baseY = heightAt(wx + lx, wz + lz) - wy - 0.08;
    const geo = spireGeos[i % spireGeos.length]!;
    const mesh = new THREE.Mesh(geo, coreMat);
    mesh.userData.waterReflect = true;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const baseScale = new THREE.Vector3(0.75 + (i % 2) * 0.22, 0.95 + (i % 3) * 0.28, 0.75 + (i % 2) * 0.22);
    mesh.position.set(lx, baseY, lz);
    mesh.scale.copy(baseScale);
    mesh.rotation.set(Math.sin(ang) * 0.28, ang + 0.6, -Math.cos(ang) * 0.28);
    root.add(mesh);
    rocks.push({ mesh, lx, lz, baseY, baseScale });
  }

  for (let i = 0; i < BOULDER_COUNT; i++) {
    const ang = (i / BOULDER_COUNT) * Math.PI * 2 + (i % 3) * 0.21;
    const dist = 3.2 + (i % 4) * 0.95;
    const lx = Math.cos(ang) * dist;
    const lz = Math.sin(ang) * dist;
    const baseY = heightAt(wx + lx, wz + lz) - wy - 0.08;
    const geo = boulderGeos[i % boulderGeos.length]!;
    const mesh = new THREE.Mesh(geo, boulderMat);
    mesh.userData.waterReflect = true;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const sx = 0.72 + (i % 4) * 0.24;
    const sy = 0.52 + (i % 3) * 0.2;
    const sz = 0.68 + ((i + 1) % 4) * 0.22;
    const baseScale = new THREE.Vector3(sx, sy, sz);
    mesh.position.set(lx, baseY, lz);
    mesh.scale.copy(baseScale);
    mesh.rotation.set((i % 3) * 0.22, ang * 1.3, ((i + 1) % 3) * 0.18);
    root.add(mesh);
    rocks.push({ mesh, lx, lz, baseY, baseScale });
  }

  return rocks;
}

function buildCraterEmbers(
  root: THREE.Group,
  emberGeo: THREE.BufferGeometry,
  emberMat: THREE.Material,
): CraterEmberItem[] {
  const embers: CraterEmberItem[] = [];
  for (let i = 0; i < EMBER_COUNT; i++) {
    const mesh = new THREE.Mesh(emberGeo, emberMat);
    mesh.userData.waterReflect = true;
    const r = 0.4 + (i % 6) * 1.15;
    const ang = (i / EMBER_COUNT) * Math.PI * 2 + (i % 4) * 0.3;
    const phase = (i / EMBER_COUNT) * 3.2;
    const speed = 0.45 + (i % 5) * 0.14;
    const baseScale = 0.55 + (i % 4) * 0.22;
    mesh.position.set(Math.cos(ang) * r, 0.25, Math.sin(ang) * r);
    mesh.scale.setScalar(baseScale);
    root.add(mesh);
    embers.push({ mesh, r, ang, phase, speed, baseScale });
  }
  return embers;
}

/**
 * Manages persistent melted meteor craters, procedural lava-crack decals,
 * persistent 3D scorched boulders + glowing meteorite spires, and terraforming removal fade-outs.
 */
export class MeteorCraterSiteManager {
  public readonly group = new THREE.Group();
  private readonly sites = new Map<string, CraterSiteInstance>();
  private readonly boulderGeos: THREE.BufferGeometry[];
  private readonly spireGeos: THREE.BufferGeometry[];
  private readonly emberGeo: THREE.BufferGeometry;
  private readonly emberMat: THREE.MeshStandardMaterial;
  private hadSimCraters = false;
  private nextLocalKey = 1;

  constructor(parent: THREE.Object3D) {
    this.group.name = 'meteor-crater-sites';
    parent.add(this.group);

    this.boulderGeos = [
      makeBoulderGeo(101, new THREE.Color(0x282320)),
      makeBoulderGeo(203, new THREE.Color(0x342b26)),
      makeBoulderGeo(307, new THREE.Color(0x221f22)),
    ];
    this.spireGeos = [
      makeSpireGeo(409, new THREE.Color(0x2b2422)),
      makeSpireGeo(521, new THREE.Color(0x1f1b1c)),
    ];
    this.emberGeo = new THREE.OctahedronGeometry(0.13, 0);

    this.emberMat = new THREE.MeshStandardMaterial({
      color: 0xffb838,
      emissive: 0xff5a08,
      emissiveIntensity: 4.2,
      roughness: 0.3,
      toneMapped: false,
    });
    this.emberMat.userData.waterReflect = true;
  }

  private findMatchingSite(wx: number, wz: number, q?: number, r?: number): CraterSiteInstance | undefined {
    if (q !== undefined && r !== undefined) {
      const exact = this.sites.get(`${q},${r}`);
      if (exact) return exact;
    }
    for (const site of this.sites.values()) {
      if (Math.hypot(site.wx - wx, site.wz - wz) < 4.5) return site;
    }
    return undefined;
  }

  private refreshExistingSite(existing: CraterSiteInstance, opts: CraterSpawnOpts): CraterSiteInstance {
    if (opts.q !== undefined && opts.r !== undefined && existing.key !== `${opts.q},${opts.r}`) {
      this.sites.delete(existing.key);
      existing.key = `${opts.q},${opts.r}`;
      existing.q = opts.q;
      existing.r = opts.r;
      this.sites.set(existing.key, existing);
    }
    if (opts.syncedFromSim) existing.syncedFromSim = true;
    if (opts.heightAt) existing.heightAt = opts.heightAt;
    existing.fadingOut = false;
    existing.fadeProgress = 0;
    existing.decalMat.uniforms.uOpacity!.value = 1;
    existing.coreMat.uniforms.uOpacity!.value = 1;
    existing.boulderMat.uniforms.uOpacity!.value = 1;
    const newWy = existing.heightAt(existing.wx, existing.wz);
    if (opts.resetHeat) {
      existing.age = 0;
      existing.heatGlow = 1;
      existing.decalMat.uniforms.uHeatGlow!.value = 1;
      existing.coreMat.uniforms.uHeatGlow!.value = 1;
      existing.boulderMat.uniforms.uHeatGlow!.value = 1;
      this.reconformSite(existing);
      this.syncHazardLights();
    } else if (Math.abs(newWy - existing.wy) > 0.04) {
      this.reconformSite(existing);
    }
    return existing;
  }

  public spawnOrUpdateCrater(wx: number, wz: number, opts: CraterSpawnOpts = {}): CraterSiteInstance {
    const heightAt = opts.heightAt ?? (() => 0);
    const existing = this.findMatchingSite(wx, wz, opts.q, opts.r);
    if (existing) return this.refreshExistingSite(existing, opts);

    const wy = heightAt(wx, wz);
    const radius = opts.radius ?? DEFAULT_CRATER_RADIUS;
    const key = opts.q !== undefined && opts.r !== undefined ? `${opts.q},${opts.r}` : `local:${this.nextLocalKey++}`;

    const root = new THREE.Group();
    root.name = `meteor-crater-${key}`;
    root.position.set(wx, wy, wz);
    this.group.add(root);

    const decalGeo = new THREE.PlaneGeometry(2, 2, 32, 32).rotateX(-Math.PI / 2);
    conformTerrainGrid(decalGeo, wx, wy, wz, radius, 0.11, heightAt, 0.04, false);
    const decalMat = createCraterDecalMaterial();
    decalMat.polygonOffset = true;
    decalMat.polygonOffsetFactor = -3;
    decalMat.polygonOffsetUnits = -3;
    const decalMesh = new THREE.Mesh(decalGeo, decalMat);
    decalMesh.renderOrder = 1;
    decalMesh.scale.set(radius, 1, radius);
    decalMesh.frustumCulled = false;
    decalMesh.userData.waterReflect = true;
    root.add(decalMesh);

    const coreMat = createMeteoriteCoreMaterial();
    const boulderMat = createCraterBoulderMaterial();
    const rocks = buildCraterRocks(
      root,
      wx,
      wy,
      wz,
      heightAt,
      this.boulderGeos,
      this.spireGeos,
      boulderMat,
      coreMat,
    );
    const embers = buildCraterEmbers(root, this.emberGeo, this.emberMat);
    const inFov = isCraterInFov(wx, wz, radius);
    for (const e of embers) e.mesh.visible = inFov;

    // Intentionally not added to `root` to prevent Three.js NUM_POINT_LIGHTS shader recompile hitches;
    // illumination is driven by zero-stutter `setDynamicHazardLights(projectors)` -> `uTaProjectors`.
    const pointLight = new THREE.PointLight(0xff7218, 3.8, radius * 2.6, 1.5);
    pointLight.position.set(0, 2.0, 0);
    pointLight.visible = inFov;

    const site: CraterSiteInstance = {
      key,
      q: opts.q,
      r: opts.r,
      wx,
      wy,
      wz,
      radius,
      age: 0,
      heatGlow: 1,
      lastConformAge: 0,
      syncedFromSim: Boolean(opts.syncedFromSim),
      fadingOut: false,
      fadeProgress: 0,
      heightAt,
      root,
      decalGeo,
      decalMat,
      decalMesh,
      coreMat,
      boulderMat,
      pointLight,
      rocks,
      embers,
    };
    this.sites.set(key, site);
    this.syncHazardLights();
    return site;
  }

  public reconformSite(site: CraterSiteInstance): void {
    site.wy = site.heightAt(site.wx, site.wz);
    site.root.position.set(site.wx, site.wy, site.wz);
    conformTerrainGrid(site.decalGeo, site.wx, site.wy, site.wz, site.radius, 0.11, site.heightAt, 0.04, false);
    for (const r of site.rocks) {
      r.baseY = site.heightAt(site.wx + r.lx, site.wz + r.lz) - site.wy - 0.08;
      r.mesh.position.y = r.baseY;
    }
  }

  public syncCraters(
    simCraters: ReadonlyArray<SimCraterRef> | undefined,
    axialToWorld: (q: number, r: number) => { x: number; z: number } = (q, r) => {
      const [x, z] = tileXZ(q, r);
      return { x, z };
    },
    heightAt: (x: number, z: number) => number = () => 0,
  ): void {
    if (!simCraters) return;
    if (simCraters.length > 0) this.hadSimCraters = true;

    const activeSites = new Set<CraterSiteInstance>();
    for (const c of simCraters) {
      const { x, z } = axialToWorld(c.q, c.r);
      const site = this.spawnOrUpdateCrater(x, z, {
        q: c.q,
        r: c.r,
        heightAt,
        syncedFromSim: true,
      });
      activeSites.add(site);
    }

    if (!this.hadSimCraters) return;
    for (const site of this.sites.values()) {
      if (activeSites.has(site)) continue;
      if (site.syncedFromSim || site.age >= CRATER_GRACE_SEC) {
        site.fadingOut = true;
      }
    }
  }

  private syncHazardLights(): void {
    const projectors: ColonyProjectorDesc[] = [];
    for (const site of this.sites.values()) {
      const fade = site.fadingOut ? Math.max(0, 1 - site.fadeProgress) : 1;
      const effHeat = site.heatGlow * fade;
      if (effHeat <= 0.015 || !isCraterInFov(site.wx, site.wz, site.radius)) continue;
      const flicker = 0.92 + 0.08 * Math.sin(site.age * 5.8 + site.wx * 0.4);
      const range = site.radius * (1.55 + 0.95 * effHeat);
      projectors.push({
        x: site.wx,
        y: site.wy + 2.4,
        z: site.wz,
        range,
        dirX: 0,
        dirY: -1,
        dirZ: 0,
        cosAngle: -1,
        r: 1.0,
        g: 0.22 + 0.34 * effHeat,
        b: 0.04 + 0.12 * effHeat * effHeat,
        intensity: 2.45 * effHeat * flicker,
      });
    }
    setDynamicHazardLights(projectors);
  }

  public update(dt: number): void {
    const step = Math.max(0, dt);
    for (const [key, site] of [...this.sites]) {
      site.age += step;
      if (site.age < 3.5 && site.age - site.lastConformAge >= 0.25) {
        site.lastConformAge = site.age;
        this.reconformSite(site);
      }

      site.heatGlow = computeCraterHeatGlow(site.age);
      site.decalMat.uniforms.uTime!.value = site.age;
      site.coreMat.uniforms.uTime!.value = site.age;
      site.boulderMat.uniforms.uTime!.value = site.age;
      site.decalMat.uniforms.uHeatGlow!.value = site.heatGlow;
      site.coreMat.uniforms.uHeatGlow!.value = site.heatGlow;
      site.boulderMat.uniforms.uHeatGlow!.value = site.heatGlow;

      if (site.fadingOut) {
        site.fadeProgress += step / CRATER_FADE_DURATION;
        if (site.fadeProgress >= 1) {
          this.group.remove(site.root);
          site.decalGeo.dispose();
          site.decalMat.dispose();
          site.coreMat.dispose();
          site.boulderMat.dispose();
          this.sites.delete(key);
          continue;
        }
      }

      const fade = site.fadingOut ? Math.max(0, 1 - site.fadeProgress) : 1;
      const effHeat = site.heatGlow * fade;
      const flicker = 0.92 + 0.08 * Math.sin(site.age * 5.8 + site.wx * 0.4);
      site.decalMat.uniforms.uOpacity!.value = fade;
      site.coreMat.uniforms.uOpacity!.value = fade;
      site.boulderMat.uniforms.uOpacity!.value = fade;

      const inFov = isCraterInFov(site.wx, site.wz, site.radius);
      site.pointLight.visible = effHeat > 0.015 && inFov;
      site.pointLight.intensity = 3.8 * effHeat * flicker;
      site.pointLight.distance = site.radius * (1.2 + 1.5 * effHeat);
      site.pointLight.color.setRGB(1.0, 0.22 + 0.34 * effHeat, 0.04 + 0.1 * effHeat);

      const nightFactor = Number(getColonyVisionUniforms().uNightFactor?.value ?? 0);
      const castShadow = inFov && (effHeat > 0.05 || nightFactor < 0.65);
      for (const r of site.rocks) {
        r.mesh.castShadow = castShadow;
        r.mesh.scale.copy(r.baseScale).multiplyScalar(Math.max(0.01, fade));
        r.mesh.position.y = r.baseY - (1 - fade) * 0.45;
      }

      for (const e of site.embers) {
        e.mesh.visible = effHeat > 0.02 && inFov;
        if (!e.mesh.visible) continue;
        const cycle = (site.age * e.speed * (0.45 + 0.55 * site.heatGlow) + e.phase) % 1;
        const y = 0.15 + cycle * 2.5 * (0.35 + 0.65 * site.heatGlow);
        const sway = Math.sin(site.age * 2.4 + e.phase * 4) * 0.28;
        e.mesh.position.set(
          Math.cos(e.ang) * e.r + sway,
          y,
          Math.sin(e.ang) * e.r + Math.cos(site.age * 2.1 + e.phase) * 0.28,
        );
        e.mesh.rotation.x += step * 2.5;
        e.mesh.rotation.y += step * 3.1;
        const pulse = Math.sin(cycle * Math.PI) * effHeat;
        e.mesh.scale.setScalar(Math.max(0.01, e.baseScale * pulse));
      }
    }
    this.syncHazardLights();
  }

  public getCount(): number {
    return this.sites.size;
  }

  public dispose(): void {
    setDynamicHazardLights([]);
    this.group.removeFromParent();
    for (const site of this.sites.values()) {
      site.decalGeo.dispose();
      site.decalMat.dispose();
      site.coreMat.dispose();
      site.boulderMat.dispose();
    }
    this.sites.clear();
    for (const g of this.boulderGeos) g.dispose();
    for (const g of this.spireGeos) g.dispose();
    this.emberGeo.dispose();
    this.emberMat.dispose();
  }
}

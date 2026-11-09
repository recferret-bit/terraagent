import * as THREE from 'three';
import { tileXZ } from '../planets/hex';
import { MeteorCraterSiteManager, type CraterSiteInstance, type SimCraterRef } from './MeteorCraterSite';
import { conformTerrainGrid } from './meteorCraterShaders';
import {
  buildDebrisParticles,
  buildMeteorBodyGroup,
  buildReticleGroup,
  createMeteorPalette,
  type ActiveMeteorStrike,
} from './parts/meteorBuilders';
import { readWeatherParams, ScreenWeatherOverlay } from './ScreenWeatherOverlay';

const METEOR_DESCENT_DURATION = 2.15;
const METEOR_SHADOW_HOLD = 1.1;
const METEOR_TOTAL_DURATION = 4.65;
const BLAST_CARPET_RADIUS = 11.2;
const GRAVITY = 24.0;
const BOUNCE = 0.32;

export interface MeteorStrikeOptions {
  screenOverlay?: ScreenWeatherOverlay;
  onShake?: (amplitude: number) => void;
  projectToScreen?: (worldPos: THREE.Vector3) => { x: number; y: number } | null;
}

export interface MeteorImpactTriggerOpts {
  q?: number; r?: number; radius?: number;
  tiles?: ReadonlyArray<{ q: number; r: number }>;
  heightAt?: (x: number, z: number) => number;
}

/**
 * 3D Meteor Strike VFX (`weather-meteor-fx`):
 * - Stage 1 & 2 (0.0s -> 2.15s): Terrain-draped 45m -> 9.5m eclipse shadow mesh covering hills & mountains +
 *   10-hex warning reticle + descending 3D molten meteor with plasma coma and trailing fire/ember wake.
 * - Stage 3 & 4 (2.15s -> 4.65s): Ground impact camera shake, volumetric 3D mushrooming fireball & ash dome,
 *   terrain-draped turbulent FBM plasma blast carpet, 74 ballistic & buoyant 3D debris chunks, and persistent
 *   melted crater site (`MeteorCraterSiteManager`) with glowing lava cracks and meteorite boulders.
 */
export class MeteorStrikeFx {
  public readonly group = new THREE.Group();
  public readonly craterManager: MeteorCraterSiteManager;
  private readonly screenOverlay?: ScreenWeatherOverlay;
  private readonly onShake?: (amplitude: number) => void;
  private readonly projectToScreen?: (worldPos: THREE.Vector3) => { x: number; y: number } | null;
  private readonly strikes: ActiveMeteorStrike[] = [];
  private readonly geos: THREE.BufferGeometry[] = [];
  private readonly mats: THREE.Material[] = [];
  private lastHeightAt: (x: number, z: number) => number = () => 0;
  private shakeAmp = 0;

  constructor(
    private readonly scene: THREE.Scene,
    optsOrOverlay?: MeteorStrikeOptions | ScreenWeatherOverlay,
    onShakeArg?: (amplitude: number) => void,
  ) {
    this.group.name = 'weather-meteor-fx';
    this.scene.add(this.group);
    this.craterManager = new MeteorCraterSiteManager(this.group);
    if (optsOrOverlay instanceof ScreenWeatherOverlay) {
      this.screenOverlay = optsOrOverlay;
      this.onShake = onShakeArg;
    } else if (optsOrOverlay) {
      this.screenOverlay = optsOrOverlay.screenOverlay;
      this.onShake = optsOrOverlay.onShake ?? onShakeArg;
      this.projectToScreen = optsOrOverlay.projectToScreen;
    }
  }

  public strikeTile(
    q: number, r: number, heightAt?: (x: number, z: number) => number, tiles?: ReadonlyArray<{ q: number; r: number }>,
  ): void {
    if (heightAt) this.lastHeightAt = heightAt;
    const [wx, wz] = tileXZ(q, r);
    this.strikeAt(new THREE.Vector3(wx, heightAt ? heightAt(wx, wz) : 0, wz), { q, r, tiles, heightAt });
  }

  public triggerStrike(
    worldPos: THREE.Vector3 | { x: number; y: number; z: number }, opts: MeteorImpactTriggerOpts = {},
  ): void {
    this.strikeAt(worldPos, opts);
  }

  public strikeAt(
    worldPos: THREE.Vector3 | { x: number; y: number; z: number },
    opts: MeteorImpactTriggerOpts = {},
  ): void {
    if (opts.heightAt) this.lastHeightAt = opts.heightAt;
    const target =
      worldPos instanceof THREE.Vector3 ? worldPos.clone() : new THREE.Vector3(worldPos.x, worldPos.y, worldPos.z);
    const initialShadowOffsetX = 30 * 0.85, initialShadowOffsetZ = -25 * 0.85;
    const shadowWorldPos = new THREE.Vector3(target.x + initialShadowOffsetX, target.y, target.z + initialShadowOffsetZ);
    this.screenOverlay?.triggerMeteorScreenSequence(() => (this.projectToScreen ? this.projectToScreen(shadowWorldPos) : null));

    const root = new THREE.Group();
    root.name = 'meteor-strike-instance';
    root.position.copy(target);
    this.group.add(root);

    const pal = createMeteorPalette(this.mats);
    const shadowGeo = new THREE.PlaneGeometry(2, 2, 20, 20).rotateX(-Math.PI / 2);
    const blastCarpetGeo = new THREE.PlaneGeometry(2, 2, 20, 20).rotateX(-Math.PI / 2);
    const fireballDomeGeo = new THREE.IcosahedronGeometry(1.0, 3);
    this.geos.push(shadowGeo, blastCarpetGeo, fireballDomeGeo);

    const initialShadowR = 45 * Math.max(0.5, readWeatherParams().meteorShadowScale);
    conformTerrainGrid(shadowGeo, shadowWorldPos.x, shadowWorldPos.y, shadowWorldPos.z, initialShadowR, 0.18, opts.heightAt, 0, false);
    const shadowDisk = new THREE.Mesh(shadowGeo, pal.shadowMat);
    shadowDisk.position.set(initialShadowOffsetX, 0, initialShadowOffsetZ);
    shadowDisk.scale.set(initialShadowR, 1, initialShadowR);
    shadowDisk.frustumCulled = false;

    const reticleGroup = buildReticleGroup(target, opts.tiles, opts.heightAt, pal, this.geos);
    const { meteorGroup, wakeChunks } = buildMeteorBodyGroup(pal, this.geos);
    meteorGroup.position.set(30, 85, -25);

    conformTerrainGrid(blastCarpetGeo, target.x, target.y, target.z, BLAST_CARPET_RADIUS, 0.22, opts.heightAt, 0, false);
    const blastCarpet = new THREE.Mesh(blastCarpetGeo, pal.blastCarpetMat);
    blastCarpet.scale.set(BLAST_CARPET_RADIUS, 1, BLAST_CARPET_RADIUS);
    blastCarpet.frustumCulled = false;
    blastCarpet.userData.waterReflect = true;
    blastCarpet.visible = false;

    const fireballDome = new THREE.Mesh(fireballDomeGeo, pal.fireballDomeMat);
    fireballDome.position.y = 0.65;
    fireballDome.renderOrder = 2;
    fireballDome.userData.waterReflect = true;
    fireballDome.visible = false;

    root.add(shadowDisk, reticleGroup, meteorGroup, blastCarpet, fireballDome);
    const debris = buildDebrisParticles(root, pal, this.geos);
    const firstTile = opts.tiles?.[0];

    this.strikes.push({
      root, target, shadowWorldPos, q: opts.q ?? firstTile?.q, r: opts.r ?? firstTile?.r,
      age: 0, impacted: false, lastShadowRadius: initialShadowR, heightAt: opts.heightAt,
      shadowDisk, shadowMat: pal.shadowMat, reticleGroup, reticleMat: pal.reticleMat,
      meteorGroup, meteorVeinMat: pal.meteorVeinMat, meteorComaMat: pal.meteorComaMat,
      wakeChunks, blastCarpet, blastCarpetMat: pal.blastCarpetMat,
      fireballDome, fireballDomeMat: pal.fireballDomeMat, debris,
    });
    this.shakeAmp = Math.max(this.shakeAmp, 0.02);
    this.onShake?.(this.shakeAmp);
  }

  public hasDescendingStrike(): boolean {
    return this.strikes.some((s) => !s.impacted && s.age < METEOR_DESCENT_DURATION);
  }

  public getRemainingDescentTime(): number {
    let maxRem = 0;
    for (const s of this.strikes) {
      if (!s.impacted && s.age < METEOR_DESCENT_DURATION) maxRem = Math.max(maxRem, METEOR_DESCENT_DURATION - s.age);
    }
    return maxRem;
  }

  public hasDescendingStrikeNear(q: number, r: number): boolean {
    const [wx, wz] = tileXZ(q, r);
    return this.strikes.some(
      (s) => !s.impacted && s.age < METEOR_DESCENT_DURATION && ((s.q === q && s.r === r) || Math.hypot(s.target.x - wx, s.target.z - wz) < 8.5),
    );
  }

  public syncCraters(
    simCraters: ReadonlyArray<SimCraterRef> | undefined,
    axialToWorld: (q: number, r: number) => { x: number; z: number } = (q, r) => {
      const [x, z] = tileXZ(q, r);
      return { x, z };
    },
    heightAt: (x: number, z: number) => number = this.lastHeightAt,
  ): void {
    this.lastHeightAt = heightAt;
    const filtered = simCraters?.filter((c) => !this.hasDescendingStrikeNear(c.q, c.r));
    this.craterManager.syncCraters(filtered, axialToWorld, heightAt);
  }

  public getCraterCount(): number { return this.craterManager.getCount(); }

  public spawnPersistentCrater(wx: number, wz: number, opts?: { q?: number; r?: number }): CraterSiteInstance {
    return this.craterManager.spawnOrUpdateCrater(wx, wz, { q: opts?.q, r: opts?.r, heightAt: this.lastHeightAt });
  }

  public update(dt: number): void {
    const step = Math.max(0, dt);
    if (this.shakeAmp > 0) this.shakeAmp = Math.max(0, this.shakeAmp - step * 1.15);

    for (let i = this.strikes.length - 1; i >= 0; i--) {
      const s = this.strikes[i]!;
      s.age += step;
      if (s.age >= METEOR_TOTAL_DURATION) {
        this.group.remove(s.root);
        this.strikes.splice(i, 1);
        continue;
      }
      if (s.age < METEOR_DESCENT_DURATION) this.updateDescentStage(s, step);
      else this.updateImpactStage(s, step);
    }

    this.craterManager.update(step);
  }

  private updateDescentStage(s: ActiveMeteorStrike, dt: number): void {
    const u = Math.max(0, Math.min(1, s.age / METEOR_DESCENT_DURATION));
    const ease = u * u * (0.35 + 0.65 * u);
    const descentShake = 0.02 + 0.34 * ease;
    this.shakeAmp = Math.max(this.shakeAmp, descentShake);
    this.onShake?.(this.shakeAmp);
    const offsetX = 30 * (1 - ease), offsetY = 85 * (1 - ease), offsetZ = -25 * (1 - ease);
    const shadowOffsetX = offsetX * 0.85, shadowOffsetZ = offsetZ * 0.85;
    s.shadowWorldPos.set(s.target.x + shadowOffsetX, s.target.y, s.target.z + shadowOffsetZ);

    const shadowScale = Math.max(0.5, readWeatherParams().meteorShadowScale);
    let shadowR = 45 * shadowScale;
    if (s.age < METEOR_SHADOW_HOLD) {
      s.shadowMat.uniforms.uOpacity!.value = 0.88;
    } else {
      const shrinkU = (s.age - METEOR_SHADOW_HOLD) / (METEOR_DESCENT_DURATION - METEOR_SHADOW_HOLD);
      shadowR = 45 * shadowScale * (1 - shrinkU) + 9.5 * shrinkU;
      s.shadowMat.uniforms.uOpacity!.value = 0.92;
    }
    s.shadowMat.uniforms.uTime!.value = s.age;
    s.shadowDisk.position.set(shadowOffsetX, 0, shadowOffsetZ);
    s.shadowDisk.scale.set(shadowR, 1, shadowR);
    s.lastShadowRadius = shadowR;
    conformTerrainGrid(s.shadowDisk.geometry, s.shadowWorldPos.x, s.shadowWorldPos.y, s.shadowWorldPos.z, shadowR, 0.18, s.heightAt, 0, false);

    s.reticleMat.opacity = 0.55 + 0.4 * Math.sin(s.age * 16);
    s.meteorVeinMat.uniforms.uTime!.value = s.age * 2.0;
    s.meteorComaMat.uniforms.uTime!.value = s.age * 2.4;
    s.meteorComaMat.uniforms.uProgress!.value = 0.15;

    s.meteorGroup.position.set(offsetX, offsetY, offsetZ);
    s.meteorGroup.rotation.x += dt * 4.5;
    s.meteorGroup.rotation.y += dt * 3.2;

    for (let k = 0; k < s.wakeChunks.length; k++) {
      const w = s.wakeChunks[k]!;
      const trailT = (s.age * 3.8 + k / s.wakeChunks.length) % 1;
      const spread = 0.65 + trailT * 2.8;
      const ang = k * 2.1 + s.age * 5.5;
      w.position.set(-0.35 * trailT * 12 + Math.cos(ang) * spread, 0.85 * trailT * 14 + Math.sin(ang) * spread * 0.5, 0.29 * trailT * 12 + Math.sin(ang) * spread);
      w.scale.setScalar(Math.max(0.15, (1 - trailT) * 1.45));
    }

    if (s.age >= METEOR_DESCENT_DURATION - 0.18) {
      const preU = (s.age - (METEOR_DESCENT_DURATION - 0.18)) / 0.18;
      s.blastCarpet.visible = true;
      s.blastCarpetMat.uniforms.uProgress!.value = 0.08 * preU;
      s.blastCarpetMat.uniforms.uTime!.value = s.age;
      s.blastCarpetMat.uniforms.uOpacity!.value = preU * 0.85;
    }
  }

  private updateImpactStage(s: ActiveMeteorStrike, dt: number): void {
    if (!s.impacted) {
      s.impacted = true;
      s.shadowWorldPos.copy(s.target);
      s.meteorGroup.visible = false;
      s.reticleGroup.visible = false;
      s.shadowDisk.visible = false;
      conformTerrainGrid(s.blastCarpet.geometry, s.target.x, s.target.y, s.target.z, BLAST_CARPET_RADIUS, 0.22, s.heightAt, 0, false);
      s.blastCarpet.visible = true;
      s.fireballDome.visible = true;
      for (const d of s.debris) d.mesh.visible = true;
      this.craterManager.spawnOrUpdateCrater(s.target.x, s.target.z, {
        q: s.q, r: s.r, heightAt: s.heightAt ?? this.lastHeightAt, resetHeat: true,
      });
      this.shakeAmp = 1.1;
      this.onShake?.(1.1);
    }

    const postT = s.age - METEOR_DESCENT_DURATION;
    if (postT < 1.4) {
      const impactRumble = Math.max(0, 1.1 * Math.exp(-postT * 1.9));
      if (impactRumble > 0.025) {
        this.shakeAmp = Math.max(this.shakeAmp, impactRumble);
        this.onShake?.(this.shakeAmp);
      }
    }
    const norm = Math.max(0, Math.min(1, postT / (METEOR_TOTAL_DURATION - METEOR_DESCENT_DURATION)));
    const carpetU = Math.min(1, postT / 1.55);
    const domeU = Math.min(1, postT / 1.15);

    s.blastCarpetMat.uniforms.uProgress!.value = carpetU;
    s.blastCarpetMat.uniforms.uTime!.value = s.age;
    s.blastCarpetMat.uniforms.uOpacity!.value = Math.max(0, 1 - carpetU * carpetU);

    const domeHoriz = 1.2 + Math.pow(domeU, 0.55) * 4.2;
    const domeVert = 1.4 + Math.pow(domeU, 0.65) * 6.2;
    s.fireballDome.scale.set(domeHoriz, domeVert, domeHoriz);
    s.fireballDome.position.y = 0.65 + domeU * 3.2;
    s.fireballDomeMat.uniforms.uProgress!.value = domeU;
    s.fireballDomeMat.uniforms.uTime!.value = s.age;
    s.fireballDomeMat.uniforms.uOpacity!.value = Math.max(0, (1 - Math.pow(domeU, 1.4)) * 0.82);
    if (domeU >= 1) s.fireballDome.visible = false;

    for (const d of s.debris) {
      if (d.buoyant) {
        d.vel.x *= 1 - 0.85 * dt;
        d.vel.z *= 1 - 0.85 * dt;
        d.vel.y = Math.max(1.4, d.vel.y - 2.2 * dt);
        d.pos.addScaledVector(d.vel, dt);
      } else {
        d.vel.y -= GRAVITY * dt;
        d.pos.addScaledVector(d.vel, dt);
        const localFloorY = s.heightAt ? s.heightAt(s.target.x + d.pos.x, s.target.z + d.pos.z) - s.target.y : 0;
        if (d.pos.y <= localFloorY + 0.12 && d.vel.y < 0) {
          d.pos.y = localFloorY + 0.12;
          d.vel.y = -d.vel.y * BOUNCE;
          d.vel.x *= 0.68;
          d.vel.z *= 0.68;
          d.bounces++;
        }
      }
      d.mesh.position.copy(d.pos);
      d.mesh.rotation.x += d.rotVel.x * dt;
      d.mesh.rotation.y += d.rotVel.y * dt;
      d.mesh.rotation.z += d.rotVel.z * dt;
      const shrink = norm > 0.68 ? (1 - norm) / 0.32 : d.buoyant ? 1 + norm * 0.65 : 1;
      d.mesh.scale.setScalar(Math.max(0.01, d.baseScale * shrink));
    }
  }

  public getActiveCount(): number {
    return this.strikes.length;
  }

  public getCameraShake(): number {
    return this.shakeAmp;
  }

  public dispose(): void {
    this.craterManager.dispose();
    this.scene.remove(this.group);
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
    this.geos.length = 0;
    this.mats.length = 0;
    this.strikes.length = 0;
  }
}

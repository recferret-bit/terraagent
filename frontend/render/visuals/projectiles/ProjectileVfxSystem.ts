import * as THREE from 'three';
import { CombatBurstSystem } from '../../particles/CombatBurstSystem';
import { ArtilleryTrail } from './ArtilleryTrail';
import { CombatDynamicLights } from './CombatDynamicLights';
import {
  countActivePools,
  createProjectileVfxPools,
  DEFAULT_TILE_SIZE_M,
  hideInstance,
  LASER_BEAM_DURATION_S,
  meshForProjectileKind,
  writeImpactMatrix,
  writeLaserMatrix,
  writeProjectileMatrix,
  type ProjectileVfxPools,
  type ProjectileSlot,
} from './pools';
import {
  emitInsectDeathVfx,
  emitMechanicalDeathVfx,
  stepSmolderSites,
  type MechanicalDeathKind,
  type MechanicalDeathVfxInput,
  type SmolderSite,
} from './deathExplosions';
import {
  allocPoolSlot,
  clearGroundCratersNear,
  clearProjectileVfxPools,
  disposeProjectileVfxPools,
  releaseNoCraterZoneByOwner,
  spawnSmokePuffInPool,
  stepAuxiliaryPools,
} from './poolSteps';
import {
  emitFiredMuzzleEffects,
  emitImpactBurstsAndCrater,
  lookupWorldGroundNormal,
} from './fireHelpers';
import {
  axialToWorldVfxPoint,
  computeArcHeight,
  defaultFlightSpeedMps,
  evalParabolicArcY,
  resolveVfxWeaponKind,
} from './projectileMath';
import type {
  ActiveAoeDecalSnapshot,
  ActiveGroundCraterSnapshot,
  ActiveLaserSnapshot,
  ActiveProjectileSnapshot,
  ProjectileFiredVfxInput,
  ProjectileImpactVfxInput,
  ProjectileVfxActiveCounts,
  ProjectileVfxPoolConfig,
  SimProjectileFiredEventLike,
  SimProjectileFiredPayloadLike,
  SimProjectileImpactEventLike,
  SimProjectileImpactPayloadLike,
  VfxPoint3D,
  WorldHeightLookup,
} from './types';

export { DEFAULT_TILE_SIZE_M, LASER_BEAM_DURATION_S };
export { axialToWorldVfxPoint, computeArcHeight, evalParabolicArcY, resolveVfxWeaponKind };
export type { MechanicalDeathKind, MechanicalDeathVfxInput };

const SIM_TICKS_PER_SECOND = 5;
const TMP_COLOR = new THREE.Color();

export class ProjectileVfxSystem {
  private static nextLightSeq = 1;
  readonly group = new THREE.Group();
  readonly tileSizeM: number;
  private readonly pools: ProjectileVfxPools;
  private readonly bursts: CombatBurstSystem;
  private readonly artilleryTrail: ArtilleryTrail;
  private readonly lights: CombatDynamicLights;
  private readonly smolderSites: SmolderSite[] = [];
  private rngSeed = 0x5f3759df;
  private autocannonEjectSide: -1 | 1 = 1;

  constructor(parent?: THREE.Object3D, config: ProjectileVfxPoolConfig = {}) {
    this.group.name = 'ProjectileVfxSystem';
    this.tileSizeM = config.tileSizeM ?? DEFAULT_TILE_SIZE_M;
    this.lights = new CombatDynamicLights(
      `combat:${ProjectileVfxSystem.nextLightSeq++}`,
      config.emitDynamicLights ?? true,
    );
    parent?.add(this.group);
    this.pools = createProjectileVfxPools(this.group, config);
    this.bursts = new CombatBurstSystem(this.group);
    this.artilleryTrail = new ArtilleryTrail(this.group);
  }

  private nextRand(): number {
    this.rngSeed = (Math.imul(this.rngSeed, 1664525) + 1013904223) >>> 0;
    return this.rngSeed / 0xffffffff;
  }

  onProjectileFired(input: ProjectileFiredVfxInput): void {
    const kind = resolveVfxWeaponKind(input);
    const fromX = input.from.x;
    const fromY = input.from.y;
    const fromZ = input.from.z ?? 0;
    const toX = input.to.x;
    const toY = input.to.y;
    const toZ = input.to.z ?? 0;

    if (kind === 'laser') {
      this.spawnLaserBeam(fromX, fromY, fromZ, toX, toY, toZ, input.durationS ?? LASER_BEAM_DURATION_S, input.source);
      if (!input.suppressLight) {
        this.lights.push(fromX, fromY, fromZ, 0.35, 0.94, 1.0, 5.8, 3.2, input.durationS ?? LASER_BEAM_DURATION_S);
        this.lights.push(toX, toY, toZ, 0.25, 0.92, 1.0, 6.8, 3.6, (input.durationS ?? LASER_BEAM_DURATION_S) * 1.4);
        this.lights.sync(this.pools);
      }
      return;
    }

    const slotIdx = allocPoolSlot(this.pools.projectiles);
    const slot = this.pools.projectiles[slotIdx]!;
    hideInstance(meshForProjectileKind(this.pools, slot.weaponKind), slotIdx);

    const dx = toX - fromX;
    const dy = toY - fromY;
    const dz = toZ - fromZ;
    const horizDist = Math.hypot(dx, dz);
    const totalDist = Math.max(0.25, Math.hypot(dx, dy, dz));
    const speedMps = input.speed && input.speed > 0 ? input.speed : defaultFlightSpeedMps(kind);
    const durationS =
      input.durationS && input.durationS > 0 ? input.durationS : Math.max(0.08, totalDist / speedMps);

    const wid = input.weaponId?.toLowerCase() ?? '';
    const defaultScale =
      kind === 'shell' ? 0.56
      : wid === 'autocannon' ? 1.9
      : wid === 'recongun' ? 0.88
      : kind === 'rocket' ? 0.88
      : 1.0;

    slot.active = true;
    slot.weaponKind = kind;
    slot.weaponId = input.weaponId;
    slot.scale = input.projectileScale ?? defaultScale;
    slot.fromX = fromX;
    slot.fromY = fromY;
    slot.fromZ = fromZ;
    slot.toX = toX;
    slot.toY = toY;
    slot.toZ = toZ;
    slot.x = fromX;
    slot.y = fromY;
    slot.z = fromZ;
    slot.t = 0;
    slot.durationS = durationS;
    slot.arcHeight = input.arcHeight ?? computeArcHeight(kind, fromY, toY, horizDist, input.arc);
    slot.aoe = Math.max(0, input.aoe ?? 0);
    slot.autoImpactOnArrival = input.autoImpactOnArrival ?? true;
    slot.targetId = input.targetId;
    slot.targetIsInsect = input.targetIsInsect;
    slot.smokeCooldownS = 0;

    writeProjectileMatrix(this.pools, slotIdx, slot);
    this.autocannonEjectSide = emitFiredMuzzleEffects(
      this.pools,
      this.bursts,
      this.lights,
      () => this.nextRand(),
      this.autocannonEjectSide,
      input,
      kind,
      slot.arcHeight,
      dx,
      dy,
      dz,
    );
  }

  spawnProjectileFired(input: ProjectileFiredVfxInput): void {
    this.onProjectileFired(input);
  }

  private spawnLaserBeam(
    fromX: number,
    fromY: number,
    fromZ: number,
    toX: number,
    toY: number,
    toZ: number,
    durationS: number,
    source?: ProjectileFiredVfxInput['source'],
  ): void {
    const idx = allocPoolSlot(this.pools.lasers);
    const slot = this.pools.lasers[idx]!;
    slot.active = true;
    slot.fromX = fromX;
    slot.fromY = fromY;
    slot.fromZ = fromZ;
    slot.toX = toX;
    slot.toY = toY;
    slot.toZ = toZ;
    slot.ageS = 0;
    slot.source = source;
    slot.durationS = Math.max(0.02, durationS);
    writeLaserMatrix(this.pools, idx, slot);
  }

  onProjectileImpact(input: ProjectileImpactVfxInput): void {
    const kind = resolveVfxWeaponKind(input);
    const x = input.at.x;
    const y = input.at.y;
    const z = input.at.z ?? 0;

    const idx = allocPoolSlot(this.pools.impacts);
    const imp = this.pools.impacts[idx]!;
    imp.active = true;
    imp.x = x;
    imp.y = y;
    imp.z = z;
    imp.ageS = 0;
    imp.durationS = kind === 'rocket' || kind === 'shell' ? 0.16 : 0.1;
    imp.maxScale = kind === 'acid' ? 0 : kind === 'rocket' || kind === 'shell' ? 0.68 : 0.45;

    TMP_COLOR.setHex(kind === 'acid' ? 0x69f0ae : kind === 'laser' ? 0x84ffff : 0xffe082);
    this.pools.impactPool.mesh.setColorAt(idx, TMP_COLOR);
    if (this.pools.impactPool.mesh.instanceColor) {
      this.pools.impactPool.mesh.instanceColor.needsUpdate = true;
    }
    writeImpactMatrix(this.pools, idx, imp);
    emitImpactBurstsAndCrater(this.pools, this.bursts, this.lights, () => this.nextRand(), input, kind);
  }

  /** Dramatic randomized insect death burst: chitin explosion, ripped parts, massive green blood & ground puddle. */
  emitInsectDeath(opts: { at: VfxPoint3D; groundY?: number; scale?: number }): void {
    emitInsectDeathVfx(this.pools, this.bursts, this.lights, () => this.nextRand(), opts);
  }

  /** Explosion effect (fireball, shockwave, shrapnel, scorch decal, smoke plume & smolder) for bots and buildings. */
  emitMechanicalDeath(opts: MechanicalDeathVfxInput): void {
    emitMechanicalDeathVfx(this.pools, this.bursts, this.lights, this.smolderSites, () => this.nextRand(), opts);
  }

  emitBotDeath(opts: { at: VfxPoint3D; groundY?: number; scale?: number }): void {
    this.emitMechanicalDeath({ kind: 'bot', ...opts });
  }

  emitBuildingDeath(opts: { at: VfxPoint3D; groundY?: number; scale?: number }): void {
    this.emitMechanicalDeath({ kind: 'building', ...opts });
  }

  /** Clears ground craters within `radiusM` of `(x, z)` (e.g. under new wrecks or cleared wreckage). */
  clearCratersInRadius(x: number, z: number, radiusM: number, ownerId?: number): number {
    return clearGroundCratersNear(this.pools, x, z, radiusM, ownerId);
  }

  releaseNoCraterZone(ownerId: number): void {
    releaseNoCraterZoneByOwner(this.pools, ownerId);
  }

  spawnProjectileImpact(input: ProjectileImpactVfxInput): void {
    this.onProjectileImpact(input);
  }

  spawnFromSimFiredEvent(
    ev: SimProjectileFiredEventLike,
    heightLookup?: WorldHeightLookup,
    tileSizeM = this.tileSizeM,
  ): void {
    const data: SimProjectileFiredPayloadLike =
      ev && typeof ev === 'object' && 'data' in ev && ev.data ? ev.data : (ev as SimProjectileFiredPayloadLike);
    const fromQ = data.fromX ?? data.from?.x ?? data.from?.q ?? data.q ?? 0;
    const fromR = data.fromY ?? data.from?.y ?? data.from?.r ?? data.r ?? 0;
    const toQ = data.aimX ?? data.to?.x ?? data.to?.q ?? data.aimQ ?? fromQ;
    const toR = data.aimY ?? data.to?.y ?? data.to?.r ?? data.aimR ?? fromR;

    const fromPt = axialToWorldVfxPoint(fromQ, fromR, 0, tileSizeM);
    fromPt.y = (heightLookup ? heightLookup(fromPt.x, fromPt.z) : 0) + 0.6;
    const toPt = axialToWorldVfxPoint(toQ, toR, 0, tileSizeM);
    toPt.y = (heightLookup ? heightLookup(toPt.x, toPt.z) : 0) + 0.6;

    const kind = resolveVfxWeaponKind({
      weaponKind: data.weaponKind,
      weaponType: data.weaponType,
      weaponId: data.weaponId,
      arc: data.arc,
    });
    const durationS =
      kind === 'laser'
        ? LASER_BEAM_DURATION_S
        : data.flightTicks && data.flightTicks > 0
          ? data.flightTicks / SIM_TICKS_PER_SECOND
          : undefined;
    const speedMps = data.speed && data.speed > 0 ? data.speed * tileSizeM : undefined;

    this.onProjectileFired({
      weaponKind: kind,
      weaponType: data.weaponType,
      weaponId: data.weaponId,
      arc: data.arc === 'indirect' ? 'indirect' : 'direct',
      from: fromPt,
      to: toPt,
      speed: speedMps,
      durationS,
      aoe: data.aoe ?? 0,
    });
  }

  spawnFromSimImpactEvent(
    ev: SimProjectileImpactEventLike,
    heightLookup?: WorldHeightLookup,
    tileSizeM = this.tileSizeM,
    present: (input: ProjectileImpactVfxInput) => ProjectileImpactVfxInput = input => input,
  ): void {
    const data: SimProjectileImpactPayloadLike =
      ev && typeof ev === 'object' && 'data' in ev && ev.data ? ev.data : (ev as SimProjectileImpactPayloadLike);
    const atQ = data.aimX ?? data.at?.x ?? data.at?.q ?? data.to?.x ?? data.q ?? 0;
    const atR = data.aimY ?? data.at?.y ?? data.at?.r ?? data.to?.y ?? data.r ?? 0;
    const atPt = axialToWorldVfxPoint(atQ, atR, 0, tileSizeM);
    atPt.y = (heightLookup ? heightLookup(atPt.x, atPt.z) : 0) + 0.35;
    const groundNormal = lookupWorldGroundNormal(heightLookup, atPt.x, atPt.z);

    this.onProjectileImpact(present({
      weaponKind: resolveVfxWeaponKind(data),
      weaponType: data.weaponType,
      weaponId: data.weaponId,
      targetId: typeof data.targetId === 'number' ? data.targetId : undefined,
      at: atPt,
      groundY: atPt.y - 0.35,
      groundNormal,
      hit: data.hit,
      aoe: data.aoe ?? 0,
    }));
  }

  update(dtSeconds: number): void {
    if (dtSeconds <= 0) return;
    for (const beam of this.pools.lasers) {
      if (!beam.active || !beam.source) continue;
      const from = beam.source();
      beam.fromX = from.x; beam.fromY = from.y; beam.fromZ = from.z ?? 0;
    }
    this.lights.step(dtSeconds);
    this.bursts.update(dtSeconds);
    this.artilleryTrail.update(dtSeconds);
    stepSmolderSites(this.smolderSites, this.pools, () => this.nextRand(), dtSeconds);
    stepAuxiliaryPools(this.pools, dtSeconds);
    this.stepProjectiles(dtSeconds);
    this.lights.sync(this.pools);
  }

  private stepProjectiles(dt: number): void {
    for (let i = 0; i < this.pools.projectiles.length; i++) {
      const p = this.pools.projectiles[i]!;
      if (!p.active) continue;
      const previousT = p.t;
      p.t = Math.min(1, p.t + dt / p.durationS);
      p.x = p.fromX + (p.toX - p.fromX) * p.t;
      p.z = p.fromZ + (p.toZ - p.fromZ) * p.t;
      p.y = evalParabolicArcY(p.fromY, p.toY, p.arcHeight, p.t);
      if (p.weaponKind === 'shell') {
        this.traceShell(p, previousT);
        p.smokeCooldownS -= dt;
        if (p.smokeCooldownS <= 0) {
          p.smokeCooldownS = 0.018;
          spawnSmokePuffInPool(this.pools, () => this.nextRand(), p.x, p.y, p.z, 0.58, true);
        }
      }
      if (p.t >= 1) {
        p.t = 1;
        p.active = false;
        hideInstance(meshForProjectileKind(this.pools, p.weaponKind), i);
        if (p.autoImpactOnArrival) {
          this.onProjectileImpact({
            weaponKind: p.weaponKind,
            weaponId: p.weaponId,
            at: { x: p.toX, y: p.toY, z: p.toZ },
            aoe: p.aoe,
            targetId: p.targetId,
            targetIsInsect: p.targetIsInsect,
          });
        }
        continue;
      }
      if (p.weaponKind === 'acid') this.shedAcid(p, dt);
      if (p.weaponKind === 'rocket') {
        p.smokeCooldownS -= dt;
        if (p.smokeCooldownS <= 0) {
          p.smokeCooldownS = 0.022;
          spawnSmokePuffInPool(this.pools, () => this.nextRand(), p.x, p.y, p.z, 0.68, true);
        }
      }
      writeProjectileMatrix(this.pools, i, p);
    }
  }

  private shedAcid(p: ProjectileSlot, dt: number): void {
    p.smokeCooldownS -= dt;
    if (p.smokeCooldownS > 0) return;
    p.smokeCooldownS = 0.07;
    const reverse = new THREE.Vector3(p.fromX - p.toX,
      p.fromY - p.toY - 4 * p.arcHeight * (1 - 2 * p.t), p.fromZ - p.toZ).normalize();
    this.bursts.emit('combat.acidTrail', { at: new THREE.Vector3(p.x, p.y, p.z).addScaledVector(reverse, 0.18),
      normal: reverse, groundY: Math.min(p.fromY, p.toY) - 0.35 });
  }

  private traceShell(p: ProjectileSlot, previousT: number): void {
    const start = Math.max(previousT, p.t - 0.24 / p.durationS);
    const steps = Math.max(1, Math.ceil((p.t - start) * p.durationS / 0.025));
    const at = (t: number) => new THREE.Vector3(
      p.fromX + (p.toX - p.fromX) * t,
      evalParabolicArcY(p.fromY, p.toY, p.arcHeight, t),
      p.fromZ + (p.toZ - p.fromZ) * t,
    );
    let previous = at(start);
    for (let i = 1; i <= steps; i++) {
      const current = at(start + (p.t - start) * i / steps);
      this.artilleryTrail.add(previous, current);
      previous = current;
    }
  }

  getBurstCounts(): Record<string, number> { return this.bursts.counts(); }
  getArtilleryTrailCount(): number { return this.artilleryTrail.count; }
  getSmolderSiteCount(): number { return this.smolderSites.length; }

  getActiveCounts(): ProjectileVfxActiveCounts {
    return countActivePools(this.pools);
  }

  getActiveProjectiles(): readonly ActiveProjectileSnapshot[] {
    return this.pools.projectiles.filter((p) => p.active);
  }

  getActiveLasers(): readonly ActiveLaserSnapshot[] {
    return this.pools.lasers.filter((l) => l.active);
  }

  getActiveAoeDecals(): readonly ActiveAoeDecalSnapshot[] {
    return this.pools.aoeDecals.filter((d) => d.active);
  }

  getActiveCraters(): readonly ActiveGroundCraterSnapshot[] {
    return this.pools.craters.filter((c) => c.active);
  }

  clear(): void {
    clearProjectileVfxPools(this.pools);
    this.bursts.clear();
    this.artilleryTrail.clear();
    this.lights.clear();
    this.smolderSites.length = 0;
    this.autocannonEjectSide = 1;
  }

  dispose(): void {
    this.clear();
    disposeProjectileVfxPools(this.pools);
    this.bursts.dispose();
    this.artilleryTrail.dispose();
    this.group.removeFromParent();
  }
}

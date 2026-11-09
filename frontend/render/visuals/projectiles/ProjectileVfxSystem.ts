import * as THREE from 'three';
import { CombatBurstSystem } from '../../particles/CombatBurstSystem';
import { ArtilleryTrail } from './ArtilleryTrail';
import {
  clearProjectileVfxPools,
  countActivePools,
  createProjectileVfxPools,
  DEFAULT_TILE_SIZE_M,
  disposeProjectileVfxPools,
  hideInstance,
  LASER_BEAM_DURATION_S,
  meshForProjectileKind,
  stepAuxiliaryPools,
  writeImpactMatrix,
  writeLaserMatrix,
  writeProjectileMatrix,
  writeSmokeMatrix,
  type ProjectileVfxPools,
  type ProjectileSlot,
} from './pools';
import type {
  ActiveAoeDecalSnapshot,
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
  VfxWeaponKind,
  WorldHeightLookup,
} from './types';

export { DEFAULT_TILE_SIZE_M, LASER_BEAM_DURATION_S };

const SIM_TICKS_PER_SECOND = 5;
const TMP_COLOR = new THREE.Color();

export function axialToWorldVfxPoint(
  q: number,
  r: number,
  heightY = 0.6,
  tileSizeM = DEFAULT_TILE_SIZE_M,
): { x: number; y: number; z: number } {
  return {
    x: (q + r / 2) * tileSizeM,
    y: heightY,
    z: ((r * Math.sqrt(3)) / 2) * tileSizeM,
  };
}

export function evalParabolicArcY(y0: number, y1: number, arcHeight: number, t: number): number {
  const clamped = Math.max(0, Math.min(1, t));
  return y0 + (y1 - y0) * clamped + 4 * arcHeight * clamped * (1 - clamped);
}

export function resolveVfxWeaponKind(input: {
  weaponKind?: VfxWeaponKind | string;
  weaponType?: string;
  weaponId?: string;
  arc?: string;
}): VfxWeaponKind {
  const kind = input.weaponKind?.toLowerCase();
  if (
    kind === 'bullet' ||
    kind === 'shell' ||
    kind === 'rocket' ||
    kind === 'laser' ||
    kind === 'acid'
  ) {
    return kind;
  }
  const wt = input.weaponType?.toLowerCase() ?? '';
  const wid = input.weaponId?.toLowerCase() ?? '';
  if (wt === 'laser' || wid.includes('laser') || wid.includes('beam')) return 'laser';
  if (wt === 'acid' || wid.includes('acid') || wid.includes('spitter')) return 'acid';
  if (
    wt === 'shell' ||
    wid.includes('shell') ||
    wid.includes('artillery') ||
    input.arc === 'indirect'
  ) {
    return 'shell';
  }
  if (wt === 'rocket' || wid.includes('rocket') || wid.includes('missile')) return 'rocket';
  return 'bullet';
}

function defaultFlightSpeedMps(kind: Exclude<VfxWeaponKind, 'laser'>): number {
  switch (kind) {
    case 'bullet':
      return 28;
    case 'rocket':
      return 18;
    case 'shell':
      return 14;
    case 'acid':
      return 15;
  }
}

export function computeArcHeight(
  kind: Exclude<VfxWeaponKind, 'laser'>,
  y0: number,
  y1: number,
  horizDist: number,
  arcHint?: 'direct' | 'indirect',
): number {
  const halfDeltaY = Math.abs(y1 - y0) * 0.5;
  if (kind === 'shell' || arcHint === 'indirect') {
    return halfDeltaY + Math.max(1.8, Math.min(9.0, horizDist * 0.34));
  }
  if (kind === 'acid') {
    return halfDeltaY + Math.max(0.85, Math.min(4.5, horizDist * 0.2));
  }
  return 0;
}

export class ProjectileVfxSystem {
  readonly group = new THREE.Group();
  readonly tileSizeM: number;
  private readonly pools: ProjectileVfxPools;
  private readonly bursts: CombatBurstSystem;
  private readonly artilleryTrail: ArtilleryTrail;
  private rngSeed = 0x5f3759df;

  constructor(parent?: THREE.Object3D, config: ProjectileVfxPoolConfig = {}) {
    this.group.name = 'ProjectileVfxSystem';
    this.tileSizeM = config.tileSizeM ?? DEFAULT_TILE_SIZE_M;
    parent?.add(this.group);
    this.pools = createProjectileVfxPools(this.group, config);
    this.bursts = new CombatBurstSystem(this.group);
    this.artilleryTrail = new ArtilleryTrail(this.group);
  }

  private nextRand(): number {
    this.rngSeed = (Math.imul(this.rngSeed, 1664525) + 1013904223) >>> 0;
    return this.rngSeed / 0xffffffff;
  }

  private allocSlot<T extends { active: boolean }>(pool: readonly T[]): number {
    for (let i = 0; i < pool.length; i++) {
      if (!pool[i]!.active) return i;
    }
    return 0;
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
      return;
    }

    const slotIdx = this.allocSlot(this.pools.projectiles);
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

    slot.active = true;
    slot.weaponKind = kind;
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
    slot.smokeCooldownS = 0;

    writeProjectileMatrix(this.pools, slotIdx, slot);
    if (kind !== 'acid') {
      const axis = input.direction?.();
      const normal = axis ? new THREE.Vector3(axis.x, axis.y, axis.z ?? 0)
        : new THREE.Vector3(dx, dy + 4 * slot.arcHeight, dz).normalize();
      this.bursts.emit('combat.muzzle', { at: new THREE.Vector3(fromX, fromY, fromZ), normal,
        groundY: fromY - 1, scale: kind === 'shell' ? 1.4 : 1,
        source: input.source, direction: input.direction });
    }
    if (kind === 'rocket') {
      this.spawnSmokePuff(fromX, fromY, fromZ);
    }
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
    const idx = this.allocSlot(this.pools.lasers);
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

  private spawnSmokePuff(x: number, y: number, z: number): void {
    const idx = this.allocSlot(this.pools.smokePuffs);
    const puff = this.pools.smokePuffs[idx]!;
    puff.active = true;
    puff.x = x + (this.nextRand() - 0.5) * 0.14;
    puff.y = y + (this.nextRand() - 0.5) * 0.14;
    puff.z = z + (this.nextRand() - 0.5) * 0.14;
    puff.vx = (this.nextRand() - 0.5) * 0.7;
    puff.vy = 0.45 + this.nextRand() * 0.55;
    puff.vz = (this.nextRand() - 0.5) * 0.7;
    puff.ageS = 0;
    puff.durationS = 0.38 + this.nextRand() * 0.18;
    puff.baseScale = 0.75 + this.nextRand() * 0.45;
    writeSmokeMatrix(this.pools, idx, puff);
  }

  onProjectileImpact(input: ProjectileImpactVfxInput): void {
    const kind = resolveVfxWeaponKind(input);
    const x = input.at.x;
    const y = input.at.y;
    const z = input.at.z ?? 0;

    const idx = this.allocSlot(this.pools.impacts);
    const imp = this.pools.impacts[idx]!;
    imp.active = true;
    imp.x = x;
    imp.y = y;
    imp.z = z;
    imp.ageS = 0;
    imp.durationS = 0.1;
    imp.maxScale = kind === 'acid' ? 0 : 0.45;

    TMP_COLOR.setHex(kind === 'acid' ? 0x69f0ae : kind === 'laser' ? 0x84ffff : 0xffe082);
    this.pools.impactPool.mesh.setColorAt(idx, TMP_COLOR);
    if (this.pools.impactPool.mesh.instanceColor) {
      this.pools.impactPool.mesh.instanceColor.needsUpdate = true;
    }
    writeImpactMatrix(this.pools, idx, imp);

    const preset = kind === 'rocket' ? 'rocket' : kind === 'shell' ? 'artillery'
      : kind === 'laser' ? 'laserHit' : kind === 'acid' ? 'acidHit' : 'impact';
    const n = input.normal;
    this.bursts.emit(`combat.${preset}`, {
      at: new THREE.Vector3(x, y, z), normal: n ? new THREE.Vector3(n.x, n.y, n.z ?? 0) : new THREE.Vector3(0, 1, 0),
      groundY: input.groundY ?? y - 0.35, scale: kind === 'rocket' || kind === 'shell' ? 1.25 : 1,
    });
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

    this.onProjectileImpact(present({
      weaponKind: resolveVfxWeaponKind(data),
      weaponType: data.weaponType,
      weaponId: data.weaponId,
      at: atPt,
      groundY: atPt.y - 0.35,
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
    this.bursts.update(dtSeconds);
    this.artilleryTrail.update(dtSeconds);
    stepAuxiliaryPools(this.pools, dtSeconds);
    this.stepProjectiles(dtSeconds);
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
      if (p.weaponKind === 'shell') this.traceShell(p, previousT);
      if (p.t >= 1) {
        p.t = 1;
        p.active = false;
        hideInstance(meshForProjectileKind(this.pools, p.weaponKind), i);
        if (p.autoImpactOnArrival) {
          this.onProjectileImpact({
            weaponKind: p.weaponKind,
            at: { x: p.toX, y: p.toY, z: p.toZ },
            aoe: p.aoe,
          });
        }
        continue;
      }
      if (p.weaponKind === 'acid') this.shedAcid(p, dt);
      if (p.weaponKind === 'rocket') {
        p.smokeCooldownS -= dt;
        if (p.smokeCooldownS <= 0) {
          p.smokeCooldownS = 0.025;
          this.spawnSmokePuff(p.x, p.y, p.z);
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

  clear(): void {
    clearProjectileVfxPools(this.pools);
    this.bursts.clear();
    this.artilleryTrail.clear();
  }

  dispose(): void {
    disposeProjectileVfxPools(this.pools);
    this.bursts.dispose();
    this.artilleryTrail.dispose();
    this.group.removeFromParent();
  }
}

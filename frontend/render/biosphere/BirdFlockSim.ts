import type { PlanetKind } from '../planets/PlanetSpec';
import { ObjectPool } from '../pools/ObjectPool';
import { PooledSlotObject } from '../pools/PooledObject';
import { mulberry32 } from '../visuals/terrain/noise';
import type {
  BiosphereAggressor,
  BiosphereBattleHotspot,
  BiosphereHabitatIndex,
  BirdFlock,
  BirdMemberState,
  BirdSpeciesSpec,
} from './biosphereTypes';
import { evaluateFlockThreats, pickAnchorsForPref } from './birdFlockThreats';
import {
  computeFormationSlotTangent,
  computeFormationSlotTarget,
  defaultFormationForPattern,
  minCurveRateFloor,
  sampleCurveDifferential,
  samplePatternCurve,
  wrapAngleDelta,
} from './birdFormations';
import { BIRDS_BY_BIOME } from './speciesCatalog';

/** Default number of preloaded groups per bird species for the active planet biome. */
export const DEFAULT_BIRD_GROUPS_PER_SPECIES = 2;

export interface BirdFlockSimulatorOptions {
  readonly groupsPerSpecies?: number;
  readonly speciesOverride?: readonly BirdSpeciesSpec[];
  readonly prebuiltFlocks?: readonly BirdFlock[];
}

function makeEmptyBirdMember(): BirdMemberState {
  return {
    x: 0, y: 10, z: 0, vx: 1, vy: 0, vz: 0,
    yaw: 0, pitch: 0, roll: 0, phase: 0, flapWeight: 0.5, scale: 0.65, wingFreqScale: 1,
  };
}

function computeTargetFlapWeight(flock: BirdFlock, m: BirdMemberState, idx: number, elapsed: number, fleeing: boolean): number {
  if (fleeing) return 1.0;
  const sp = flock.species;
  const vy = m.vy ?? 0;
  if (sp.flapBase < 0.50) {
    const powerCycle = Math.sin(elapsed * (0.78 + 0.12 * (idx % 2)) + flock.id * 1.9 + idx * 0.42);
    if (powerCycle > 0.50 || vy > 0.14) return 0.84;
    return sp.flapBase;
  }
  if (sp.sizeClass === 'medium') {
    const glideDip = Math.sin(elapsed * 1.35 + flock.id * 1.3 + idx * 0.48);
    if (glideDip < -0.72 && vy <= 0.12) return 0.22;
  }
  if (vy > 0.22) return Math.min(1, sp.flapBase + 0.28);
  if (vy < -0.35) return Math.max(0.14, sp.flapBase * 0.55);
  return sp.flapBase;
}

interface FlockStepContext {
  readonly flock: BirdFlock;
  readonly prevAng: number;
  readonly prevBaseY: number;
  readonly prevAnchorX: number;
  readonly prevAnchorZ: number;
  readonly anchorX: number;
  readonly anchorZ: number;
  readonly lx0: number;
  readonly ly0: number;
  readonly lz0: number;
  readonly lx: number;
  readonly ly: number;
  readonly lz: number;
  readonly fwdX: number;
  readonly fwdZ: number;
  readonly baseY: number;
  readonly elapsed: number;
  readonly desiredSpeed: number;
  readonly fleeing: boolean;
  readonly velBlend: number;
  readonly rotBlend: number;
  readonly stepDt: number;
}

function advancePooledMember(m: BirdMemberState, idx: number, ctx: FlockStepContext): void {
  const {
    flock, prevAng, prevBaseY, prevAnchorX, prevAnchorZ, anchorX, anchorZ,
    lx0, ly0, lz0, lx, ly, lz, fwdX, fwdZ, baseY, elapsed, desiredSpeed, fleeing, velBlend, rotBlend, stepDt,
  } = ctx;
  const [tx0, , tz0] = computeFormationSlotTarget(
    flock, idx, lx0, ly0, lz0, fwdX, fwdZ, prevBaseY, elapsed - stepDt, prevAng, prevAnchorX, prevAnchorZ,
  );
  const [tx, ty, tz] = computeFormationSlotTarget(
    flock, idx, lx, ly, lz, fwdX, fwdZ, baseY, elapsed, flock.orbitAngle, anchorX, anchorZ,
  );
  const [refFwdX, refFwdZ] = computeFormationSlotTangent(
    flock, idx, flock.orbitAngle, elapsed, baseY, anchorX, anchorZ,
  );

  const slotDx = tx - tx0, slotDz = tz - tz0;
  const slotLen = Math.hypot(slotDx, slotDz);
  let tanX = refFwdX, tanZ = refFwdZ;
  let feedSpeed = desiredSpeed;
  if (slotLen > 1e-4 && stepDt > 1e-5) {
    const rx = slotDx / slotLen, rz = slotDz / slotLen;
    const align = rx * refFwdX + rz * refFwdZ;
    const w = Math.max(0, Math.min(1, align / 0.65));
    const bx = refFwdX * (1 - w) + rx * w;
    const bz = refFwdZ * (1 - w) + rz * w;
    const bl = Math.max(1e-4, Math.hypot(bx, bz));
    tanX = bx / bl;
    tanZ = bz / bl;
    const rawSlotSpd = (slotLen / stepDt) * Math.max(0.55, rx * tanX + rz * tanZ);
    feedSpeed = w > 0.25 ? Math.max(desiredSpeed * 0.72, Math.min(desiredSpeed * 1.32, rawSlotSpd)) : desiredSpeed * 0.75;
  }

  const errX = tx - m.x, errY = ty - m.y, errZ = tz - m.z;
  const errDist = Math.hypot(errX, errZ);
  const maxCorr = desiredSpeed * (fleeing ? 0.95 : 0.65);
  const corrScale = errDist > 1e-4 ? Math.min(maxCorr, errDist * 1.35) / errDist : 0;

  let desVx = tanX * feedSpeed + errX * corrScale;
  let desVz = tanZ * feedSpeed + errZ * corrScale;
  const desSpd = Math.hypot(desVx, desVz);
  if (desSpd > desiredSpeed * 1.38) {
    const s = (desiredSpeed * 1.38) / desSpd;
    desVx *= s; desVz *= s;
  } else if (desSpd < desiredSpeed * 0.70) {
    const s = (desiredSpeed * 0.70) / Math.max(1e-4, desSpd);
    desVx *= s; desVz *= s;
  }
  const desVy = Math.max(-3.6, Math.min(3.6, errY * 1.75));

  m.vx += (desVx - m.vx) * velBlend;
  m.vz += (desVz - m.vz) * velBlend;
  m.vy = (m.vy ?? 0) + (desVy - (m.vy ?? 0)) * velBlend;
  m.x += m.vx * stepDt;
  m.y += m.vy * stepDt;
  m.z += m.vz * stepDt;

  const spdXZ = Math.hypot(m.vx, m.vz);
  const targetYaw = spdXZ > 0.08 ? Math.atan2(m.vx, m.vz) : m.yaw;
  const dYaw = wrapAngleDelta(targetYaw - m.yaw);
  const maxStepYaw = (fleeing ? 3.2 : 2.3) * stepDt;
  const stepYaw = Math.max(-maxStepYaw, Math.min(maxStepYaw, dYaw * rotBlend));
  m.yaw = wrapAngleDelta(m.yaw + stepYaw);

  const yawRate = stepYaw / Math.max(0.016, stepDt);
  m.roll += (Math.max(-0.48, Math.min(0.48, -yawRate * 0.16)) - m.roll) * rotBlend;
  m.pitch += (Math.max(-0.28, Math.min(0.28, -Math.atan2(m.vy, Math.max(0.5, spdXZ)) * 0.62)) - m.pitch) * rotBlend;

  const freqScale = m.wingFreqScale ?? Math.pow(flock.species.scale / Math.max(0.25, m.scale), 0.75);
  m.phase += stepDt * (freqScale - 1);

  const targetFlap = computeTargetFlapWeight(flock, m, idx, elapsed, fleeing);
  m.flapWeight = fleeing ? 1.0 : m.flapWeight + (targetFlap - m.flapWeight) * (1 - Math.exp(-stepDt * 4.5));
}

export class BirdFlockSimulator {
  readonly speciesList: readonly BirdSpeciesSpec[];
  readonly flocks: BirdFlock[] = [];
  readonly pools = new Map<string, ObjectPool<PooledSlotObject<BirdMemberState>>>();
  readonly groupsPerSpecies: number;
  private elapsed = 0;

  constructor(biome: PlanetKind, seed: number, habitat: BiosphereHabitatIndex, opts: BirdFlockSimulatorOptions = {}) {
    this.speciesList = opts.speciesOverride ?? BIRDS_BY_BIOME[biome];
    this.groupsPerSpecies = Math.max(1, Math.floor(opts.groupsPerSpecies ?? DEFAULT_BIRD_GROUPS_PER_SPECIES));

    for (const spec of this.speciesList) {
      const maxMembers = this.groupsPerSpecies * spec.flockSize[1];
      this.pools.set(
        spec.id,
        new ObjectPool<PooledSlotObject<BirdMemberState>>({
          key: `bird:${spec.id}`,
          initialSize: maxMembers,
          threshold: maxMembers,
          hardCap: true,
          create: (slotIdx, key) => new PooledSlotObject<BirdMemberState>(key, slotIdx, makeEmptyBirdMember()),
        }),
      );
    }

    if (opts.prebuiltFlocks !== undefined) {
      this.hydrateFlocks(opts.prebuiltFlocks);
      return;
    }
    this.seedBiomeFlocks(seed, habitat);
  }

  private hydrateFlocks(prebuilt: readonly BirdFlock[]): void {
    for (const src of prebuilt) {
      const spec = this.speciesList[src.speciesSlot] ?? src.species;
      const pool = this.pools.get(spec.id);
      const members: BirdMemberState[] = [];
      for (const mSrc of src.members) {
        const slot = pool?.tryAcquire();
        const m = slot ? slot.data : makeEmptyBirdMember();
        Object.assign(m, mSrc);
        members.push(m);
      }
      this.flocks.push({
        ...src,
        species: spec,
        targetX: src.targetX ?? src.homeX,
        targetZ: src.targetZ ?? src.homeZ,
        anchorX: src.anchorX ?? src.homeX,
        anchorZ: src.anchorZ ?? src.homeZ,
        orbitDir: src.orbitDir ?? 1,
        fleeAltBoost: src.fleeAltBoost ?? 0,
        formation: src.formation ?? defaultFormationForPattern(spec),
        members,
      });
    }
  }

  private seedBiomeFlocks(seed: number, habitat: BiosphereHabitatIndex): void {
    const rng = mulberry32(seed ^ 0x51a7b3);
    let flockId = 0;
    this.speciesList.forEach((spec, slot) => {
      const anchors = pickAnchorsForPref(spec, habitat);
      const pool = this.pools.get(spec.id)!;
      const formation = defaultFormationForPattern(spec);
      for (let f = 0; f < this.groupsPerSpecies; f++) {
        const anchor = anchors[(f * 7 + slot * 3) % anchors.length]!;
        const count = spec.flockSize[0] + Math.floor(rng() * (spec.flockSize[1] - spec.flockSize[0] + 1));
        const baseY = Math.max(0, habitat.heightAt(anchor.x, anchor.z));
        const orbitAngle = rng() * Math.PI * 2;
        const orbitDir: 1 | -1 = f % 2 === 0 ? 1 : -1;
        const defaultState =
          spec.pattern === 'thermalSoar' ? 'SOARING' : spec.pattern === 'waterSkim' ? 'SKIMMING' : 'PATROLLING';
        const flock: BirdFlock = {
          id: flockId++, species: spec, speciesSlot: slot, pattern: spec.pattern, formation, state: defaultState,
          homeX: anchor.x, homeZ: anchor.z, homeTileIndex: spec.habitatPref === 'forest' ? anchor.tileIndex : -1,
          targetX: anchor.x, targetZ: anchor.z, anchorX: anchor.x, anchorZ: anchor.z,
          orbitAngle, orbitDir, headingYaw: 0, cruiseBaseY: baseY,
          fleeAltBoost: 0, stateTimer: 0, relocations: 0, members: [],
        };
        const [lx, ly, lz] = samplePatternCurve(flock, orbitAngle, 0, baseY, anchor.x, anchor.z);
        const diff = sampleCurveDifferential(flock, orbitAngle, 0, baseY, anchor.x, anchor.z);
        const dAng = orbitDir * (spec.speed * 0.05) / Math.max(minCurveRateFloor(flock), diff.dSdAngle);
        const [nx, ny, nz] = samplePatternCurve(flock, orbitAngle + dAng, 0.05, baseY, anchor.x, anchor.z);
        const initYaw = Math.atan2(diff.fwdX, diff.fwdZ);
        flock.headingYaw = initYaw;

        for (let i = 0; i < count; i++) {
          const member = pool.acquire().data;
          const [sx, sy, sz] = computeFormationSlotTarget(flock, i, lx, ly, lz, diff.fwdX, diff.fwdZ, baseY, 0, orbitAngle, anchor.x, anchor.z);
          const [sxNext, syNext, szNext] = computeFormationSlotTarget(flock, i, nx, ny, nz, diff.fwdX, diff.fwdZ, baseY, 0.05, orbitAngle + dAng, anchor.x, anchor.z);
          const mDx = sxNext - sx, mDz = szNext - sz;
          const mLen = Math.hypot(mDx, mDz);
          const mYaw = mLen > 1e-4 ? Math.atan2(mDx, mDz) : initYaw;
          const initSpd = mLen > 1e-4 ? Math.max(spec.speed * 0.68, Math.min(spec.speed * 1.32, mLen / 0.05)) : spec.speed;
          const scale = spec.scale * (0.86 + rng() * 0.28);
          const wingFreqScale = Math.pow(spec.scale / Math.max(0.25, scale), 0.75);
          const phase = formation === 'veeEchelon' || formation === 'jEchelon' ? -Math.ceil(i / 2) * 0.55 + rng() * 0.25 : rng() * 16;
          Object.assign(member, {
            x: sx, y: sy, z: sz, vx: Math.sin(mYaw) * initSpd, vy: Math.max(-2.5, Math.min(2.5, (syNext - sy) / 0.05)), vz: Math.cos(mYaw) * initSpd,
            yaw: mYaw, pitch: 0, roll: 0, phase, flapWeight: spec.flapBase, scale, wingFreqScale,
          });
          flock.members.push(member);
        }
        this.flocks.push(flock);
      }
    });
  }

  step(
    dt: number,
    habitat: BiosphereHabitatIndex,
    aggressors: readonly BiosphereAggressor[],
    battles: readonly BiosphereBattleHotspot[],
    disturbances: readonly BiosphereBattleHotspot[] = [],
  ): void {
    const stepDt = Math.min(0.1, Math.max(0, dt));
    if (stepDt <= 0) return;
    this.elapsed += stepDt;
    for (const flock of this.flocks) this.stepSingleFlock(flock, stepDt, habitat, aggressors, battles, disturbances);
  }

  private stepSingleFlock(
    flock: BirdFlock,
    stepDt: number,
    habitat: BiosphereHabitatIndex,
    aggressors: readonly BiosphereAggressor[],
    battles: readonly BiosphereBattleHotspot[],
    disturbances: readonly BiosphereBattleHotspot[],
  ): void {
    const leader = flock.members[0];
    if (!leader) return;

    if (flock.homeX !== flock.targetX || flock.homeZ !== flock.targetZ) {
      flock.targetX = flock.homeX;
      flock.targetZ = flock.homeZ;
      flock.anchorX = flock.homeX;
      flock.anchorZ = flock.homeZ;
    } else {
      flock.anchorX ??= flock.homeX;
      flock.anchorZ ??= flock.homeZ;
    }

    evaluateFlockThreats(flock, leader.x, leader.z, habitat, aggressors, battles, disturbances);

    const fleeing =
      flock.state === 'FLEEING_FOREST' || flock.state === 'FLEEING_BATTLE' || flock.state === 'FLEEING_AGGRESSOR';
    if (flock.stateTimer > 0) {
      flock.stateTimer -= stepDt;
      if (flock.stateTimer <= 0) {
        flock.state = flock.pattern === 'thermalSoar' ? 'SOARING' : flock.pattern === 'waterSkim' ? 'SKIMMING' : 'PATROLLING';
      }
    }
    if (!habitat.isInBounds(flock.homeX, flock.homeZ)) {
      const pull = (1 - Math.exp(-stepDt * 3.0)) * 0.35;
      flock.homeX -= flock.homeX * pull;
      flock.homeZ -= flock.homeZ * pull;
      flock.targetX = flock.homeX;
      flock.targetZ = flock.homeZ;
    }

    const desiredSpeed = flock.species.speed * (fleeing ? 1.55 : 1.0);
    const prevAnchorX = flock.anchorX;
    const prevAnchorZ = flock.anchorZ;
    const driftDx = flock.targetX - prevAnchorX;
    const driftDz = flock.targetZ - prevAnchorZ;
    const driftDist = Math.hypot(driftDx, driftDz);
    if (driftDist > 1e-4) {
      const maxDriftSpd = desiredSpeed * 0.38;
      const stepMove = Math.min(driftDist, Math.min(maxDriftSpd, driftDist * 1.8) * stepDt);
      flock.anchorX = prevAnchorX + (driftDx / driftDist) * stepMove;
      flock.anchorZ = prevAnchorZ + (driftDz / driftDist) * stepMove;
    }

    const anchorGroundY = Math.max(0, habitat.heightAt(flock.anchorX, flock.anchorZ));
    const prevBaseY = flock.cruiseBaseY ?? anchorGroundY;
    flock.cruiseBaseY = prevBaseY + (anchorGroundY - prevBaseY) * (1 - Math.exp(-stepDt * 1.2));
    flock.fleeAltBoost = (flock.fleeAltBoost ?? 0) + ((fleeing ? 2.8 : 0) - (flock.fleeAltBoost ?? 0)) * (1 - Math.exp(-stepDt * 2.2));
    const baseY = flock.cruiseBaseY;

    const orbitSpeed = driftDist > 0.25 ? desiredSpeed * 0.94 : desiredSpeed;
    const prevAng = flock.orbitAngle;
    const diff0 = sampleCurveDifferential(flock, prevAng, this.elapsed - stepDt, prevBaseY, prevAnchorX, prevAnchorZ);
    const dir = flock.orbitDir ?? 1;
    flock.orbitAngle += dir * (orbitSpeed * stepDt) / Math.max(minCurveRateFloor(flock), diff0.dSdAngle);

    const [lx0, ly0, lz0] = samplePatternCurve(flock, prevAng, this.elapsed - stepDt, prevBaseY, prevAnchorX, prevAnchorZ);
    const [lx, ly, lz] = samplePatternCurve(flock, flock.orbitAngle, this.elapsed, baseY, flock.anchorX, flock.anchorZ);
    const diff1 = sampleCurveDifferential(flock, flock.orbitAngle, this.elapsed, baseY, flock.anchorX, flock.anchorZ);
    const rawHeading = Math.atan2(diff1.fwdX, diff1.fwdZ);
    const prevHeading = flock.headingYaw ?? rawHeading;
    const maxFlockTurn = (fleeing ? 3.2 : 2.2) * stepDt;
    const dFlockYaw = wrapAngleDelta(rawHeading - prevHeading) * (1 - Math.exp(-stepDt * 4.0));
    flock.headingYaw = wrapAngleDelta(prevHeading + Math.max(-maxFlockTurn, Math.min(maxFlockTurn, dFlockYaw)));

    const fwdX = Math.sin(flock.headingYaw), fwdZ = Math.cos(flock.headingYaw);
    const tightOrbitGain = Math.max(1, 6.0 / Math.max(1.5, flock.species.orbitRadius));
    const ctx: FlockStepContext = {
      flock, prevAng, prevBaseY, prevAnchorX, prevAnchorZ,
      anchorX: flock.anchorX, anchorZ: flock.anchorZ,
      lx0, ly0, lz0, lx, ly, lz, fwdX, fwdZ, baseY,
      elapsed: this.elapsed,
      desiredSpeed,
      fleeing,
      velBlend: 1 - Math.exp(-stepDt * (fleeing ? 4.2 : 3.4) * tightOrbitGain),
      rotBlend: 1 - Math.exp(-stepDt * 6.0 * tightOrbitGain),
      stepDt,
    };
    flock.members.forEach((m, idx) => advancePooledMember(m, idx, ctx));
  }

  dispose(): void {
    for (const pool of this.pools.values()) pool.dispose();
    this.pools.clear();
    this.flocks.length = 0;
  }
}

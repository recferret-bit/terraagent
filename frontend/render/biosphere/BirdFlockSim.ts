import type { PlanetKind } from '../planets/PlanetSpec';
import { mulberry32 } from '../visuals/terrain/noise';
import type {
  BiosphereAggressor,
  BiosphereBattleHotspot,
  BiosphereHabitatIndex,
  BirdFlock,
  BirdMemberState,
  BirdSpeciesSpec,
  HabitatAnchor,
} from './biosphereTypes';
import { BIRDS_BY_BIOME } from './speciesCatalog';

function pickAnchorsForPref(spec: BirdSpeciesSpec, habitat: BiosphereHabitatIndex): HabitatAnchor[] {
  if (spec.habitatPref === 'forest' && habitat.forestAnchors.length > 0) return habitat.forestAnchors;
  if (spec.habitatPref === 'water' && habitat.waterAnchors.length > 0) return habitat.waterAnchors;
  if (spec.habitatPref === 'rock' && habitat.rockAnchors.length > 0) return habitat.rockAnchors;
  if (habitat.grassAnchors.length > 0) return habitat.grassAnchors;
  if (habitat.forestAnchors.length > 0) return habitat.forestAnchors;
  return [{ x: 0, z: 0, tileIndex: -1 }];
}

function findSurvivingForestAnchor(
  fromX: number,
  fromZ: number,
  habitat: BiosphereHabitatIndex,
  aggressors: readonly BiosphereAggressor[],
): HabitatAnchor {
  let best: HabitatAnchor | null = null;
  let bestScore = Infinity;
  for (const cand of habitat.forestAnchors) {
    const dist = Math.hypot(cand.x - fromX, cand.z - fromZ);
    if (dist < 6) continue;
    let penalty = 0;
    for (const ag of aggressors) {
      const dAg = Math.hypot(cand.x - ag.x, cand.z - ag.z);
      if (dAg < 18) penalty += (18 - dAg) * 8;
    }
    const score = dist + penalty;
    if (score < bestScore) {
      bestScore = score;
      best = cand;
    }
  }
  if (best) return best;
  const bound = Math.max(18, habitat.halfSize * 0.72);
  const ang = Math.atan2(fromZ, fromX) + 0.9;
  return { x: Math.cos(ang) * bound, z: Math.sin(ang) * bound, tileIndex: -1 };
}

function createFlockMembers(
  rng: () => number,
  spec: BirdSpeciesSpec,
  cx: number,
  cz: number,
  groundY: number,
  count: number,
): BirdMemberState[] {
  const members: BirdMemberState[] = [];
  const baseAlt = groundY + 0.5 * (spec.altitude[0] + spec.altitude[1]);
  for (let i = 0; i < count; i++) {
    const offX = (rng() - 0.5) * 3.2;
    const offZ = (rng() - 0.5) * 3.2;
    members.push({
      x: cx + offX,
      y: baseAlt + (rng() - 0.5) * 1.4,
      z: cz + offZ,
      vx: spec.speed,
      vz: 0,
      yaw: rng() * Math.PI * 2,
      pitch: 0,
      roll: 0,
      phase: rng() * 20,
      flapWeight: spec.flapBase,
      scale: spec.scale * (0.88 + rng() * 0.24),
    });
  }
  return members;
}

function computeLeaderTarget(flock: BirdFlock, elapsed: number, groundY: number): [number, number, number] {
  const sp = flock.species;
  const r = sp.orbitRadius;
  const a = flock.orbitAngle;
  const midAlt = groundY + 0.5 * (sp.altitude[0] + sp.altitude[1]);

  if (flock.state === 'FLEEING_FOREST' || flock.state === 'FLEEING_BATTLE' || flock.state === 'FLEEING_AGGRESSOR') {
    return [flock.targetX, midAlt + 3.2, flock.targetZ];
  }

  switch (flock.pattern) {
    case 'canopyOrbit':
      return [
        flock.homeX + Math.cos(a) * r,
        midAlt + Math.sin(a * 2.0 + flock.id) * 1.1,
        flock.homeZ + Math.sin(a) * r,
      ];
    case 'thermalSoar':
      return [
        flock.homeX + Math.cos(a * 0.68) * r,
        midAlt + Math.sin(a * 0.5 + flock.id) * 2.6,
        flock.homeZ + Math.sin(a * 0.68) * r,
      ];
    case 'figureEight':
      return [
        flock.homeX + Math.sin(a) * r * 1.25,
        midAlt + Math.cos(a * 2.0) * 1.4,
        flock.homeZ + Math.sin(a * 2.0) * r * 0.62,
      ];
    case 'waterSkim':
      return [
        flock.homeX + Math.cos(a * 1.15) * r,
        groundY + sp.altitude[0] + Math.abs(Math.sin(elapsed * 1.6 + flock.id)) * 1.3,
        flock.homeZ + Math.sin(a * 0.85) * r * 0.78,
      ];
    case 'veeFormation':
    case 'ridgePatrol':
      return [
        flock.homeX + Math.cos(a * 0.45) * r,
        midAlt + Math.sin(a * 0.9) * 1.2,
        flock.homeZ + Math.sin(a * 0.45) * r * 0.82,
      ];
  }
}

function evaluateFlockThreats(
  flock: BirdFlock,
  cx: number,
  cz: number,
  habitat: BiosphereHabitatIndex,
  aggressors: readonly BiosphereAggressor[],
  battles: readonly BiosphereBattleHotspot[],
): void {
  // 1. Battles cause immediate sharp scatter away from combat zone
  for (const bat of battles) {
    const dx = cx - bat.x, dz = cz - bat.z;
    const d = Math.hypot(dx, dz);
    if (d < bat.radius + 14) {
      const inv = d > 0.1 ? 1 / d : 1;
      const pushX = d > 0.1 ? dx * inv : 1;
      const pushZ = d > 0.1 ? dz * inv : 0;
      flock.state = 'FLEEING_BATTLE';
      flock.stateTimer = 5.5;
      flock.targetX = Math.max(-habitat.halfSize * 0.88, Math.min(habitat.halfSize * 0.88, cx + pushX * 26));
      flock.targetZ = Math.max(-habitat.halfSize * 0.88, Math.min(habitat.halfSize * 0.88, cz + pushZ * 26));
      return;
    }
  }

  // 2. Deforestation / Terraforming check: home forest cleared or actively chopped by a working robot
  if (flock.species.habitatPref === 'forest') {
    const forestGone = flock.homeTileIndex >= 0 && !habitat.forestTileSet.has(flock.homeTileIndex);
    const robotChoppingHome = aggressors.some(
      (ag) => ag.working && Math.hypot(ag.x - flock.homeX, ag.z - flock.homeZ) < 11,
    );
    if (forestGone || robotChoppingHome) {
      const next = findSurvivingForestAnchor(flock.homeX, flock.homeZ, habitat, aggressors);
      flock.homeX = next.x;
      flock.homeZ = next.z;
      flock.homeTileIndex = next.tileIndex;
      flock.targetX = next.x;
      flock.targetZ = next.z;
      flock.state = 'FLEEING_FOREST';
      flock.stateTimer = 6.5;
      flock.relocations++;
      return;
    }
  }

  // 3. Low-altitude aggressor robot proximity
  for (const ag of aggressors) {
    const rad = (ag.radius ?? 9) + (ag.working ? 5 : 0);
    const dx = cx - ag.x, dz = cz - ag.z;
    const d = Math.hypot(dx, dz);
    if (d < rad) {
      const inv = d > 0.1 ? 1 / d : 1;
      flock.state = 'FLEEING_AGGRESSOR';
      flock.stateTimer = 4.0;
      flock.targetX = Math.max(-habitat.halfSize * 0.88, Math.min(habitat.halfSize * 0.88, cx + dx * inv * 20));
      flock.targetZ = Math.max(-habitat.halfSize * 0.88, Math.min(habitat.halfSize * 0.88, cz + dz * inv * 20));
      return;
    }
  }
}

export class BirdFlockSimulator {
  readonly speciesList: readonly BirdSpeciesSpec[];
  readonly flocks: BirdFlock[] = [];
  private elapsed = 0;

  constructor(biome: PlanetKind, seed: number, habitat: BiosphereHabitatIndex) {
    this.speciesList = BIRDS_BY_BIOME[biome];
    const rng = mulberry32(seed ^ 0x51a7b3);
    const flocksPerSpecies = habitat.halfSize > 55 ? 3 : 2;
    let flockId = 0;

    this.speciesList.forEach((spec, slot) => {
      const anchors = pickAnchorsForPref(spec, habitat);
      for (let f = 0; f < flocksPerSpecies; f++) {
        const anchor = anchors[(f * 7 + slot * 3) % anchors.length]!;
        const count = spec.flockSize[0] + Math.floor(rng() * (spec.flockSize[1] - spec.flockSize[0] + 1));
        const gY = Math.max(0, habitat.heightAt(anchor.x, anchor.z));
        const defaultState =
          spec.pattern === 'thermalSoar' ? 'SOARING' : spec.pattern === 'waterSkim' ? 'SKIMMING' : 'PATROLLING';
        this.flocks.push({
          id: flockId++,
          species: spec,
          speciesSlot: slot,
          pattern: spec.pattern,
          state: defaultState,
          homeX: anchor.x,
          homeZ: anchor.z,
          homeTileIndex: spec.habitatPref === 'forest' ? anchor.tileIndex : -1,
          targetX: anchor.x,
          targetZ: anchor.z,
          orbitAngle: rng() * Math.PI * 2,
          stateTimer: 0,
          relocations: 0,
          members: createFlockMembers(rng, spec, anchor.x, anchor.z, gY, count),
        });
      }
    });
  }

  step(
    dt: number,
    habitat: BiosphereHabitatIndex,
    aggressors: readonly BiosphereAggressor[],
    battles: readonly BiosphereBattleHotspot[],
  ): void {
    const stepDt = Math.min(0.1, Math.max(0, dt));
    if (stepDt <= 0) return;
    this.elapsed += stepDt;

    for (const flock of this.flocks) {
      const leader = flock.members[0]!;
      evaluateFlockThreats(flock, leader.x, leader.z, habitat, aggressors, battles);

      const fleeing =
        flock.state === 'FLEEING_FOREST' || flock.state === 'FLEEING_BATTLE' || flock.state === 'FLEEING_AGGRESSOR';
      if (flock.stateTimer > 0) {
        flock.stateTimer -= stepDt;
        if (flock.stateTimer <= 0) {
          flock.state =
            flock.pattern === 'thermalSoar' ? 'SOARING' : flock.pattern === 'waterSkim' ? 'SKIMMING' : 'PATROLLING';
        }
      }

      const angRate = flock.species.speed / Math.max(4.5, flock.species.orbitRadius);
      flock.orbitAngle += angRate * stepDt;
      const gY = Math.max(0, habitat.heightAt(leader.x, leader.z));
      const [lx, ly, lz] = computeLeaderTarget(flock, this.elapsed, gY);
      const speedMul = fleeing ? 1.68 : 1.0;
      const desiredSpeed = flock.species.speed * speedMul;

      flock.members.forEach((m, idx) => {
        let tx = lx, ty = ly, tz = lz;
        if (idx > 0) {
          const rank = Math.ceil(idx / 2);
          const side = idx % 2 === 1 ? 1 : -1;
          const fwdX = Math.sin(leader.yaw), fwdZ = Math.cos(leader.yaw);
          const rightX = fwdZ, rightZ = -fwdX;
          if (flock.pattern === 'veeFormation' && !fleeing) {
            tx = leader.x - fwdX * rank * 1.45 + rightX * side * rank * 1.25;
            tz = leader.z - fwdZ * rank * 1.45 + rightZ * side * rank * 1.25;
            ty = leader.y + rank * 0.08;
          } else {
            const lag = idx * 0.75;
            tx += Math.cos(this.elapsed * 0.9 + idx * 2.1) * 1.6 - fwdX * lag;
            tz += Math.sin(this.elapsed * 0.9 + idx * 2.1) * 1.6 - fwdZ * lag;
            ty += Math.sin(this.elapsed * 1.3 + idx) * 0.45;
          }
        }

        const dx = tx - m.x, dy = ty - m.y, dz = tz - m.z;
        const distXZ = Math.max(0.01, Math.hypot(dx, dz));
        const steerX = (dx / distXZ) * desiredSpeed;
        const steerZ = (dz / distXZ) * desiredSpeed;
        const blend = Math.min(1, stepDt * (fleeing ? 4.2 : 2.4));
        const prevYaw = m.yaw;
        m.vx += (steerX - m.vx) * blend;
        m.vz += (steerZ - m.vz) * blend;
        m.x += m.vx * stepDt;
        m.z += m.vz * stepDt;
        m.y += dy * Math.min(1, stepDt * 2.2);

        m.yaw = Math.atan2(m.vx, m.vz);
        let dYaw = m.yaw - prevYaw;
        while (dYaw > Math.PI) dYaw -= Math.PI * 2;
        while (dYaw < -Math.PI) dYaw += Math.PI * 2;
        m.roll = Math.max(-0.55, Math.min(0.55, -dYaw / Math.max(0.016, stepDt) * 0.18));
        m.pitch = Math.max(-0.35, Math.min(0.35, -dy * 0.08));
        m.flapWeight = fleeing ? 1.0 : dy > 0.25 ? Math.min(1, flock.species.flapBase + 0.35) : flock.species.flapBase;
      });
    }
  }
}

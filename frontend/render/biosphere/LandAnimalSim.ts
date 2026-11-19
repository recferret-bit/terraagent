import type { PlanetKind } from '../planets/PlanetSpec';
import { mulberry32 } from '../visuals/terrain/noise';
import type {
  AnimalScheduleState,
  BiosphereAggressor,
  BiosphereBattleHotspot,
  BiosphereHabitatIndex,
  HabitatAnchor,
  LandAnimalAgent,
  LandAnimalSpeciesSpec,
} from './biosphereTypes';
import { LAND_ANIMALS_BY_BIOME, resolveCircadianActivity } from './speciesCatalog';

function nearestAnchor(x: number, z: number, list: readonly HabitatAnchor[], avoid: readonly BiosphereAggressor[]): HabitatAnchor | null {
  let best: HabitatAnchor | null = null;
  let bestScore = Infinity;
  for (const a of list) {
    let penalty = 0;
    for (const ag of avoid) {
      const d = Math.hypot(a.x - ag.x, a.z - ag.z);
      if (d < 16) penalty += (16 - d) * 6;
    }
    const score = Math.hypot(a.x - x, a.z - z) + penalty;
    if (score < bestScore) {
      bestScore = score;
      best = a;
    }
  }
  return best;
}

function pickEscapeGoal(
  ax: number,
  az: number,
  tx: number,
  tz: number,
  distRun: number,
  habitat: BiosphereHabitatIndex,
): [number, number] {
  const baseAng = Math.atan2(az - tz, ax - tx);
  const lim = habitat.halfSize * 0.90;
  for (const offset of [0, 0.55, -0.55, 1.15, -1.15, 1.85, -1.85, Math.PI]) {
    const a = baseAng + offset;
    const gx = Math.max(-lim, Math.min(lim, ax + Math.cos(a) * distRun));
    const gz = Math.max(-lim, Math.min(lim, az + Math.sin(a) * distRun));
    if (habitat.isPassableLand(gx, gz)) return [gx, gz];
  }
  return [ax, az];
}

function advanceOnPassableLand(agent: LandAnimalAgent, dt: number, habitat: BiosphereHabitatIndex): void {
  const nextX = agent.x + agent.vx * dt;
  const nextZ = agent.z + agent.vz * dt;
  if (habitat.isPassableLand(nextX, nextZ)) {
    agent.x = nextX;
    agent.z = nextZ;
    return;
  }
  if (habitat.isPassableLand(nextX, agent.z)) {
    agent.x = nextX;
    agent.vz *= 0.3;
    return;
  }
  if (habitat.isPassableLand(agent.x, nextZ)) {
    agent.z = nextZ;
    agent.vx *= 0.3;
    return;
  }
  const spd = Math.hypot(agent.vx, agent.vz) * dt;
  const base = Math.atan2(agent.vz, agent.vx);
  for (const turn of [0.9, -0.9, 1.7, -1.7, Math.PI]) {
    const tx = agent.x + Math.cos(base + turn) * spd;
    const tz = agent.z + Math.sin(base + turn) * spd;
    if (habitat.isPassableLand(tx, tz)) {
      agent.x = tx;
      agent.z = tz;
      agent.vx = Math.cos(base + turn) * (spd / Math.max(1e-4, dt));
      agent.vz = Math.sin(base + turn) * (spd / Math.max(1e-4, dt));
      return;
    }
  }
}

function findConquerorThreat(
  x: number,
  z: number,
  aggressors: readonly BiosphereAggressor[],
  battles: readonly BiosphereBattleHotspot[],
  colonized: readonly HabitatAnchor[],
): { tx: number; tz: number } | null {
  for (const bat of battles) {
    if (Math.hypot(x - bat.x, z - bat.z) < bat.radius + 10) return { tx: bat.x, tz: bat.z };
  }
  for (const ag of aggressors) {
    const rad = (ag.radius ?? 11) + (ag.working ? 4 : 0);
    if (Math.hypot(x - ag.x, z - ag.z) < rad) return { tx: ag.x, tz: ag.z };
  }
  for (const col of colonized) {
    if (Math.hypot(x - col.x, z - col.z) < 5.5) return { tx: col.x, tz: col.z };
  }
  return null;
}

function selectGoalForActivity(
  agent: LandAnimalAgent,
  activity: AnimalScheduleState,
  allAgents: readonly LandAnimalAgent[],
  habitat: BiosphereHabitatIndex,
  aggressors: readonly BiosphereAggressor[],
): void {
  if (activity === 'SLEEPING') {
    agent.goalX = agent.homeX;
    agent.goalZ = agent.homeZ;
    return;
  }
  if (activity === 'DRINKING') {
    const w = nearestAnchor(agent.x, agent.z, habitat.waterAnchors, aggressors);
    if (w) { agent.goalX = w.x; agent.goalZ = w.z; }
    return;
  }
  if (activity === 'EATING_GRASS') {
    const g = nearestAnchor(agent.homeX, agent.homeZ, habitat.grassAnchors, aggressors);
    if (g) { agent.goalX = g.x; agent.goalZ = g.z; }
    return;
  }
  if (activity === 'BROWSING_TREES') {
    const pool = habitat.forestAnchors.length > 0 ? habitat.forestAnchors : habitat.grassAnchors;
    const f = nearestAnchor(agent.homeX, agent.homeZ, pool, aggressors);
    if (f) { agent.goalX = f.x; agent.goalZ = f.z; }
    return;
  }
  if (activity === 'HUNTING') {
    let prey: LandAnimalAgent | null = null;
    let bestD = Infinity;
    for (const other of allAgents) {
      if (other.species.diet === 'predator') continue;
      const d = Math.hypot(other.x - agent.x, other.z - agent.z);
      if (d < bestD && d < 42) {
        bestD = d;
        prey = other;
      }
    }
    if (prey) {
      agent.goalX = prey.x;
      agent.goalZ = prey.z;
      return;
    }
  }
  agent.goalX = agent.homeX;
  agent.goalZ = agent.homeZ;
}

function stepAnimalKinematics(
  agent: LandAnimalAgent,
  dt: number,
  rng: () => number,
  allAgents: readonly LandAnimalAgent[],
  habitat: BiosphereHabitatIndex,
): void {
  if (agent.state === 'SLEEPING') {
    agent.vx *= 0.8;
    agent.vz *= 0.8;
    agent.walkWeight = Math.max(0, agent.walkWeight - dt * 3.0);
    agent.workWeight = Math.max(0, agent.workWeight - dt * 3.0);
    agent.sleepCrouch = Math.min(1, agent.sleepCrouch + dt * 2.2);
    agent.y = habitat.heightAt(agent.x, agent.z);
    return;
  }

  agent.sleepCrouch = Math.max(0, agent.sleepCrouch - dt * 3.2);
  const dxGoal = agent.goalX - agent.x;
  const dzGoal = agent.goalZ - agent.z;
  const distGoal = Math.hypot(dxGoal, dzGoal);
  const feedingState =
    agent.state === 'DRINKING' || agent.state === 'EATING_GRASS' || agent.state === 'BROWSING_TREES';

  if (feedingState && distGoal < 2.6) {
    agent.vx *= 0.75;
    agent.vz *= 0.75;
    agent.walkWeight = Math.max(0, agent.walkWeight - dt * 3.5);
    agent.workWeight = Math.min(1, agent.workWeight + dt * 3.0);
    agent.y = habitat.heightAt(agent.x, agent.z);
    return;
  }

  agent.workWeight = Math.max(0, agent.workWeight - dt * 3.0);
  const sprinting =
    agent.state === 'FLEEING_AGGRESSOR' || agent.state === 'FLEEING_PREDATOR' || (agent.state === 'HUNTING' && distGoal < 14);
  const targetSpeed = sprinting ? agent.species.runSpeed : agent.species.walkSpeed;

  let dirX = distGoal > 0.2 ? dxGoal / distGoal : Math.sin(agent.yaw);
  let dirZ = distGoal > 0.2 ? dzGoal / distGoal : Math.cos(agent.yaw);

  // Social group cohesion + gentle personal-space separation
  if (agent.species.social === 'group') {
    let cohX = 0, cohZ = 0, sepX = 0, sepZ = 0, mates = 0;
    for (const m of allAgents) {
      if (m === agent || m.groupId !== agent.groupId) continue;
      const mx = m.x - agent.x, mz = m.z - agent.z;
      const md = Math.hypot(mx, mz);
      cohX += m.x; cohZ += m.z; mates++;
      if (md > 0.01 && md < 1.5) {
        sepX -= (mx / md) * (1.5 - md);
        sepZ -= (mz / md) * (1.5 - md);
      }
    }
    if (mates > 0) {
      dirX += ((cohX / mates - agent.x) * 0.08) + sepX * 0.9;
      dirZ += ((cohZ / mates - agent.z) * 0.08) + sepZ * 0.9;
    }
  }

  if (agent.state === 'ROAMING' && distGoal < 3.5) {
    agent.pauseTimer -= dt;
    if (agent.pauseTimer <= 0) {
      const ang = rng() * Math.PI * 2;
      const rad = 4 + rng() * 9;
      const nx = agent.homeX + Math.cos(ang) * rad;
      const nz = agent.homeZ + Math.sin(ang) * rad;
      if (habitat.isPassableLand(nx, nz)) {
        agent.goalX = nx;
        agent.goalZ = nz;
      }
      agent.pauseTimer = 2.5 + rng() * 4.0;
    }
  }

  const len = Math.max(0.01, Math.hypot(dirX, dirZ));
  const steerX = (dirX / len) * targetSpeed;
  const steerZ = (dirZ / len) * targetSpeed;
  const blend = Math.min(1, dt * 3.5);
  agent.vx += (steerX - agent.vx) * blend;
  agent.vz += (steerZ - agent.vz) * blend;

  advanceOnPassableLand(agent, dt, habitat);
  agent.y = habitat.heightAt(agent.x, agent.z);
  const curSpd = Math.hypot(agent.vx, agent.vz);
  if (curSpd > 0.12) agent.yaw = Math.atan2(agent.vx, agent.vz);
  agent.walkWeight = Math.min(1, curSpd / Math.max(0.5, agent.species.walkSpeed));
}

export class LandAnimalSimulator {
  readonly speciesList: readonly LandAnimalSpeciesSpec[];
  readonly agents: LandAnimalAgent[] = [];
  readonly groupCount: number;
  private readonly rng: () => number;

  constructor(biome: PlanetKind, seed: number, habitat: BiosphereHabitatIndex) {
    this.speciesList = LAND_ANIMALS_BY_BIOME[biome];
    this.rng = mulberry32(seed ^ 0x9e3779b1);
    const groupsPerSpecies = habitat.halfSize > 55 ? 3 : 2;
    let agentId = 0;
    let groupId = 0;

    this.speciesList.forEach((spec, slot) => {
      const pool =
        spec.diet === 'treeBrowser' && habitat.forestAnchors.length > 0
          ? habitat.forestAnchors
          : habitat.grassAnchors.length > 0
            ? habitat.grassAnchors
            : habitat.rockAnchors;
      const safePool = pool.length > 0 ? pool : [{ x: 4, z: 4, tileIndex: -1 }];

      for (let g = 0; g < groupsPerSpecies; g++) {
        const anchor = safePool[(g * 11 + slot * 5) % safePool.length]!;
        const count =
          spec.social === 'solo'
            ? 1
            : spec.groupSize[0] + Math.floor(this.rng() * (spec.groupSize[1] - spec.groupSize[0] + 1));
        const thisGroup = groupId++;

        for (let m = 0; m < count; m++) {
          const ang = (m / Math.max(1, count)) * Math.PI * 2 + this.rng() * 0.5;
          const dist = m === 0 ? 0 : 1.3 + this.rng() * 1.8;
          const ax = anchor.x + Math.cos(ang) * dist;
          const az = anchor.z + Math.sin(ang) * dist;
          const px = habitat.isPassableLand(ax, az) ? ax : anchor.x;
          const pz = habitat.isPassableLand(ax, az) ? az : anchor.z;
          this.agents.push({
            id: agentId++,
            groupId: thisGroup,
            species: spec,
            speciesSlot: slot,
            canAttackPlayer: false,
            state: 'ROAMING',
            x: px,
            y: habitat.heightAt(px, pz),
            z: pz,
            vx: 0,
            vz: 0,
            yaw: this.rng() * Math.PI * 2,
            homeX: px,
            homeZ: pz,
            goalX: px,
            goalZ: pz,
            phase: this.rng() * 20,
            walkWeight: 0,
            workWeight: 0,
            sleepCrouch: 0,
            scale: spec.scale * (0.90 + this.rng() * 0.20),
            pauseTimer: this.rng() * 2,
          });
        }
      }
    });
    this.groupCount = groupId;
  }

  step(
    dt: number,
    solarHour24: number,
    habitat: BiosphereHabitatIndex,
    aggressors: readonly BiosphereAggressor[],
    battles: readonly BiosphereBattleHotspot[],
  ): void {
    const stepDt = Math.min(0.1, Math.max(0, dt));
    if (stepDt <= 0) return;

    for (const agent of this.agents) {
      // 1. Robot / Colony / Battle Aggressor Override (ALL nature treats robots as conquerors)
      const threat = findConquerorThreat(agent.x, agent.z, aggressors, battles, habitat.colonizedAnchors);
      if (threat) {
        const [fleeX, fleeZ] = pickEscapeGoal(agent.x, agent.z, threat.tx, threat.tz, 14, habitat);
        agent.state = 'FLEEING_AGGRESSOR';
        agent.goalX = fleeX;
        agent.goalZ = fleeZ;
        agent.homeX = fleeX;
        agent.homeZ = fleeZ;
        stepAnimalKinematics(agent, stepDt, this.rng, this.agents, habitat);
        continue;
      }

      // 2. Ecological Predator-Prey Response (herbivores flee nearby hunting predators)
      if (agent.species.diet !== 'predator') {
        const hunter = this.agents.find(
          (p) => p.species.diet === 'predator' && p.state === 'HUNTING' && Math.hypot(p.x - agent.x, p.z - agent.z) < 12,
        );
        if (hunter) {
          const [fleeX, fleeZ] = pickEscapeGoal(agent.x, agent.z, hunter.x, hunter.z, 12, habitat);
          agent.state = 'FLEEING_PREDATOR';
          agent.goalX = fleeX;
          agent.goalZ = fleeZ;
          stepAnimalKinematics(agent, stepDt, this.rng, this.agents, habitat);
          continue;
        }
      }

      // 3. Circadian Day/Night Schedule
      const scheduled = resolveCircadianActivity(agent.species, solarHour24);
      if (agent.state !== scheduled) {
        agent.state = scheduled;
        selectGoalForActivity(agent, scheduled, this.agents, habitat, aggressors);
      } else if (scheduled === 'HUNTING') {
        selectGoalForActivity(agent, scheduled, this.agents, habitat, aggressors);
      }
      stepAnimalKinematics(agent, stepDt, this.rng, this.agents, habitat);
    }
  }
}

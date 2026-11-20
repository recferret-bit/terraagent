import type { PlanetKind } from '../planets/PlanetSpec';
import { ObjectPool } from '../pools/ObjectPool';
import { PooledSlotObject } from '../pools/PooledObject';
import { mulberry32 } from '../visuals/terrain/noise';
import type {
  BiosphereAggressor,
  BiosphereBattleHotspot,
  BiosphereHabitatIndex,
  LandAnimalAgent,
  LandAnimalSpeciesSpec,
} from './biosphereTypes';
import {
  advanceOnPassableLand,
  findClosestPrey,
  findConquerorThreat,
  pickEscapeGoal,
  pickProwlWaypoint,
  selectGoalForActivity,
} from './landAnimalNavigation';
import { LAND_ANIMALS_BY_BIOME, resolveCircadianActivity } from './speciesCatalog';

function stepStationaryFeeding(
  agent: LandAnimalAgent,
  dt: number,
  rng: () => number,
  habitat: BiosphereHabitatIndex,
): void {
  agent.vx *= 0.72;
  agent.vz *= 0.72;
  agent.walkWeight = Math.max(0, agent.walkWeight - dt * 3.5);
  agent.workWeight = Math.min(1, agent.workWeight + dt * 3.0);
  agent.pauseTimer -= dt;
  if (agent.pauseTimer <= 0) {
    for (let k = 0; k < 6; k++) {
      const ang = rng() * Math.PI * 2;
      const stepR = 1.3 + rng() * 1.6;
      const nx = agent.x + Math.cos(ang) * stepR;
      const nz = agent.z + Math.sin(ang) * stepR;
      if (habitat.isPassableLand(nx, nz)) {
        agent.goalX = nx;
        agent.goalZ = nz;
        break;
      }
    }
    agent.pauseTimer = 1.8 + rng() * 2.6;
  }
  agent.y = habitat.heightAt(agent.x, agent.z);
}

function applySocialSteering(
  agent: LandAnimalAgent,
  allAgents: readonly LandAnimalAgent[],
  dirX: number,
  dirZ: number,
): [number, number] {
  if (agent.species.social !== 'group') return [dirX, dirZ];
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
  if (mates === 0) return [dirX, dirZ];
  return [
    dirX + ((cohX / mates - agent.x) * 0.08) + sepX * 0.9,
    dirZ + ((cohZ / mates - agent.z) * 0.08) + sepZ * 0.9,
  ];
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

  if (feedingState && distGoal < 0.45) {
    stepStationaryFeeding(agent, dt, rng, habitat);
    return;
  }

  const slowForagingStep = feedingState && distGoal < 3.4;
  if (slowForagingStep) {
    agent.workWeight = Math.min(0.85, Math.max(0.55, agent.workWeight + dt * 2.0));
  } else {
    agent.workWeight = Math.max(0, agent.workWeight - dt * 3.0);
  }
  const sprinting =
    agent.state === 'FLEEING_AGGRESSOR' || agent.state === 'FLEEING_PREDATOR' || (agent.state === 'HUNTING' && distGoal < 14);
  const targetSpeed = sprinting
    ? agent.species.runSpeed
    : slowForagingStep
      ? agent.species.walkSpeed * 0.36
      : agent.state === 'HUNTING'
        ? agent.species.walkSpeed * 1.18
        : agent.species.walkSpeed;

  const baseDirX = distGoal > 0.2 ? dxGoal / distGoal : Math.sin(agent.yaw);
  const baseDirZ = distGoal > 0.2 ? dzGoal / distGoal : Math.cos(agent.yaw);
  const [dirX, dirZ] = applySocialSteering(agent, allAgents, baseDirX, baseDirZ);

  if ((agent.state === 'ROAMING' || agent.state === 'HUNTING') && distGoal < 3.2) {
    agent.pauseTimer -= dt;
    if (agent.pauseTimer <= 0) {
      if (agent.state === 'HUNTING') {
        const [nx, nz] = pickProwlWaypoint(agent, rng, habitat);
        agent.goalX = nx;
        agent.goalZ = nz;
        agent.pauseTimer = 1.0 + rng() * 1.8;
      } else {
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

export interface LandAnimalSimulatorOptions {
  readonly groupsPerSpecies?: number;
  readonly speciesOverride?: readonly LandAnimalSpeciesSpec[];
  readonly prebuiltAgents?: readonly LandAnimalAgent[];
}

function makeEmptyAnimal(spec: LandAnimalSpeciesSpec, slot: number): LandAnimalAgent {
  return {
    id: 0, groupId: 0, species: spec, speciesSlot: slot, canAttackPlayer: false, state: 'ROAMING',
    x: 0, y: 0, z: 0, vx: 0, vz: 0, yaw: 0, homeX: 0, homeZ: 0, goalX: 0, goalZ: 0,
    phase: 0, walkWeight: 0, workWeight: 0, sleepCrouch: 0, scale: spec.scale, pauseTimer: 0,
  };
}

export class LandAnimalSimulator {
  readonly speciesList: readonly LandAnimalSpeciesSpec[];
  readonly agents: LandAnimalAgent[] = [];
  readonly pools = new Map<string, ObjectPool<PooledSlotObject<LandAnimalAgent>>>();
  readonly groupCount: number;
  private readonly rng: () => number;

  constructor(
    biome: PlanetKind,
    seed: number,
    habitat: BiosphereHabitatIndex,
    opts: LandAnimalSimulatorOptions = {},
  ) {
    this.speciesList = opts.speciesOverride ?? LAND_ANIMALS_BY_BIOME[biome];
    this.rng = mulberry32(seed ^ 0x9e3779b1);
    const baseGroups = opts.groupsPerSpecies ?? 2;

    this.speciesList.forEach((spec, slot) => {
      const maxAgents = Math.max(1, baseGroups * spec.groupSize[1]);
      this.pools.set(
        spec.id,
        new ObjectPool<PooledSlotObject<LandAnimalAgent>>({
          key: `animal:${spec.id}`,
          initialSize: maxAgents,
          threshold: maxAgents,
          hardCap: true,
          create: (idx, key) => new PooledSlotObject(key, idx, makeEmptyAnimal(spec, slot)),
        }),
      );
    });

    if (opts.prebuiltAgents !== undefined) {
      const groups = new Set<number>();
      for (const src of opts.prebuiltAgents) {
        const spec = this.speciesList[src.speciesSlot] ?? src.species;
        const slotObj = this.pools.get(spec.id)?.tryAcquire();
        const dst = slotObj ? slotObj.data : makeEmptyAnimal(spec, src.speciesSlot);
        Object.assign(dst, src, { species: spec, canAttackPlayer: false });
        this.agents.push(dst);
        groups.add(dst.groupId);
      }
      this.groupCount = groups.size;
      return;
    }

    let agentId = 0;
    let groupId = 0;
    this.speciesList.forEach((spec, slot) => {
      const groupsPerSpecies = spec.diet === 'predator' && habitat.halfSize < 26 ? 1 : baseGroups;
      const pool = this.pools.get(spec.id)!;
      const anchors =
        spec.diet === 'treeBrowser' && habitat.forestAnchors.length > 0
          ? habitat.forestAnchors
          : habitat.grassAnchors.length > 0
            ? habitat.grassAnchors
            : habitat.rockAnchors;
      const safePool = anchors.length > 0 ? anchors : [{ x: 4, z: 4, tileIndex: -1 }];

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
          const ok = habitat.isPassableLand(ax, az);
          const px = ok ? ax : anchor.x, pz = ok ? az : anchor.z;
          const dst = pool.acquire().data;
          Object.assign(dst, {
            id: agentId++, groupId: thisGroup, species: spec, speciesSlot: slot, canAttackPlayer: false,
            state: 'ROAMING', x: px, y: habitat.heightAt(px, pz), z: pz, vx: 0, vz: 0,
            yaw: this.rng() * Math.PI * 2, homeX: px, homeZ: pz, goalX: px, goalZ: pz,
            phase: this.rng() * 20, walkWeight: 0, workWeight: 0, sleepCrouch: 0,
            scale: spec.scale * (0.90 + this.rng() * 0.20), pauseTimer: this.rng() * 2,
          });
          this.agents.push(dst);
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
    disturbances: readonly BiosphereBattleHotspot[] = [],
  ): void {
    const stepDt = Math.min(0.1, Math.max(0, dt));
    if (stepDt <= 0) return;

    const leaders = new Map<number, LandAnimalAgent>();
    for (const a of this.agents) {
      if (!leaders.has(a.groupId)) leaders.set(a.groupId, a);
    }

    for (const agent of this.agents) {
      const leader = leaders.get(agent.groupId) ?? agent;
      // 1. Robot / Colony / Battle / Habitat-Clearing Aggressor Override (ALL nature treats robots as conquerors)
      const threat = findConquerorThreat(agent.x, agent.z, aggressors, battles, disturbances, habitat.colonizedAnchors);
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

      // 2. Ecological Predator-Prey Response (sleeping prey only wake at close range; awake prey flee at 12 m)
      if (agent.species.diet !== 'predator') {
        const scheduledNight = resolveCircadianActivity(agent.species, solarHour24) === 'SLEEPING';
        const alertRadius = scheduledNight && agent.sleepCrouch > 0.25 ? 5.5 : 12.0;
        const hunter = this.agents.find(
          (p) => p.species.diet === 'predator' && p.state === 'HUNTING' && Math.hypot(p.x - agent.x, p.z - agent.z) < alertRadius,
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

      // 3. Circadian Day/Night Schedule (herds/packs navigate together around their group leader)
      const scheduled = resolveCircadianActivity(agent.species, solarHour24);
      if (agent.state !== scheduled) {
        agent.state = scheduled;
        selectGoalForActivity(agent, leader, scheduled, this.agents, habitat, aggressors, this.rng);
      } else if (scheduled === 'HUNTING') {
        const closePrey = findClosestPrey(leader, this.agents, 46);
        if (closePrey) {
          agent.goalX = closePrey.x;
          agent.goalZ = closePrey.z;
        }
      }
      stepAnimalKinematics(agent, stepDt, this.rng, this.agents, habitat);
    }
  }

  dispose(): void {
    for (const pool of this.pools.values()) pool.dispose();
    this.pools.clear();
    this.agents.length = 0;
  }
}

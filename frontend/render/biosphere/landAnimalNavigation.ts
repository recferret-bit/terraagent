import type {
  AnimalScheduleState,
  BiosphereAggressor,
  BiosphereBattleHotspot,
  BiosphereHabitatIndex,
  HabitatAnchor,
  LandAnimalAgent,
} from './biosphereTypes';

export function nearestAnchor(
  x: number,
  z: number,
  list: readonly HabitatAnchor[],
  avoid: readonly BiosphereAggressor[],
  minDistance = 0,
): HabitatAnchor | null {
  let best: HabitatAnchor | null = null;
  let bestScore = Infinity;
  let fallback: HabitatAnchor | null = null;
  let fallbackScore = Infinity;
  for (const a of list) {
    let penalty = 0;
    for (const ag of avoid) {
      const d = Math.hypot(a.x - ag.x, a.z - ag.z);
      if (d < 16) penalty += (16 - d) * 6;
    }
    const dist = Math.hypot(a.x - x, a.z - z);
    const score = dist + penalty;
    if (score < fallbackScore) {
      fallbackScore = score;
      fallback = a;
    }
    if (dist >= minDistance && score < bestScore) {
      bestScore = score;
      best = a;
    }
  }
  return best ?? fallback;
}

export function pickEscapeGoal(
  ax: number,
  az: number,
  tx: number,
  tz: number,
  distRun: number,
  habitat: BiosphereHabitatIndex,
): [number, number] {
  const baseAng = Math.atan2(az - tz, ax - tx);
  for (const offset of [0, 0.55, -0.55, 1.15, -1.15, 1.85, -1.85, Math.PI]) {
    const a = baseAng + offset;
    for (const stepDist of [distRun, distRun * 0.65, distRun * 0.35]) {
      const gx = ax + Math.cos(a) * stepDist;
      const gz = az + Math.sin(a) * stepDist;
      if (habitat.isPassableLand(gx, gz)) return [gx, gz];
    }
  }
  const fx = ax * 0.72, fz = az * 0.72;
  if (habitat.isPassableLand(fx, fz)) return [fx, fz];
  return [ax, az];
}

export function advanceOnPassableLand(agent: LandAnimalAgent, dt: number, habitat: BiosphereHabitatIndex): void {
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

export function findConquerorThreat(
  x: number,
  z: number,
  aggressors: readonly BiosphereAggressor[],
  battles: readonly BiosphereBattleHotspot[],
  disturbances: readonly BiosphereBattleHotspot[],
  colonized: readonly HabitatAnchor[],
): { tx: number; tz: number } | null {
  for (const bat of battles) {
    if (Math.hypot(x - bat.x, z - bat.z) < bat.radius + 10) return { tx: bat.x, tz: bat.z };
  }
  for (const ds of disturbances) {
    if (Math.hypot(x - ds.x, z - ds.z) < ds.radius + 6) return { tx: ds.x, tz: ds.z };
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

export function findClosestPrey(
  leader: LandAnimalAgent,
  allAgents: readonly LandAnimalAgent[],
  maxDist: number,
): LandAnimalAgent | null {
  let prey: LandAnimalAgent | null = null;
  let bestD = maxDist;
  for (const other of allAgents) {
    if (other.species.diet === 'predator') continue;
    const d = Math.hypot(other.x - leader.x, other.z - leader.z);
    if (d < bestD) {
      bestD = d;
      prey = other;
    }
  }
  return prey;
}

export function pickProwlWaypoint(
  leader: LandAnimalAgent,
  rng: () => number,
  habitat: BiosphereHabitatIndex,
): [number, number] {
  const grounds = habitat.grassAnchors.length > 0 ? habitat.grassAnchors : habitat.waterAnchors;
  if (grounds.length > 0 && rng() < 0.65) {
    for (let k = 0; k < 6; k++) {
      const cand = grounds[Math.floor(rng() * grounds.length)]!;
      const d = Math.hypot(cand.x - leader.x, cand.z - leader.z);
      if (d > 6 && d < 38 && habitat.isPassableLand(cand.x, cand.z)) return [cand.x, cand.z];
    }
  }
  for (let k = 0; k < 8; k++) {
    const ang = rng() * Math.PI * 2;
    const rad = 8 + rng() * 14;
    const nx = leader.homeX + Math.cos(ang) * rad;
    const nz = leader.homeZ + Math.sin(ang) * rad;
    if (habitat.isPassableLand(nx, nz) && Math.hypot(nx - leader.x, nz - leader.z) > 4.5) return [nx, nz];
  }
  return [leader.homeX, leader.homeZ];
}

export function selectGoalForActivity(
  agent: LandAnimalAgent,
  leader: LandAnimalAgent,
  activity: AnimalScheduleState,
  allAgents: readonly LandAnimalAgent[],
  habitat: BiosphereHabitatIndex,
  aggressors: readonly BiosphereAggressor[],
  rng: () => number,
): void {
  const offAng = (agent.id * 2.39996) % (Math.PI * 2);
  const offR = agent === leader ? 0 : 1.35;
  const ox = Math.cos(offAng) * offR;
  const oz = Math.sin(offAng) * offR;
  const applyGoal = (gx: number, gz: number) => {
    const nx = gx + ox, nz = gz + oz;
    if (habitat.isPassableLand(nx, nz)) { agent.goalX = nx; agent.goalZ = nz; }
    else { agent.goalX = gx; agent.goalZ = gz; }
  };

  if (activity === 'SLEEPING') { applyGoal(leader.homeX, leader.homeZ); return; }
  if (activity === 'DRINKING') {
    const w = nearestAnchor(leader.x, leader.z, habitat.waterAnchors, aggressors, 6.5);
    if (w) applyGoal(w.x, w.z);
    return;
  }
  if (activity === 'EATING_GRASS') {
    const g = nearestAnchor(leader.x, leader.z, habitat.grassAnchors, aggressors, 7.5);
    if (g) applyGoal(g.x, g.z);
    return;
  }
  if (activity === 'BROWSING_TREES') {
    const pool = habitat.forestAnchors.length > 0 ? habitat.forestAnchors : habitat.grassAnchors;
    const f = nearestAnchor(leader.x, leader.z, pool, aggressors, 7.0);
    if (f) applyGoal(f.x, f.z);
    return;
  }
  if (activity === 'HUNTING') {
    const prey = findClosestPrey(leader, allAgents, 46) ?? findClosestPrey(leader, allAgents, 110);
    if (prey) { applyGoal(prey.x, prey.z); return; }
    const [px, pz] = pickProwlWaypoint(leader, rng, habitat);
    applyGoal(px, pz);
    return;
  }
  if (Math.hypot(leader.homeX - leader.x, leader.homeZ - leader.z) < 3.2) {
    const [rx, rz] = pickProwlWaypoint(leader, rng, habitat);
    applyGoal(rx, rz);
    return;
  }
  applyGoal(leader.homeX, leader.homeZ);
}

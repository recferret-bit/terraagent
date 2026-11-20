import type {
  BiosphereAggressor,
  BiosphereBattleHotspot,
  BiosphereHabitatIndex,
  BirdFlock,
  BirdSpeciesSpec,
  HabitatAnchor,
} from './biosphereTypes';

export function pickAnchorsForPref(spec: BirdSpeciesSpec, habitat: BiosphereHabitatIndex): HabitatAnchor[] {
  if (spec.habitatPref === 'forest' && habitat.forestAnchors.length > 0) return habitat.forestAnchors;
  if (spec.habitatPref === 'water' && habitat.waterAnchors.length > 0) return habitat.waterAnchors;
  if (spec.habitatPref === 'rock' && habitat.rockAnchors.length > 0) return habitat.rockAnchors;
  if (habitat.grassAnchors.length > 0) return habitat.grassAnchors;
  if (habitat.forestAnchors.length > 0) return habitat.forestAnchors;
  return [{ x: 0, z: 0, tileIndex: -1 }];
}

export function pickSafeInBoundsPoint(
  fromX: number,
  fromZ: number,
  pushX: number,
  pushZ: number,
  distRun: number,
  habitat: BiosphereHabitatIndex,
): [number, number] {
  const baseAng = Math.atan2(pushZ, pushX);
  for (const offset of [0, 0.5, -0.5, 1.1, -1.1, 1.8, -1.8, Math.PI]) {
    const a = baseAng + offset;
    const gx = fromX + Math.cos(a) * distRun;
    const gz = fromZ + Math.sin(a) * distRun;
    if (habitat.isInBounds(gx, gz)) return [gx, gz];
  }
  return [fromX * 0.55, fromZ * 0.55];
}

function findSurvivingForestAnchor(
  fromX: number,
  fromZ: number,
  habitat: BiosphereHabitatIndex,
  aggressors: readonly BiosphereAggressor[],
): HabitatAnchor {
  const candidates =
    habitat.forestAnchors.length > 0
      ? habitat.forestAnchors
      : habitat.grassAnchors.length > 0
        ? habitat.grassAnchors
        : habitat.waterAnchors;
  let best: HabitatAnchor | null = null;
  let bestScore = Infinity;
  for (const cand of candidates) {
    const dist = Math.hypot(cand.x - fromX, cand.z - fromZ);
    if (dist < 6 || !habitat.isInBounds(cand.x, cand.z)) continue;
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
  const [sx, sz] = pickSafeInBoundsPoint(fromX, fromZ, -fromX || 1, -fromZ || 0.5, Math.min(18, habitat.halfSize * 0.45), habitat);
  return { x: sx, z: sz, tileIndex: -1 };
}

/**
 * Evaluates battle hotspots, deforestation/habitat disturbances, and nearby robot aggressors.
 * Updates logical `(homeX, homeZ)` / `(targetX, targetZ)` while leaving `(anchorX, anchorZ)` continuous
 * so the flock glides smoothly to its new habitat without any single-frame slot jump.
 */
export function evaluateFlockThreats(
  flock: BirdFlock,
  cx: number,
  cz: number,
  habitat: BiosphereHabitatIndex,
  aggressors: readonly BiosphereAggressor[],
  battles: readonly BiosphereBattleHotspot[],
  disturbances: readonly BiosphereBattleHotspot[],
): void {
  if (flock.state === 'FLEEING_BATTLE' && flock.stateTimer > 2.5) return;
  for (const bat of battles) {
    const dx = cx - bat.x, dz = cz - bat.z;
    const d = Math.hypot(dx, dz);
    if (d < bat.radius + 14 && Math.hypot(flock.homeX - bat.x, flock.homeZ - bat.z) < bat.radius + 18) {
      const inv = d > 0.1 ? 1 / d : 1;
      const [tx, tz] = pickSafeInBoundsPoint(cx, cz, d > 0.1 ? dx * inv : 1, d > 0.1 ? dz * inv : 0, 22, habitat);
      flock.homeX = tx;
      flock.homeZ = tz;
      flock.homeTileIndex = -1;
      flock.targetX = tx;
      flock.targetZ = tz;
      flock.state = 'FLEEING_BATTLE';
      flock.stateTimer = 5.5;
      return;
    }
  }

  const hitDisturbance = disturbances.some(
    (ds) =>
      Math.hypot(flock.homeX - ds.x, flock.homeZ - ds.z) < flock.species.orbitRadius + ds.radius * 0.7 ||
      (flock.state !== 'FLEEING_FOREST' && Math.hypot(cx - ds.x, cz - ds.z) < ds.radius + 6),
  );
  const forestGone = flock.species.habitatPref === 'forest' && flock.homeTileIndex >= 0 && !habitat.forestTileSet.has(flock.homeTileIndex);
  const robotChoppingHome =
    flock.species.habitatPref === 'forest' &&
    aggressors.some((ag) => ag.working && Math.hypot(ag.x - flock.homeX, ag.z - flock.homeZ) < flock.species.orbitRadius + 5);
  if ((forestGone || robotChoppingHome || hitDisturbance) && !(flock.state === 'FLEEING_FOREST' && flock.stateTimer > 4.0)) {
    const next = findSurvivingForestAnchor(flock.homeX, flock.homeZ, habitat, aggressors);
    flock.homeX = next.x;
    flock.homeZ = next.z;
    flock.homeTileIndex = flock.species.habitatPref === 'forest' ? next.tileIndex : -1;
    flock.targetX = next.x;
    flock.targetZ = next.z;
    flock.state = 'FLEEING_FOREST';
    flock.stateTimer = 6.5;
    flock.relocations++;
    return;
  }

  if (flock.state === 'FLEEING_AGGRESSOR' && flock.stateTimer > 2.0) return;
  for (const ag of aggressors) {
    const rad = (ag.radius ?? 9) + (ag.working ? 5 : 0);
    const dx = cx - ag.x, dz = cz - ag.z;
    const d = Math.hypot(dx, dz);
    if (d < rad) {
      const inv = d > 0.1 ? 1 / d : 1;
      const [tx, tz] = pickSafeInBoundsPoint(cx, cz, d > 0.1 ? dx * inv : 1, d > 0.1 ? dz * inv : 0, 18, habitat);
      flock.homeX = tx;
      flock.homeZ = tz;
      flock.targetX = tx;
      flock.targetZ = tz;
      flock.state = 'FLEEING_AGGRESSOR';
      flock.stateTimer = 4.0;
      return;
    }
  }
}

import type {
  AvianFormationStyle,
  BirdFlock,
  BirdSpeciesSpec,
} from './biosphereTypes';

export function wrapAngleDelta(delta: number): number {
  let d = delta % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export function defaultFormationForPattern(spec: BirdSpeciesSpec): AvianFormationStyle {
  if (spec.formation) return spec.formation;
  switch (spec.pattern) {
    case 'thermalSoar': return 'thermalKettle';
    case 'veeFormation': return 'veeEchelon';
    case 'waterSkim': return 'pelotonWave';
    case 'figureEight': return 'tandemPair';
    case 'ridgePatrol': return 'ridgeSweep';
    case 'canopyOrbit': return spec.scale < 0.60 ? 'murmurationRibbon' : 'canopyCarousel';
  }
}

export function samplePatternCurve(
  flock: BirdFlock,
  angle: number,
  elapsed: number,
  baseY: number,
  centerX = flock.anchorX ?? flock.homeX,
  centerZ = flock.anchorZ ?? flock.homeZ,
): [number, number, number] {
  const sp = flock.species;
  const r = sp.orbitRadius;
  const altBoost = flock.fleeAltBoost ?? 0;
  const midAlt = baseY + 0.5 * (sp.altitude[0] + sp.altitude[1]) + altBoost;

  switch (flock.pattern) {
    case 'canopyOrbit':
      return [
        centerX + Math.cos(angle) * r + Math.sin(angle * 2.0 + flock.id) * (r * 0.16),
        midAlt + Math.sin(angle * 2.0 + flock.id) * 0.95,
        centerZ + Math.sin(angle) * r + Math.cos(angle * 2.0 + flock.id) * (r * 0.14),
      ];
    case 'thermalSoar':
      return [
        centerX + Math.cos(angle * 0.68) * r,
        midAlt + Math.sin(angle * 0.45 + flock.id) * 2.4,
        centerZ + Math.sin(angle * 0.68) * r,
      ];
    case 'figureEight':
      return [
        centerX + Math.sin(angle) * r * 1.24,
        midAlt + Math.cos(angle * 2.0) * 1.25,
        centerZ + Math.sin(angle * 2.0) * r * 0.68,
      ];
    case 'waterSkim':
      return [
        centerX + Math.cos(angle) * r + Math.sin(angle * 2.0 + flock.id) * (r * 0.12),
        baseY + sp.altitude[0] + altBoost + (0.5 + 0.5 * Math.sin(elapsed * 1.6 + flock.id)) * 1.2,
        centerZ + Math.sin(angle) * r * 0.84 + Math.cos(angle * 2.0 + flock.id) * (r * 0.10),
      ];
    case 'veeFormation': {
      const migAng = (flock.id * 1.047) % Math.PI;
      const u = Math.cos(angle * 0.36) * r * 1.56;
      const v = Math.sin(angle * 0.36) * r * 0.82;
      const cm = Math.cos(migAng), sm = Math.sin(migAng);
      return [
        centerX + cm * u - sm * v,
        midAlt + Math.sin(angle * 0.36 + flock.id) * 0.55,
        centerZ + sm * u + cm * v,
      ];
    }
    case 'ridgePatrol': {
      const ridgeAng = (flock.id * 1.37 + 0.5) % Math.PI;
      const u = Math.sin(angle * 0.52) * r * 1.34;
      const v = Math.cos(angle * 0.52) * r * 0.76;
      const cr = Math.cos(ridgeAng), sr = Math.sin(ridgeAng);
      return [
        centerX + cr * u - sr * v,
        midAlt + Math.cos(angle * 1.04 + flock.id) * 1.65,
        centerZ + sr * u + cr * v,
      ];
    }
  }
}

export function minCurveRateFloor(flock: BirdFlock, cap = 4.5): number {
  return Math.max(0.6, Math.min(cap, flock.species.orbitRadius * 0.68));
}

export function sampleCurveDifferential(
  flock: BirdFlock,
  angle: number,
  elapsed: number,
  baseY: number,
  centerX = flock.anchorX ?? flock.homeX,
  centerZ = flock.anchorZ ?? flock.homeZ,
): { fwdX: number; fwdZ: number; rightX: number; rightZ: number; dSdAngle: number } {
  const dir = flock.orbitDir ?? 1;
  const eps = 0.015;
  const [x0, , z0] = samplePatternCurve(flock, angle - eps * dir, elapsed - 0.015, baseY, centerX, centerZ);
  const [x1, , z1] = samplePatternCurve(flock, angle + eps * dir, elapsed + 0.015, baseY, centerX, centerZ);
  const dx = x1 - x0;
  const dz = z1 - z0;
  const len = Math.hypot(dx, dz);
  if (len <= 1e-5) {
    return { fwdX: 0, fwdZ: 1, rightX: 1, rightZ: 0, dSdAngle: minCurveRateFloor(flock) };
  }
  const fwdX = dx / len;
  const fwdZ = dz / len;
  return {
    fwdX,
    fwdZ,
    rightX: fwdZ,
    rightZ: -fwdX,
    dSdAngle: len / (2 * eps),
  };
}

/**
 * Time-invariant C^1 lateral bound against the pattern's minimum radius of curvature `rMin`:
 * keeps `|effLat| < 0.72 * rMin` (`1 - kappa * effLat > 0.28 > 0`) with `d(effLat)/ds === 0`
 * so inner wingmen never hit a Frenet retrogressive cusp or whip sideways on tight turns.
 */
function boundLateralForPattern(flock: BirdFlock, latOffsetM: number): number {
  const r = Math.max(0.5, flock.species.orbitRadius);
  const rMin =
    flock.pattern === 'figureEight'
      ? r * 0.28
      : flock.pattern === 'thermalSoar'
        ? r * 0.95
        : r * 0.42;
  const absLat = Math.abs(latOffsetM);
  const knee = rMin * 0.45;
  if (absLat <= knee) return latOffsetM;
  const span = rMin * 0.27;
  const excess = absLat - knee;
  return Math.sign(latOffsetM) * (knee + (span * excess) / (span + excess));
}

function resolveDelayedStreamlineAngle(
  flock: BirdFlock,
  orbitAngle: number,
  elapsed: number,
  baseY: number,
  backDistM: number,
  centerX: number,
  centerZ: number,
): { delayedAng: number; dtDelay: number } {
  const dir = flock.orbitDir ?? 1;
  const scaledBack = backDistM * Math.min(1, Math.max(0.25, flock.species.orbitRadius / 6.0));
  const dtDelay = scaledBack / Math.max(2.0, flock.species.speed);
  const floor = minCurveRateFloor(flock, 5.0);
  const d0 = sampleCurveDifferential(flock, orbitAngle, elapsed, baseY, centerX, centerZ).dSdAngle;
  const midAng = orbitAngle - dir * ((0.5 * scaledBack) / Math.max(floor, d0));
  const dMid = sampleCurveDifferential(flock, midAng, elapsed - 0.5 * dtDelay, baseY, centerX, centerZ).dSdAngle;
  const delayedAng = orbitAngle - dir * (scaledBack / Math.max(floor, dMid));
  return { delayedAng, dtDelay };
}

function sampleStreamlineSlot(
  flock: BirdFlock,
  orbitAngle: number,
  elapsed: number,
  baseY: number,
  backDistM: number,
  latOffsetM: number,
  altOffsetM: number,
  centerX: number,
  centerZ: number,
): [number, number, number] {
  const { delayedAng, dtDelay } = resolveDelayedStreamlineAngle(
    flock, orbitAngle, elapsed, baseY, backDistM, centerX, centerZ,
  );
  const [bx, by, bz] = samplePatternCurve(flock, delayedAng, elapsed - dtDelay, baseY, centerX, centerZ);
  const loc = sampleCurveDifferential(flock, delayedAng, elapsed - dtDelay, baseY, centerX, centerZ);
  const effLat = boundLateralForPattern(flock, latOffsetM);
  return [bx + loc.rightX * effLat, by + altOffsetM, bz + loc.rightZ * effLat];
}

function streamlineBackDist(formation: Exclude<AvianFormationStyle, 'thermalKettle'>, idx: number): number {
  switch (formation) {
    case 'veeEchelon': return Math.ceil(idx / 2) * 1.62;
    case 'jEchelon': {
      const longArm = idx % 3 !== 0;
      const rank = longArm ? idx - Math.floor(idx / 3) : Math.ceil(idx / 3);
      return rank * 1.48;
    }
    case 'murmurationRibbon': return idx * 1.15;
    case 'pelotonWave': return idx * 1.28;
    case 'tandemPair': return Math.ceil(idx / 2) * 1.55;
    case 'canopyCarousel':
    case 'ridgeSweep': return idx * 1.35;
  }
}

/**
 * Local forward unit tangent `[fwdX, fwdZ]` for member `idx` along its own formation trajectory:
 * - `thermalKettle` members follow their own 360° circular ring tangent for both `orbitDir = 1` and `orbitDir = -1`.
 * - Streamline formations evaluate the spine tangent at member `idx`'s delayed arc-length position.
 */
export function computeFormationSlotTangent(
  flock: BirdFlock,
  idx: number,
  orbitAngle: number,
  elapsed: number,
  baseY: number,
  centerX = flock.anchorX ?? flock.homeX,
  centerZ = flock.anchorZ ?? flock.homeZ,
): [number, number] {
  if (idx === 0) {
    const d = sampleCurveDifferential(flock, orbitAngle, elapsed, baseY, centerX, centerZ);
    return [d.fwdX, d.fwdZ];
  }
  const formation = flock.formation ?? defaultFormationForPattern(flock.species);
  if (formation === 'thermalKettle') {
    const dir = flock.orbitDir ?? 1;
    const memberAng = orbitAngle * (0.68 + (idx % 2) * 0.05) + idx * 1.95;
    return [-dir * Math.sin(memberAng), dir * Math.cos(memberAng)];
  }
  const backDistM = streamlineBackDist(formation, idx);
  const { delayedAng, dtDelay } = resolveDelayedStreamlineAngle(
    flock, orbitAngle, elapsed, baseY, backDistM, centerX, centerZ,
  );
  const loc = sampleCurveDifferential(flock, delayedAng, elapsed - dtDelay, baseY, centerX, centerZ);
  return [loc.fwdX, loc.fwdZ];
}

export function computeFormationSlotTarget(
  flock: BirdFlock,
  idx: number,
  lx: number,
  ly: number,
  lz: number,
  _fwdX: number,
  _fwdZ: number,
  baseY: number,
  elapsed: number,
  orbitAngle = flock.orbitAngle,
  centerX = flock.anchorX ?? flock.homeX,
  centerZ = flock.anchorZ ?? flock.homeZ,
): [number, number, number] {
  if (idx === 0) return [lx, ly, lz];
  const formation = flock.formation ?? defaultFormationForPattern(flock.species);

  switch (formation) {
    case 'veeEchelon': {
      const rank = Math.ceil(idx / 2);
      const side = idx % 2 === 1 ? 1 : -1;
      return sampleStreamlineSlot(flock, orbitAngle, elapsed, baseY, rank * 1.62, side * rank * 1.24, rank * 0.07, centerX, centerZ);
    }
    case 'jEchelon': {
      const longArm = idx % 3 !== 0;
      const rank = longArm ? idx - Math.floor(idx / 3) : Math.ceil(idx / 3);
      const side = longArm ? -1 : 1;
      return sampleStreamlineSlot(flock, orbitAngle, elapsed, baseY, rank * 1.48, side * rank * 1.18, rank * 0.06, centerX, centerZ);
    }
    case 'thermalKettle': {
      const sp = flock.species;
      const kettleR = sp.orbitRadius * (0.76 + (idx % 3) * 0.16);
      const memberAng = orbitAngle * (0.68 + (idx % 2) * 0.05) + idx * 1.95;
      const midAlt = baseY + 0.5 * (sp.altitude[0] + sp.altitude[1]) + (flock.fleeAltBoost ?? 0);
      return [
        centerX + Math.cos(memberAng) * kettleR,
        midAlt + Math.sin(memberAng * 0.5 + idx * 1.3) * 2.4 + idx * 0.45,
        centerZ + Math.sin(memberAng) * kettleR,
      ];
    }
    case 'murmurationRibbon': {
      const wave = Math.sin(elapsed * 2.1 + idx * 0.85) * 0.92;
      const bob = Math.cos(elapsed * 1.9 + idx * 0.9) * 0.36;
      return sampleStreamlineSlot(flock, orbitAngle, elapsed, baseY, idx * 1.15, wave, bob, centerX, centerZ);
    }
    case 'pelotonWave': {
      const lat = ((idx % 2 === 1 ? 1 : -1) * Math.ceil(idx / 2)) * 0.76;
      const crest = Math.sin(elapsed * 2.6 - idx * 0.75) * 0.36;
      return sampleStreamlineSlot(flock, orbitAngle, elapsed, baseY, idx * 1.28, lat, crest, centerX, centerZ);
    }
    case 'tandemPair': {
      const wingSide = idx % 2 === 1 ? 1 : -1;
      const tier = Math.ceil(idx / 2);
      const dy = (idx % 2 === 1 ? 0.32 : -0.22) * tier;
      return sampleStreamlineSlot(flock, orbitAngle, elapsed, baseY, tier * 1.55, wingSide * tier * 1.32, dy, centerX, centerZ);
    }
    case 'canopyCarousel':
    case 'ridgeSweep': {
      const lat = (idx % 2 === 1 ? 1 : -1) * (0.65 + (idx % 3) * 0.35);
      return sampleStreamlineSlot(flock, orbitAngle, elapsed, baseY, idx * 1.35, lat, (idx - 1.5) * 0.25, centerX, centerZ);
    }
  }
}

import {
  formatSectorId,
  W11_DEFAULT_SECTOR_RADIUS,
  W11_SEVEN_SECTOR_COORDS,
  type SectorId,
} from '@terra/contracts';
import { profileNumber, worldProfile, type ProfileRow } from '../gen/profile';
import { profileShares, type TerrainShares } from '../gen/temperate';
import { TILE_M } from '../gen/world/context';
import { fbm2d, hash2d, ridged2d, seedOf, smoothstep } from '../gen/world/noise';
import { axialToPlane, HEX_DIRS, hexDistance } from '../grid/hex';
import { PREP, TERRAIN } from '../grid/layers';
import type { PlanetType } from '../kernel/state';
import { isGlobalHexTile, sampleAtlasTile } from './depositSampler';
import { buildSamplerLandingPlan } from './landingPlan';
import { sectorCenterForMacro } from './partition';
import { resolveAtlasRegionalResources, type ResolvedAtlasResourceProfile } from './regionalResources';
import type { AtlasSamplerLandingPlan, GenerateSmallAtlasOptions } from './types';

export { isGlobalHexTile, sampleAtlasTile };

const WIND_DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 0], [0.98078528, 0.19509032], [0.92387953, 0.38268343], [0.83146961, 0.55557023],
  [0.70710678, 0.70710678], [0.55557023, 0.83146961], [0.38268343, 0.92387953], [0.19509032, 0.98078528],
  [0, 1], [-0.19509032, 0.98078528], [-0.38268343, 0.92387953], [-0.55557023, 0.83146961],
  [-0.70710678, 0.70710678], [-0.83146961, 0.55557023], [-0.92387953, 0.38268343], [-0.98078528, 0.19509032],
].map(([x, y]) => [Math.fround(x), Math.fround(y)] as const);

export interface MacroCenterEntry {
  readonly sectorId: SectorId;
  readonly macroQ: number;
  readonly macroR: number;
  readonly centerQ: number;
  readonly centerR: number;
  readonly centerMx: number;
  readonly centerMy: number;
}

export interface CorridorSegment {
  readonly ax: number;
  readonly ay: number;
  readonly bx: number;
  readonly by: number;
}

export interface BaseSampledTile {
  readonly q: number;
  readonly r: number;
  readonly mx: number;
  readonly my: number;
  readonly isLandSector: boolean;
  readonly distanceToOcean: number;
  readonly distanceToLand: number;
  readonly terrain: number;
  readonly prep: number;
  readonly height: number;
}

export interface AtlasSamplerContext {
  readonly planetType: PlanetType;
  readonly seed: string;
  readonly worldSalt: string;
  readonly sectorRadius: number;
  readonly profile: ProfileRow;
  readonly shares: TerrainShares;
  readonly landMacros: readonly MacroCenterEntry[];
  readonly oceanBoundaryMacros: readonly MacroCenterEntry[];
  readonly corridors: readonly CorridorSegment[];
  readonly windDir: readonly [number, number];
  readonly seedElev: number;
  readonly seedMoist: number;
  readonly seedBasin: number;
  readonly seedCoast: number;
  readonly seedWarp: number;
  readonly seedErg: number;
  readonly seedDune: number;
  readonly seedRange: number;
  readonly seedRidge: number;
  readonly seedHole: number;
  readonly seedLandform: number;
  readonly seedDeposit: number;
  readonly seedDepositKind: number;
  readonly seedRichness: number;
  readonly seedSubVein: number;
  readonly seedSubKind: number;
  readonly landingPlan: AtlasSamplerLandingPlan;
  readonly regionalResources: ResolvedAtlasResourceProfile;
  readonly hasCustomRegionalResources: boolean;
  readonly baseCache: Map<number, BaseSampledTile>;
  num(field: string, fallback: number): number;
}

function buildMacroEntry(mq: number, mr: number, sectorRadius: number): MacroCenterEntry {
  const { centerQ, centerR } = sectorCenterForMacro(mq, mr, sectorRadius);
  const [px, py] = axialToPlane(centerQ, centerR);
  return {
    sectorId: formatSectorId(mq, mr),
    macroQ: mq + 0,
    macroR: mr + 0,
    centerQ,
    centerR,
    centerMx: Math.fround(px * TILE_M),
    centerMy: Math.fround(py * TILE_M),
  };
}

function buildCanonicalMacroTopology(opts?: GenerateSmallAtlasOptions): {
  landMacros: MacroCenterEntry[];
  oceanBoundaryMacros: MacroCenterEntry[];
  corridors: CorridorSegment[];
} {
  const sectorRadius = opts?.sectorRadius ?? W11_DEFAULT_SECTOR_RADIUS;
  const rawLand = opts?.landCoords ?? W11_SEVEN_SECTOR_COORDS;
  const landMap = new Map<SectorId, MacroCenterEntry>();
  for (const [mq, mr] of rawLand) {
    const entry = buildMacroEntry(mq, mr, sectorRadius);
    landMap.set(entry.sectorId, entry);
  }
  const landMacros = [...landMap.values()].sort((a, b) => a.macroQ - b.macroQ || a.macroR - b.macroR);

  const oceanMap = new Map<SectorId, MacroCenterEntry>();
  for (const l of landMacros) {
    for (const [dq, dr] of HEX_DIRS) {
      const nq = l.macroQ + dq;
      const nr = l.macroR + dr;
      const id = formatSectorId(nq, nr);
      if (!landMap.has(id) && !oceanMap.has(id)) {
        oceanMap.set(id, buildMacroEntry(nq, nr, sectorRadius));
      }
    }
  }
  if (opts?.oceanCoords) {
    for (const [mq, mr] of opts.oceanCoords) {
      const id = formatSectorId(mq, mr);
      if (!landMap.has(id) && !oceanMap.has(id)) {
        oceanMap.set(id, buildMacroEntry(mq, mr, sectorRadius));
      }
    }
  }
  const oceanBoundaryMacros = [...oceanMap.values()].sort((a, b) => a.macroQ - b.macroQ || a.macroR - b.macroR);

  const corridors: CorridorSegment[] = [];
  for (let i = 0; i < landMacros.length; i++) {
    const a = landMacros[i]!;
    for (let j = i + 1; j < landMacros.length; j++) {
      const b = landMacros[j]!;
      if (hexDistance(a.macroQ, a.macroR, b.macroQ, b.macroR) === 1) {
        corridors.push({ ax: a.centerMx, ay: a.centerMy, bx: b.centerMx, by: b.centerMy });
      }
    }
  }
  return { landMacros, oceanBoundaryMacros, corridors };
}

const BASE_SAMPLER_CACHE = new Map<string, { landingPlan: AtlasSamplerLandingPlan; baseCache: Map<number, BaseSampledTile> }>();

export function createAtlasSamplerContext(opts?: GenerateSmallAtlasOptions): AtlasSamplerContext {
  const planetType: PlanetType = opts?.planetType ?? 'temperate';
  const seed = opts?.seed ?? `w11-${planetType}-v1`;
  const worldSalt = opts?.worldSalt ?? '';
  const sectorRadius = opts?.sectorRadius ?? W11_DEFAULT_SECTOR_RADIUS;
  const profile = worldProfile(planetType);
  const shares = profileShares(profile);
  const { landMacros, oceanBoundaryMacros, corridors } = buildCanonicalMacroTopology(opts);
  const prefix = `${seed}|${planetType}|atlas`;
  const windSeed = seedOf(`${prefix}:wind`);
  const windDir = WIND_DIRS[Math.floor(hash2d(11, 13, windSeed) * WIND_DIRS.length)]!;
  const baseKey = `${planetType}|${seed}|${sectorRadius}|${opts?.foundingSeatsPerSector ?? ''}|${landMacros.map((m) => m.sectorId).join(',')}|${oceanBoundaryMacros.map((m) => m.sectorId).join(',')}`;
  let sharedBase = BASE_SAMPLER_CACHE.get(baseKey);
  if (!sharedBase) {
    if (BASE_SAMPLER_CACHE.size >= 24) {
      const oldest = BASE_SAMPLER_CACHE.keys().next().value;
      if (oldest !== undefined) BASE_SAMPLER_CACHE.delete(oldest);
    }
    sharedBase = {
      landingPlan: buildSamplerLandingPlan({ landMacros, sectorRadius, foundingSeatsPerSector: opts?.foundingSeatsPerSector, seed }),
      baseCache: new Map<number, BaseSampledTile>(),
    };
    BASE_SAMPLER_CACHE.set(baseKey, sharedBase);
  }
  const regionalResources = resolveAtlasRegionalResources({
    planetId: opts?.planetId,
    planetType,
    resourceProfileId: opts?.resourceProfileId,
    sectors: [
      ...landMacros.map((m) => ({
        sectorId: m.sectorId, macroQ: m.macroQ, macroR: m.macroR, kind: 'land' as const,
        archetype: opts?.sectorArchetypes?.[m.sectorId] ?? (m.macroQ === 0 && m.macroR === 0 ? 'heartland' : 'frontier'),
      })),
      ...oceanBoundaryMacros.map((m) => ({
        sectorId: m.sectorId, macroQ: m.macroQ, macroR: m.macroR, kind: 'ocean' as const,
        archetype: opts?.sectorArchetypes?.[m.sectorId],
      })),
    ],
    sectorArchetypes: opts?.sectorArchetypes,
    sectorResourceOverrides: opts?.sectorResourceOverrides,
    planetResourceOverride: opts?.planetResourceOverride,
    config: opts?.regionalResourceConfig,
  });
  return {
    planetType, seed, worldSalt, sectorRadius, profile, shares, landMacros, oceanBoundaryMacros, corridors, windDir,
    seedElev: seedOf(`${prefix}:elev`), seedMoist: seedOf(`${prefix}:moist`), seedBasin: seedOf(`${prefix}:basin`),
    seedCoast: seedOf(`${prefix}:coast`), seedWarp: seedOf(`${prefix}:warp`), seedErg: seedOf(`${prefix}:erg`),
    seedDune: seedOf(`${prefix}:dune`), seedRange: seedOf(`${prefix}:range`), seedRidge: seedOf(`${prefix}:ridge`),
    seedHole: seedOf(`${prefix}:hole`), seedLandform: seedOf(`${prefix}:landform`), seedDeposit: seedOf(`${prefix}:deposit`),
    seedDepositKind: seedOf(`${prefix}:depositKind`), seedRichness: seedOf(`${prefix}:richness`),
    seedSubVein: seedOf(`${prefix}|${worldSalt}:subVein`), seedSubKind: seedOf(`${prefix}|${worldSalt}:subKind`),
    landingPlan: sharedBase.landingPlan, regionalResources, hasCustomRegionalResources: regionalResources.hasCustomOverrides,
    baseCache: sharedBase.baseCache, num: (f, fallback) => profileNumber(profile, f, fallback),
  };
}

function dist2d(dx: number, dy: number): number {
  return Math.sqrt(dx * dx + dy * dy);
}

function pointToSegmentDistanceM(px: number, py: number, seg: CorridorSegment): number {
  const vx = seg.bx - seg.ax;
  const vy = seg.by - seg.ay;
  const lenSq = vx * vx + vy * vy;
  if (lenSq <= 1e-6) return dist2d(px - seg.ax, py - seg.ay);
  const t = Math.min(1, Math.max(0, ((px - seg.ax) * vx + (py - seg.ay) * vy) / lenSq));
  return dist2d(px - (seg.ax + t * vx), py - (seg.ay + t * vy));
}

function computeCorridorProximity(mx: number, my: number, ctx: AtlasSamplerContext): number {
  let minDistM = Infinity;
  for (const l of ctx.landMacros) {
    const d = dist2d(mx - l.centerMx, my - l.centerMy);
    if (d < minDistM) minDistM = d;
  }
  for (const seg of ctx.corridors) {
    const d = pointToSegmentDistanceM(mx, my, seg);
    if (d < minDistM) minDistM = d;
  }
  return smoothstep(18.0 * TILE_M, 4.5 * TILE_M, minDistM);
}

function computeMacroDistances(q: number, r: number, ctx: AtlasSamplerContext): {
  distanceToLand: number;
  distanceToOcean: number;
} {
  let distanceToLand = Infinity;
  for (const l of ctx.landMacros) {
    const d = Math.max(0, hexDistance(q, r, l.centerQ, l.centerR) - ctx.sectorRadius);
    if (d < distanceToLand) distanceToLand = d;
  }
  let distanceToOcean = Infinity;
  for (const m of ctx.oceanBoundaryMacros) {
    const d = Math.max(0, hexDistance(q, r, m.centerQ, m.centerR) - ctx.sectorRadius);
    if (d < distanceToOcean) distanceToOcean = d;
  }
  return { distanceToLand, distanceToOcean };
}

function sampleOceanHaloTile(
  mx: number,
  my: number,
  dLand: number,
  ctx: AtlasSamplerContext,
): { terrain: number; prep: number; height: number } {
  const cNoise = fbm2d(mx, my, 0.025, ctx.seedCoast);
  const fineWater = fbm2d(mx, my, 0.06, ctx.seedElev);
  const oceanDepth = dLand + (cNoise - 0.5) * 1.6;
  const height = Math.fround(-0.06 - 0.032 * Math.min(14, dLand) - 0.08 * (1 - cNoise) - 0.04 * (1 - fineWater));
  const terrain = oceanDepth < 4.0 ? TERRAIN.shallow : TERRAIN.deep;
  return { terrain, prep: PREP.wild, height };
}

function sampleTemperateOrOceanLand(
  mx: number,
  my: number,
  dOcean: number,
  corridor: number,
  ctx: AtlasSamplerContext,
): { terrain: number; prep: number; height: number } {
  const cNoise = fbm2d(mx, my, 0.025, ctx.seedCoast);
  const coastEnv = smoothstep(0.9, 5.2, dOcean + (cNoise - 0.5) * 1.4);
  const e1 = fbm2d(mx, my, 0.025, ctx.seedElev);
  const e2 = fbm2d(mx, my, 0.062, ctx.seedWarp);
  const ridge = ridged2d(mx, my, 0.021, ctx.seedRidge);
  const moist = fbm2d(mx, my, 0.034, ctx.seedMoist);
  const basin = fbm2d(mx, my, 0.055, ctx.seedBasin);

  const rawElev = 0.6 * e1 + 0.24 * e2 + 0.16 * ridge;
  const corridorWeight = 0.68 * corridor;
  const interiorElev = rawElev * (1 - corridorWeight) + 0.48 * corridorWeight;
  const coastalTarget = 0.22 + 0.08 * cNoise;
  const isOceanBiome = ctx.planetType === 'ocean';
  const waterThreshold = isOceanBiome ? 0.41 : 0.31;
  const deepThreshold = isOceanBiome ? 0.31 : 0.23;

  let effElev = coastalTarget + (interiorElev - coastalTarget) * coastEnv;
  if (corridor > 0.4) {
    effElev = Math.max(effElev, waterThreshold + 0.045 * smoothstep(0.4, 0.75, corridor));
  }

  if (effElev < waterThreshold) {
    const wDepth = (waterThreshold - effElev) / Math.max(0.05, waterThreshold);
    const height = Math.fround(-0.03 - 0.5 * wDepth);
    const terrain = effElev < deepThreshold ? TERRAIN.deep : TERRAIN.shallow;
    return { terrain, prep: PREP.wild, height };
  }

  const u = (effElev - waterThreshold) / (1 - waterThreshold);
  const holeFactor =
    smoothstep(0.2, 0.08, basin) *
    smoothstep(0.05, 0.14, u) *
    smoothstep(0.38, 0.26, u) *
    (1 - smoothstep(0.15, 0.35, corridor));

  let baseH: number;
  if (u <= 0.54) {
    baseH = 0.02 + 0.12 * (u / 0.54);
  } else if (u <= 0.75) {
    const tSlope = (u - 0.54) / 0.21;
    baseH = 0.14 + 0.41 * tSlope * tSlope * (3 - 2 * tSlope);
  } else {
    const tRock = (u - 0.75) / 0.25;
    baseH = 0.55 + 0.75 * tRock;
  }
  const height = Math.fround(baseH - 0.36 * holeFactor);

  let terrain: number;
  if (holeFactor > 0.45) {
    terrain = TERRAIN.hole;
  } else if (u > 0.75) {
    terrain = TERRAIN.rock;
  } else if (u > 0.54) {
    terrain = TERRAIN.slope;
  } else {
    const forestScore = moist + 0.12 * smoothstep(0.18, 0.48, u) - 0.32 * smoothstep(0.35, 0.85, corridor);
    const forestCutoff = isOceanBiome ? 0.49 : 0.435;
    terrain = forestScore > forestCutoff && u > 0.05 ? TERRAIN.forest : TERRAIN.flat;
  }
  return { terrain, prep: terrain === TERRAIN.flat ? PREP.flat : PREP.wild, height };
}

function duneWave(coord: number, wavelengthM: number): number {
  const phase = (coord / wavelengthM) % 1;
  const t01 = phase < 0 ? phase + 1 : phase;
  const s = t01 < 0.62 ? t01 / 0.62 : (1 - t01) / 0.38;
  return s * s * (3 - 2 * s);
}

function sampleGlobalDesertLandformM(mx: number, my: number, ctx: AtlasSamplerContext): number {
  const cellM = 56;
  const cx = Math.floor(mx / cellM);
  const cy = Math.floor(my / cellM);
  const rMin = ctx.num('mesaRadiusMin', 3.5) + 4.0;
  const rMax = ctx.num('mesaRadiusMax', 6.5) + 4.5;
  const hMin = ctx.num('mesaHeightMinM', 6);
  const hMax = ctx.num('mesaHeightMaxM', 11);
  let best = 0;

  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const gx = cx + dx;
      const gy = cy + dy;
      const cSeed = (ctx.seedLandform ^ Math.imul(gx, 0x9e3779b1) ^ Math.imul(gy, 0x85ebca6b)) >>> 0;
      if (hash2d(gx, gy, ctx.seedLandform) >= 0.34) continue;
      const fx = (gx + 0.25 + 0.5 * hash2d(1, 7, cSeed)) * cellM;
      const fy = (gy + 0.25 + 0.5 * hash2d(2, 9, cSeed)) * cellM;
      const radius = rMin + hash2d(9, 2, cSeed) * (rMax - rMin);
      const heightM = (hMin + hash2d(4, 4, cSeed) * (hMax - hMin)) * 0.65;
      const dTiles = dist2d(mx - fx, my - fy) / TILE_M;
      const wobble = 0.18 * (fbm2d(mx, my, 0.035, cSeed) - 0.5);
      const t = (dTiles + wobble) / radius;
      if (t >= 1.75) continue;
      const profile = 1 - smoothstep(0.25, 1.72, t);
      const h = heightM * profile;
      if (h > best) best = h;
    }
  }
  return best;
}

function sampleDesertLand(
  mx: number,
  my: number,
  dOcean: number,
  corridor: number,
  ctx: AtlasSamplerContext,
): { terrain: number; prep: number; height: number } {
  const cNoise = fbm2d(mx, my, 0.02, ctx.seedCoast);
  const coastEnv = smoothstep(0.8, 8.5, dOcean + (cNoise - 0.5) * 0.6);
  const [wx, wy] = ctx.windDir;
  const ergScale = ctx.num('ergScale', 0.012);
  const duneH = ctx.num('duneHeightM', 5.2) * 0.52;
  const waveM = ctx.num('duneWavelengthM', 15) * 1.9;
  const crossS = ctx.num('duneCrossScale', 0.018);
  const rangeS = ctx.num('rangeScale', 0.0045) * 1.6;
  const rangeH = ctx.num('rangeHeightM', 12) * 0.52;
  const rockH = ctx.num('rockHeightM', 2.4);
  const holeT = ctx.num('holeThreshold', 0.18);

  const u = mx * wx + my * wy;
  const v = -mx * wy + my * wx;
  const warp = (fbm2d(mx, my, 0.009, ctx.seedWarp) - 0.5) * 10;
  const d1 = duneWave(u + warp, waveM);
  const d2 = duneWave(u * 0.7 - v * 0.5 + warp * 0.5, waveM * 0.85);
  const env =
    (0.75 + 0.25 * fbm2d(mx, my, ergScale, ctx.seedErg)) *
    (0.8 + 0.2 * fbm2d(v, u * 0.25, crossS, ctx.seedDune));
  const duneBase = (0.35 + d1 * duneH + d2 * (duneH * 0.22)) * env;

  const rawMacro = 0.65 * fbm2d(mx, my, 0.016, ctx.seedElev) + 0.35 * fbm2d(mx, my, 0.028, ctx.seedBasin);
  const macroElev = rawMacro * (1 - 0.45 * corridor) + 0.32 * (0.45 * corridor);

  const highlandMask = smoothstep(0.47, 0.66, macroElev) * smoothstep(3.5, 10.0, dOcean);
  const ridge = smoothstep(0.4, 0.88, ridged2d(mx, my, rangeS, ctx.seedRidge));
  const cragRise = rangeH * highlandMask * (0.48 + 0.52 * ridge);
  const mesaRise = sampleGlobalDesertLandformM(mx, my, ctx) * 0.78 * highlandMask;
  const rockRise = Math.max(cragRise, mesaRise);

  const duneEnvelope = smoothstep(0.38, 0.52, macroElev) * coastEnv;
  const flatMask = smoothstep(0.47, 0.38, macroElev) * smoothstep(1.2, 4.0, dOcean);

  const holeNoise = fbm2d(mx, my, 0.03, ctx.seedHole);
  const holeMask =
    smoothstep(holeT + 0.02, holeT - 0.06, holeNoise) *
    smoothstep(0.38, 0.46, macroElev) *
    smoothstep(0.58, 0.48, macroElev) *
    smoothstep(3.0, 6.5, dOcean);

  const wildH = duneBase * duneEnvelope + rockRise * coastEnv;
  const blendedH = 0.08 + wildH * (1 - flatMask) - 0.38 * holeMask;
  const height = Math.fround(blendedH);

  if (holeMask > 0.48) return { terrain: TERRAIN.hole, prep: PREP.wild, height };
  if (rockRise * coastEnv > 1.05 && height > rockH * 0.42) {
    return { terrain: TERRAIN.rock, prep: PREP.wild, height };
  }
  if (flatMask > 0.98 && holeMask === 0) {
    return { terrain: TERRAIN.flat, prep: PREP.flat, height: Math.fround(0.08) };
  }
  return { terrain: TERRAIN.slope, prep: PREP.wild, height };
}

function packTileCoord(q: number, r: number): number {
  return ((q + 16384) << 15) ^ (r + 16384);
}

export function sampleBaseAtlasTile(q: number, r: number, ctx: AtlasSamplerContext): BaseSampledTile {
  const key = packTileCoord(q, r);
  const cached = ctx.baseCache.get(key);
  if (cached && cached.q === q && cached.r === r) return cached;

  const [px, py] = axialToPlane(q, r);
  const mx = Math.fround(px * TILE_M);
  const my = Math.fround(py * TILE_M);
  const { distanceToLand, distanceToOcean } = computeMacroDistances(q, r, ctx);
  const isLandSector = distanceToLand === 0;

  let sampled: { terrain: number; prep: number; height: number };
  if (!isLandSector) {
    sampled = sampleOceanHaloTile(mx, my, distanceToLand, ctx);
  } else if (ctx.landingPlan.flatOverrideCoords.has(key)) {
    sampled = { terrain: TERRAIN.flat, prep: PREP.flat, height: Math.fround(0.08) };
  } else {
    const corridor = computeCorridorProximity(mx, my, ctx);
    sampled =
      ctx.planetType === 'desert'
        ? sampleDesertLand(mx, my, distanceToOcean, corridor, ctx)
        : sampleTemperateOrOceanLand(mx, my, distanceToOcean, corridor, ctx);
  }

  const out: BaseSampledTile = {
    q: q + 0,
    r: r + 0,
    mx,
    my,
    isLandSector,
    distanceToOcean,
    distanceToLand,
    terrain: sampled.terrain,
    prep: sampled.prep,
    height: sampled.height,
  };
  ctx.baseCache.set(key, out);
  return out;
}

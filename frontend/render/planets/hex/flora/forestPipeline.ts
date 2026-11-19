import { hexIndex } from '@terra/sim/grid/hex';
import type { PlanetKind, PlanetSpec } from '../../PlanetSpec';
import { BREEDS_BY_BIOME, type TreeBreedId, type TreeBreedSpec } from '../../../visuals/terrain/treeBreeds';
import { foliageTreeTraits, type Place } from '../../../visuals/terrain/Scatter';
import { HEX_DEPOSIT, HEX_TERRAIN, isClearedPrep, tileHash01, tileHashU32, type HexTileLayers } from '../chunkMesh';
import { tileXZ } from '../hexMath';

export type ForestStandRegime = 'monoculture' | 'mixed';
export type CanopyCohort = 'emergent' | 'canopy' | 'understory';

export interface CandidateTreePlace {
  tileQ: number;
  tileR: number;
  tileIndex: number;
  slotIndex: number;
  x: number;
  z: number;
  minCrownDist: number;
}

export interface ForestStandClassification {
  standId: number;
  regime: ForestStandRegime;
  moisture: number;
  exposure: number;
  primaryBreed: TreeBreedSpec;
  secondaryBreed: TreeBreedSpec;
  pioneerBreed: TreeBreedSpec;
}

export interface StratifiedTreeSite extends CandidateTreePlace {
  stand: ForestStandClassification;
  breed: TreeBreedSpec;
  cohort: CanopyCohort;
}

export interface GeneratedForestTree extends Place {
  tileQ: number;
  tileR: number;
  tileIndex: number;
  breedId: TreeBreedId;
  breedIndex: number;
  cohort: CanopyCohort;
  standRegime: ForestStandRegime;
  windOmega: number;
  windPhase: number;
}

export interface ForestPipelineResult {
  candidatePlaces: CandidateTreePlace[];
  standsByTile: Map<number, ForestStandClassification>;
  stratifiedSites: StratifiedTreeSite[];
  trees: GeneratedForestTree[];
}

function valueNoise2D(x: number, z: number, seed: number): number {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
  const n00 = tileHash01(ix, iz, seed);
  const n10 = tileHash01(ix + 1, iz, seed);
  const n01 = tileHash01(ix, iz + 1, seed);
  const n11 = tileHash01(ix + 1, iz + 1, seed);
  return (n00 + (n10 - n00) * sx) * (1 - sz) + (n01 + (n11 - n01) * sx) * sz;
}

function fbmStand(x: number, z: number, seed: number): number {
  return (
    valueNoise2D(x * 0.11, z * 0.11, seed) * 0.58 +
    valueNoise2D(x * 0.24, z * 0.24, seed + 37) * 0.28 +
    valueNoise2D(x * 0.51, z * 0.51, seed + 83) * 0.14
  );
}

/**
 * Stage 1 — Candidate Tree Place Generation:
 * Places `count` crown-inhibited micro-sites inside hex `(q, r)` using golden-angle sector offsets so
 * adjacent trunks maintain realistic root/crown separation (`>= 0.42 m`).
 */
export function generateCandidateTreePlaces(
  q: number,
  r: number,
  tileIndex: number,
  count: number,
  saltBase = 200,
): CandidateTreePlace[] {
  const [cx, cz] = tileXZ(q, r);
  const baseAngle = tileHash01(q, r, saltBase + 99) * Math.PI * 2;
  const sector = (Math.PI * 2) / Math.max(1, count);
  const pts: Array<{ x: number; z: number }> = [];
  const out: CandidateTreePlace[] = [];

  for (let k = 0; k < count; k++) {
    const h1 = tileHash01(q, r, saltBase + k * 7);
    const h2 = tileHash01(q, r, saltBase + k * 7 + 1);
    const minR = count > 1 ? 0.36 : 0.14;
    const dist = minR + 0.36 * h1;
    const angle = baseAngle + k * sector + (h2 - 0.5) * Math.min(0.46, sector * 0.34);
    const x = cx + Math.cos(angle) * dist;
    const z = cz + Math.sin(angle) * dist;
    let minCrownDist = 2.0;
    for (const prev of pts) {
      minCrownDist = Math.min(minCrownDist, Math.hypot(x - prev.x, z - prev.z));
    }
    pts.push({ x, z });
    out.push({ tileQ: q, tileR: r, tileIndex, slotIndex: k, x, z, minCrownDist });
  }
  return out;
}

/**
 * Stage 2 — Ecological Stand & Ecotone Formation:
 * Evaluates abiotic moisture + exposure + stand-seed fields so forests naturally organize into coherent
 * single-breed climax monocultures (~45%) and mixed-breed old-growth / riparian stands (~55%).
 */
export function evaluateForestStand(
  q: number,
  r: number,
  biome: PlanetKind,
  planetSeed = 17,
  tileElevation?: number,
): ForestStandClassification {
  const breeds = BREEDS_BY_BIOME[biome];
  const [wx, wz] = tileXZ(q, r);
  const standField = fbmStand(wx * 0.32, wz * 0.32, planetSeed + 401);
  const regimeField = fbmStand(wx * 0.22 + 19, wz * 0.22 - 11, planetSeed + 509);
  const baseMoisture = fbmStand(wx * 0.28 - 31, wz * 0.28 + 23, planetSeed + 613);
  const riparianBoost = tileElevation !== undefined && tileElevation < 0.48 ? (0.48 - tileElevation) * 0.45 : 0;
  const ridgeDry = tileElevation !== undefined && tileElevation > 1.8 ? Math.min(0.22, (tileElevation - 1.8) * 0.12) : 0;
  const moisture = Math.max(0, Math.min(1, baseMoisture + riparianBoost - ridgeDry * 0.5));
  const exposure = Math.max(0, Math.min(1, fbmStand(wx * 0.25 + 47, wz * 0.25 + 41, planetSeed + 719) + ridgeDry));

  const standCellQ = Math.round(q / 5);
  const standCellR = Math.round(r / 5);
  const standId = tileHashU32(standCellQ, standCellR, planetSeed + 907) % 10000;
  const regime: ForestStandRegime = regimeField < 0.46 ? 'monoculture' : 'mixed';

  const wetBreeds = breeds.filter((b) => b.moisturePref === 'wet');
  const dryBreeds = breeds.filter((b) => b.moisturePref === 'dry');
  const mesicBreeds = breeds.filter((b) => b.moisturePref === 'mesic');

  let primaryBreed: TreeBreedSpec;
  if (moisture > 0.64 && wetBreeds.length > 0) {
    primaryBreed = wetBreeds[Math.floor(standField * wetBreeds.length) % wetBreeds.length]!;
  } else if (exposure > 0.62 && dryBreeds.length > 0) {
    primaryBreed = dryBreeds[Math.floor(standField * dryBreeds.length) % dryBreeds.length]!;
  } else {
    const pool = mesicBreeds.length > 0 ? mesicBreeds : breeds;
    primaryBreed = pool[Math.floor(standField * 7.99) % pool.length]!;
  }

  const others = breeds.filter((b) => b.id !== primaryBreed.id);
  const secPool = others.length > 0 ? others : breeds;
  const secondaryBreed = secPool[Math.floor((moisture * 5.3 + standField * 3.1) % secPool.length)]!;
  const pioPool = others.filter((b) => b.id !== secondaryBreed.id);
  const pioneerBreed = (pioPool.length > 0 ? pioPool : secPool)[Math.floor((exposure * 7.1) % Math.max(1, pioPool.length || secPool.length))]!;

  return { standId, regime, moisture, exposure, primaryBreed, secondaryBreed, pioneerBreed };
}

/**
 * Stage 3 — Canopy Competition & Age-Cohort Stratification:
 * Selects breed per site (100% single breed in core monoculture stands; primary + co-dominant + pioneer
 * in mixed stands) and assigns vertical strata (`emergent`, `canopy`, `understory`).
 */
export function stratifyStandSites(
  places: readonly CandidateTreePlace[],
  stand: ForestStandClassification,
): StratifiedTreeSite[] {
  return places.map((place, idx) => {
    const mixRoll = tileHash01(place.tileQ, place.tileR, 1200 + place.slotIndex * 13);
    let breed = stand.primaryBreed;
    if (stand.regime === 'mixed') {
      if (mixRoll > 0.80) breed = stand.pioneerBreed;
      else if (mixRoll > 0.44) breed = stand.secondaryBreed;
    }
    const cohortRoll = tileHash01(place.tileQ, place.tileR, 1300 + place.slotIndex * 17);
    const cohort: CanopyCohort =
      idx === 0 && stand.moisture > 0.42 && cohortRoll > 0.35
        ? 'emergent'
        : idx >= 2 || cohortRoll < 0.28
          ? 'understory'
          : 'canopy';
    return { ...place, stand, breed, cohort };
  });
}

/**
 * Stage 4 — Individual Tree Phenotype & Wind Trait Synthesis:
 * Ensures even adjacent trees of the exact same breed look distinctly grown: unique 360° yaw, crown/trunk
 * aspect ratio, phototropic tilt, chlorophyll tint, and individual GPU wind oscillator frequency & phase.
 */
export function synthesizeTreePhenotype(
  site: StratifiedTreeSite,
  heightAt: (x: number, z: number) => number,
  saltBase = 200,
): GeneratedForestTree {
  const { tileQ: q, tileR: r, slotIndex: k, breed, cohort, stand } = site;
  const hRot = tileHash01(q, r, saltBase + k * 7 + 2);
  const hSize = tileHash01(q, r, saltBase + k * 7 + 3);
  const hTint = tileHash01(q, r, saltBase + k * 7 + 4);
  const hAspect = tileHash01(q, r, saltBase + k * 7 + 5);
  const hWind = tileHash01(q, r, saltBase + k * 7 + 6);

  const cohortMul = cohort === 'emergent' ? 1.24 : cohort === 'understory' ? 0.72 : 1.0;
  const sxRange = breed.scaleRangeXZ;
  const syRange = breed.scaleRangeY;
  const slotSpread = ((hSize * 0.62 + k * 0.3183) % 1);
  const scaleXZ = (sxRange[0] + (sxRange[1] - sxRange[0]) * hAspect) * cohortMul;
  const scaleY = (syRange[0] + (syRange[1] - syRange[0]) * slotSpread) * cohortMul;
  const windMul = breed.windCompliance * (0.82 + 0.36 * hWind) * (cohort === 'understory' ? 1.15 : 1.0);
  const s = 0.28 + 0.66 * hSize;
  const traits = foliageTreeTraits(site.x, site.z, (0.36 + 0.32 * s) * scaleY);

  return {
    tileQ: q,
    tileR: r,
    tileIndex: site.tileIndex,
    x: site.x,
    y: heightAt(site.x, site.z),
    z: site.z,
    rot: hRot * Math.PI * 2,
    s,
    r: hTint,
    scaleX: scaleXZ * (0.94 + 0.12 * hWind),
    scaleY,
    scaleZ: scaleXZ * (1.06 - 0.12 * hWind),
    tintMul: 0.90 + 0.22 * stand.moisture * (cohort === 'emergent' ? 1.06 : 0.96),
    breedId: breed.id,
    breedIndex: breed.breedIndex,
    windMul,
    cohort,
    standRegime: stand.regime,
    windOmega: traits.omega,
    windPhase: traits.phase,
  };
}

/** Runs all 4 stages for a single forest/oasis tile `(q, r)`. */
export function generateTileForestTrees(
  q: number,
  r: number,
  tileIndex: number,
  biome: PlanetKind,
  heightAt: (x: number, z: number) => number,
  planetSeed = 17,
  countOverride?: number,
): GeneratedForestTree[] {
  const count = countOverride ?? 2 + (tileHashU32(q, r, 101) % 3);
  const [cx, cz] = tileXZ(q, r);
  const places = generateCandidateTreePlaces(q, r, tileIndex, count, 200);
  const stand = evaluateForestStand(q, r, biome, planetSeed, heightAt(cx, cz));
  const stratified = stratifyStandSites(places, stand);
  return stratified.map((s) => synthesizeTreePhenotype(s, heightAt, 200));
}

/**
 * Full planet-level execution of the 4-stage Forest Generation Pipeline (for analytics, biosphere habitat queries, and tests).
 */
export function runForestGenerationPipeline(
  radius: number,
  layers: HexTileLayers,
  look: PlanetSpec,
  heightAt: (x: number, z: number) => number = () => 0,
): ForestPipelineResult {
  const hx = hexIndex(radius);
  const candidatePlaces: CandidateTreePlace[] = [];
  const standsByTile = new Map<number, ForestStandClassification>();
  const stratifiedSites: StratifiedTreeSite[] = [];
  const trees: GeneratedForestTree[] = [];
  const terrain = layers.terrain;
  if (!terrain) return { candidatePlaces, standsByTile, stratifiedSites, trees };

  for (let i = 0; i < hx.count; i++) {
    if (isClearedPrep(layers.prep?.[i] ?? 0)) continue;
    const dep = layers.deposit?.[i] ?? 0;
    if (dep === HEX_DEPOSIT.metals || dep === HEX_DEPOSIT.minerals || dep === HEX_DEPOSIT.oil) continue;
    const q = hx.q[i]!, r = hx.r[i]!;
    const t = terrain[i] ?? 0;
    const isForest =
      t === HEX_TERRAIN.forest ||
      (look.kind === 'dune' && t === HEX_TERRAIN.slope && (layers.height[i] ?? 0) < 0.55 && tileHash01(q, r, look.seed + 771) > 0.90);
    if (!isForest) continue;

    const count = look.kind === 'dune' ? 1 + (tileHashU32(q, r, 109) % 2) : 2 + (tileHashU32(q, r, 101) % 3);
    const places = generateCandidateTreePlaces(q, r, i, count, 200);
    const stand = evaluateForestStand(q, r, look.kind, look.seed);
    const strat = stratifyStandSites(places, stand);
    standsByTile.set(i, stand);
    candidatePlaces.push(...places);
    stratifiedSites.push(...strat);
    for (const s of strat) trees.push(synthesizeTreePhenotype(s, heightAt, 200));
  }
  return { candidatePlaces, standsByTile, stratifiedSites, trees };
}

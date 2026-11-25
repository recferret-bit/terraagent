import { fbm2d, HEX_DIRS, latticeHash01, mixGroundSeed, type HexIndex } from '@terra/sim/grid/hex';
import type { PlanetKind } from '../../PlanetSpec';
import { HEX_DEPOSIT, HEX_PREP, HEX_TERRAIN, isClearedPrep, tileShoreFactor, type HexTileLayers } from '../chunkMesh';
import { sampleHexLatticeField, sampleHexLatticeFieldArray } from '../heightSampler';
import { tileAt, tileXZ } from '../hexMath';
import {
  GROUND_FLORA_KINDS,
  GROUND_OBJECT_SPECS,
  renderedFloraOuterRadius,
  type FloraFootprint,
  type GroundFloraKind,
  type GroundObjectCategory,
  type GroundObjectKind,
  type GroundObjectSpec,
  type TerrainPropKind,
  type TerrainSubstrate,
} from './groundObjectCatalog';

export {
  GROUND_FLORA_KINDS,
  GROUND_OBJECT_SPECS,
  renderedFloraOuterRadius,
  type FloraFootprint,
  type GroundFloraKind,
  type GroundObjectCategory,
  type GroundObjectKind,
  type GroundObjectSpec,
  type TerrainPropKind,
  type TerrainSubstrate,
};

export interface EcotoneSample {
  readonly moisture: number;
  readonly rockiness: number;
  readonly fertility: number;
}

export interface TerrainSiteSample {
  readonly biome: PlanetKind;
  readonly substrate: TerrainSubstrate;
  readonly slope: number;
  readonly ecotone: EcotoneSample;
}

/** Smooth 2D FBM ecotone fields seeded deterministically by the planet seed. */
export function floraEcotoneFields(x: number, z: number, seed: number): EcotoneSample {
  return {
    moisture: fbm2d(x, z, 0.085, mixGroundSeed(seed, 17)),
    rockiness: fbm2d(x, z, 0.095, mixGroundSeed(seed, 53)),
    fertility: fbm2d(x, z, 0.075, mixGroundSeed(seed, 89)),
  };
}

const FOOTPRINT_PERIMETER_DIRS: readonly (readonly [number, number])[] = Array.from({ length: 16 }, (_, i) => {
  const a = (i / 16) * Math.PI * 2;
  return [Math.cos(a), Math.sin(a)] as const;
});

/** Pure compatibility predicate deciding whether `kind` can be fitted onto `site`. */
export function canFitObjectOnTerrain(kind: GroundObjectKind, site: TerrainSiteSample): boolean {
  const spec = GROUND_OBJECT_SPECS[kind];
  if (!spec.biomes.includes(site.biome)) return false;
  if (!spec.allowedSubstrates.includes(site.substrate)) return false;
  if (site.slope > spec.maxSlope) return false;
  if (spec.minMoisture !== undefined && site.ecotone.moisture < spec.minMoisture) return false;
  if (spec.maxMoisture !== undefined && site.ecotone.moisture > spec.maxMoisture) return false;
  return true;
}

const ZERO_ECOTONE: EcotoneSample = { moisture: 0.5, rockiness: 0, fertility: 0.5 };

/**
 * Footprint-aware compatibility check used by both `HexTerrain` and `PlanetSurface`: verifies the center site
 * AND radial rings (`0.55r`, `1.0r`) across the object's rendered outer extent (`substrateRadius ?? radius`)
 * so foliage blades, lobes, and rock skirts never extend onto beach sand or water.
 */
export function canFitObjectFootprint(
  kind: GroundObjectKind,
  x: number,
  z: number,
  sampleSiteAt: (px: number, pz: number, substrateOnly?: boolean) => TerrainSiteSample,
  minRadius = 0,
): boolean {
  const spec = GROUND_OBJECT_SPECS[kind];
  const center = sampleSiteAt(x, z, false);
  if (!canFitObjectOnTerrain(kind, center)) return false;
  const r = Math.max(spec.footprint.substrateRadius ?? spec.footprint.radius, minRadius);
  if (r <= 0) return true;
  const perimSubstrates = spec.footprintSubstrates ?? spec.allowedSubstrates;
  const rings = r > 0.85 ? ([0.55, 1.0] as const) : ([1.0] as const);

  for (const ringMul of rings) {
    const rr = r * ringMul;
    for (const [dx, dz] of FOOTPRINT_PERIMETER_DIRS) {
      const sub = sampleSiteAt(x + dx * rr, z + dz * rr, true).substrate;
      if (center.substrate === 'livingTurf') {
        if (
          sub === 'submerged' ||
          sub === 'craterHole' ||
          sub === 'coastalSand' ||
          sub === 'coastalForest' ||
          sub === 'rockOutcrop' ||
          sub === 'duneMesaCap'
        ) {
          return false;
        }
        continue;
      }
      if (!perimSubstrates.includes(sub)) return false;
    }
  }
  return true;
}

/** Shared dune wadi/oasis slope test used by both `forestPipeline` and `floraPlacementPipeline`. */
export function isDuneWadiSlope(
  q: number,
  r: number,
  rawHeight: number,
  ecotone: EcotoneSample,
  planetSeed: number,
): boolean {
  if (rawHeight >= 1.15) return false;
  const bioPatch = latticeHash01(q, r, mixGroundSeed(planetSeed, 771)) * 0.55 + ecotone.moisture * 0.45;
  const wadiMoisture = rawHeight < 0.62 ? 0.14 : 0;
  return bioPatch + wadiMoisture > 0.80;
}

export interface TileWaterProximity {
  readonly waterNeighbors: number;
  readonly deepNeighbors: number;
  readonly landNeighbors: number;
  readonly shallowNeighbor: boolean;
}

/** Inspects adjacent water vs dry land neighbors around tile `i` (non-dune only). */
export function inspectTileWaterNeighbors(
  hx: HexIndex,
  i: number,
  layers: HexTileLayers,
  kind: PlanetKind,
): TileWaterProximity {
  if (kind === 'dune' || !layers.terrain) {
    return { waterNeighbors: 0, deepNeighbors: 0, landNeighbors: 0, shallowNeighbor: false };
  }
  const q = hx.q[i]!;
  const r = hx.r[i]!;
  let waterNeighbors = 0;
  let deepNeighbors = 0;
  let landNeighbors = 0;
  let shallowNeighbor = false;
  for (const [dq, dr] of HEX_DIRS) {
    const j = hx.indexOf(q + dq, r + dr);
    if (j < 0) continue;
    if (isClearedPrep(layers.prep?.[j] ?? 0)) {
      landNeighbors++;
      continue;
    }
    const t = layers.terrain[j] ?? 0;
    if (t === HEX_TERRAIN.shallow) {
      waterNeighbors++;
      shallowNeighbor = true;
    } else if (t === HEX_TERRAIN.deep) {
      waterNeighbors++;
      deepNeighbors++;
    } else if (t !== HEX_TERRAIN.hole) {
      landNeighbors++;
    }
  }
  return { waterNeighbors, deepNeighbors, landNeighbors, shallowNeighbor };
}

/**
 * Exact CPU mirror of the vertex-interpolated `vHexShore` varying in `HEX_SHORE_BEACH_GLSL` (`hexEdges.ts`).
 */
export function sampleHexShoreAtPoint(
  hx: HexIndex,
  x: number,
  z: number,
  layers: HexTileLayers,
  biome: PlanetKind,
  shoreByTile?: ArrayLike<number>,
): number {
  if (biome === 'dune' || !layers.terrain) return 0;
  if (shoreByTile) return sampleHexLatticeFieldArray(hx, x, z, shoreByTile);
  const effectiveLayers = layers.kind === biome ? layers : { ...layers, kind: biome };
  return sampleHexLatticeField(hx, x, z, (idx) => tileShoreFactor(hx, idx, effectiveLayers));
}

/**
 * Exact support of `beachMask > 0` in `HEX_SHORE_BEACH_GLSL` (`hexEdges.ts`):
 * - `dryCoast` / `wetReach`: `vHexShore > 0.32` (`shoreZone`) and `y < 0.34` (`0.345` with margin)
 * - `cornerSaturate`: `vHexShore > 0.74` and `y < 0.36` (`lowCoastal`)
 */
const HEX_DRY_SAND_MAX_Y = 0.345;
const HEX_LOW_COASTAL_MAX_Y = 0.36;
const HEX_SAND_MIN_SHORE = 0.32;
const HEX_CORNER_SATURATE_SHORE = 0.74;

/** True wherever `HEX_SHORE_BEACH_GLSL` (`hexEdges.ts`) can paint visible coastal sand (`beachMask > 0`). */
export function isHexBeachSandAtPoint(
  hx: HexIndex,
  x: number,
  z: number,
  y: number,
  layers: HexTileLayers,
  biome: PlanetKind,
  shoreByTile?: ArrayLike<number>,
): boolean {
  if (biome === 'dune' || !layers.terrain || y <= -0.34 || y >= HEX_LOW_COASTAL_MAX_Y) return false;
  const vShore = sampleHexShoreAtPoint(hx, x, z, layers, biome, shoreByTile);
  return (vShore > HEX_SAND_MIN_SHORE && y < HEX_DRY_SAND_MAX_Y) || (vShore > HEX_CORNER_SATURATE_SHORE && y < HEX_LOW_COASTAL_MAX_Y);
}

/**
 * Local tile-only site classifier for `scatterTileProps`, preserving `RN-02` (neighbor changes never shift a tile's props)
 * while routing every prop (`pine`, `duneTree`, `boulder`, `spire`, `metals`, `minerals`, `oil`) through `canFitObjectOnTerrain`.
 */
export function classifyHexTilePropSite(
  q: number,
  r: number,
  terrain: number,
  prep: number,
  deposit: number,
  biome: PlanetKind,
  planetSeed: number,
): TerrainSiteSample {
  const [cx, cz] = tileXZ(q, r);
  const ecotone = floraEcotoneFields(cx, cz, planetSeed);
  const withSub = (substrate: TerrainSubstrate): TerrainSiteSample => ({ biome, substrate, slope: 0, ecotone });

  const hasDeposit =
    deposit === HEX_DEPOSIT.metals || deposit === HEX_DEPOSIT.minerals || deposit === HEX_DEPOSIT.oil;
  if (hasDeposit) {
    return withSub(biome === 'dune' && terrain === HEX_TERRAIN.rock ? 'duneMesaCap' : 'depositPad');
  }
  if (isClearedPrep(prep) || prep === HEX_PREP.ridge || prep === HEX_PREP.moat) {
    return withSub('engineeredPad');
  }
  if (terrain === HEX_TERRAIN.shallow || terrain === HEX_TERRAIN.deep) return withSub('submerged');
  if (terrain === HEX_TERRAIN.hole) return withSub('craterHole');
  if (terrain === HEX_TERRAIN.rock) return withSub(biome === 'dune' ? 'duneMesaCap' : 'rockOutcrop');
  if (biome === 'dune') {
    return withSub(terrain === HEX_TERRAIN.forest ? 'desertWadi' : 'aridDune');
  }
  if (terrain === HEX_TERRAIN.forest) return withSub('forestFloor');
  if (terrain === HEX_TERRAIN.slope) return withSub('uplandSlope');
  return withSub('meadowTurf');
}

export function hasMountainRockNeighbor(hx: HexIndex, tileIndex: number, layers: HexTileLayers): boolean {
  const q = hx.q[tileIndex];
  const r = hx.r[tileIndex];
  if (q === undefined || r === undefined) return false;
  for (const [dq, dr] of HEX_DIRS) {
    const ni = hx.indexOf(q + dq, r + dr);
    if (ni >= 0 && (layers.terrain?.[ni] ?? HEX_TERRAIN.flat) === HEX_TERRAIN.rock) return true;
  }
  return false;
}

function classifyNonDuneHexSubstrate(params: {
  hx: HexIndex;
  tileIndex: number;
  x: number;
  z: number;
  y: number;
  t: number;
  slope: number;
  layers: HexTileLayers;
  biome: PlanetKind;
  waterProx?: TileWaterProximity;
  isWetlandSlot?: boolean;
  shoreByTile?: ArrayLike<number>;
}): TerrainSubstrate {
  const { hx, tileIndex, x, z, y, t, slope, layers, biome, waterProx, isWetlandSlot, shoreByTile } = params;
  const prox = waterProx ?? inspectTileWaterNeighbors(hx, tileIndex, layers, biome);
  if (t === HEX_TERRAIN.shallow) {
    if (isWetlandSlot && prox.deepNeighbors === 0 && prox.landNeighbors >= 4 && y <= -0.14 && y >= -0.34) {
      return 'littoralWetland';
    }
    return 'submerged';
  }
  const onCoastalSandBand =
    (prox.waterNeighbors >= 1 && (y < HEX_DRY_SAND_MAX_Y || t === HEX_TERRAIN.slope)) ||
    prox.waterNeighbors >= 3 ||
    isHexBeachSandAtPoint(hx, x, z, y, layers, biome, shoreByTile);
  if (onCoastalSandBand) {
    return t === HEX_TERRAIN.forest ? 'coastalForest' : 'coastalSand';
  }
  if (t === HEX_TERRAIN.forest) {
    if ((hasMountainRockNeighbor(hx, tileIndex, layers) && slope >= 0.36) || slope >= 0.48) return 'rockOutcrop';
    return 'forestFloor';
  }
  if (t === HEX_TERRAIN.slope) {
    if (hasMountainRockNeighbor(hx, tileIndex, layers) || slope >= 0.45) return 'rockOutcrop';
    return 'uplandSlope';
  }
  if ((hasMountainRockNeighbor(hx, tileIndex, layers) && slope >= 0.36) || slope >= 0.48) return 'rockOutcrop';
  return 'meadowTurf';
}

function classifyDuneHexSubstrate(params: {
  hx: HexIndex;
  tileIndex: number;
  q: number;
  r: number;
  t: number;
  y: number;
  slope: number;
  layers: HexTileLayers;
  planetSeed: number;
  getEcotone: () => EcotoneSample;
}): TerrainSubstrate {
  const { hx, tileIndex, q, r, t, y, slope, layers, planetSeed, getEcotone } = params;
  const rawTileHeight = layers.height?.[tileIndex] ?? 0;
  const isDuneMountain =
    hasMountainRockNeighbor(hx, tileIndex, layers) ||
    slope >= 0.40 ||
    (t === HEX_TERRAIN.slope && (slope >= 0.36 || rawTileHeight >= 1.15 || y >= 1.25));
  if (isDuneMountain) {
    return 'duneMesaCap';
  }
  if (t === HEX_TERRAIN.shallow) return 'aridDune';
  if (t === HEX_TERRAIN.forest) {
    if (rawTileHeight >= 1.15) return 'duneMesaCap';
    return 'desertWadi';
  }
  if (t === HEX_TERRAIN.slope && isDuneWadiSlope(q, r, rawTileHeight, getEcotone(), planetSeed)) {
    return 'desertWadi';
  }
  return 'aridDune';
}

/**
 * Classifies the exact `(x, z)` terrain site on a hex planet, matching `HEX_SHORE_BEACH_GLSL` via lattice-interpolated
 * `vHexShore` so coastal beach sand and sandy neighbor-edge bleeds classify as `'coastalSand'` (never spawning bushes,
 * wildflowers, grass tufts, or reeds on sand near water hexagons), while emergent reeds fit only inside sheltered
 * shallow-marsh water coves (`'littoralWetland'`).
 */
export function classifyHexSiteAtPoint(params: {
  hx: HexIndex;
  tileIndex: number;
  x: number;
  z: number;
  layers: HexTileLayers;
  biome: PlanetKind;
  planetSeed: number;
  heightAt: (x: number, z: number) => number;
  waterProx?: TileWaterProximity;
  ecotone?: EcotoneSample;
  isWetlandSlot?: boolean;
  substrateOnly?: boolean;
  shoreByTile?: ArrayLike<number>;
}): TerrainSiteSample {
  const { hx, x, z, layers, biome, planetSeed, heightAt, substrateOnly } = params;
  const hit = tileAt(hx.radius, x, z);
  if (!hit) {
    return { biome, substrate: 'submerged', slope: 0, ecotone: substrateOnly ? ZERO_ECOTONE : (params.ecotone ?? floraEcotoneFields(x, z, planetSeed)) };
  }
  const tileIndex = hit.i;
  const sameTile = tileIndex === params.tileIndex;
  const q = hx.q[tileIndex]!;
  const r = hx.r[tileIndex]!;
  const t = layers.terrain?.[tileIndex] ?? HEX_TERRAIN.flat;
  const prep = layers.prep?.[tileIndex] ?? 0;
  const dep = layers.deposit?.[tileIndex] ?? 0;
  let cachedEcotone: EcotoneSample | undefined = sameTile ? params.ecotone : undefined;
  const getEcotone = (): EcotoneSample => (cachedEcotone ??= floraEcotoneFields(x, z, planetSeed));
  const y = heightAt(x, z);
  const d = 0.45;
  const slope =
    Math.hypot(
      Math.max(Math.abs(heightAt(x + d, z) - y), Math.abs(heightAt(x - d, z) - y)),
      Math.max(Math.abs(heightAt(x, z + d) - y), Math.abs(heightAt(x, z - d) - y)),
    ) / d;

  const withSub = (substrate: TerrainSubstrate): TerrainSiteSample => ({
    biome,
    substrate,
    slope,
    ecotone: substrateOnly ? ZERO_ECOTONE : getEcotone(),
  });

  if (t === HEX_TERRAIN.deep) return withSub('submerged');
  if (t === HEX_TERRAIN.hole) return withSub('craterHole');
  if (t === HEX_TERRAIN.rock) return withSub(biome === 'dune' ? 'duneMesaCap' : 'rockOutcrop');
  if (dep === HEX_DEPOSIT.metals || dep === HEX_DEPOSIT.minerals || dep === HEX_DEPOSIT.oil) {
    return withSub('depositPad');
  }
  if (prep === HEX_PREP.living) {
    if (biome !== 'dune' && isHexBeachSandAtPoint(hx, x, z, y, layers, biome, params.shoreByTile)) {
      return withSub('coastalSand');
    }
    return withSub('livingTurf');
  }
  if (
    isClearedPrep(prep) ||
    prep === HEX_PREP.ridge ||
    prep === HEX_PREP.moat ||
    ((layers.owner?.[tileIndex] ?? -1) >= 0 && prep === HEX_PREP.flat)
  ) {
    return withSub('engineeredPad');
  }

  if (biome === 'dune') {
    return withSub(
      classifyDuneHexSubstrate({ hx, tileIndex, q, r, t, y, slope, layers, planetSeed, getEcotone }),
    );
  }

  return withSub(
    classifyNonDuneHexSubstrate({
      hx,
      tileIndex,
      x,
      z,
      y,
      t,
      slope,
      layers,
      biome,
      waterProx: sameTile ? params.waterProx : undefined,
      isWetlandSlot: params.isWetlandSlot,
      shoreByTile: params.shoreByTile,
    }),
  );
}

/** Classifies a continuous `PlanetSurface` world coordinate `(x, z)` using the same substrate taxonomy. */
export function classifySurfaceSite(params: {
  biome: PlanetKind;
  x: number;
  z: number;
  y: number;
  waterLevel: number | null;
  slope: number;
  planetSeed: number;
  forestDensity?: number;
  rockMask?: number;
  isWetlandCandidate?: boolean;
}): TerrainSiteSample {
  const { biome, x, z, y, waterLevel, slope, planetSeed } = params;
  const ecotone = floraEcotoneFields(x, z, planetSeed);
  const withSub = (substrate: TerrainSubstrate): TerrainSiteSample => ({ biome, substrate, slope, ecotone });

  if (biome === 'dune' || waterLevel === null) {
    if ((params.rockMask ?? 0) > 0.34 || slope >= 0.42) return withSub('rockOutcrop');
    const oasis = ecotone.moisture + (y < 0.85 ? 0.22 : 0);
    return withSub(oasis > 0.62 && slope < 0.42 ? 'desertWadi' : 'aridDune');
  }

  const dh = y - waterLevel;
  if (dh <= 0.01) {
    if (params.isWetlandCandidate && dh >= -0.20 && dh <= -0.04 && slope < 0.28 && ecotone.moisture >= 0.56) {
      return withSub('littoralWetland');
    }
    return withSub('submerged');
  }

  // Match `KIND_OCEAN_FOREST` (`1.15 + 0.5 * n1` up to `1.65m`) and `KIND_FOREST_ROCK` (`shoreSand` + moist littoral bank).
  // Note: `terrainShader.ts` `rockMask = smoothstep(0.30, 0.50, 1 - N.y)` is zero below `slope ≈ 1.02` (`45.6°`),
  // so moderate coastal slopes (`0.56..1.02`) still render as beach sand and must classify as `'coastalSand'`.
  const sandBandTop = biome === 'oceanForest' ? 1.65 : 0.45;
  if (dh < sandBandTop) {
    if ((params.rockMask ?? 0) > 0.50 || slope >= 1.15) return withSub('rockOutcrop');
    if ((params.forestDensity ?? 0) > 0.45 && dh >= (biome === 'oceanForest' ? 0.65 : 0.28)) {
      return withSub('coastalForest');
    }
    return withSub('coastalSand');
  }
  if ((params.rockMask ?? 0) > 0.45 || slope >= 0.48) return withSub('rockOutcrop');
  if ((params.forestDensity ?? 0) > 0.45) return withSub('forestFloor');
  if (slope > 0.28) return withSub('uplandSlope');
  return withSub('meadowTurf');
}

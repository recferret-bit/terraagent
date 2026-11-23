import { hexDistance, hexIndex, mixGroundSeed } from '@terra/sim/grid/hex';
import type { Place } from '../../../visuals/terrain/Scatter';
import { GROUND_VARIANT_COUNT } from '../../../visuals/terrain/groundFloraGeos';
import type { PlanetKind, PlanetSpec } from '../../PlanetSpec';
import {
  HEX_DEPOSIT,
  HEX_PREP,
  HEX_TERRAIN,
  isClearedPrep,
  tileHash01,
  tileHashU32,
  tileShoreFactor,
  type HexTileLayers,
} from '../chunkMesh';
import { scatterTileProps } from '../chunkPropScatter';
import { clampToGroundHexagon, tileXZ } from '../hexMath';
import { generateTileForestTrees } from './forestPipeline';
import {
  canFitObjectFootprint,
  canFitObjectOnTerrain,
  classifyHexSiteAtPoint,
  floraEcotoneFields,
  GROUND_FLORA_KINDS,
  GROUND_OBJECT_SPECS,
  inspectTileWaterNeighbors,
  isDuneWadiSlope,
  renderedFloraOuterRadius,
  type EcotoneSample,
  type FloraFootprint,
  type GroundFloraKind,
  type TerrainPropKind,
  type TileWaterProximity,
} from './terrainCompatibility';

export {
  canFitObjectFootprint,
  canFitObjectOnTerrain,
  classifyHexSiteAtPoint,
  floraEcotoneFields,
  GROUND_FLORA_KINDS,
  GROUND_OBJECT_SPECS,
  renderedFloraOuterRadius,
  type EcotoneSample,
  type FloraFootprint,
  type GroundFloraKind,
};

export const FLORA_DOMINANCE_ORDER: readonly GroundFloraKind[] = [
  'duneTree',
  'saguaro',
  'barrelCactus',
  'bush',
  'reeds',
  'wildflower',
  'grassTuft',
] as const;

export const FLORA_FOOTPRINTS: Readonly<Record<GroundFloraKind, FloraFootprint>> = {
  duneTree: GROUND_OBJECT_SPECS.duneTree.footprint,
  saguaro: GROUND_OBJECT_SPECS.saguaro.footprint,
  barrelCactus: GROUND_OBJECT_SPECS.barrelCactus.footprint,
  bush: GROUND_OBJECT_SPECS.bush.footprint,
  reeds: GROUND_OBJECT_SPECS.reeds.footprint,
  wildflower: GROUND_OBJECT_SPECS.wildflower.footprint,
  grassTuft: GROUND_OBJECT_SPECS.grassTuft.footprint,
};

const PROP_KIND_LIST: readonly TerrainPropKind[] = ['pine', 'duneTree', 'boulder', 'spire', 'metals', 'minerals', 'oil'];
export const PROP_EXCLUSION_RADIUS: Readonly<Record<string, number>> = Object.fromEntries(
  PROP_KIND_LIST.map((k) => [k, GROUND_OBJECT_SPECS[k].footprint.radius]),
);

/** Count direct water neighbors (non-dune only) to detect coastal shores and headlands. */
export function countTileWaterNeighbors(
  hx: ReturnType<typeof hexIndex>,
  i: number,
  layers: HexTileLayers,
  kind: PlanetKind,
): { waterNeighbors: number; shallowNeighbor: boolean } {
  const { waterNeighbors, shallowNeighbor } = inspectTileWaterNeighbors(hx, i, layers, kind);
  return { waterNeighbors, shallowNeighbor };
}

interface GridEntry {
  x: number;
  z: number;
  radius: number;
  kind: string | undefined;
}

/** Spatial hash enforcing non-overlapping placement across props and flora layers. */
export class SpatialExclusionGrid {
  private readonly cells = new Map<string, GridEntry[]>();

  constructor(private readonly cellSize = 1.8) {}

  insert(x: number, z: number, radius: number, kind?: string): void {
    const gx = Math.floor(x / this.cellSize);
    const gz = Math.floor(z / this.cellSize);
    const key = `${gx},${gz}`;
    let bucket = this.cells.get(key);
    if (!bucket) {
      bucket = [];
      this.cells.set(key, bucket);
    }
    bucket.push({ x, z, radius, kind });
  }

  canPlace(x: number, z: number, radius: number, kind?: string, minSameKindDist = 0, clearance = 0.14): boolean {
    const searchR = Math.max(radius + 0.72 + clearance, minSameKindDist);
    const span = Math.max(1, Math.ceil(searchR / this.cellSize));
    const gx = Math.floor(x / this.cellSize);
    const gz = Math.floor(z / this.cellSize);
    for (let dz = -span; dz <= span; dz++) {
      for (let dx = -span; dx <= span; dx++) {
        const bucket = this.cells.get(`${gx + dx},${gz + dz}`);
        if (!bucket) continue;
        for (const e of bucket) {
          const sameGap = kind && e.kind === kind ? minSameKindDist : 0;
          const req = Math.max(radius + e.radius + clearance, sameGap);
          const ox = x - e.x;
          const oz = z - e.z;
          if (ox * ox + oz * oz < req * req) return false;
        }
      }
    }
    return true;
  }
}

interface FloraSlotRequest {
  tileIndex: number;
  q: number;
  r: number;
  cx: number;
  cz: number;
  kind: GroundFloraKind;
  salt: number;
  planetSeed: number;
  radMin: number;
  radSpan: number;
  rimMargin: number;
  ecotone: EcotoneSample;
  waterProx?: TileWaterProximity;
  wetlandDir?: readonly [number, number];
  presetPlace?: Place;
}

type PushFloraSlot = (
  kind: GroundFloraKind,
  salt: number,
  radMin: number,
  radSpan: number,
  extra?: { presetPlace?: Place; wetlandDir?: readonly [number, number] },
) => void;

function enqueueDuneFloraRequests(
  q: number,
  r: number,
  tileIdx: number,
  t: number,
  rawHeight: number,
  heightAt: (x: number, z: number) => number,
  planetSeed: number,
  radius: number,
  ecotone: EcotoneSample,
  push: PushFloraSlot,
): void {
  if (t === HEX_TERRAIN.slope && isDuneWadiSlope(q, r, rawHeight, ecotone, planetSeed)) {
    for (const tr of generateTileForestTrees(q, r, tileIdx, 'dune', heightAt, planetSeed, 1, radius)) {
      push('duneTree', 605, 0.14, 0.36, { presetPlace: tr });
    }
  }
  if (t === HEX_TERRAIN.slope || t === HEX_TERRAIN.flat) {
    const saguaroScore = 0.55 * (1 - ecotone.moisture * 0.4) + 0.45 * tileHash01(q, r, mixGroundSeed(planetSeed, 601));
    const barrelScore = 0.45 * ecotone.rockiness + 0.55 * tileHash01(q, r, mixGroundSeed(planetSeed, 623));
    if (saguaroScore > 0.72) push('saguaro', 610, 0.16, 0.48);
    else if (barrelScore > 0.64) push('barrelCactus', 630, 0.18, 0.48);
    if (0.40 * ecotone.moisture + 0.60 * tileHash01(q, r, mixGroundSeed(planetSeed, 641)) > 0.62) push('bush', 650, 0.22, 0.46);
    if (0.40 * ecotone.fertility + 0.60 * tileHash01(q, r, mixGroundSeed(planetSeed, 661)) > 0.52) push('grassTuft', 670, 0.20, 0.50);
  } else if (t === HEX_TERRAIN.forest) {
    if (tileHash01(q, r, mixGroundSeed(planetSeed, 645)) > 0.46) push('bush', 655, 0.28, 0.40);
    push('grassTuft', 675, 0.24, 0.44);
  } else if (t === HEX_TERRAIN.rock && 0.35 * ecotone.rockiness + 0.65 * tileHash01(q, r, mixGroundSeed(planetSeed, 681)) > 0.60) {
    push('barrelCactus', 690, 0.26, 0.42);
  }
}

function enqueueTileFloraRequests(params: {
  hx: ReturnType<typeof hexIndex>;
  tileIdx: number;
  q: number;
  r: number;
  t: number;
  prep: number;
  cx: number;
  cz: number;
  layers: HexTileLayers;
  heightAt: (x: number, z: number) => number;
  biome: PlanetKind;
  planetSeed: number;
  radius: number;
  ecotone: EcotoneSample;
  waterProx: TileWaterProximity;
  shoreByTile?: Float32Array;
  into: Record<GroundFloraKind, FloraSlotRequest[]>;
}): void {
  const { tileIdx, q, r, t, prep, cx, cz, layers, heightAt, biome, planetSeed, radius, ecotone, waterProx, shoreByTile, into } = params;
  const push: PushFloraSlot = (kind, salt, radMin, radSpan, extra) => {
    into[kind].push({
      tileIndex: tileIdx,
      q,
      r,
      cx,
      cz,
      kind,
      salt: mixGroundSeed(planetSeed, salt),
      planetSeed,
      radMin,
      radSpan,
      rimMargin: GROUND_OBJECT_SPECS[kind].footprint.rimMargin,
      ecotone,
      waterProx,
      ...extra,
    });
  };

  if (prep === HEX_PREP.living) {
    if (biome === 'dune') {
      push('grassTuft', 710, 0.30, 0.28);
      return;
    }
    for (let k = 0; k < 2; k++) push('grassTuft', 710 + k * 9, 0.24, 0.34);
    if (tileHash01(q, r, mixGroundSeed(planetSeed, 729)) > 0.45) push('wildflower', 735, 0.22, 0.34);
    return;
  }
  if (isClearedPrep(prep)) return;

  if (biome === 'dune') {
    enqueueDuneFloraRequests(q, r, tileIdx, t, layers.height[tileIdx] ?? 0, heightAt, planetSeed, radius, ecotone, push);
    return;
  }

  // Emergent reeds root exclusively inside sheltered shallow-marsh water coves (never on coastal beach sand hexes).
  if (t === HEX_TERRAIN.shallow) {
    if (
      waterProx.deepNeighbors === 0 &&
      waterProx.landNeighbors >= 4 &&
      ecotone.moisture >= (GROUND_OBJECT_SPECS.reeds.minMoisture ?? 0.56)
    ) {
      push('reeds', 750, 0.04, 0.14, { wetlandDir: [1, 0] });
    }
    return;
  }

  // Tile-level early skip when the tile center already sits in the coastal beach sand / coastal forest zone.
  const centerSite = classifyHexSiteAtPoint({
    hx: params.hx, tileIndex: tileIdx, x: cx, z: cz, layers, biome, planetSeed, heightAt, waterProx, ecotone, shoreByTile,
  });
  if (centerSite.substrate === 'coastalSand' || centerSite.substrate === 'coastalForest') return;

  if (t === HEX_TERRAIN.flat) {
    const hexVariant = tileHash01(q, r, mixGroundSeed(planetSeed, 811)) * 0.65 + ecotone.fertility * 0.35;
    if (hexVariant > 0.24) {
      const tufts = hexVariant > 0.70 ? 3 : 2;
      for (let k = 0; k < tufts; k++) push('grassTuft', 820 + k * 11, 0.18, 0.54);
    }
    if (0.40 * ecotone.moisture + 0.60 * hexVariant > 0.56) push('wildflower', 860, 0.20, 0.48);
    if (0.40 * ecotone.fertility + 0.60 * tileHash01(q, r, mixGroundSeed(planetSeed, 877)) > 0.72) push('bush', 885, 0.22, 0.36);
  } else if (t === HEX_TERRAIN.forest) {
    const uRoll = tileHash01(q, r, mixGroundSeed(planetSeed, 901));
    if (uRoll > 0.34) push('bush', 910, 0.20, 0.36);
    if (uRoll > 0.50) push('wildflower', 925, 0.24, 0.44);
    push('grassTuft', 940, 0.20, 0.50);
  } else if (t === HEX_TERRAIN.slope && tileHash01(q, r, mixGroundSeed(planetSeed, 953)) > 0.52) {
    push('grassTuft', 960, 0.22, 0.46);
    if (tileHash01(q, r, mixGroundSeed(planetSeed, 971)) > 0.66) push('bush', 980, 0.26, 0.40);
  }
}

const GOLDEN_ANGLE = 2.399963229728653;

function tryPlaceFloraSlot(
  req: FloraSlotRequest,
  grid: SpatialExclusionGrid,
  hx: ReturnType<typeof hexIndex>,
  layers: HexTileLayers,
  biome: PlanetKind,
  radius: number,
  heightAt: (x: number, z: number) => number,
  shoreByTile?: Float32Array,
): Place | null {
  const fp = FLORA_FOOTPRINTS[req.kind];
  const baseAng = tileHash01(req.q, req.r, req.salt) * Math.PI * 2;
  const baseDist = req.radMin + tileHash01(req.q, req.r, req.salt + 1) * req.radSpan;
  const instS = req.presetPlace ? req.presetPlace.s : tileHash01(req.q, req.r, req.salt + 3);
  const outerRadius = renderedFloraOuterRadius(req.kind, instS);

  for (let attempt = 0; attempt < 10; attempt++) {
    let x: number;
    let z: number;
    if (attempt === 0 && req.presetPlace) {
      x = req.presetPlace.x;
      z = req.presetPlace.z;
    } else if (req.wetlandDir) {
      const ang = baseAng + attempt * GOLDEN_ANGLE;
      const dist = Math.min(0.22, baseDist + (attempt % 3) * 0.03);
      const rawX = req.cx + Math.cos(ang) * dist;
      const rawZ = req.cz + Math.sin(ang) * dist;
      [x, z] = clampToGroundHexagon(radius, rawX, rawZ, req.rimMargin);
    } else {
      const ang = baseAng + attempt * GOLDEN_ANGLE;
      const radialT =
        attempt === 0
          ? baseDist
          : attempt >= 6
            ? 0.62 + (attempt - 6) * 0.05
            : Math.min(0.74, Math.max(0.14, baseDist + ((attempt % 3) - 1) * 0.14));
      const [ax, az] = clampToGroundHexagon(radius, req.cx, req.cz, req.rimMargin + req.radMin + req.radSpan * 0.5);
      const rawX = ax + Math.cos(ang) * radialT;
      const rawZ = az + Math.sin(ang) * radialT;
      [x, z] = clampToGroundHexagon(radius, rawX, rawZ, req.rimMargin);
    }

    const fits = canFitObjectFootprint(
      req.kind,
      x,
      z,
      (px, pz, substrateOnly) =>
        classifyHexSiteAtPoint({
          hx,
          tileIndex: req.tileIndex,
          x: px,
          z: pz,
          layers,
          biome,
          planetSeed: req.planetSeed,
          heightAt,
          waterProx: req.waterProx,
          ecotone: req.ecotone,
          isWetlandSlot: Boolean(req.wetlandDir),
          substrateOnly,
          shoreByTile,
        }),
      outerRadius,
    );
    if (!fits) continue;
    if (!grid.canPlace(x, z, fp.radius, req.kind, fp.sameKindDist, 0.14)) continue;

    grid.insert(x, z, fp.radius, req.kind);
    if (req.presetPlace) {
      return { ...req.presetPlace, x, y: heightAt(x, z), z };
    }
    return {
      x,
      y: heightAt(x, z),
      z,
      rot: tileHash01(req.q, req.r, req.salt + 2) * Math.PI * 2,
      s: instS,
      r: tileHash01(req.q, req.r, req.salt + 4),
      breedIndex: tileHashU32(req.q, req.r, req.salt + 5) % GROUND_VARIANT_COUNT,
    };
  }
  return null;
}

function emptyFloraByKind(): Record<GroundFloraKind, Place[]> {
  return { grassTuft: [], wildflower: [], bush: [], saguaro: [], barrelCactus: [], reeds: [], duneTree: [] };
}

/**
 * Evaluate ground flora across `evalTiles` with a shared `SpatialExclusionGrid` seeded from
 * boulders, spires, trees, and deposits, verifying object-to-substrate fit at every candidate point.
 */
export function placeFloraByCellsWithExclusion(
  evalTiles: readonly number[],
  emitCells: ReadonlySet<string> | null,
  tileCell: readonly string[],
  hx: ReturnType<typeof hexIndex>,
  radius: number,
  layers: HexTileLayers,
  heightAt: (x: number, z: number) => number,
  look: PlanetSpec,
): Map<string, Record<GroundFloraKind, Place[]>> {
  const outByCell = new Map<string, Record<GroundFloraKind, Place[]>>();
  if (!layers.terrain) return outByCell;

  const planetSeed = layers.seed ?? look.seed;
  const effectiveLayers = layers.kind === look.kind ? layers : { ...layers, kind: look.kind };
  let shoreByTile: Float32Array | undefined;
  if (look.kind !== 'dune') {
    shoreByTile = new Float32Array(hx.count);
    for (let i = 0; i < hx.count; i++) shoreByTile[i] = tileShoreFactor(hx, i, effectiveLayers);
  }
  const grid = new SpatialExclusionGrid(1.8);
  const requests: Record<GroundFloraKind, FloraSlotRequest[]> = {
    grassTuft: [], wildflower: [], bush: [], saguaro: [], barrelCactus: [], reeds: [], duneTree: [],
  };

  for (const i of evalTiles) {
    if (hexDistance(0, 0, hx.q[i]!, hx.r[i]!) > radius) continue;
    const q = hx.q[i]!;
    const r = hx.r[i]!;
    const t = layers.terrain[i] ?? 0;
    const prep = layers.prep?.[i] ?? 0;
    const dep = layers.deposit?.[i] ?? 0;
    const waterProx = inspectTileWaterNeighbors(hx, i, layers, look.kind);
    const props = scatterTileProps(
      q, r, i, t, prep, dep, heightAt, look.kind,
      layers.richness ? layers.richness[i] : undefined, layers.depositTier?.[i] ?? 0, radius, planetSeed,
    );
    for (const p of props) {
      grid.insert(p.x, p.z, PROP_EXCLUSION_RADIUS[p.kind] ?? 0.52, p.kind);
    }

    if (dep === HEX_DEPOSIT.metals || dep === HEX_DEPOSIT.minerals || dep === HEX_DEPOSIT.oil) continue;
    if (prep === HEX_PREP.ridge || prep === HEX_PREP.moat) continue;
    if ((layers.owner?.[i] ?? -1) >= 0 && (prep === HEX_PREP.prepared || prep === HEX_PREP.irrigated || prep === HEX_PREP.flat)) {
      continue;
    }
    if (t === HEX_TERRAIN.deep || t === HEX_TERRAIN.hole || (look.kind === 'dune' && t === HEX_TERRAIN.shallow)) continue;

    const [cx, cz] = tileXZ(q, r);
    const ecotone = floraEcotoneFields(cx, cz, planetSeed);
    enqueueTileFloraRequests({
      hx, tileIdx: i, q, r, t, prep, cx, cz, layers, heightAt,
      biome: look.kind, planetSeed, radius, ecotone, waterProx, shoreByTile, into: requests,
    });
  }

  for (const kind of FLORA_DOMINANCE_ORDER) {
    for (const req of requests[kind]) {
      const place = tryPlaceFloraSlot(req, grid, hx, layers, look.kind, radius, heightAt, shoreByTile);
      if (!place) continue;
      const cell = tileCell[req.tileIndex]!;
      if (emitCells && !emitCells.has(cell)) continue;
      let cellBucket = outByCell.get(cell);
      if (!cellBucket) {
        cellBucket = emptyFloraByKind();
        outByCell.set(cell, cellBucket);
      }
      cellBucket[kind].push(place);
    }
  }
  return outByCell;
}

/** Filter continuous `PlanetSurface` candidates through a shared `SpatialExclusionGrid` in dominance order. */
export function filterSurfacePlacesWithExclusion<T extends Place>(
  grid: SpatialExclusionGrid,
  candidates: readonly T[],
  radius: number,
  sameKindDist: number,
  kind: string,
  clearance = 0.14,
): T[] {
  const accepted: T[] = [];
  for (const p of candidates) {
    if (!grid.canPlace(p.x, p.z, radius, kind, sameKindDist, clearance)) continue;
    grid.insert(p.x, p.z, radius, kind);
    accepted.push(p);
  }
  return accepted;
}

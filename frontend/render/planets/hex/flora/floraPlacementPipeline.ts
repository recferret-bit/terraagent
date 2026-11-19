import { HEX_DIRS, hexDistance, hexIndex } from '@terra/sim/grid/hex';
import type { Place } from '../../../visuals/terrain/Scatter';
import type { PlanetKind, PlanetSpec } from '../../PlanetSpec';
import {
  HEX_DEPOSIT,
  HEX_PREP,
  HEX_TERRAIN,
  isClearedPrep,
  tileHash01,
  tileHashU32,
  type HexTileLayers,
} from '../chunkMesh';
import { scatterTileProps } from '../chunkPropScatter';
import { clampToGroundHexagon, HEX_PROP_EDGE_MARGIN_M, tileXZ } from '../hexMath';
import { generateTileForestTrees } from './forestPipeline';

export type GroundFloraKind = 'grassTuft' | 'wildflower' | 'bush' | 'saguaro' | 'barrelCactus' | 'reeds' | 'duneTree';

export const GROUND_FLORA_KINDS: readonly GroundFloraKind[] = [
  'grassTuft',
  'wildflower',
  'bush',
  'saguaro',
  'barrelCactus',
  'reeds',
  'duneTree',
] as const;

export const FLORA_DOMINANCE_ORDER: readonly GroundFloraKind[] = [
  'duneTree',
  'saguaro',
  'barrelCactus',
  'bush',
  'reeds',
  'wildflower',
  'grassTuft',
] as const;

export interface FloraFootprint {
  readonly radius: number;
  readonly sameKindDist: number;
}

export const FLORA_FOOTPRINTS: Record<GroundFloraKind, FloraFootprint> = {
  duneTree: { radius: 0.56, sameKindDist: 1.55 },
  saguaro: { radius: 0.52, sameKindDist: 1.75 },
  barrelCactus: { radius: 0.46, sameKindDist: 1.15 },
  bush: { radius: 0.48, sameKindDist: 1.05 },
  reeds: { radius: 0.34, sameKindDist: 0.60 },
  wildflower: { radius: 0.28, sameKindDist: 0.50 },
  grassTuft: { radius: 0.26, sameKindDist: 0.46 },
};

export const PROP_EXCLUSION_RADIUS: Record<string, number> = {
  pine: 0.58,
  duneTree: 0.58,
  boulder: 0.52,
  spire: 0.52,
  metals: 0.55,
  minerals: 0.55,
  oil: 0.55,
};

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

function hash2D(ix: number, iz: number, seed: number): number {
  const n = Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + Math.imul(seed, 1442695041);
  const m = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((m ^ (m >>> 16)) >>> 0) / 4294967295;
}

function smoothValueNoise2D(x: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const a = hash2D(ix, iz, seed);
  const b = hash2D(ix + 1, iz, seed);
  const c = hash2D(ix, iz + 1, seed);
  const d = hash2D(ix + 1, iz + 1, seed);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}

function fbm2(x: number, z: number, seed: number): number {
  return 0.65 * smoothValueNoise2D(x, z, seed) + 0.35 * smoothValueNoise2D(x * 2.07 + 13.7, z * 2.07 - 9.1, seed ^ 0x9e37);
}

export interface EcotoneSample {
  moisture: number;
  rockiness: number;
  fertility: number;
}

/** Smooth 2D FBM ecotone fields driving natural plant patch grouping. */
export function floraEcotoneFields(x: number, z: number, seed: number): EcotoneSample {
  return {
    moisture: fbm2(x * 0.085, z * 0.085, seed + 17),
    rockiness: fbm2(x * 0.095, z * 0.095, seed + 53),
    fertility: fbm2(x * 0.075, z * 0.075, seed + 89),
  };
}

/** Count direct water neighbors (non-dune only) to detect coastal corner headlands. */
export function countTileWaterNeighbors(
  hx: ReturnType<typeof hexIndex>,
  i: number,
  layers: HexTileLayers,
  kind: PlanetKind,
): { waterNeighbors: number; shallowNeighbor: boolean } {
  if (kind === 'dune' || !layers.terrain) return { waterNeighbors: 0, shallowNeighbor: false };
  const q = hx.q[i]!;
  const r = hx.r[i]!;
  let waterNeighbors = 0;
  let shallowNeighbor = false;
  for (const [dq, dr] of HEX_DIRS) {
    const j = hx.indexOf(q + dq, r + dr);
    if (j < 0 || isClearedPrep(layers.prep?.[j] ?? 0)) continue;
    const t = layers.terrain[j] ?? 0;
    if (t === HEX_TERRAIN.shallow || t === HEX_TERRAIN.deep) {
      waterNeighbors++;
      if (t === HEX_TERRAIN.shallow) shallowNeighbor = true;
    }
  }
  return { waterNeighbors, shallowNeighbor };
}

interface FloraSlotRequest {
  tileIndex: number;
  q: number;
  r: number;
  cx: number;
  cz: number;
  kind: GroundFloraKind;
  salt: number;
  radMin: number;
  radSpan: number;
  rimMargin: number;
  presetPlace?: Place;
}

const DUNE_TREE_RIM_MARGIN_M = Math.max(HEX_PROP_EDGE_MARGIN_M, 1.48);

function pushDuneTileRequests(
  q: number,
  r: number,
  tileIdx: number,
  t: number,
  rawH: number,
  cx: number,
  cz: number,
  heightAt: (x: number, z: number) => number,
  look: PlanetSpec,
  radius: number,
  ecotone: EcotoneSample,
  into: Record<GroundFloraKind, FloraSlotRequest[]>,
): void {
  const pushReq = (kind: GroundFloraKind, salt: number, radMin: number, radSpan: number, presetPlace?: Place) =>
    into[kind].push({
      tileIndex: tileIdx,
      q,
      r,
      cx,
      cz,
      kind,
      salt,
      radMin,
      radSpan,
      rimMargin: kind === 'duneTree' ? DUNE_TREE_RIM_MARGIN_M : HEX_PROP_EDGE_MARGIN_M,
      presetPlace,
    });

  const seed = look.seed;
  const bioPatch = tileHash01(q, r, seed + 771) * 0.55 + ecotone.moisture * 0.45;
  const wadiMoisture = rawH < 0.62 ? 0.14 : 0;
  if (t === HEX_TERRAIN.slope && bioPatch + wadiMoisture > 0.80) {
    for (const tr of generateTileForestTrees(q, r, tileIdx, 'dune', heightAt, seed, 1, radius)) {
      pushReq('duneTree', 605, 0.14, 0.36, tr);
    }
  }
  if (t === HEX_TERRAIN.slope || t === HEX_TERRAIN.flat) {
    const saguaroScore = 0.55 * (1 - ecotone.moisture * 0.4) + 0.45 * tileHash01(q, r, seed + 601);
    const barrelScore = 0.45 * ecotone.rockiness + 0.55 * tileHash01(q, r, seed + 623);
    if (saguaroScore > 0.72) pushReq('saguaro', 610, 0.16, 0.48);
    else if (barrelScore > 0.64) pushReq('barrelCactus', 630, 0.18, 0.48);
    if (0.40 * ecotone.moisture + 0.60 * tileHash01(q, r, seed + 641) > 0.62) pushReq('bush', 650, 0.22, 0.46);
    if (0.40 * ecotone.fertility + 0.60 * tileHash01(q, r, seed + 661) > 0.52) pushReq('grassTuft', 670, 0.20, 0.50);
  } else if (t === HEX_TERRAIN.forest) {
    if (tileHash01(q, r, seed + 645) > 0.46) pushReq('bush', 655, 0.28, 0.40);
    pushReq('grassTuft', 675, 0.24, 0.44);
  } else if (t === HEX_TERRAIN.rock && 0.35 * ecotone.rockiness + 0.65 * tileHash01(q, r, seed + 681) > 0.60) {
    pushReq('barrelCactus', 690, 0.26, 0.42);
  }
}

function pushLushTileRequests(
  hx: ReturnType<typeof hexIndex>,
  q: number,
  r: number,
  tileIdx: number,
  t: number,
  prep: number,
  cx: number,
  cz: number,
  layers: HexTileLayers,
  look: PlanetSpec,
  ecotone: EcotoneSample,
  into: Record<GroundFloraKind, FloraSlotRequest[]>,
): void {
  const pushReq = (kind: GroundFloraKind, salt: number, radMin: number, radSpan: number) =>
    into[kind].push({
      tileIndex: tileIdx,
      q,
      r,
      cx,
      cz,
      kind,
      salt,
      radMin,
      radSpan,
      rimMargin: HEX_PROP_EDGE_MARGIN_M,
    });
  const seed = look.seed;
  if (prep === HEX_PREP.living) {
    for (let k = 0; k < 2; k++) pushReq('grassTuft', 710 + k * 9, 0.55, 0.22);
    if (tileHash01(q, r, seed + 729) > 0.45) pushReq('wildflower', 735, 0.52, 0.24);
    return;
  }
  if (isClearedPrep(prep)) return;

  const { waterNeighbors, shallowNeighbor } = countTileWaterNeighbors(hx, tileIdx, layers, look.kind);
  if (shallowNeighbor && (t === HEX_TERRAIN.flat || t === HEX_TERRAIN.forest || t === HEX_TERRAIN.slope)) {
    const nReeds = 1 + (tileHashU32(q, r, 741) % 2);
    for (let k = 0; k < nReeds; k++) pushReq('reeds', 750 + k * 9, 0.34, 0.40);
  }
  // Pointy coastal corners bordering >= 3 water hexes stay bare beach sand without grass tufts or bushes.
  if (waterNeighbors >= 3) return;

  if (t === HEX_TERRAIN.flat) {
    const hexVariant = tileHash01(q, r, seed + 811) * 0.65 + ecotone.fertility * 0.35;
    if (hexVariant > 0.24) {
      const tufts = hexVariant > 0.70 ? 3 : 2;
      for (let k = 0; k < tufts; k++) pushReq('grassTuft', 820 + k * 11, 0.18, 0.54);
    }
    if (0.40 * ecotone.moisture + 0.60 * hexVariant > 0.56) pushReq('wildflower', 860, 0.20, 0.48);
    if (0.40 * ecotone.fertility + 0.60 * tileHash01(q, r, seed + 877) > 0.72) pushReq('bush', 885, 0.30, 0.38);
  } else if (t === HEX_TERRAIN.forest) {
    const uRoll = tileHash01(q, r, seed + 901);
    if (uRoll > 0.34) pushReq('bush', 910, 0.26, 0.42);
    if (uRoll > 0.50) pushReq('wildflower', 925, 0.24, 0.44);
    pushReq('grassTuft', 940, 0.20, 0.50);
  } else if (t === HEX_TERRAIN.slope && tileHash01(q, r, seed + 953) > 0.52) {
    pushReq('grassTuft', 960, 0.22, 0.46);
    if (tileHash01(q, r, seed + 971) > 0.66) pushReq('bush', 980, 0.26, 0.40);
  }
}

const GOLDEN_ANGLE = 2.399963229728653;

function tryPlaceFloraSlot(
  req: FloraSlotRequest,
  grid: SpatialExclusionGrid,
  radius: number,
  heightAt: (x: number, z: number) => number,
): Place | null {
  const fp = FLORA_FOOTPRINTS[req.kind];
  const baseAng = tileHash01(req.q, req.r, req.salt) * Math.PI * 2;
  const baseDist = req.radMin + tileHash01(req.q, req.r, req.salt + 1) * req.radSpan;

  for (let attempt = 0; attempt < 7; attempt++) {
    let x: number;
    let z: number;
    if (attempt === 0 && req.presetPlace) {
      x = req.presetPlace.x;
      z = req.presetPlace.z;
    } else {
      const ang = baseAng + attempt * GOLDEN_ANGLE;
      const radialT = attempt === 0 ? baseDist : Math.min(0.74, Math.max(0.14, baseDist + ((attempt % 3) - 1) * 0.14));
      const [ax, az] = clampToGroundHexagon(radius, req.cx, req.cz, req.rimMargin + req.radMin + req.radSpan * 0.5);
      const rawX = ax + Math.cos(ang) * radialT;
      const rawZ = az + Math.sin(ang) * radialT;
      [x, z] = clampToGroundHexagon(radius, rawX, rawZ, req.rimMargin);
    }
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
      s: tileHash01(req.q, req.r, req.salt + 3),
      r: tileHash01(req.q, req.r, req.salt + 4),
    };
  }
  return null;
}

function emptyFloraByKind(): Record<GroundFloraKind, Place[]> {
  return { grassTuft: [], wildflower: [], bush: [], saguaro: [], barrelCactus: [], reeds: [], duneTree: [] };
}

/**
 * Evaluate ground flora across `evalTiles` with a shared `SpatialExclusionGrid` seeded from
 * boulders, spires, trees, and deposits, returning non-overlapping instances per cell for `emitCells`.
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
    const props = scatterTileProps(
      q, r, i, t, prep, dep, heightAt, look.kind,
      layers.richness ? layers.richness[i] : undefined, layers.depositTier?.[i] ?? 0, radius, look.seed,
    );
    for (const p of props) {
      grid.insert(p.x, p.z, PROP_EXCLUSION_RADIUS[p.kind] ?? 0.52, p.kind);
    }

    if (dep === HEX_DEPOSIT.metals || dep === HEX_DEPOSIT.minerals || dep === HEX_DEPOSIT.oil) continue;
    if (prep === HEX_PREP.ridge || prep === HEX_PREP.moat) continue;
    if ((layers.owner?.[i] ?? -1) >= 0 && (prep === HEX_PREP.prepared || prep === HEX_PREP.irrigated || prep === HEX_PREP.flat)) {
      continue;
    }
    if (t === HEX_TERRAIN.shallow || t === HEX_TERRAIN.deep || t === HEX_TERRAIN.hole) continue;

    const [cx, cz] = tileXZ(q, r);
    if (look.kind === 'dune') {
      if (!isClearedPrep(prep)) {
        const eco = floraEcotoneFields(cx, cz, look.seed);
        pushDuneTileRequests(q, r, i, t, layers.height[i] ?? 0, cx, cz, heightAt, look, radius, eco, requests);
      } else if (prep === HEX_PREP.living) {
        requests.grassTuft.push({
          tileIndex: i, q, r, cx, cz, kind: 'grassTuft', salt: 710, radMin: 0.45, radSpan: 0.20, rimMargin: HEX_PROP_EDGE_MARGIN_M,
        });
      }
    } else {
      const eco = floraEcotoneFields(cx, cz, look.seed);
      pushLushTileRequests(hx, q, r, i, t, prep, cx, cz, layers, look, eco, requests);
    }
  }

  for (const kind of FLORA_DOMINANCE_ORDER) {
    for (const req of requests[kind]) {
      const place = tryPlaceFloraSlot(req, grid, radius, heightAt);
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

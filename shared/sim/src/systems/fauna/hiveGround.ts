import { isPreparedGround } from '../../grid/geo';
import { HEX_DIRS, hexDistance, hexIndex, inHex, levelledFlatHeight } from '../../grid/hex';
import {
  HEX_LEVEL_EPS_M,
  hexTileMask,
  isHexTile,
  isOpenGround,
  joinPlaneHeight,
  type HexTileLayers,
} from '../../grid/hexTile';
import { DEPOSIT, PREP, TERRAIN } from '../../grid/layers';
import { setTileDeposit, setTileHeight, setTilePrep, setTileTerrain } from '../../grid/tileModel';
import type { CompiledDataLike } from '../../kernel/config';
import type { PlanetState } from '../../kernel/state';
import { getWreckTileSet } from '../combat/wrecks';
import { occupiedGroundTiles } from '../construction/occupancy';
import { entityFootprint, getBuildingFootprintTiles, OCCUPYING_BUILDING_KINDS } from '../construction/placement';

/**
 * Minimum axial hex radius terraformed around an insect hive (`landingRadius = 4` in `data/worldgen.ts`).
 * Combined with the round planar disc (`HIVE_PLANAR_RADIUS_*`, matching `landing.ts`), every tile of the 3×3 hive
 * footprint (`dq, dr ∈ [-1, 1]`), its entire 5×5 surrounding perimeter (`dq, dr ∈ [-2, 2]`), and `hexDistance <= 3`
 * is terraformed (`TERRAIN.flat`, `PREP.prepared`) and has a closed hexagon (`isHexTile === true`).
 */
export const HIVE_TERRAFORM_RADIUS = 4;

/** Inner axial radius (`hexDistance <= 3`) around a hive guaranteed to have closed hexagons (`isHexTile`). */
export const HIVE_HEX_RADIUS = 3;

/** Round planar disc radii (in tile spacings, matching `landing.ts` / `data/worldgen.ts`). */
export const HIVE_PLANAR_RADIUS_DESERT = 5.2;
export const HIVE_PLANAR_RADIUS_DEFAULT = 4.5;

const HIVE_FALLOFF_TILES = 2.8;
const HIVE_PLANE_SEARCH_RINGS = 6;

function smoothstep01(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function isWaterTerrain(t: number): boolean {
  return t === TERRAIN.shallow || t === TERRAIN.deep;
}

/** Exact planar Euclidean distance in tile spacings (`axialToPlane` norm `sqrt(dq^2 + dq*dr + dr^2)`). */
export function hivePlanarDist(dq: number, dr: number): number {
  return Math.sqrt(dq * dq + dq * dr + dr * dr);
}

export function isWithinHivePadOffset(dq: number, dr: number, planarRadius: number, hexRadius = HIVE_TERRAFORM_RADIUS): boolean {
  return hivePlanarDist(dq, dr) <= planarRadius || hexDistance(0, 0, dq, dr) <= hexRadius;
}

function collectHivePadIndices(radius: number, cq: number, cr: number, planarRadius: number, hexRadius: number): number[] {
  const hx = hexIndex(radius);
  const bound = Math.max(hexRadius, Math.ceil((planarRadius * 2) / Math.sqrt(3)) + 1);
  const out: number[] = [];
  for (let dr = -bound; dr <= bound; dr++) {
    for (let dq = -bound; dq <= bound; dq++) {
      if (!isWithinHivePadOffset(dq, dr, planarRadius, hexRadius)) continue;
      const idx = hx.indexOf(cq + dq, cr + dr);
      if (idx >= 0) out.push(idx);
    }
  }
  return out;
}

function collectRingIndices(radius: number, cq: number, cr: number, ring: number): number[] {
  const hx = hexIndex(radius);
  const out: number[] = [];
  for (let dr = -ring; dr <= ring; dr++) {
    for (let dq = -ring; dq <= ring; dq++) {
      if (hexDistance(0, 0, dq, dr) !== ring) continue;
      const idx = hx.indexOf(cq + dq, cr + dr);
      if (idx >= 0) out.push(idx);
    }
  }
  return out;
}

function collectFixedPadAnchors(
  hx: ReturnType<typeof hexIndex>,
  cq: number,
  cr: number,
  ringHalf: number,
  padIndices: readonly number[],
  layers: HexTileLayers & { owner?: ArrayLike<number> },
  occupied: ReadonlySet<number>,
): { core: number[]; outer: number[] } {
  const { terrain, prep, height, owner } = layers;
  const core: number[] = [];
  const outer: number[] = [];
  const seen = new Set<number>();
  const addIdx = (i: number, inCore: boolean) => {
    if (i < 0 || seen.has(i)) return;
    const isFixed = occupied.has(i) || (owner ? (owner[i] ?? -1) >= 0 : false);
    if (!isFixed || !isOpenGround(terrain[i] ?? -1, prep?.[i] ?? 0)) return;
    seen.add(i);
    (inCore ? core : outer).push(height[i] ?? 0);
  };
  for (let dr = -ringHalf; dr <= ringHalf; dr++) {
    for (let dq = -ringHalf; dq <= ringHalf; dq++) {
      addIdx(hx.indexOf(cq + dq, cr + dr), true);
      for (const [ndq, ndr] of HEX_DIRS) addIdx(hx.indexOf(cq + dq + ndq, cr + dr + ndr), true);
    }
  }
  for (const i of padIndices) {
    addIdx(i, false);
    const tq = hx.q[i]!, tr = hx.r[i]!;
    for (const [ndq, ndr] of HEX_DIRS) addIdx(hx.indexOf(tq + ndq, tr + ndr), false);
  }
  return { core, outer };
}

function resolveHivePadHeight(
  radius: number,
  cq: number,
  cr: number,
  ringHalf: number,
  padIndices: readonly number[],
  maxSearchRing: number,
  layers: HexTileLayers & { owner?: ArrayLike<number> },
  occupied: ReadonlySet<number>,
): number {
  const { terrain, height } = layers;
  const hx = hexIndex(radius);
  const fixed = collectFixedPadAnchors(hx, cq, cr, ringHalf, padIndices, layers, occupied);
  if (fixed.core.length > 0) {
    const coreJoined = joinPlaneHeight(fixed.core);
    if (coreJoined !== null) return Math.fround(coreJoined);
  }
  if (fixed.outer.length > 0) {
    const outerJoined = joinPlaneHeight(fixed.outer);
    if (outerJoined !== null) return Math.fround(outerJoined);
  }
  for (let ring = 1; ring <= maxSearchRing; ring++) {
    const hexAnchors = collectRingIndices(radius, cq, cr, ring)
      .filter((i) => isHexTile(radius, i, layers))
      .map((i) => height[i] ?? 0);
    if (hexAnchors.length > 0) {
      const joined = joinPlaneHeight(hexAnchors);
      if (joined !== null) return Math.fround(joined);
    }
  }

  const naturalHeights = padIndices
    .filter((i) => !isWaterTerrain(terrain[i] ?? 0))
    .map((i) => height[i] ?? 0)
    .sort((a, b) => a - b);
  if (naturalHeights.length === 0) return 0;
  const pick = naturalHeights[Math.min(naturalHeights.length - 1, Math.floor(naturalHeights.length * 0.25))]!;
  const maxNatural = naturalHeights[naturalHeights.length - 1]!;
  return Math.fround(maxNatural > 0.1 ? Math.max(0.15, pick) : pick);
}

function buryDisruptedEdgeDeposits(
  state: PlanetState,
  cq: number,
  cr: number,
  bound: number,
  occupied: ReadonlySet<number>,
  stamp: number | undefined,
  changedSet: Set<number>,
): void {
  const radius = state.grid.radius;
  const hx = hexIndex(radius);
  const L = state.grid.layers;
  const deposit = L.deposit as Uint8Array | undefined;
  if (!deposit) return;
  const owner = L.owner as Int16Array | Int8Array | undefined;
  const richness = L.richness as Float32Array | undefined;
  const subDeposit = L.subDeposit as Uint8Array | undefined;
  const subRichness = L.subRichness as Float32Array | undefined;
  const hexLayers: HexTileLayers = { terrain: L.terrain, prep: L.prep, height: L.height };

  for (let dr = -bound; dr <= bound; dr++) {
    for (let dq = -bound; dq <= bound; dq++) {
      if (hexDistance(0, 0, dq, dr) > bound) continue;
      const i = hx.indexOf(cq + dq, cr + dr);
      if (i < 0 || deposit[i] === DEPOSIT.none || occupied.has(i)) continue;
      if (owner && (owner[i] ?? -1) >= 0) continue;
      if (isHexTile(radius, i, hexLayers)) continue;
      if (subDeposit && subRichness && subDeposit[i] === DEPOSIT.none) {
        subDeposit[i] = deposit[i]!;
        subRichness[i] = Math.round(richness?.[i] ?? 10000);
      }
      setTileDeposit(state.grid, i, DEPOSIT.none, 0, stamp);
      changedSet.add(i);
    }
  }
}

function buildOwnedDepositMismatchGuard(
  hx: ReturnType<typeof hexIndex>,
  q: number,
  r: number,
  ringHalf: number,
  levelLh: number,
  owner: ArrayLike<number> | undefined,
  deposit: ArrayLike<number> | undefined,
  height: ArrayLike<number>,
): (ti: number) => boolean {
  if (!owner || !deposit) return () => false;
  const coreClosureSet = new Set<number>();
  for (let dr = -ringHalf; dr <= ringHalf; dr++) {
    for (let dq = -ringHalf; dq <= ringHalf; dq++) {
      const ci = hx.indexOf(q + dq, r + dr);
      if (ci >= 0) coreClosureSet.add(ci);
      for (const [ndq, ndr] of HEX_DIRS) {
        const ni = hx.indexOf(q + dq + ndq, r + dr + ndr);
        if (ni >= 0) coreClosureSet.add(ni);
      }
    }
  }
  return (ti: number): boolean => {
    if (coreClosureSet.has(ti)) return false;
    const tq = hx.q[ti]!, tr = hx.r[ti]!;
    for (const [ndq, ndr] of HEX_DIRS) {
      const ni = hx.indexOf(tq + ndq, tr + ndr);
      if (ni < 0 || (owner[ni] ?? -1) < 0 || (deposit[ni] ?? DEPOSIT.none) === DEPOSIT.none) continue;
      if (Math.abs(levelledFlatHeight(height[ni] ?? 0) - levelLh) > HEX_LEVEL_EPS_M) return true;
    }
    return false;
  };
}

/**
 * Terraforms and levels the ground below and around a placed hive (`(q, r)`) following the same round-disc foundation
 * & hex-tile rules as player ground spawning (`landing.ts` / `data/worldgen.ts`). Returns changed tile indices.
 */
export function terraformHiveGround(
  state: PlanetState,
  q: number,
  r: number,
  tick?: number,
  data?: CompiledDataLike,
  footprint = 3,
): number[] {
  const radius = state.grid.radius;
  const hx = hexIndex(radius);
  if (hx.indexOf(q, r) < 0) return [];

  const stamp = tick !== undefined && tick > 0 ? tick : undefined;
  const ringHalf = Math.floor(Math.max(1, footprint) / 2) + 1;
  const hexPadRadius = Math.max(HIVE_TERRAFORM_RADIUS, ringHalf + 2);
  const basePlanar = state.meta.planetType === 'desert' ? HIVE_PLANAR_RADIUS_DESERT : HIVE_PLANAR_RADIUS_DEFAULT;
  const planarRadius = Math.max(basePlanar, hexPadRadius + 0.5);
  const L = state.grid.layers;
  const terrain = L.terrain as Uint8Array;
  const prep = L.prep as Uint8Array;
  const height = L.height as Float32Array;
  const owner = L.owner as Int16Array | Int8Array | undefined;
  const deposit = L.deposit as Uint8Array | undefined;
  const subDeposit = L.subDeposit as Uint8Array | undefined;
  const subRichness = L.subRichness as Float32Array | undefined;

  const wasHex = hexTileMask(radius, { terrain, prep, height });
  const occupied = occupiedGroundTiles(state, data);
  const padIndices = collectHivePadIndices(radius, q, r, planarRadius, hexPadRadius);
  const searchRings = Math.ceil(planarRadius) + HIVE_PLANE_SEARCH_RINGS;
  const level = resolveHivePadHeight(radius, q, r, ringHalf, padIndices, searchRings, { terrain, prep, height, owner }, occupied);
  const touchesMismatchedOwnedDeposit = buildOwnedDepositMismatchGuard(
    hx, q, r, ringHalf, levelledFlatHeight(level), owner, deposit, height,
  );

  const footprintClearSet = new Set<number>();
  for (const pt of getBuildingFootprintTiles(q, r, Math.max(5, footprint + 2))) {
    const fi = hx.indexOf(pt.q, pt.r);
    if (fi >= 0) footprintClearSet.add(fi);
  }

  const padSet = new Set<number>(padIndices);
  const changedSet = new Set<number>();
  for (const i of padIndices) {
    if (isWaterTerrain(terrain[i] ?? 0) || occupied.has(i) || (owner && (owner[i] ?? -1) >= 0)) continue;
    if (touchesMismatchedOwnedDeposit(i)) continue;
    let touched = false;
    if (terrain[i] !== TERRAIN.flat) {
      setTileTerrain(state.grid, i, TERRAIN.flat, stamp);
      touched = true;
    }
    if (!isPreparedGround(prep[i] ?? 0)) {
      setTilePrep(state.grid, i, PREP.prepared, stamp);
      touched = true;
    }
    if (footprintClearSet.has(i)) {
      if (deposit && deposit[i] !== DEPOSIT.none) {
        setTileDeposit(state.grid, i, DEPOSIT.none, 0, stamp);
        touched = true;
      }
      if (subDeposit && subDeposit[i] !== DEPOSIT.none) {
        subDeposit[i] = DEPOSIT.none;
        if (subRichness) subRichness[i] = 0;
      }
    }
    if (Math.abs((height[i] ?? 0) - level) > 1e-5) {
      setTileHeight(state.grid, i, level, stamp);
      touched = true;
    }
    if (touched) changedSet.add(i);
  }

  const outerPlanar = planarRadius + HIVE_FALLOFF_TILES;
  const outerHexBound = Math.ceil((outerPlanar * 2) / Math.sqrt(3)) + 1;
  for (let dr = -outerHexBound; dr <= outerHexBound; dr++) {
    for (let dq = -outerHexBound; dq <= outerHexBound; dq++) {
      const i = hx.indexOf(q + dq, r + dr);
      if (i < 0 || padSet.has(i) || isWaterTerrain(terrain[i] ?? 0)) continue;
      if (occupied.has(i) || (owner && (owner[i] ?? -1) >= 0) || wasHex[i] || touchesMismatchedOwnedDeposit(i)) continue;
      const d = hivePlanarDist(dq, dr);
      if (d > outerPlanar) continue;
      const curH = height[i] ?? 0;
      if (Math.abs(curH - level) <= 0.35) continue;
      const t = smoothstep01(planarRadius, outerPlanar, d);
      const nextH = Math.fround(level + (curH - level) * t);
      if (Math.abs(nextH - curH) > 1e-4) {
        setTileHeight(state.grid, i, nextH, stamp);
        changedSet.add(i);
      }
    }
  }

  buryDisruptedEdgeDeposits(state, q, r, outerHexBound + 1, occupied, stamp, changedSet);
  return [...changedSet];
}

export interface HiveSitePlacementOptions {
  readonly data?: CompiledDataLike;
  readonly blocked?: ReadonlySet<number>;
  /** When true, forbids any owned colony tile (`owner >= 0`) inside the hive footprint and surrounding hex ring. */
  readonly disallowAllOwned?: boolean;
  readonly footprint?: number;
}

export function collectBlockedHiveTiles(state: PlanetState, data?: CompiledDataLike): Set<number> {
  const blocked = new Set<number>(occupiedGroundTiles(state, data));
  for (const ti of getWreckTileSet(state)) blocked.add(ti);
  const hx = hexIndex(state.grid.radius);
  const { count, cols } = state.entities;
  for (let row = 0; row < count; row++) {
    if (cols.hpMax[row]! > 0 && cols.hp[row]! <= 0) continue;
    const kind = cols.kind[row]!;
    if (!OCCUPYING_BUILDING_KINDS.has(kind)) continue;
    const fp = Math.max(entityFootprint(kind, data), cols.footprintW[row] || 1, cols.footprintD[row] || 1);
    for (const pt of getBuildingFootprintTiles(Math.round(cols.q[row]!), Math.round(cols.r[row]!), fp)) {
      const ti = hx.indexOf(pt.q, pt.r);
      if (ti >= 0) blocked.add(ti);
    }
  }
  return blocked;
}

/**
 * Validates whether a 3×3 hive placed at `(hq, hr)` has a dry, unobstructed, in-bounds footprint and surrounding
 * hex ring so hexagons (`isHexTile`) form below and around the placed hive without overlapping buildings, wrecks,
 * water, walls, map edges, or incompatible/disallowed owned colony territory.
 */
export function isHiveSitePlaceable(
  state: PlanetState,
  hq: number,
  hr: number,
  opts?: HiveSitePlacementOptions,
): boolean {
  if (!inHex(hq, hr, state.grid.radius)) return false;
  const hx = hexIndex(state.grid.radius);
  const blocked = opts?.blocked ?? collectBlockedHiveTiles(state, opts?.data);
  const footprint = Math.max(1, Math.trunc(opts?.footprint ?? 3));
  const ringHalf = Math.floor(footprint / 2) + 1;
  const { terrain, prep, height, owner, deposit } = state.grid.layers;
  let minOwnedLh = Infinity;
  let maxOwnedLh = -Infinity;
  const seen = new Set<number>();

  const checkCoord = (tx: number, ty: number, inClearZone: boolean): boolean => {
    const ti = hx.indexOf(tx, ty);
    if (ti < 0 || blocked.has(ti)) return false;
    if (seen.has(ti) && !inClearZone) return true;
    seen.add(ti);
    const t = terrain[ti] ?? TERRAIN.flat;
    const p = prep[ti] ?? PREP.wild;
    if (isWaterTerrain(t) || p === PREP.ridge || p === PREP.moat) return false;
    const tileOwner = owner ? (owner[ti] ?? -1) : -1;
    if (tileOwner >= 0) {
      if (opts?.disallowAllOwned) return false;
      if (t !== TERRAIN.flat || !isPreparedGround(p)) return false;
      if (inClearZone && deposit && (deposit[ti] ?? DEPOSIT.none) !== DEPOSIT.none) return false;
      const lh = levelledFlatHeight(height[ti] ?? 0);
      if (lh < minOwnedLh) minOwnedLh = lh;
      if (lh > maxOwnedLh) maxOwnedLh = lh;
      if (maxOwnedLh - minOwnedLh > HEX_LEVEL_EPS_M) return false;
    }
    return true;
  };

  for (let fr = -ringHalf; fr <= ringHalf; fr++) {
    for (let fq = -ringHalf; fq <= ringHalf; fq++) {
      const q = hq + fq;
      const r = hr + fr;
      if (!checkCoord(q, r, true)) return false;
      for (const [dq, dr] of HEX_DIRS) {
        const inClear = Math.abs(fq + dq) <= ringHalf && Math.abs(fr + dr) <= ringHalf;
        if (!checkCoord(q + dq, r + dr, inClear)) return false;
      }
    }
  }
  return true;
}

export function findNearestHiveSpawnTile(
  state: PlanetState,
  cq: number,
  cr: number,
  opts?: HiveSitePlacementOptions,
): { q: number; r: number } | null {
  const blocked = opts?.blocked ?? collectBlockedHiveTiles(state, opts?.data);
  const maxDist = state.grid.radius * 2;
  const search = (disallowAllOwned: boolean): { q: number; r: number } | null => {
    for (let dist = 0; dist <= maxDist; dist++) {
      for (let dq = -dist; dq <= dist; dq++) {
        for (let dr = -dist; dr <= dist; dr++) {
          if (hexDistance(0, 0, dq, dr) !== dist) continue;
          const q = cq + dq;
          const r = cr + dr;
          if (!inHex(q, r, state.grid.radius)) continue;
          if (isHiveSitePlaceable(state, q, r, { ...opts, blocked, disallowAllOwned })) {
            return { q, r };
          }
        }
      }
    }
    return null;
  };
  return search(true) ?? (opts?.disallowAllOwned ? null : search(false));
}

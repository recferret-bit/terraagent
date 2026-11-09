import {
  formatSectorId,
  parseSectorId,
  W11_DEFAULT_SECTOR_RADIUS,
  type SectorId,
} from '@terra/contracts';
import { HEX_DIRS, hexCount, hexDistance, hexIndex, hexRound, inHex } from '../grid/hex';
import {
  type GlobalTileSectorLookup,
  type SectorNeighborV1,
  type SectorTileEntry,
  type TileSectorNeighbor,
} from './types';

export * from './types';
export * from './smallAtlas';

function assertValidSectorRadius(sectorRadius: number): void {
  if (!Number.isSafeInteger(sectorRadius) || sectorRadius <= 0) {
    throw new RangeError(`sectorRadius must be a positive integer, got ${sectorRadius}`);
  }
}

function assertSafeIntPair(a: number, b: number, label: string): void {
  if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b)) {
    throw new RangeError(`${label} must be safe integers, got (${a}, ${b})`);
  }
}

export function tileCoordKey(q: number, r: number): string {
  return `${q === 0 ? 0 : q},${r === 0 ? 0 : r}`;
}

export function oppositeHexDir(dir: number): number {
  if (!Number.isSafeInteger(dir) || dir < 0 || dir > 5) {
    throw new RangeError(`hex direction must be an integer in 0..5, got ${dir}`);
  }
  return (dir + 3) % 6;
}

/**
 * Basis vectors `bq = (2R + 1, -R)` and `br = (R, R + 1)` for a macro-hex tiling of radius-`R` hexes.
 * Their determinant is `(2R + 1)(R + 1) + R^2 = 3R(R + 1) + 1 = hexCount(R)`.
 */
export function macroBasisVectors(sectorRadius = W11_DEFAULT_SECTOR_RADIUS): {
  readonly bq: readonly [number, number];
  readonly br: readonly [number, number];
  readonly determinant: number;
} {
  assertValidSectorRadius(sectorRadius);
  const bq: readonly [number, number] = [2 * sectorRadius + 1, -sectorRadius];
  const br: readonly [number, number] = [sectorRadius, sectorRadius + 1];
  return { bq, br, determinant: hexCount(sectorRadius) };
}

export function sectorCenterForMacro(
  macroQ: number,
  macroR: number,
  sectorRadius = W11_DEFAULT_SECTOR_RADIUS,
): { centerQ: number; centerR: number } {
  assertValidSectorRadius(sectorRadius);
  assertSafeIntPair(macroQ, macroR, 'macro coordinates');
  const centerQ = macroQ * (2 * sectorRadius + 1) + macroR * sectorRadius + 0;
  const centerR = -macroQ * sectorRadius + macroR * (sectorRadius + 1) + 0;
  return { centerQ, centerR };
}

export function sectorCenterForId(
  sectorId: SectorId,
  sectorRadius = W11_DEFAULT_SECTOR_RADIUS,
): { macroQ: number; macroR: number; centerQ: number; centerR: number } {
  assertValidSectorRadius(sectorRadius);
  const parsed = parseSectorId(sectorId);
  if (!parsed) throw new RangeError(`invalid sectorId "${sectorId}"`);
  const { centerQ, centerR } = sectorCenterForMacro(parsed.macroQ, parsed.macroR, sectorRadius);
  return { macroQ: parsed.macroQ, macroR: parsed.macroR, centerQ, centerR };
}

export function macroNeighbors(
  macroQ: number,
  macroR: number,
  sectorRadius = W11_DEFAULT_SECTOR_RADIUS,
  knownSectorIds?: ReadonlySet<SectorId> | null,
): SectorNeighborV1[] {
  assertValidSectorRadius(sectorRadius);
  assertSafeIntPair(macroQ, macroR, 'macro coordinates');
  const out: SectorNeighborV1[] = [];
  for (let dir = 0; dir < HEX_DIRS.length; dir++) {
    const [dq, dr] = HEX_DIRS[dir]!;
    const nq = macroQ + dq + 0;
    const nr = macroR + dr + 0;
    const id = formatSectorId(nq, nr);
    const sectorId = knownSectorIds ? (knownSectorIds.has(id) ? id : null) : id;
    out.push({ dir, macroQ: nq, macroR: nr, sectorId });
  }
  return out;
}

export const macroNeighbours = macroNeighbors;

/**
 * Exact O(1) mapping from any global axial tile `(q, r)` to its unique owning macro-hex sector.
 * Uses the inverse basis matrix `1/N * [[R + 1, -R], [R, 2R + 1]]` and checks `hexRound(fq, fr)`
 * plus its 6 immediate macro-hex neighbours so `hexDistance(localQ, localR, 0, 0) <= R` is exact.
 */
export function globalTileToSector(
  q: number,
  r: number,
  sectorRadius = W11_DEFAULT_SECTOR_RADIUS,
): GlobalTileSectorLookup {
  assertValidSectorRadius(sectorRadius);
  assertSafeIntPair(q, r, 'global tile coordinates');
  const area = hexCount(sectorRadius);
  const fq = ((sectorRadius + 1) * q - sectorRadius * r) / area;
  const fr = (sectorRadius * q + (2 * sectorRadius + 1) * r) / area;
  const [baseQ, baseR] = hexRound(fq, fr);
  const hx = hexIndex(sectorRadius);

  const tryMacro = (mq: number, mr: number): GlobalTileSectorLookup | null => {
    const centerQ = mq * (2 * sectorRadius + 1) + mr * sectorRadius + 0;
    const centerR = -mq * sectorRadius + mr * (sectorRadius + 1) + 0;
    const localQ = q - centerQ + 0;
    const localR = r - centerR + 0;
    if (!inHex(localQ, localR, sectorRadius)) return null;
    return {
      sectorId: formatSectorId(mq, mr),
      macroQ: mq + 0,
      macroR: mr + 0,
      centerQ,
      centerR,
      localQ,
      localR,
      localIndex: hx.indexOf(localQ, localR),
    };
  };

  const direct = tryMacro(baseQ, baseR);
  if (direct) return direct;
  for (const [dq, dr] of HEX_DIRS) {
    const hit = tryMacro(baseQ + dq, baseR + dr);
    if (hit) return hit;
  }
  throw new Error(`unreachable: tile (${q}, ${r}) did not resolve to a sector at radius ${sectorRadius}`);
}

export function sectorIdLocalToGlobalTile(
  sectorId: SectorId,
  localQ: number,
  localR: number,
  sectorRadius = W11_DEFAULT_SECTOR_RADIUS,
): { q: number; r: number } {
  const parsed = parseSectorId(sectorId);
  if (!parsed) throw new RangeError(`invalid sectorId "${sectorId}"`);
  return resolveLocalToGlobal(parsed.macroQ, parsed.macroR, localQ, localR, sectorRadius);
}

export function sectorLocalToGlobalTile(
  macroQ: number,
  macroR: number,
  localQ: number,
  localR: number,
  sectorRadius?: number,
): { q: number; r: number };
export function sectorLocalToGlobalTile(
  sectorId: SectorId,
  localQ: number,
  localR: number,
  sectorRadius?: number,
): { q: number; r: number };
export function sectorLocalToGlobalTile(
  arg0: number | SectorId,
  arg1: number,
  arg2: number,
  arg3?: number,
  arg4?: number,
): { q: number; r: number } {
  if (typeof arg0 === 'string') {
    const parsed = parseSectorId(arg0);
    if (!parsed) throw new RangeError(`invalid sectorId "${arg0}"`);
    return resolveLocalToGlobal(parsed.macroQ, parsed.macroR, arg1, arg2, arg3 ?? W11_DEFAULT_SECTOR_RADIUS);
  }
  return resolveLocalToGlobal(arg0, arg1, arg2, arg3!, arg4 ?? W11_DEFAULT_SECTOR_RADIUS);
}

function resolveLocalToGlobal(
  macroQ: number,
  macroR: number,
  localQ: number,
  localR: number,
  sectorRadius: number,
): { q: number; r: number } {
  assertValidSectorRadius(sectorRadius);
  assertSafeIntPair(macroQ, macroR, 'macro coordinates');
  assertSafeIntPair(localQ, localR, 'local tile coordinates');
  if (!inHex(localQ, localR, sectorRadius)) {
    throw new RangeError(
      `local tile (${localQ}, ${localR}) is outside sector radius ${sectorRadius} (distance ${hexDistance(0, 0, localQ, localR)})`,
    );
  }
  const { centerQ, centerR } = sectorCenterForMacro(macroQ, macroR, sectorRadius);
  return { q: centerQ + localQ + 0, r: centerR + localR + 0 };
}

export function sectorLocalIndexToGlobalTile(
  macroQ: number,
  macroR: number,
  localIndex: number,
  sectorRadius = W11_DEFAULT_SECTOR_RADIUS,
): { q: number; r: number; localQ: number; localR: number } {
  assertValidSectorRadius(sectorRadius);
  assertSafeIntPair(macroQ, macroR, 'macro coordinates');
  const hx = hexIndex(sectorRadius);
  if (!Number.isSafeInteger(localIndex) || localIndex < 0 || localIndex >= hx.count) {
    throw new RangeError(`localIndex must be in 0..${hx.count - 1}, got ${localIndex}`);
  }
  const localQ = hx.q[localIndex]! + 0;
  const localR = hx.r[localIndex]! + 0;
  const { centerQ, centerR } = sectorCenterForMacro(macroQ, macroR, sectorRadius);
  return { q: centerQ + localQ + 0, r: centerR + localR + 0, localQ, localR };
}

export function enumerateSectorTiles(
  macroQ: number,
  macroR: number,
  sectorRadius?: number,
): SectorTileEntry[];
export function enumerateSectorTiles(
  sectorId: SectorId,
  sectorRadius?: number,
): SectorTileEntry[];
export function enumerateSectorTiles(
  arg0: number | SectorId,
  arg1?: number,
  arg2?: number,
): SectorTileEntry[] {
  let macroQ: number;
  let macroR: number;
  let sectorRadius: number;
  if (typeof arg0 === 'string') {
    const parsed = parseSectorId(arg0);
    if (!parsed) throw new RangeError(`invalid sectorId "${arg0}"`);
    macroQ = parsed.macroQ;
    macroR = parsed.macroR;
    sectorRadius = arg1 ?? W11_DEFAULT_SECTOR_RADIUS;
  } else {
    macroQ = arg0;
    macroR = arg1!;
    sectorRadius = arg2 ?? W11_DEFAULT_SECTOR_RADIUS;
  }
  const { centerQ, centerR } = sectorCenterForMacro(macroQ, macroR, sectorRadius);
  const hx = hexIndex(sectorRadius);
  const out: SectorTileEntry[] = new Array(hx.count);
  for (let localIndex = 0; localIndex < hx.count; localIndex++) {
    const localQ = hx.q[localIndex]! + 0;
    const localR = hx.r[localIndex]! + 0;
    out[localIndex] = { q: centerQ + localQ + 0, r: centerR + localR + 0, localQ, localR, localIndex };
  }
  return out;
}

export function tileSectorNeighbors(
  q: number,
  r: number,
  sectorRadius = W11_DEFAULT_SECTOR_RADIUS,
): TileSectorNeighbor[] {
  const origin = globalTileToSector(q, r, sectorRadius);
  const out: TileSectorNeighbor[] = [];
  for (let dir = 0; dir < HEX_DIRS.length; dir++) {
    const [dq, dr] = HEX_DIRS[dir]!;
    const nq = q + dq + 0;
    const nr = r + dr + 0;
    const owner = globalTileToSector(nq, nr, sectorRadius);
    out.push({
      dir,
      oppositeDir: (dir + 3) % 6,
      q: nq,
      r: nr,
      ...owner,
      crossesSectorBoundary: owner.sectorId !== origin.sectorId,
    });
  }
  return out;
}

export const tileSectorNeighbours = tileSectorNeighbors;

import {
  formatSectorId,
  SECTOR_ID_REGEX,
  W11_DEFAULT_SECTOR_RADIUS,
  W11_SEVEN_SECTOR_COORDS,
  type SectorId,
} from '@terra/contracts';
import { globalTileToSector } from '@terra/sim';

const COORD_BIAS = 65_536;
const COORD_STRIDE = 131_072;
const MAX_CACHE_PER_RADIUS = 131_072;

const FNV_OFFSET_A = 0x811c9dc5;
const FNV_PRIME_A = 0x01000193;
const FNV_OFFSET_B = 0x9e3779b9;
const FNV_PRIME_B = 0x85ebca6b;

const sectorCoordCache = new Map<number, Map<number, SectorId>>();

/**
 * Fast zero-BigInt 64-bit dual-lane FNV-1a digest over structured fields.
 * Produces a deterministic 16-hex-character fingerprint in ~80ns for real-time backend checks.
 */
export function fnv1a64Hex(parts: readonly (string | number | boolean | null | undefined)[]): string {
  let hA = FNV_OFFSET_A | 0;
  let hB = FNV_OFFSET_B | 0;
  for (let p = 0; p < parts.length; p++) {
    const raw = parts[p];
    const str = raw === null || raw === undefined ? '' : String(raw);
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      hA = Math.imul(hA ^ ch, FNV_PRIME_A);
      hB = Math.imul(hB ^ ((ch << 1) ^ 0x5a), FNV_PRIME_B);
    }
    hA = Math.imul(hA ^ 0x1f, FNV_PRIME_A);
    hB = Math.imul(hB ^ 0x7f, FNV_PRIME_B);
  }
  const hexA = (hA >>> 0).toString(16).padStart(8, '0');
  const hexB = (hB >>> 0).toString(16).padStart(8, '0');
  return `${hexA}${hexB}`;
}

/**
 * Packs an axial integer pair `(q, r)` (`[-65536, 65535]`) into a single collision-free
 * 53-bit IEEE safe integer key so coordinate hash-table lookups allocate zero strings.
 */
export function packAxialCoord(q: number, r: number): number {
  const nq = (q | 0) + COORD_BIAS;
  const nr = (r | 0) + COORD_BIAS;
  return nq * COORD_STRIDE + nr;
}

export function isValidSectorIdFormat(value: unknown): value is SectorId {
  return typeof value === 'string' && SECTOR_ID_REGEX.test(value);
}

/**
 * O(1) memoized mapping from `(q, r, sectorRadius)` to `SectorId`.
 * Caches up to 131,072 coordinates per radius (covering an entire 7-sector R=144 atlas in RAM).
 */
export function resolveTileSectorFast(
  q: number,
  r: number,
  sectorRadius = W11_DEFAULT_SECTOR_RADIUS,
): SectorId {
  if (!Number.isSafeInteger(q) || !Number.isSafeInteger(r)) return 'sec_0_0';
  const radius = Number.isSafeInteger(sectorRadius) && sectorRadius > 0 ? sectorRadius : W11_DEFAULT_SECTOR_RADIUS;
  if (q >= -COORD_BIAS && q < COORD_BIAS && r >= -COORD_BIAS && r < COORD_BIAS) {
    let table = sectorCoordCache.get(radius);
    if (!table) {
      table = new Map<number, SectorId>();
      sectorCoordCache.set(radius, table);
    }
    const packed = packAxialCoord(q, r);
    const cached = table.get(packed);
    if (cached !== undefined) return cached;
    const computed = globalTileToSector(q, r, radius).sectorId;
    if (table.size >= MAX_CACHE_PER_RADIUS) table.clear();
    table.set(packed, computed);
    return computed;
  }
  return globalTileToSector(q, r, radius).sectorId;
}

export function sectorOrdinalToSectorId(ordinal: number): SectorId | null {
  if (!Number.isInteger(ordinal) || ordinal < 0 || ordinal >= W11_SEVEN_SECTOR_COORDS.length) {
    return null;
  }
  const [mq, mr] = W11_SEVEN_SECTOR_COORDS[ordinal]!;
  return formatSectorId(mq, mr);
}

export function computeColonyBindingHash(input: {
  readonly playerId: string;
  readonly planetId: string;
  readonly colonyId: string;
  readonly colonyIndex: number;
  readonly baseSectorId: SectorId;
  readonly status: string;
}): string {
  return fnv1a64Hex([
    'bind:v1',
    input.playerId,
    input.planetId,
    input.colonyId,
    input.colonyIndex,
    input.baseSectorId,
    input.status,
  ]);
}

export function computeSectorSpaceHash(input: {
  readonly planetId: string;
  readonly sectorId: SectorId;
  readonly kind: string;
  readonly capacity: number;
  readonly reservedSeats: number;
  readonly foundedSeats: number;
  readonly freeSeats: number;
}): string {
  return fnv1a64Hex([
    'sec:v1',
    input.planetId,
    input.sectorId,
    input.kind,
    input.capacity,
    input.reservedSeats,
    input.foundedSeats,
    input.freeSeats,
  ]);
}

/**
 * Resolves the authoritative base `SectorId` of a colony from its explicit `foundingSectorId`
 * cross-checked with `(spawnQ, spawnR)` when positioned on a multi-sector coordinate grid.
 */
export function inferAuthoritativeBaseSector(input: {
  readonly foundingSectorId?: string | null;
  readonly spawnQ?: number;
  readonly spawnR?: number;
  readonly sectorRadius?: number;
  readonly hasMultiSectorGrid?: boolean;
}): SectorId {
  const radius = input.sectorRadius ?? W11_DEFAULT_SECTOR_RADIUS;
  const raw = input.foundingSectorId?.trim();
  const validExplicit = isValidSectorIdFormat(raw) ? raw : undefined;
  const hasSpawn =
    typeof input.spawnQ === 'number' &&
    typeof input.spawnR === 'number' &&
    Number.isSafeInteger(input.spawnQ) &&
    Number.isSafeInteger(input.spawnR) &&
    (input.spawnQ !== 0 || input.spawnR !== 0);

  if (input.hasMultiSectorGrid && hasSpawn) {
    const coordSector = resolveTileSectorFast(input.spawnQ!, input.spawnR!, radius);
    if (!validExplicit || validExplicit === 'sec_0_0') return coordSector;
    return validExplicit;
  }
  if (validExplicit) return validExplicit;
  if (hasSpawn && input.hasMultiSectorGrid) {
    return resolveTileSectorFast(input.spawnQ!, input.spawnR!, radius);
  }
  return 'sec_0_0';
}

export function normalizeColonyStatus(raw: unknown): 'ACTIVE' | 'ELIMINATED' | 'ENDED' {
  const upper = String(raw ?? 'ACTIVE').toUpperCase();
  if (upper === 'ELIMINATED') return 'ELIMINATED';
  if (
    upper === 'ENDED' ||
    upper === 'SETTLED' ||
    upper === 'PLANET_ENDED' ||
    upper === 'TRANSFERRED' ||
    upper === 'ABANDONED'
  ) {
    return 'ENDED';
  }
  return 'ACTIVE';
}

import { DEPOSIT_CODES, PREP_CODES, TERRAIN_CODES } from '@terra/contracts/tiles/codes';
import { HEX_DIRS, hexIndex, isTileUneven, levelledFlatHeight } from '@terra/sim/grid/hex';
import type { PlanetKind } from '../PlanetSpec';
import { tileXZ } from './hexMath';

/** Sim tile codes (shared with the sim through `@terra/contracts`, parity-tested there): terrain class, prep, deposit. */
export const HEX_TERRAIN = TERRAIN_CODES;
export const HEX_PREP = PREP_CODES;
export const HEX_DEPOSIT = DEPOSIT_CODES;

/**
 * Cleared, levelled ground: the one rule height, water and props share (RN-05). A tile in one of these prep states is
 * levelled at its own height (no class detail, no slope easing), carries no water surface and no wild props.
 */
export function isClearedPrep(prep: number): boolean {
  return prep === HEX_PREP.prepared || prep === HEX_PREP.irrigated || prep === HEX_PREP.living;
}

export interface HexTileLayers {
  terrain?: ArrayLike<number>;
  prep?: ArrayLike<number>;
  height: ArrayLike<number>;
  deposit?: ArrayLike<number>;
  /** Tier of the visible deposit (sim `depositTier`): 0 / missing = legacy tier 1, else 1..3. */
  depositTier?: ArrayLike<number>;
  richness?: ArrayLike<number>;
  owner?: ArrayLike<number>;
  /** Optional planet look kind ('dune' | 'oceanForest' | 'forestRock'); defaults to 'forestRock'. */
  kind?: PlanetKind;
}

/**
 * Plain buffers of one chunk's surface (vertices = tile centres, y = effective height). The class tint is not a vertex
 * attribute: the shader looks it up per hex cell (`tileTint.ts`), so it never smears over neighbouring tiles.
 */
export interface ChunkBuffers {
  position: Float32Array;
  normal: Float32Array;
  aAO: Float32Array;
  aRock: Float32Array;
  aHexFlat: Float32Array;
  /** Shoreline weight [0..1] of the tile (water tile or dry tile bordering water); drives the beach band. */
  aHexShore: Float32Array;
  index: Uint32Array;
  /** Tile index of each vertex (a chunk also holds the border vertices of its neighbours' tiles). */
  vertexTile: Int32Array;
}

export function tileHashU32(q: number, r: number, salt = 0): number {
  let h = (salt ^ Math.imul(q, 0x9e3779b1) ^ Math.imul(r, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

export function tileHash01(q: number, r: number, salt = 0): number {
  return tileHashU32(q, r, salt) / 4294967296;
}

type StyleSpec = readonly [number, number, number, number]; // [hexA, hexB, ao, rock]

const CLASS_STYLES: Record<PlanetKind, Record<number, StyleSpec>> = {
  forestRock: {
    [HEX_TERRAIN.flat]: [0x567d46, 0x648c51, 1.0, 0.0],
    [HEX_TERRAIN.forest]: [0x466e3b, 0x507a44, 0.95, 0.0],
    [HEX_TERRAIN.rock]: [0x6b7078, 0x555a63, 0.74, 1.0],
    [HEX_TERRAIN.slope]: [0x8a795d, 0x78684e, 0.84, 0.0],
    [HEX_TERRAIN.hole]: [0x64664e, 0x6e7056, 0.95, 0.0],
    [HEX_TERRAIN.shallow]: [0x2b6e78, 0x38858f, 0.88, 0.0],
    [HEX_TERRAIN.deep]: [0x10344a, 0x164663, 0.62, 0.0],
  },
  dune: {
    [HEX_TERRAIN.flat]: [0xe2aa6c, 0xecb97a, 1.0, 0.0],
    [HEX_TERRAIN.forest]: [0xd69e62, 0xe2af72, 0.95, 0.0],
    [HEX_TERRAIN.rock]: [0xb5784a, 0x8c5836, 0.88, 1.0],
    [HEX_TERRAIN.slope]: [0xd48642, 0xe09650, 0.96, 0.0],
    [HEX_TERRAIN.hole]: [0xd29a5e, 0xdea96c, 0.95, 0.0],
    [HEX_TERRAIN.shallow]: [0xbd8449, 0xd6a668, 0.9, 0.0],
    [HEX_TERRAIN.deep]: [0x7d4f2d, 0x633c20, 0.65, 0.0],
  },
  oceanForest: {
    [HEX_TERRAIN.flat]: [0x4f8a3c, 0x78ab4e, 1.0, 0.0],
    [HEX_TERRAIN.forest]: [0x447d35, 0x589442, 0.95, 0.0],
    [HEX_TERRAIN.rock]: [0x7a7f86, 0x5c6168, 0.74, 1.0],
    [HEX_TERRAIN.slope]: [0xb8a574, 0x9e8b5c, 0.86, 0.0],
    [HEX_TERRAIN.hole]: [0x5a7848, 0x688854, 0.95, 0.0],
    [HEX_TERRAIN.shallow]: [0x1f9fb8, 0x2cb5cf, 0.88, 0.0],
    [HEX_TERRAIN.deep]: [0x0b3f66, 0x114f7d, 0.62, 0.0],
  },
};

function unpackRgb(hex: number): [number, number, number] {
  return [((hex >> 16) & 0xff) / 255, ((hex >> 8) & 0xff) / 255, (hex & 0xff) / 255];
}

export function tileStyle(
  q: number,
  r: number,
  terrain: number,
  prep = 0,
  deposit = 0,
  kind: PlanetKind = 'forestRock',
): { r: number; g: number; b: number; ao: number; rock: number } {
  const table = CLASS_STYLES[kind] ?? CLASS_STYLES.forestRock;
  const flatSpec = table[HEX_TERRAIN.flat]!;
  const hasDeposit = deposit !== HEX_DEPOSIT.none && terrain !== HEX_TERRAIN.rock;
  // Prepared (terraformed) ground is plain levelled flat ground: same tint, AO and material as a flat tile.
  const spec = prep === HEX_PREP.prepared || hasDeposit ? flatSpec : (table[terrain] ?? flatSpec);
  const t = tileHash01(q, r, 31);
  const [r0, g0, b0] = unpackRgb(spec[0]);
  const [r1, g1, b1] = unpackRgb(spec[1]);
  const cr = r0 + (r1 - r0) * t;
  const cg = g0 + (g1 - g0) * t;
  const cb = b0 + (b1 - b0) * t;
  const ao = spec[2];
  const rock = spec[3];

  return { r: cr, g: cg, b: cb, ao, rock };
}

/**
 * Rendered height of one tile. The sim `height` layer is the ground truth in metres (D-38: dunes, mesas, mountain
 * ranges); classes only add cosmetic detail on top and keep water below the water plane. Flat and Prepared ground sit
 * at their own level, so a pad on a raised plateau stays on the plateau.
 */
function baseTileHeight(q: number, r: number, raw: number, terrain: number, prep: number, kind?: PlanetKind): number {
  if (isClearedPrep(prep)) return levelledFlatHeight(raw);
  const h = tileHash01(q, r, 17);
  switch (terrain) {
    case HEX_TERRAIN.flat:
      return levelledFlatHeight(raw);
    case HEX_TERRAIN.forest:
      return (raw > 0.01 ? raw : 0.12) + 0.06 * h;
    case HEX_TERRAIN.rock: {
      if (kind === 'dune' && raw > 0.8) return raw + 0.04 * h;
      const step = Math.round(h * 3) / 3;
      return Math.max(raw, 0.65) + 0.22 * (0.4 + 0.6 * step);
    }
    case HEX_TERRAIN.slope:
      if (kind === 'dune') return raw;
      return Math.max(raw, 0.32) + 0.16 * h;
    case HEX_TERRAIN.hole:
      return Math.min(raw <= -0.25 ? raw : -0.35, -0.35) - 0.08 * h;
    case HEX_TERRAIN.shallow:
      return (raw < -0.04 && raw >= -0.35 ? raw : -0.2) - 0.06 * h;
    case HEX_TERRAIN.deep:
      return Math.min(raw < -0.35 ? raw : -0.58, -0.48) - 0.14 * h;
    default:
      return raw;
  }
}

/**
 * Computes the rendered vertex height for every tile on the planet. When `layers.terrain` is absent, returns `layers.height`
 * directly; when `terrain` is provided, the sim height (metres) plus class detail (`flat`/`prepared` levelled at their own
 * height, `hole` <= -0.35, `rock` crags, `slope` eased towards neighbour heights, `shallow`/`deep` submerged).
 */
export function computeEffectiveHeights(radius: number, layers: HexTileLayers): Float32Array {
  const hx = hexIndex(radius);
  const out = new Float32Array(hx.count);
  const terrain = layers.terrain;
  if (!terrain) {
    for (let i = 0; i < hx.count; i++) out[i] = layers.height[i] ?? 0;
    return out;
  }
  const prep = layers.prep;
  const deposit = layers.deposit;
  const kind = layers.kind;
  const base = new Float32Array(hx.count);
  for (let i = 0; i < hx.count; i++) {
    const t0 = terrain[i] ?? 0;
    const hasDeposit = (deposit?.[i] ?? 0) !== HEX_DEPOSIT.none && t0 !== HEX_TERRAIN.rock;
    const effTerrain = hasDeposit ? HEX_TERRAIN.flat : t0;
    const effRaw = layers.height[i] ?? 0; // a deposit tile is levelled at its own height, never pitted to 0 on a plateau
    base[i] = baseTileHeight(hx.q[i]!, hx.r[i]!, effRaw, effTerrain, prep?.[i] ?? 0, kind);
  }
  for (let i = 0; i < hx.count; i++) {
    const t0 = terrain[i] ?? 0;
    const hasDeposit = (deposit?.[i] ?? 0) !== HEX_DEPOSIT.none && t0 !== HEX_TERRAIN.rock;
    const t = hasDeposit ? HEX_TERRAIN.flat : t0;
    const p = prep?.[i] ?? 0;
    if (t !== HEX_TERRAIN.slope || isClearedPrep(p)) {
      out[i] = base[i]!;
      continue;
    }
    const q = hx.q[i]!, r = hx.r[i]!;
    let sum = 0, n = 0;
    for (const [dq, dr] of HEX_DIRS) {
      const j = hx.indexOf(q + dq, r + dr);
      if (j >= 0) { sum += base[j]!; n++; }
    }
    const avg = n > 0 ? sum / n : base[i]!;
    // Preserve sharp wind-carved dune crests on `dune`; ease synthetic/quota slopes.
    const selfW = kind === 'dune' ? 0.88 : 0.65;
    out[i] = selfW * base[i]! + (1 - selfW) * avg;
  }
  return out;
}

/** Horizon ambient occlusion from higher neighbouring tiles (mirrors pre-W1 `bakeAO` in `TerrainGrid.ts`). */
function horizonAO(hx: ReturnType<typeof hexIndex>, i: number, height: ArrayLike<number>): number {
  const q = hx.q[i]!, r = hx.r[i]!, h0 = height[i]!;
  let occ = 0;
  for (const [dq, dr] of HEX_DIRS) {
    const j = hx.indexOf(q + dq, r + dr);
    if (j >= 0) {
      const dh = height[j]! - h0;
      if (dh > 0.08) occ += Math.min(0.18, dh * 0.12);
    }
  }
  return Math.max(0.88, Math.min(1, 1 - occ * 0.25));
}

function isWaterAt(layers: HexTileLayers, i: number): boolean {
  if (!layers.terrain || i < 0 || isClearedPrep(layers.prep?.[i] ?? 0)) return false;
  const t = layers.terrain[i] ?? 0;
  return t === HEX_TERRAIN.shallow || t === HEX_TERRAIN.deep;
}

/** Shoreline weight [0..1] for non-dune water tiles and dry land tiles bordering water. */
function tileShoreFactor(hx: ReturnType<typeof hexIndex>, i: number, layers: HexTileLayers): number {
  if (!layers.terrain || layers.kind === 'dune') return 0;
  if (isWaterAt(layers, i)) return 1.0;
  const q = hx.q[i]!, r = hx.r[i]!;
  let waterNeighbors = 0;
  for (const [dq, dr] of HEX_DIRS) {
    const j = hx.indexOf(q + dq, r + dr);
    if (j >= 0 && isWaterAt(layers, j)) waterNeighbors++;
  }
  return waterNeighbors > 0 ? Math.min(0.95, 0.55 + waterNeighbors * 0.14) : 0;
}

/**
 * Builds the surface of the tiles in `tiles`: every owned tile t=(q,r) contributes the lattice triangle (t,C,B) with
 * B=(q+1,r), C=(q,r+1) and the triangle (B',C',t) with B'=(q,r-1), C'=(q-1,r), so across all chunks each triangle is
 * built exactly once. Normals come from the full six-neighbour fan of the effective height layer.
 */
export function buildChunk(
  radius: number,
  tiles: ArrayLike<number>,
  heightOrLayers: ArrayLike<number> | HexTileLayers,
  layersArg?: Omit<HexTileLayers, 'height'> & { height?: ArrayLike<number> },
  /** The planet's `computeEffectiveHeights(radius, layers)`, when the caller already has it (one pass per update). */
  effHeights?: ArrayLike<number>,
): ChunkBuffers {
  const hx = hexIndex(radius);
  const layers: HexTileLayers =
    'height' in heightOrLayers
      ? heightOrLayers
      : { ...layersArg, height: heightOrLayers };
  const effHeight = effHeights ?? (layers.terrain ? computeEffectiveHeights(radius, layers) : layers.height);

  const local = new Map<number, number>();
  const order: number[] = [];
  const vert = (i: number) => {
    let v = local.get(i);
    if (v === undefined) { v = order.length; local.set(i, v); order.push(i); }
    return v;
  };
  const idx: number[] = [];
  for (let n = 0; n < tiles.length; n++) {
    const i = tiles[n]!, q = hx.q[i]!, r = hx.r[i]!;
    const b = hx.indexOf(q + 1, r), c = hx.indexOf(q, r + 1);
    if (b >= 0 && c >= 0) idx.push(vert(i), vert(c), vert(b));
    const b2 = hx.indexOf(q, r - 1), c2 = hx.indexOf(q - 1, r);
    if (b2 >= 0 && c2 >= 0) idx.push(vert(b2), vert(c2), vert(i));
  }
  const V = order.length;
  const position = new Float32Array(V * 3);
  const normal = new Float32Array(V * 3);
  const aAO = new Float32Array(V);
  const aRock = new Float32Array(V);
  const aHexFlat = new Float32Array(V);
  const aHexShore = new Float32Array(V);
  const hasTerrain = Boolean(layers.terrain);

  for (let v = 0; v < V; v++) {
    const i = order[v]!, q = hx.q[i]!, r = hx.r[i]!;
    const [x, z] = tileXZ(q, r);
    position[v * 3] = x;
    position[v * 3 + 1] = effHeight[i]!;
    position[v * 3 + 2] = z;
    fanNormal(radius, i, effHeight, normal, v * 3);
    if (!hasTerrain) {
      aAO[v] = 1;
      aRock[v] = -1;
      aHexFlat[v] = 1.0;
      continue;
    }
    const prepVal = layers.prep?.[i] ?? 0;
    const tVal = layers.terrain![i] ?? 0;
    const depVal = layers.deposit?.[i] ?? 0;
    const hasDeposit = depVal !== HEX_DEPOSIT.none && tVal !== HEX_TERRAIN.rock;
    const st = tileStyle(q, r, tVal, prepVal, depVal, layers.kind ?? 'forestRock');
    const isLevelGroundPlane = Math.abs(levelledFlatHeight(layers.height[i] ?? 0)) <= 0.01;
    const isFlatBuildable =
      isClearedPrep(prepVal) ||
      hasDeposit ||
      (tVal === HEX_TERRAIN.flat &&
        prepVal !== HEX_PREP.ridge &&
        prepVal !== HEX_PREP.moat &&
        (isLevelGroundPlane || !isTileUneven(radius, i, layers.terrain!, layers.height)));
    aAO[v] = isClearedPrep(prepVal) || hasDeposit ? st.ao : st.ao * horizonAO(hx, i, effHeight);
    aRock[v] = st.rock;
    aHexFlat[v] = isFlatBuildable ? 1.0 : 0.0;
    aHexShore[v] = tileShoreFactor(hx, i, layers);
  }
  return {
    position,
    normal,
    aAO,
    aRock,
    aHexFlat,
    aHexShore,
    index: Uint32Array.from(idx),
    vertexTile: Int32Array.from(order),
  };
}

/** Surface normal at tile `i` from the ring of its neighbours (missing neighbours are skipped). */
export function fanNormal(radius: number, i: number, height: ArrayLike<number>, out: Float32Array, o: number): void {
  const hx = hexIndex(radius);
  const q = hx.q[i]!, r = hx.r[i]!, h0 = height[i]!;
  const [x0, z0] = tileXZ(q, r);
  const ring: Array<[number, number, number] | null> = HEX_DIRS.map(([dq, dr]) => {
    const j = hx.indexOf(q + dq, r + dr);
    if (j < 0) return null;
    const [x, z] = tileXZ(q + dq, r + dr);
    return [x - x0, height[j]! - h0, z - z0];
  });
  let nx = 0, ny = 0, nz = 0;
  for (let k = 0; k < 6; k++) {
    const a = ring[k], b = ring[(k + 1) % 6];
    if (!a || !b) continue;
    nx += a[1] * b[2] - a[2] * b[1]; ny += a[2] * b[0] - a[0] * b[2]; nz += a[0] * b[1] - a[1] * b[0];
  }
  if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
  const l = Math.hypot(nx, ny, nz);
  if (l < 1e-9) { out[o] = 0; out[o + 1] = 1; out[o + 2] = 0; return; }
  out[o] = nx / l; out[o + 1] = ny / l; out[o + 2] = nz / l;
}

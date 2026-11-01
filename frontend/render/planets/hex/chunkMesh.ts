import { DEPOSIT_CODES, PREP_CODES, TERRAIN_CODES } from '@terra/contracts/tiles/codes';
import { HEX_DIRS, hexIndex } from '@terra/sim/grid/hex';
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

export const PREP_BLEND_DURATION_S = 0.4;
export const INITIAL_PREP_START_TIME = -10.0;

export interface HexTileLayers {
  terrain?: ArrayLike<number>;
  prep?: ArrayLike<number>;
  height: ArrayLike<number>;
  deposit?: ArrayLike<number>;
  owner?: ArrayLike<number>;
  /** Optional per-tile timestamp (s) when a tile transitioned to Prepared; defaults to -10 (already complete). */
  prepStartTime?: ArrayLike<number>;
  /** Optional planet look kind ('dune' | 'oceanForest' | 'forestRock'); defaults to 'forestRock'. */
  kind?: PlanetKind;
}

/** Plain buffers of one chunk's surface (vertices = tile centres, y = effective height, color = class/deposit RGB). */
export interface ChunkBuffers {
  position: Float32Array;
  normal: Float32Array;
  aAO: Float32Array;
  aRock: Float32Array;
  color: Float32Array;
  aPrepTarget: Float32Array;
  aPrepStartTime: Float32Array;
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
    [HEX_TERRAIN.forest]: [0x2d4c2b, 0x365934, 0.86, 0.0],
    [HEX_TERRAIN.rock]: [0x6b7078, 0x555a63, 0.74, 1.0],
    [HEX_TERRAIN.slope]: [0x8a795d, 0x78684e, 0.84, 0.48],
    [HEX_TERRAIN.hole]: [0x3d352e, 0x2b241f, 0.42, 0.35],
    [HEX_TERRAIN.shallow]: [0x2b6e78, 0x38858f, 0.88, 0.0],
    [HEX_TERRAIN.deep]: [0x10344a, 0x164663, 0.62, 0.0],
  },
  dune: {
    [HEX_TERRAIN.flat]: [0xc98a4b, 0xe8c07a, 1.0, 0.0],
    [HEX_TERRAIN.forest]: [0xb87a40, 0xd8a35d, 0.9, 0.22],
    [HEX_TERRAIN.rock]: [0x8a5a3c, 0x5e3b26, 0.74, 1.0],
    [HEX_TERRAIN.slope]: [0xa86f44, 0x915d38, 0.84, 0.48],
    [HEX_TERRAIN.hole]: [0x5c3b28, 0x432a1c, 0.42, 0.35],
    [HEX_TERRAIN.shallow]: [0xbd8449, 0xd6a668, 0.9, 0.14],
    [HEX_TERRAIN.deep]: [0x7d4f2d, 0x633c20, 0.65, 0.4],
  },
  oceanForest: {
    [HEX_TERRAIN.flat]: [0x4f8a3c, 0x78ab4e, 1.0, 0.0],
    [HEX_TERRAIN.forest]: [0x2b6329, 0x3b7a35, 0.86, 0.0],
    [HEX_TERRAIN.rock]: [0x7a7f86, 0x5c6168, 0.74, 1.0],
    [HEX_TERRAIN.slope]: [0xb8a574, 0x9e8b5c, 0.86, 0.38],
    [HEX_TERRAIN.hole]: [0x363b30, 0x262b22, 0.42, 0.35],
    [HEX_TERRAIN.shallow]: [0x1f9fb8, 0x2cb5cf, 0.88, 0.0],
    [HEX_TERRAIN.deep]: [0x0b3f66, 0x114f7d, 0.62, 0.0],
  },
};

const PREP_PAD_STYLE: StyleSpec = [0x7d8478, 0x8a9185, 0.96, 0.25];
const DUNE_PREP_PAD_STYLE: StyleSpec = [0x9c8268, 0xad9378, 0.96, 0.25];

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
  const padStyle = kind === 'dune' ? DUNE_PREP_PAD_STYLE : PREP_PAD_STYLE;
  const spec = prep === HEX_PREP.prepared ? padStyle : (table[terrain] ?? table[HEX_TERRAIN.flat]!);
  const t = tileHash01(q, r, 31);
  const [r0, g0, b0] = unpackRgb(spec[0]);
  const [r1, g1, b1] = unpackRgb(spec[1]);
  let cr = r0 + (r1 - r0) * t;
  let cg = g0 + (g1 - g0) * t;
  let cb = b0 + (b1 - b0) * t;
  let ao = spec[2];
  let rock = spec[3];

  if (deposit === HEX_DEPOSIT.metals) {
    const [dr, dg, db] = unpackRgb(0xc46d29);
    cr = cr * 0.55 + dr * 0.45;
    cg = cg * 0.55 + dg * 0.45;
    cb = cb * 0.55 + db * 0.45;
    rock = Math.max(rock, 0.65);
  } else if (deposit === HEX_DEPOSIT.minerals) {
    const [dr, dg, db] = unpackRgb(0x38bfd4);
    cr = cr * 0.55 + dr * 0.45;
    cg = cg * 0.55 + dg * 0.45;
    cb = cb * 0.55 + db * 0.45;
    rock = Math.max(rock, 0.55);
  } else if (deposit === HEX_DEPOSIT.oil) {
    const [dr, dg, db] = unpackRgb(0x231c30);
    cr = cr * 0.5 + dr * 0.5;
    cg = cg * 0.5 + dg * 0.5;
    cb = cb * 0.5 + db * 0.5;
    ao = Math.min(ao, 0.58);
  }
  return { r: cr, g: cg, b: cb, ao, rock };
}

/** Sub-0.15 m noise on flat ground renders perfectly level; from 0.35 m up the sim height is used as is (no step). */
function levelled(raw: number): number {
  const a = Math.abs(raw);
  const t = Math.min(1, Math.max(0, (a - 0.15) / 0.2));
  return raw * t * t * (3 - 2 * t);
}

/**
 * Rendered height of one tile. The sim `height` layer is the ground truth in metres (D-38: dunes, mesas, mountain
 * ranges); classes only add cosmetic detail on top and keep water below the water plane. Flat and Prepared ground sit
 * at their own level, so a pad on a raised plateau stays on the plateau.
 */
function baseTileHeight(q: number, r: number, raw: number, terrain: number, prep: number): number {
  if (isClearedPrep(prep)) return levelled(raw);
  const h = tileHash01(q, r, 17);
  switch (terrain) {
    case HEX_TERRAIN.flat:
      return levelled(raw);
    case HEX_TERRAIN.forest:
      return (raw > 0.01 ? raw : 0.12) + 0.06 * h;
    case HEX_TERRAIN.rock: {
      const step = Math.round(h * 3) / 3;
      return Math.max(raw, 0.65) + 0.22 * (0.4 + 0.6 * step);
    }
    case HEX_TERRAIN.slope:
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
  const base = new Float32Array(hx.count);
  for (let i = 0; i < hx.count; i++) {
    base[i] = baseTileHeight(hx.q[i]!, hx.r[i]!, layers.height[i] ?? 0, terrain[i] ?? 0, prep?.[i] ?? 0);
  }
  for (let i = 0; i < hx.count; i++) {
    const t = terrain[i] ?? 0;
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
    // Ease slopes towards their neighbours; never clamp: real relief is metres high (D-38).
    out[i] = 0.65 * base[i]! + 0.35 * avg;
  }
  return out;
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
  const color = new Float32Array(V * 3);
  const aPrepTarget = new Float32Array(V);
  const aPrepStartTime = new Float32Array(V);
  const hasTerrain = Boolean(layers.terrain);

  for (let v = 0; v < V; v++) {
    const i = order[v]!, q = hx.q[i]!, r = hx.r[i]!;
    const [x, z] = tileXZ(q, r);
    position[v * 3] = x;
    position[v * 3 + 1] = effHeight[i]!;
    position[v * 3 + 2] = z;
    fanNormal(radius, i, effHeight, normal, v * 3);
    const prepVal = layers.prep?.[i] ?? 0;
    const isPrep = prepVal === HEX_PREP.prepared;
    const startT = isPrep ? (layers.prepStartTime?.[i] ?? INITIAL_PREP_START_TIME) : INITIAL_PREP_START_TIME;
    aPrepTarget[v] = isPrep ? 1.0 : 0.0;
    aPrepStartTime[v] = startT;
    if (hasTerrain) {
      const stylePrep = isPrep && startT >= 0 ? HEX_PREP.flat : prepVal;
      const st = tileStyle(q, r, layers.terrain![i] ?? 0, stylePrep, layers.deposit?.[i] ?? 0, layers.kind ?? 'forestRock');
      aAO[v] = st.ao;
      aRock[v] = st.rock;
      color[v * 3] = st.r;
      color[v * 3 + 1] = st.g;
      color[v * 3 + 2] = st.b;
    } else {
      const st = tileStyle(q, r, HEX_TERRAIN.flat, 0, 0, layers.kind ?? 'forestRock');
      aAO[v] = 1;
      aRock[v] = -1;
      color[v * 3] = st.r;
      color[v * 3 + 1] = st.g;
      color[v * 3 + 2] = st.b;
    }
  }
  return {
    position,
    normal,
    aAO,
    aRock,
    color,
    aPrepTarget,
    aPrepStartTime,
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

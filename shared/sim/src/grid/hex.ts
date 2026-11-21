/**
 * Axial hex math for a hexagon-shaped planet of radius R (CLIENT §8: presentation-safe, usable by the client main
 * thread). Tiles are indexed row by row: r from -R to R, q ascending within the row. Count = 3R(R+1)+1.
 */
export const hexCount = (radius: number) => 3 * radius * (radius + 1) + 1;

export const HEX_DIRS: readonly (readonly [number, number])[] = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];

export const hexDistance = (aq: number, ar: number, bq: number, br: number) =>
  (Math.abs(aq - bq) + Math.abs(aq + ar - bq - br) + Math.abs(ar - br)) / 2;

export const inHex = (q: number, r: number, radius: number) => hexDistance(0, 0, q, r) <= radius;

export interface HexIndex {
  readonly radius: number;
  readonly count: number;
  readonly q: Int16Array;
  readonly r: Int16Array;
  /** Tile index of (q, r), or -1 outside the planet. */
  indexOf(q: number, r: number): number;
}

const cache = new Map<number, HexIndex>();

/** Precomputed coordinate tables for radius R (cached; not part of the planet state). */
export function hexIndex(radius: number): HexIndex {
  const hit = cache.get(radius);
  if (hit) return hit;
  const count = hexCount(radius);
  const qs = new Int16Array(count), rs = new Int16Array(count);
  const starts = new Int32Array(2 * radius + 1);
  let i = 0;
  for (let r = -radius; r <= radius; r++) {
    starts[r + radius] = i;
    const q0 = Math.max(-radius, -r - radius), q1 = Math.min(radius, -r + radius);
    for (let q = q0; q <= q1; q++) { qs[i] = q; rs[i] = r; i++; }
  }
  const idx: HexIndex = {
    radius, count, q: qs, r: rs,
    indexOf(q, r) {
      if (!inHex(q, r, radius)) return -1;
      return starts[r + radius] + q - Math.max(-radius, -r - radius);
    },
  };
  cache.set(radius, idx);
  return idx;
}

/** Convenience helper: tile index of `(q, r)` on a planet of `radius`, or `-1` outside the planet. */
export const indexOf = (radius: number, q: number, r: number): number => hexIndex(radius).indexOf(q, r);

/** Axial (q, r) → planar centre in tile units with pointy-top hexes of circumradius 1/√3 (unit spacing). */
export function axialToPlane(q: number, r: number): [number, number] {
  return [q + r / 2, (r * Math.sqrt(3)) / 2];
}

/** Planar point (tile units) → fractional axial, then rounded to the nearest hex. */
export function planeToAxial(x: number, y: number): [number, number] {
  const r = (2 * y) / Math.sqrt(3);
  const q = x - r / 2;
  return hexRound(q, r);
}

export function hexRound(q: number, r: number): [number, number] {
  const s = -q - r;
  let rq = Math.round(q), rr = Math.round(r);
  const rs = Math.round(s);
  const dq = Math.abs(rq - q), dr = Math.abs(rr - r), ds = Math.abs(rs - s);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  return [rq + 0, rr + 0];
}

/** Sub-0.15 m noise on flat ground renders perfectly level; from 0.35 m up the sim height is used as is (no step). */
export function levelledFlatHeight(raw: number): number {
  const a = Math.abs(raw);
  const t = Math.min(1, Math.max(0, (a - 0.15) / 0.2));
  return raw * t * t * (3 - 2 * t);
}

/**
 * Whether a Flat tile (`terrain === 0`) sits on a sloped ramp or cliff edge rather than a level plateau, so its
 * hexagon is not drawn, buildings cannot be placed on it (`uneven`), and ground units do not walk onto it.
 */
export function isTileUneven(
  radius: number,
  tileIdx: number,
  terrain: ArrayLike<number>,
  height?: ArrayLike<number> | null,
): boolean {
  if (!height || terrain[tileIdx] !== 0) return false;
  const raw0 = height[tileIdx] ?? 0;
  const h0 = levelledFlatHeight(raw0);
  const hx = hexIndex(radius);
  const q = hx.q[tileIdx]!, r = hx.r[tileIdx]!;
  let flatPeers = 0;
  let levelPeers = 0;
  let firstPeer = -1;
  let maxFlatStep = 0;
  for (const [dq, dr] of HEX_DIRS) {
    const j = hx.indexOf(q + dq, r + dr);
    if (j < 0 || terrain[j] !== 0) continue;
    flatPeers++;
    const rawJ = height[j] ?? 0;
    const df = Math.abs(levelledFlatHeight(rawJ) - h0);
    if (df > maxFlatStep) maxFlatStep = df;
    if (Math.abs(rawJ - raw0) < 1e-3) {
      levelPeers++;
      if (firstPeer < 0) firstPeer = j;
    }
  }
  if (Math.abs(h0) <= 0.01) return flatPeers > 0 && levelPeers === 0 && maxFlatStep > 0.05;
  if (levelPeers >= 2) return false;
  if (levelPeers === 1) {
    const pq = hx.q[firstPeer]!, pr = hx.r[firstPeer]!;
    for (const [dq, dr] of HEX_DIRS) {
      const k = hx.indexOf(pq + dq, pr + dr);
      if (k >= 0 && k !== tileIdx && terrain[k] === 0 && Math.abs((height[k] ?? 0) - raw0) < 1e-3) {
        return false;
      }
    }
  }
  return true;
}

/** FNV-1a 32-bit unsigned string hash over UTF-16 code units (engine-wide canonical string hash). */
export function fnv1a32(s: string, h = 0x811c9dc5): number {
  let out = h >>> 0;
  for (let i = 0; i < s.length; i++) {
    out = Math.imul(out ^ s.charCodeAt(i), 0x01000193) >>> 0;
  }
  return out >>> 0;
}

/**
 * Deterministic 32-bit unsigned seed derived from any numeric or string planet seed.
 * Numeric inputs are normalized idempotently (`hashGroundSeed(hashGroundSeed(s)) === hashGroundSeed(s)`),
 * while string seeds are hashed via FNV-1a + Murmur3 `fmix32` avalanche so every player joining a planet
 * computes the exact same non-zero `u32` seed across JS engines.
 */
export function hashGroundSeed(seed: string | number | null | undefined, fallback = 17): number {
  const fb = (Math.trunc(fallback) >>> 0) || 17;
  if (seed === null || seed === undefined || seed === '') return fb;
  if (typeof seed === 'number') {
    if (!Number.isFinite(seed)) return fb;
    return (Math.trunc(seed) >>> 0) || fb;
  }
  let h = fnv1a32(seed);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h || fb;
}

/**
 * Parses an optional URL/config seed parameter (`?seed=<number|hash>`).
 * Returns `undefined` when absent/blank; preserves positive integer literals (`"42"` -> `42`) for numeric
 * seed compatibility, and hashes string hashes or `"0"` deterministically via `hashGroundSeed`.
 */
export function parseGroundSeedInput(
  raw: string | number | null | undefined,
  fallback = 17,
): number | undefined {
  if (raw === null || raw === undefined) return undefined;
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? hashGroundSeed(raw, fallback) : undefined;
  }
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  if (/^[+-]?\d+$/.test(trimmed)) {
    const n = Number(trimmed);
    if (Number.isSafeInteger(n)) {
      const u = Math.trunc(n) >>> 0;
      if (u !== 0) return u;
    }
  }
  return hashGroundSeed(trimmed, fallback);
}

/**
 * Combines a planet `seed` with a stream/feature `salt` into an independent 32-bit stream seed.
 * When `seed === 0`, returns `salt >>> 0` so unseeded unit-test calls remain deterministic.
 */
export function mixGroundSeed(seed: number, salt: number): number {
  const s = seed >>> 0;
  const k = salt >>> 0;
  if (s === 0) return k;
  let h = (s ^ Math.imul(k + 0x9e3779b9, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/** Pure 32-bit integer lattice hash in `[0, 2^32)`. Shared by `@terra/sim` worldgen and `@terra/render` hex scatter. */
export function latticeHashU32(ix: number, iy: number, seed = 0): number {
  let h = (seed ^ Math.imul(ix, 0x9e3779b1) ^ Math.imul(iy, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/** Pure 32-bit integer lattice hash in `[0, 1)`. */
export function latticeHash01(ix: number, iy: number, seed = 0): number {
  return latticeHashU32(ix, iy, seed) / 4294967296;
}

/** Smoothstep 2D value noise in `[0, 1)`, evaluated with `Math.fround` for cross-engine parity. */
export function valueNoise2d(x: number, y: number, scale: number, seed: number): number {
  const sx = x * scale;
  const sy = y * scale;
  const x0 = Math.floor(sx);
  const y0 = Math.floor(sy);
  const fx = sx - x0;
  const fy = sy - y0;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const v00 = latticeHash01(x0, y0, seed);
  const v10 = latticeHash01(x0 + 1, y0, seed);
  const v01 = latticeHash01(x0, y0 + 1, seed);
  const v11 = latticeHash01(x0 + 1, y0 + 1, seed);
  const a = v00 + (v10 - v00) * ux;
  const b = v01 + (v11 - v01) * ux;
  return Math.fround(a + (b - a) * uy);
}

/** 3-octave fractal value noise in `[0, 1)`, evaluated with `Math.fround` for cross-engine parity. */
export function fbm2d(x: number, y: number, baseScale: number, seed: number): number {
  const o1 = valueNoise2d(x, y, baseScale, seed);
  const o2 = valueNoise2d(x + 17.3, y - 9.1, baseScale * 2, (seed + 0x9e3779b9) >>> 0);
  const o3 = valueNoise2d(x - 31.7, y + 23.5, baseScale * 4, (seed + 0x3c6ef372) >>> 0);
  return Math.fround(o1 * 0.57 + o2 * 0.29 + o3 * 0.14);
}




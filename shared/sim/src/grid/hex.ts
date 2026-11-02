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



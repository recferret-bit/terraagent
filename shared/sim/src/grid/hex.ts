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

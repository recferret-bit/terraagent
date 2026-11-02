/**
 * Deterministic noise for world generation (pure functions of coordinates + a 32-bit seed, `Math.fround` so every
 * host gets the same bits). Coordinates are in tile-plane units unless a caller scales them.
 */
/** Pure 32-bit integer lattice hash in [0, 1). */
export function hash2d(ix: number, iy: number, seed: number): number {
  let h = (seed ^ Math.imul(ix, 0x9e3779b1) ^ Math.imul(iy, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smoothstep 2D value noise in [0, 1). */
export function valueNoise2d(x: number, y: number, scale: number, seed: number): number {
  const sx = x * scale;
  const sy = y * scale;
  const x0 = Math.floor(sx);
  const y0 = Math.floor(sy);
  const fx = sx - x0;
  const fy = sy - y0;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const v00 = hash2d(x0, y0, seed);
  const v10 = hash2d(x0 + 1, y0, seed);
  const v01 = hash2d(x0, y0 + 1, seed);
  const v11 = hash2d(x0 + 1, y0 + 1, seed);
  const a = v00 + (v10 - v00) * ux;
  const b = v01 + (v11 - v01) * ux;
  return Math.fround(a + (b - a) * uy);
}

/** 3-octave fractal value noise in [0, 1). */
export function fbm2d(x: number, y: number, baseScale: number, seed: number): number {
  const o1 = valueNoise2d(x, y, baseScale, seed);
  const o2 = valueNoise2d(x + 17.3, y - 9.1, baseScale * 2, (seed + 0x9e3779b9) >>> 0);
  const o3 = valueNoise2d(x - 31.7, y + 23.5, baseScale * 4, (seed + 0x3c6ef372) >>> 0);
  return Math.fround(o1 * 0.57 + o2 * 0.29 + o3 * 0.14);
}

/** Ridged noise in [0, 1): 1 on the crest line, falling off to both sides (mountain ranges, dune crests). */
export function ridged2d(x: number, y: number, scale: number, seed: number): number {
  const n = fbm2d(x, y, scale, seed);
  return Math.fround(1 - Math.abs(2 * n - 1));
}

export const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** 32-bit seed from a string label (FNV-1a), for per-stage / per-sector streams that do not consume the planet rng. */
export function seedOf(label: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < label.length; i++) h = Math.imul(h ^ label.charCodeAt(i), 0x01000193) >>> 0;
  return h >>> 0;
}

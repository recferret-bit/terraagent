/**
 * Deterministic noise for world generation (pure functions of coordinates + a 32-bit seed, `Math.fround` so every
 * host gets the same bits). Coordinates are in tile-plane units unless a caller scales them.
 */
import { fbm2d, fnv1a32, latticeHash01, valueNoise2d } from '../../grid/hex';

export { fbm2d, latticeHash01 as hash2d, valueNoise2d };

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
export const seedOf = (label: string): number => fnv1a32(label);

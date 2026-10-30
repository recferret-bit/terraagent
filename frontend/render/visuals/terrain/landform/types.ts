import type { Noise2 } from '../noise';

export type LandformKind = 'mesa' | 'butte' | 'spires' | 'ridge' | 'dome';

export interface LandformSample { h: number; rock: number }
export interface Landform {
  kind: LandformKind;
  x: number; z: number;
  /** Max influence radius (m). */
  radius: number;
  /** Writes height (m, absolute) + bedrock mask into `out`; returns false when (x, z) is outside the footprint. */
  sample(x: number, z: number, out: LandformSample): boolean;
}

/** Per-instance inputs handed to an archetype builder: seeded RNG, noise phase, local frame and erosion warp. */
export interface LandformCtx {
  kind: LandformKind; x: number; z: number; scale: number; n: Noise2;
  R: () => number;
  /** Noise phase → unique erosion pattern per instance. */
  ph: number;
  local(px: number, pz: number): readonly [number, number];
  erosion(px: number, pz: number, amp: number): number;
}

export type LandformBuilder = (c: LandformCtx) => Landform;

export const rand = (seed: number) => {
  let a = (seed * 2654435761) >>> 0;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
};
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Polynomial smooth-min (union of distance fields with a soft seam of width k). */
export const smin = (a: number, b: number, k: number) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };
/** Polynomial smooth-max. */
export const smax = (a: number, b: number, k: number) => -smin(-a, -b, k);

export interface Lobe { ox: number; oz: number; r: number; ax: number; rot: number }

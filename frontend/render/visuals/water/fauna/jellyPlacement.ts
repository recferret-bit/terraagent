import { mulberry32 } from '../../terrain/noise';
import { SHORE_DIST_MAX, type ShoreField } from '../shoreField';
import { WATER_RANGES } from '../waterConfig';
import { BED_CLEARANCE, FAUNA_SINK_MAX, SHORE_CLEARANCE, candidateTexels, lerp, shallowestBed } from './faunaPlacement';

/**
 * Deterministic jellyfish placement (pure; no three.js): a few slow drifters in DEEP water only. Each drifts on a
 * small closed loop (`jellyPathPoint` mirrors the vertex shader); its whole body (bell + tentacles, at the deepest
 * wave sink) stays `BED_CLEARANCE` above the bed and its loop `SHORE_CLEARANCE` off dry ground.
 */

export const JELLY_CAP = 24;
/** Tentacle length below the rim (m at scale 1); `jellyGeometry.ts` builds to it. */
export const JELLY_TENTACLE_LEN = 0.36;
/** Jellies per square metre of water at density 1. */
export const JELLY_PER_M2 = 0.004;
/** Drift loop radius (m), drift speed (m/s), bell scale, depth (m below the water level). */
const RADIUS: readonly [number, number] = [0.4, 1.4];
const SPEED: readonly [number, number] = [0.04, 0.1];
const SCALE: readonly [number, number] = [0.7, 1.35];
const DEPTH: readonly [number, number] = [0.3, 0.8];
/** Deep water only: the shallowest bed under the loop must be at least this deep (m). */
const MIN_BED = 1.1;
/** Vertical pulse bob (m at scale 1); the material uses the same value. */
export const JELLY_BOB = 0.05;
/** Bell pulse period (s at scale 1). */
export const JELLY_PULSE_S = 2.4;
const MAX_TRIES = 300;

export interface JellyBuffers {
  /** 4 / instance: centre x, centre z, loop radius, signed angular speed (rad / s). */
  readonly drift: Float32Array;
  /** 4 / instance: phase 0..1, depth (m below the water level), bell scale, hue 0..2. */
  readonly jelly: Float32Array;
}

export const createJellyBuffers = (cap = JELLY_CAP): JellyBuffers => ({
  drift: new Float32Array(cap * 4), jelly: new Float32Array(cap * 4),
});

/** Jellies to draw at `density` out of `placed` (placed for the maximum density). */
export const visibleJellyCount = (placed: number, density: number): number =>
  Math.min(placed, Math.round((placed * Math.max(0, density)) / WATER_RANGES.faunaDensity[1]));

/** Writes up to `cap` jellies into `out`; returns how many were placed. Same field + seed => same layout. */
export function layoutJellies(f: ShoreField, seed: number, out: JellyBuffers, cap = JELLY_CAP): number {
  const waterArea = f.waterTexels * f.texel * f.texel;
  const budget = Math.min(cap, Math.round(waterArea * JELLY_PER_M2 * WATER_RANGES.faunaDensity[1]));
  if (budget === 0) return 0;
  const cand = candidateTexels(f, RADIUS[0] + SHORE_CLEARANCE);
  if (cand.length === 0) return 0;
  const rnd = mulberry32((seed ^ 0x7e11f) >>> 0);
  let placed = 0;
  for (let tries = 0; tries < MAX_TRIES && placed < budget; tries++) {
    const k = cand[Math.floor(rnd() * cand.length)]!;
    const cx = ((k % f.res) + 0.5) * f.texel - f.span / 2, cz = (Math.floor(k / f.res) + 0.5) * f.texel - f.span / 2;
    const radius = lerp(RADIUS, rnd());
    const scale = lerp(SCALE, rnd());
    const reach = radius + 0.2 * scale + f.texel;
    if (reach + SHORE_CLEARANCE >= SHORE_DIST_MAX || f.dist[k]! < reach + SHORE_CLEARANCE) continue;
    const bedDepth = -shallowestBed(f, cx, cz, reach);
    if (bedDepth < MIN_BED) continue;
    const body = (JELLY_TENTACLE_LEN + 0.05) * scale + JELLY_BOB * scale; // rim to tentacle tip + pulse bob
    const hi = Math.min(DEPTH[1], bedDepth - BED_CLEARANCE - FAUNA_SINK_MAX - body);
    if (hi < DEPTH[0]) continue;
    const omega = (lerp(SPEED, rnd()) / radius) * (rnd() < 0.5 ? -1 : 1);
    out.drift.set([cx, cz, radius, omega], placed * 4);
    out.jelly.set([rnd(), lerp([DEPTH[0], hi], rnd()), scale, Math.floor(rnd() * 3)], placed * 4);
    placed++;
  }
  return placed;
}

/** TS mirror of the vertex shader's bell rim centre at time `t` and wave sink `sink` (world x, y, z). */
export function jellyPathPoint(b: JellyBuffers, i: number, t: number, sink = 0): [number, number, number] {
  const [cx, cz, r, omega] = b.drift.subarray(i * 4, i * 4 + 4) as unknown as [number, number, number, number];
  const [phase, depth, scale] = b.jelly.subarray(i * 4, i * 4 + 3) as unknown as [number, number, number];
  const th = phase * Math.PI * 2 + omega * t;
  const pulse = (phase * 2 + t / (JELLY_PULSE_S * scale)) * Math.PI * 2;
  const y = -depth - sink + JELLY_BOB * scale * Math.sin(pulse - 1.2);
  return [cx + r * Math.cos(th), y, cz + r * Math.sin(th)];
}

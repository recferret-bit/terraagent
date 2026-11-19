import { mulberry32 } from '../../terrain/noise';
import { SHORE_DIST_MAX, sampleField, type ShoreField } from '../shoreField';
import { WATER_RANGES } from '../waterConfig';
import { WAVE_VERT_PEAK } from '../waveModel';

/**
 * Deterministic aquatic fauna placement from the baked shore field (pure; no three.js).
 * Supports 4 distinct swimming species in one instanced buffer layout:
 *  - `SPECIES_SCHOOL` (0): mid-water pelagic schooling fish (5..9 per school)
 *  - `SPECIES_SOLITARY` (1): larger solitary cruiser fish (salmon / reef grouper)
 *  - `SPECIES_MINNOW` (2): bright shallow-water darting shoals (5..9 per shoal, thrives in shallow coastal/lake beds)
 *  - `SPECIES_RAY` (3): wide diamond-winged gliding manta / river rays (1..2 per loop, undulating pectoral wings)
 */

export const FAUNA_CAP = 128;
/** Fish per square metre of water at density 1. */
export const FISH_PER_M2 = 0.08;
export const SPECIES_SCHOOL = 0;
export const SPECIES_SOLITARY = 1;
export const SPECIES_MINNOW = 2;
export const SPECIES_RAY = 3;
/** Radial loop wobble, as a fraction of the loop radius (`rho = R * (1 + W sin(2θ + φ))`). */
export const PATH_WOBBLE = 0.22;
export const SHORE_CLEARANCE = 1.2;
/** Swim depth below the water level (m) and the minimum gap between the fish's belly and the bed. */
export const SWIM_DEPTH: readonly [number, number] = [0.25, 0.9];
export const BED_CLEARANCE = 0.15;
/**
 * Fauna swims deeper as the waves grow (`faunaSink.ts`): sink = deepest swell trough × margin, at most this much.
 * Shallow shoals attenuate sink smoothly so they stay clear of shallow (-0.55 m) beds.
 */
export const FAUNA_SINK_MARGIN = 1.25;
export const FAUNA_SINK_MAX = WAVE_VERT_PEAK * FAUNA_SINK_MARGIN;
/** Dart clock: every `DART_PERIOD` s the fish gains `DART_GAIN` s of path in the last `1 - DART_START` of the period. */
export const DART_PERIOD = 6.5;
export const DART_GAIN = 1.6;
export const DART_START = 0.78;
/** Vertical bob amplitude (m) and the school members' vertical spread (m). */
export const BOB_AMP = 0.03;
const SCHOOL_DY = 0.07;
const MINNOW_DY = 0.022;

export interface FaunaBuffers {
  /** 4 / instance: centre x, centre z, loop radius, signed angular speed (rad / s). */
  readonly swim: Float32Array;
  /** 4 / instance: phase 0..1, swim depth (m below the water level), body length (m), species (0..3). */
  readonly fish: Float32Array;
  /** 4 / instance: school frame offset along, side, dy (m), wiggle phase 0..1. */
  readonly offset: Float32Array;
}

export interface FaunaLayout {
  /** Instances written (sized for the maximum density). */
  placed: number;
  /** Cumulative instance count after each group (school, shoal, ray pair, or solitary), in draw order. */
  groupEnds: number[];
  /** Water surface area (m²). */
  waterArea: number;
}

export const createFaunaBuffers = (cap = FAUNA_CAP): FaunaBuffers => ({
  swim: new Float32Array(cap * 4), fish: new Float32Array(cap * 4), offset: new Float32Array(cap * 4),
});

/** Scales planet-wide aquatic fauna cap for large hex planets while keeping `FAUNA_CAP` for unit-sized test lakes. */
export function planetFishCap(span: number): number {
  if (span <= 80) return FAUNA_CAP;
  return Math.min(2400, Math.max(FAUNA_CAP, Math.round((span / 64) ** 1.65 * FAUNA_CAP)));
}

/** Depth-attenuated wave sink (shallow minnows hug the upper layer without hitting shallow beds). */
export function effectiveWaveSink(depth: number, sink: number): number {
  const t = Math.min(1, Math.max(0, (depth - 0.14) / 0.22));
  return sink * (t * t * (3 - 2 * t));
}

/** Fish wanted for a water area at `density` (before rounding to whole groups). */
export const targetFishCount = (waterArea: number, density: number, cap = FAUNA_CAP): number =>
  Math.min(cap, Math.round(waterArea * FISH_PER_M2 * Math.max(0, density)));

/** Instances to draw at `density`: whole groups in placement order whose midpoint fits the target. */
export function visibleFishCount(layout: FaunaLayout, density: number, cap = FAUNA_CAP): number {
  const target = targetFishCount(layout.waterArea, density, cap);
  let count = 0, start = 0;
  for (const end of layout.groupEnds) {
    if ((start + end) / 2 >= target) break;
    count = end; start = end;
  }
  return count;
}

interface Species {
  radius: [number, number];
  members: [number, number];
  length: [number, number];
  speed: [number, number];
  spread: number;
  dy: number;
  minDepth: number;
  maxDepth: number;
  minBed: number;
  widthMul: number;
}

const SPECIES: Record<number, Species> = {
  [SPECIES_SCHOOL]: { radius: [0.72, 1.95], members: [5, 9], length: [0.42, 0.64], speed: [0.38, 0.64], spread: 0.40, dy: SCHOOL_DY, minDepth: SWIM_DEPTH[0], maxDepth: SWIM_DEPTH[1], minBed: 0.65, widthMul: 0.5 },
  [SPECIES_SOLITARY]: { radius: [1.7, 3.5], members: [1, 1], length: [0.85, 1.22], speed: [0.24, 0.40], spread: 0, dy: 0, minDepth: 0.45, maxDepth: SWIM_DEPTH[1], minBed: 1.05, widthMul: 0.5 },
  [SPECIES_MINNOW]: { radius: [0.30, 0.66], members: [3, 7], length: [0.26, 0.40], speed: [0.48, 0.82], spread: 0.14, dy: MINNOW_DY, minDepth: 0.16, maxDepth: 0.24, minBed: 0.29, widthMul: 0.5 },
  [SPECIES_RAY]: { radius: [1.4, 3.1], members: [1, 2], length: [0.90, 1.32], speed: [0.20, 0.34], spread: 0.50, dy: 0.03, minDepth: 0.38, maxDepth: 0.85, minBed: 0.96, widthMul: 0.66 },
};

function pickSpeciesKind(u: number, bedHint: number, shoreDist: number): number {
  if (bedHint < 0.68) return u < 0.72 ? SPECIES_MINNOW : -1;
  if (shoreDist < 3.4) return shoreDist >= 2.8 && u > 0.65 ? SPECIES_SCHOOL : SPECIES_MINNOW;
  if (u < 0.25) return SPECIES_SOLITARY;
  if (u < 0.45) return SPECIES_RAY;
  if (u < 0.64) return SPECIES_MINNOW;
  return SPECIES_SCHOOL;
}

/** Shallowest bed (m, the field's R) over the disk of radius `reach` around (cx, cz), sampled on 3 rings. */
export function shallowestBed(f: ShoreField, cx: number, cz: number, reach: number): number {
  let top = sampleField(f, f.bed, cx, cz, 0);
  for (const [frac, n] of [[0.5, 8], [0.8, 12], [1, 16]] as const) {
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      top = Math.max(top, sampleField(f, f.bed, cx + Math.cos(a) * reach * frac, cz + Math.sin(a) * reach * frac, 0));
    }
  }
  return top;
}

function ringInWater(f: ShoreField, cx: number, cz: number, reach: number, minDist: number): boolean {
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    const x = cx + Math.cos(a) * reach;
    const z = cz + Math.sin(a) * reach;
    if (sampleField(f, f.mask, x, z, 0) < 0.5) return false;
    if (sampleField(f, f.dist, x, z, 0) < minDist) return false;
  }
  return true;
}

/** Collects the texel centres far enough from the shore to host the smallest loop. */
export function candidateTexels(f: ShoreField, minDist: number): Int32Array {
  let n = 0;
  for (let k = 0; k < f.dist.length; k++) if (f.mask[k] && f.dist[k]! >= minDist) n++;
  const out = new Int32Array(n);
  n = 0;
  for (let k = 0; k < f.dist.length; k++) if (f.mask[k] && f.dist[k]! >= minDist) out[n++] = k;
  return out;
}

export const lerp = (r: readonly [number, number], t: number): number => r[0] + (r[1] - r[0]) * t;

/** Writes up to `cap` fish/rays (enough for the maximum F8 density) into `out`; same field + seed => same layout. */
export function layoutFauna(f: ShoreField, seed: number, out: FaunaBuffers, cap = FAUNA_CAP): FaunaLayout {
  const waterArea = f.waterTexels * f.texel * f.texel;
  const layout: FaunaLayout = { placed: 0, groupEnds: [], waterArea };
  const budget = targetFishCount(waterArea, WATER_RANGES.faunaDensity[1], cap);
  if (budget === 0) return layout;
  const minReach = SPECIES[SPECIES_MINNOW]!.radius[0] * (1 + PATH_WOBBLE);
  const cand = candidateTexels(f, minReach + SHORE_CLEARANCE);
  if (cand.length === 0) return layout;
  const rnd = mulberry32((seed ^ 0x51f15e) >>> 0);
  const maxTries = Math.max(800, budget * 12);
  const texPad = Math.min(f.texel * 0.85, 0.48);

  for (let tries = 0; tries < maxTries && layout.placed < budget; tries++) {
    const k = cand[Math.floor(rnd() * cand.length)]!;
    const cx = ((k % f.res) + 0.5) * f.texel - f.span / 2, cz = (Math.floor(k / f.res) + 0.5) * f.texel - f.span / 2;
    const centerBed = -f.bed[k]!;
    const shoreDist = f.dist[k]!;
    const kind = pickSpeciesKind(rnd(), centerBed, shoreDist);
    if (kind < 0) continue;
    const sp = SPECIES[kind]!;
    const radRoll = shoreDist < 3.5 ? rnd() * 0.45 : rnd();
    const radius = lerp(sp.radius, radRoll);
    const length = lerp(sp.length, rnd());
    const members = Math.min(budget - layout.placed, Math.round(lerp(sp.members, rnd())));
    if (members < sp.members[0]) continue;
    const effSpread = members === 1 ? 0 : sp.spread + length * (kind === SPECIES_MINNOW ? 0.24 : 0.42);
    const loopExcursion = radius * (1 + PATH_WOBBLE) + effSpread * Math.SQRT2;
    const reach = loopExcursion + length * sp.widthMul + texPad;
    if (reach + SHORE_CLEARANCE >= SHORE_DIST_MAX || shoreDist < reach + SHORE_CLEARANCE) continue;
    if (!ringInWater(f, cx, cz, loopExcursion, Math.max(0.2, SHORE_CLEARANCE + length * 0.5 - f.texel * 0.7))) continue;
    const bedDepth = -shallowestBed(f, cx, cz, reach);
    if (bedDepth < sp.minBed) continue;

    const lo = sp.minDepth;
    const maxSinkAtLo = effectiveWaveSink(lo, FAUNA_SINK_MAX);
    const hiCap = Math.min(sp.maxDepth, bedDepth - BED_CLEARANCE - maxSinkAtLo - sp.dy - BOB_AMP - length * 0.16);
    if (hiCap < lo) continue;
    const rawDepth = lerp([lo, hiCap], rnd());
    const effSink = effectiveWaveSink(rawDepth, FAUNA_SINK_MAX);
    if (bedDepth - rawDepth - effSink - sp.dy - BOB_AMP - length * 0.16 < BED_CLEARANCE) continue;

    const omega = (lerp(sp.speed, rnd()) / radius) * (rnd() < 0.5 ? -1 : 1);
    const phase = rnd();
    for (let m = 0; m < members; m++) {
      const i = layout.placed++;
      out.swim.set([cx, cz, radius, omega], i * 4);
      const l = length * (0.9 + 0.2 * rnd());
      out.fish.set([phase, rawDepth, l, kind], i * 4);
      const solo = members === 1;
      out.offset.set(
        solo ? [0, 0, 0, rnd()] : [(rnd() * 2 - 1) * effSpread, (rnd() * 2 - 1) * effSpread, (rnd() * 2 - 1) * sp.dy, rnd()],
        i * 4,
      );
    }
    layout.groupEnds.push(layout.placed);
  }
  return layout;
}

/** Swim clock (s): real time plus the integrated darts (monotonic, so the path never reverses). */
export function fishClock(t: number, phase: number): number {
  const u = t / DART_PERIOD + phase * 3.7;
  const x = Math.min(1, Math.max(0, ((u - Math.floor(u)) - DART_START) / (1 - DART_START)));
  return t + DART_GAIN * (Math.floor(u) + x * x * (3 - 2 * x));
}

const loop = (cx: number, cz: number, r: number, phase: number, th: number): [number, number] => {
  const rho = r * (1 + PATH_WOBBLE * Math.sin(2 * th + phase * 11));
  return [cx + rho * Math.cos(th), cz + rho * Math.sin(th)];
};

/** TS mirror of the vertex shader's fish/ray centre at time `t` and wave sink `sink` (world x, y, z); `i` indexes the buffers. */
export function fishPathPoint(b: FaunaBuffers, i: number, t: number, sink = 0): [number, number, number] {
  const [cx, cz, r, omega] = b.swim.subarray(i * 4, i * 4 + 4) as unknown as [number, number, number, number];
  const [phase, depth] = b.fish.subarray(i * 4, i * 4 + 2) as unknown as [number, number];
  const [along, side, dy] = b.offset.subarray(i * 4, i * 4 + 3) as unknown as [number, number, number];
  const th = phase * Math.PI * 2 + omega * fishClock(t, phase);
  const dir = omega < 0 ? -1 : 1;
  const p0 = loop(cx, cz, r, phase, th), p1 = loop(cx, cz, r, phase, th + 0.05 * dir);
  const fl = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) || 1;
  const fx = (p1[0] - p0[0]) / fl, fz = (p1[1] - p0[1]) / fl;
  const effSink = effectiveWaveSink(depth, sink);
  const y = -depth - effSink + dy + BOB_AMP * Math.sin(t * 1.1 + phase * 17);
  return [p0[0] + fx * along - fz * side, y, p0[1] + fz * along + fx * side];
}

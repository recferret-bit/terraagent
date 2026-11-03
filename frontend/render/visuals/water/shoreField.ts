import * as THREE from 'three';

/**
 * Baked shore-distance field for the hex planet water (contract: `Liquids.ts` `Common.shoreField`).
 *
 * One RGBA HalfFloat texel per `span / res` metres over the planet (uv = worldXZ / span + 0.5):
 *   R = bed height (m, water level 0): deep / shallow tile targets, softened between tiles and sloping up to
 *       `BED_EDGE` at the water's edge, so depth -> 0 at the shore;
 *   G = Euclidean distance to the nearest dry ground (m), 0 at the shore, clamped at `SHORE_DIST_MAX`;
 *   B = water mask 0 / 1;  A = 0.
 * The core (`bakeShoreField`) is pure so the specs run without WebGL; the fauna reads the same CPU arrays.
 */

/** Water code of a world point: 0 = dry (or off the planet), 1 = shallow, 2 = deep. */
export type WaterCodeAt = (x: number, z: number) => number;

export const SHORE_FIELD_RES = 512;
export const SHORE_DIST_MAX = 12;
export const BED_DRY = 0.05;
export const BED_SHALLOW = -0.55;
export const BED_DEEP = -1.6;
/** Bed height right at the water's edge (just under the pinned shore surface). */
export const BED_EDGE = -0.12;
/** Distance from the shore over which the bed slopes from `BED_EDGE` down to the tile depth. */
export const BED_SLOPE_M = 3;
/** Box-blur radius (m) that softens the shallow / deep step between neighbouring water tiles. */
const BED_BLUR_M = 1.5;

export interface ShoreField {
  readonly res: number;
  readonly span: number;
  /** Texel size in metres. */
  readonly texel: number;
  /** Row-major (row j = z), `res * res`. */
  readonly bed: Float32Array;
  readonly dist: Float32Array;
  readonly mask: Uint8Array;
  waterTexels: number;
}

const INF = 1e20;

/** World coordinate of texel centre `i` (same mapping as the shader's `uv = p / span + 0.5`). */
export const texelCentre = (i: number, res: number, span: number): number => (i + 0.5) * (span / res) - span / 2;

/** Bilinear-free lookup (nearest texel) of a field array at world `(x, z)`; outside the span -> `outside`. */
export function sampleField(f: ShoreField, arr: ArrayLike<number>, x: number, z: number, outside = 0): number {
  const i = Math.floor((x / f.span + 0.5) * f.res), j = Math.floor((z / f.span + 0.5) * f.res);
  if (i < 0 || j < 0 || i >= f.res || j >= f.res) return outside;
  return arr[j * f.res + i]!;
}

/**
 * Felzenszwalb–Huttenlocher 1-D squared distance transform of `f` (length `n`, stride `stride` from `off`),
 * written back in place. `v`, `z`, `tmp` are scratch buffers of length >= n (+1 for `z`).
 */
function edt1d(f: Float32Array, off: number, stride: number, n: number, v: Int32Array, z: Float32Array, tmp: Float32Array): void {
  for (let q = 0; q < n; q++) tmp[q] = f[off + q * stride]!;
  let k = 0;
  v[0] = 0; z[0] = -INF; z[1] = INF;
  for (let q = 1; q < n; q++) {
    const fq = tmp[q]! + q * q;
    let s = (fq - (tmp[v[k]!]! + v[k]! * v[k]!)) / (2 * (q - v[k]!));
    while (s <= z[k]!) {
      k--;
      s = (fq - (tmp[v[k]!]! + v[k]! * v[k]!)) / (2 * (q - v[k]!));
    }
    k++;
    v[k] = q; z[k] = s; z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1]! < q) k++;
    const d = q - v[k]!;
    f[off + q * stride] = d * d + tmp[v[k]!]!;
  }
}

/** Exact squared Euclidean distance (texels²) from every texel to the nearest seed (`d2` = 0 seeds, INF others), in place. */
export function squaredEdt(d2: Float32Array, res: number): void {
  const v = new Int32Array(res), z = new Float32Array(res + 1), tmp = new Float32Array(res);
  for (let j = 0; j < res; j++) edt1d(d2, j * res, 1, res, v, z, tmp);
  for (let i = 0; i < res; i++) edt1d(d2, i, res, res, v, z, tmp);
}

/** Separable running-sum box blur of `src` (radius `r` texels, clamped edges) into `src`; `tmp` is scratch. */
function boxBlur(src: Float32Array, tmp: Float32Array, res: number, r: number): void {
  const norm = 1 / (2 * r + 1), last = res - 1;
  const pass = (from: Float32Array, to: Float32Array, step: number, lineStep: number) => {
    for (let line = 0; line < res; line++) {
      const base = line * lineStep;
      let acc = 0;
      for (let q = -r; q <= r; q++) acc += from[base + (q < 0 ? 0 : q > last ? last : q) * step]!;
      for (let q = 0; q < res; q++) {
        to[base + q * step] = acc * norm;
        const add = q + r + 1, sub = q - r;
        acc += from[base + (add > last ? last : add) * step]! - from[base + (sub < 0 ? 0 : sub) * step]!;
      }
    }
  };
  pass(src, tmp, 1, res);
  pass(tmp, src, res, 1);
}

const smooth01 = (t: number) => { const x = Math.min(1, Math.max(0, t)); return x * x * (3 - 2 * x); };

/** Allocates a field whose arrays are reused by every `bakeShoreField(…, into)` call. */
export function createShoreField(span: number, res = SHORE_FIELD_RES): ShoreField {
  const n = res * res;
  return { res, span, texel: span / res, bed: new Float32Array(n), dist: new Float32Array(n), mask: new Uint8Array(n), waterTexels: 0 };
}

/** Rasterises `codeAt` at texel centres and fills `into` (mask, exact shore distance, sloped bed). */
export function bakeShoreField(codeAt: WaterCodeAt, into: ShoreField): ShoreField {
  const { res, span, texel, bed, dist, mask } = into;
  let water = 0;
  for (let j = 0; j < res; j++) {
    const z = texelCentre(j, res, span);
    for (let i = 0; i < res; i++) {
      const k = j * res + i, code = codeAt(texelCentre(i, res, span), z);
      mask[k] = code > 0 ? 1 : 0;
      dist[k] = code > 0 ? INF : 0;
      bed[k] = code === 2 ? BED_DEEP : BED_SHALLOW; // dry texels blur in as shallow: the shore slope owns the edge
      water += mask[k]!;
    }
  }
  into.waterTexels = water;
  if (water === 0) {
    bed.fill(BED_DRY);
    return into;
  }
  if (water < res * res) squaredEdt(dist, res);
  const blurR = Math.max(1, Math.round(BED_BLUR_M / texel));
  boxBlur(bed, new Float32Array(res * res), res, blurR);
  for (let k = 0; k < res * res; k++) {
    if (!mask[k]) { bed[k] = BED_DRY; continue; }
    // Distance from the texel centre to the nearest dry texel centre, minus half a texel: ~ distance to the edge.
    const d = water === res * res ? SHORE_DIST_MAX : Math.min(SHORE_DIST_MAX, Math.max(0, Math.sqrt(dist[k]!) - 0.5) * texel);
    dist[k] = d;
    bed[k] = BED_EDGE + (bed[k]! - BED_EDGE) * smooth01(d / BED_SLOPE_M);
  }
  return into;
}

/** RGBA HalfFloat texture over the field's span (filled by `writeShoreFieldTexture`). */
export function createShoreFieldTexture(res = SHORE_FIELD_RES): THREE.DataTexture {
  const tex = new THREE.DataTexture(new Uint16Array(res * res * 4), res, res, THREE.RGBAFormat, THREE.HalfFloatType);
  tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  return tex;
}

/** Packs the field into `tex` (same resolution) and flags it for upload. */
export function writeShoreFieldTexture(tex: THREE.DataTexture, f: ShoreField): void {
  const data = tex.image.data as Uint16Array;
  const h = THREE.DataUtils.toHalfFloat;
  const zero = h(0), one = h(1);
  for (let k = 0; k < f.res * f.res; k++) {
    data[k * 4] = h(f.bed[k]!);
    data[k * 4 + 1] = h(f.dist[k]!);
    data[k * 4 + 2] = f.mask[k] ? one : zero;
    data[k * 4 + 3] = zero;
  }
  tex.needsUpdate = true;
}

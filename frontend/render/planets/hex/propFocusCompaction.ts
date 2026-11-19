import * as THREE from 'three';
import {
  getViewFocus,
  getViewFocusEdgesUniform,
  isViewFocusEnabled,
  VIEW_FOCUS_MAX_RADIUS,
  viewFocusQuadDistance,
  type ViewFocus,
} from '../../core/viewFocus';

/**
 * Per-instance view-focus culling for the bucketed prop meshes (`propBuckets.ts`). A bucket whose bounds touch the
 * view focus used to draw ALL its instances (a 32 m pine cell vs a 22 m focus when zoomed in: ~70 % of the drawn
 * trees were outside the camera + margin, in the colour pass and in both shadow passes). Now each straddling bucket
 * reorders its instance buffers so that:
 *
 *  - `[0, nMain)`: instances touching the focus → drawn in the colour pass (`count = nMain`);
 *  - `[nMain, nShadow)`: instances outside the focus whose shadow (along the shadow light, clamped) can reach it →
 *    drawn only in the shadow-map passes (`onBeforeShadow` raises `count`, `onAfterShadow` lowers it again);
 *  - the rest: not drawn at all.
 *
 * The bucket's bounding sphere/box stay the full set's (frustum culling never sees a shrunken bucket), the order is
 * only rewritten when the focus left the circle it was classified for (plus a slack) or the light turned, and only the
 * live prefix of the buffers is uploaded. Picking maps a drawn instance id back through `placedIndex`.
 */

/** Extra radius (m, plus a share of the focus radius) a classification covers, so small pans do not rewrite buffers. */
const SLACK_MIN_M = 2;
const SLACK_FRAC = 0.08;
/** Longest shadow (m) a prop may cast into the focus (a 4 m pine at ~4° sun elevation). */
export const PROP_SHADOW_REACH_MAX = 60;
/** Re-classify when a shadow light turned by more than this (cos of ~1.5°). */
const LIGHT_COS_EPS = Math.cos((1.5 * Math.PI) / 180);

let enabled = true;
/** A/B switch (dev): off → every bucket draws all its instances again (bucket-level focus culling stays). */
export function setPropInstanceCulling(on: boolean): void { enabled = on; }
export const isPropInstanceCulling = (): boolean => enabled;

interface CompactState {
  readonly n: number;
  /** Original instance data, in build order. */
  readonly matrices: Float32Array;
  readonly colors: Float32Array | null;
  /** Per original instance: x, z (world), bounding radius, height of its top above its base. */
  readonly xzrh: Float32Array;
  /** Tallest instance (m): bounds the shadow reach of the whole bucket. */
  hMax: number;
  /** World translation (x, z) of the mesh `xzrh` was measured at (the terrain group moves for the space view). */
  wx: number; wz: number;
  /** Drawn slot → original index. */
  readonly order: Uint32Array;
  nMain: number;
  nShadow: number;
  /** Focus circle (+ slack) the current order is valid for; NaN = never classified. */
  cx: number; cz: number; cr: number;
  lightKey: number;
  isIdentity: boolean;
}

const states = new WeakMap<THREE.InstancedMesh, CompactState>();
/** Horizontal shadow offset per metre of height, per active directional shadow camera. */
const lightDirs = new Map<THREE.Camera, THREE.Vector3>();
const tmpDir = new THREE.Vector3();
let lightKey = 0;

/** Updates `lightDirs` from a single directional shadow camera (used by `onBeforeShadow`). */
function recordShadowLight(cam: THREE.Camera): boolean {
  if (!(cam as THREE.OrthographicCamera).isOrthographicCamera) return false;
  const e = cam.matrixWorld.elements;
  const d = tmpDir.set(-e[8]!, -e[9]!, -e[10]!).normalize(); // a camera looks down its -Z
  const prev = lightDirs.get(cam);
  if (prev && prev.dot(d) >= LIGHT_COS_EPS) return false;
  lightDirs.set(cam, d.clone()); // allocate only when the direction is new (this runs per bucket per shadow pass)
  lightKey++;
  return true;
}

/** Keeps only the currently active shadow cameras in `lightDirs`, evicting disabled daytime/night casters. */
export function syncActivePropShadowLights(
  activeLights: ReadonlyArray<{ readonly cam: THREE.Camera; readonly dir: Readonly<THREE.Vector3> }>,
): void {
  let changed = false;
  for (const cam of [...lightDirs.keys()]) {
    if (!activeLights.some((entry) => entry.cam === cam)) {
      lightDirs.delete(cam);
      changed = true;
    }
  }
  for (const { cam, dir } of activeLights) {
    if (!(cam as THREE.OrthographicCamera).isOrthographicCamera) continue;
    tmpDir.copy(dir).normalize();
    const prev = lightDirs.get(cam);
    if (!prev || prev.dot(tmpDir) < LIGHT_COS_EPS) {
      lightDirs.set(cam, tmpDir.clone());
      changed = true;
    }
  }
  if (changed) lightKey++;
}

const tmpM = new THREE.Matrix4();
const tmpV = new THREE.Vector3();
const tmpS = new THREE.Sphere();

/** (Re)measures every instance's world xz / radius / height from the build-order matrices. */
function measure(im: THREE.InstancedMesh, st: CompactState): void {
  const geo = im.geometry;
  if (!geo.boundingSphere) geo.computeBoundingSphere();
  if (!geo.boundingBox) geo.computeBoundingBox();
  const topY = geo.boundingBox!.max.y, botY = geo.boundingBox!.min.y;
  let hMax = 0;
  for (let i = 0; i < st.n; i++) {
    tmpM.fromArray(st.matrices, i * 16).premultiply(im.matrixWorld);
    tmpS.copy(geo.boundingSphere!).applyMatrix4(tmpM);
    const h = Math.max(0, (topY - botY) * tmpV.setFromMatrixColumn(tmpM, 1).length());
    st.xzrh.set([tmpS.center.x, tmpS.center.z, tmpS.radius, h], i * 4);
    hMax = Math.max(hMax, h);
  }
  st.hMax = hMax;
  st.wx = im.matrixWorld.elements[12]!;
  st.wz = im.matrixWorld.elements[14]!;
  st.cx = NaN; // re-classify
}

/**
 * Snapshot of a freshly built bucket (all instances in build order). Null when the mesh is not in that state, e.g.
 * after a hot reload of this module dropped the state of an already compacted mesh (the bucket rebuilds cleanly).
 */
function makeState(im: THREE.InstancedMesh): CompactState | null {
  const n = im.count;
  if (n !== (im.userData as { placed?: unknown[] }).placed?.length) return null;
  const order = new Uint32Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  const st: CompactState = {
    n, xzrh: new Float32Array(n * 4), hMax: 0, wx: 0, wz: 0, order, nMain: n, nShadow: n,
    cx: NaN, cz: NaN, cr: NaN, lightKey: -1, isIdentity: true,
    matrices: (im.instanceMatrix.array as Float32Array).slice(0, n * 16),
    colors: im.instanceColor ? (im.instanceColor.array as Float32Array).slice(0, n * 3) : null,
  };
  im.updateWorldMatrix(true, false);
  measure(im, st);
  return st;
}

/** Squared distance from (px, pz) to the segment (ax, az) → (ax + ux, az + uz). */
function segDist2(px: number, pz: number, ax: number, az: number, ux: number, uz: number): number {
  const l2 = ux * ux + uz * uz;
  const t = l2 > 0 ? Math.min(1, Math.max(0, ((px - ax) * ux + (pz - az) * uz) / l2)) : 0;
  const dx = ax + ux * t - px, dz = az + uz * t - pz;
  return dx * dx + dz * dz;
}

/** True when segment `(ax, az) + t*(ux, uz)` (`t in [0,1]`) clips inside the focus quad padded by `pad`. */
function segIntersectsQuad(ax: number, az: number, ux: number, uz: number, pad: number): boolean {
  const e = getViewFocusEdgesUniform().value.elements;
  let t0 = 0;
  let t1 = 1;
  for (let k = 0; k < 16; k += 4) {
    const nx = e[k]!, nz = e[k + 1]!, c = e[k + 2]!;
    const num = pad - (nx * ax + nz * az + c);
    const den = nx * ux + nz * uz;
    if (Math.abs(den) < 1e-8) {
      if (num < 0) return false;
    } else if (den > 0) {
      t1 = Math.min(t1, num / den);
    } else {
      t0 = Math.max(t0, num / den);
    }
    if (t0 > t1) return false;
  }
  return true;
}

function castsInto(st: CompactState, i: number, fx: number, fz: number, r: number, slack: number, useQuad: boolean): boolean {
  if (lightDirs.size === 0) return true; // no shadow pass seen yet: keep every caster
  const x = st.xzrh[i * 4]!, z = st.xzrh[i * 4 + 1]!, ri = st.xzrh[i * 4 + 2]!, rr = r + ri, h = st.xzrh[i * 4 + 3]!;
  for (const d of lightDirs.values()) {
    const hl = Math.hypot(d.x, d.z) || 1;
    const k = Math.min(PROP_SHADOW_REACH_MAX, (h * hl) / Math.max(1e-3, -d.y)); // h · cot(sun elevation)
    const ux = (d.x / hl) * k, uz = (d.z / hl) * k;
    if (segDist2(fx, fz, x, z, ux, uz) <= rr * rr && (!useQuad || segIntersectsQuad(x, z, ux, uz, slack + ri))) return true;
  }
  return false;
}

function writeOrder(im: THREE.InstancedMesh, st: CompactState): void {
  if (st.nShadow <= 0) return;
  const m = im.instanceMatrix.array as Float32Array, c = im.instanceColor?.array as Float32Array | undefined;
  for (let s = 0; s < st.nShadow; s++) {
    const o = st.order[s]!;
    m.set(st.matrices.subarray(o * 16, o * 16 + 16), s * 16);
    if (c && st.colors) c.set(st.colors.subarray(o * 3, o * 3 + 3), s * 3);
  }
  im.instanceMatrix.clearUpdateRanges();
  im.instanceMatrix.addUpdateRange(0, st.nShadow * 16);
  im.instanceMatrix.needsUpdate = true;
  if (im.instanceColor) {
    im.instanceColor.clearUpdateRanges();
    im.instanceColor.addUpdateRange(0, st.nShadow * 3);
    im.instanceColor.needsUpdate = true;
  }
}

/** Sorts the instances into [focus | shadow-only | culled] for the focus quad + circle (fx, fz, r). */
function classify(st: CompactState, fx: number, fz: number, r: number, slack: number): void {
  const useQuad = r > 28;
  const main: number[] = [], shadow: number[] = [], culled: number[] = [];
  for (let i = 0; i < st.n; i++) {
    const x = st.xzrh[i * 4]!, z = st.xzrh[i * 4 + 1]!, ri = st.xzrh[i * 4 + 2]!;
    const dx = x - fx, dz = z - fz, rr = r + ri;
    if (dx * dx + dz * dz <= rr * rr && (!useQuad || viewFocusQuadDistance(x, z) <= slack + ri)) main.push(i);
    else if (castsInto(st, i, fx, fz, r, slack, useQuad)) shadow.push(i);
    else culled.push(i);
  }
  st.nMain = main.length;
  st.nShadow = main.length + shadow.length;
  st.order.set(main, 0);
  st.order.set(shadow, main.length);
  st.order.set(culled, st.nShadow); // keeps `order` a permutation (placedIndex of any slot stays meaningful)
}

function restoreIdentity(im: THREE.InstancedMesh, st: CompactState): void {
  st.nMain = st.nShadow = st.n;
  if (!st.isIdentity) {
    for (let i = 0; i < st.n; i++) st.order[i] = i;
    writeOrder(im, st);
    st.isIdentity = true;
  }
}

function setFull(im: THREE.InstancedMesh, st: CompactState): void {
  if (st.nMain === st.n && st.nShadow === st.n && Number.isNaN(st.cx) && st.isIdentity) return;
  st.cx = st.cz = st.cr = NaN;
  restoreIdentity(im, st);
}

const tmpBucketSphere = new THREE.Sphere();
function isBucketInsideFocus(im: THREE.InstancedMesh, f: Readonly<ViewFocus>): boolean {
  const bs = im.boundingSphere;
  if (!bs) return false;
  tmpBucketSphere.copy(bs).applyMatrix4(im.matrixWorld);
  const bx = tmpBucketSphere.center.x, bz = tmpBucketSphere.center.z, br = tmpBucketSphere.radius;
  return Math.hypot(bx - f.x, bz - f.z) + br <= f.radius && viewFocusQuadDistance(bx, bz) <= -br;
}

function installHooks(im: THREE.InstancedMesh, st: CompactState): void {
  im.onBeforeShadow = (_r, _o, _c, shadowCam) => {
    recordShadowLight(shadowCam);
    im.count = st.nShadow;
  };
  im.onAfterShadow = () => { im.count = st.nMain; };
}

function stateOf(im: THREE.InstancedMesh): CompactState | null {
  const known = states.get(im);
  if (known) return known;
  const st = im.count === 0 ? null : makeState(im);
  if (st) {
    states.set(im, st);
    installHooks(im, st);
  }
  return st;
}

/**
 * Extra radius (m) for the bucket-level focus test: a bucket just off the focus whose trees' shadows (along the
 * shadow lights seen so far) can fall into it is kept, and `compactBucketToFocus` then draws only those casters in the
 * shadow passes. 0 with the per-instance culling off (the old bucket test) or before any shadow pass.
 */
export function bucketShadowPad(im: THREE.InstancedMesh): number {
  if (!enabled || lightDirs.size === 0) return 0;
  const st = stateOf(im);
  if (!st) return 0;
  let cot = 0;
  for (const d of lightDirs.values()) cot = Math.max(cot, Math.hypot(d.x, d.z) / Math.max(1e-3, -d.y));
  return Math.min(PROP_SHADOW_REACH_MAX, st.hMax * cot);
}

const slackFor = (r: number) => Math.max(SLACK_MIN_M, r * (r > 35 ? 0.16 : SLACK_FRAC));

/** True when the classified circle still contains the focus and is not much looser than needed. */
function stillValid(st: CompactState, f: Readonly<ViewFocus>): boolean {
  if (Number.isNaN(st.cx) || st.lightKey !== lightKey) return false;
  const moved = Math.hypot(f.x - st.cx, f.z - st.cz);
  return moved + f.radius <= st.cr && st.cr <= f.radius + slackFor(f.radius) * 3.5;
}

/**
 * Updates one bucket for the current view focus (call after the bucket-level visibility test, for visible buckets).
 * Returns false when no instance of the bucket is drawn in any pass (the caller hides it).
 */
export function compactBucketToFocus(im: THREE.InstancedMesh): boolean {
  const st = stateOf(im);
  if (!st) return im.count > 0; // empty, or not compactable: drawn as is
  const e = im.matrixWorld.elements;
  if (e[12] !== st.wx || e[14] !== st.wz) measure(im, st); // the terrain group moved (space view ↔ colony)
  const f = getViewFocus();
  if (!enabled || !isViewFocusEnabled() || f.radius >= VIEW_FOCUS_MAX_RADIUS) {
    setFull(im, st);
  } else if (!stillValid(st, f)) {
    const slack = slackFor(f.radius);
    const cr = f.radius + slack;
    if (isBucketInsideFocus(im, f)) {
      restoreIdentity(im, st);
    } else {
      classify(st, f.x, f.z, cr, slack);
      if (st.nMain === st.n && st.nShadow === st.n) {
        restoreIdentity(im, st);
      } else {
        st.isIdentity = false;
        writeOrder(im, st);
      }
    }
    st.cx = f.x; st.cz = f.z; st.cr = cr; st.lightKey = lightKey;
  }
  im.count = st.nMain;
  return st.nShadow > 0;
}

/** Build-order index of drawn instance `id` (identity until the bucket was compacted). */
export function placedIndex(im: THREE.InstancedMesh, id: number): number {
  return states.get(im)?.order[id] ?? id;
}

/** Instances drawn in the colour pass / in the shadow passes (tests, dev audit). */
export function bucketDrawCounts(im: THREE.InstancedMesh): { main: number; shadow: number; total: number } {
  const st = states.get(im);
  return st ? { main: st.nMain, shadow: st.nShadow, total: st.n } : { main: im.count, shadow: im.count, total: im.count };
}

/** Forgets the shadow lights seen so far (terrain dispose: a new session brings new lights; tests). */
export function resetPropShadowLights(): void { lightDirs.clear(); lightKey++; }

// Dependency-free triangle math for the model validator. A mesh is a flat Float32Array of triangles (9 numbers each,
// non-indexed, counter-clockwise = outward). All distances are metres.

export type Box = [number, number, number, number, number, number]; // minx miny minz maxx maxy maxz

export const emptyBox = (): Box => [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];

export function trisBox(t: ArrayLike<number>): Box {
  const b = emptyBox();
  for (let i = 0; i < t.length; i += 3) {
    const x = t[i], y = t[i + 1], z = t[i + 2];
    if (x < b[0]) b[0] = x; if (y < b[1]) b[1] = y; if (z < b[2]) b[2] = z;
    if (x > b[3]) b[3] = x; if (y > b[4]) b[4] = y; if (z > b[5]) b[5] = z;
  }
  return b;
}

/** Per-triangle boxes (6 numbers each) for fast broad-phase culling. */
export function perTriBoxes(t: Float32Array): Float32Array {
  const n = t.length / 9, out = new Float32Array(n * 6);
  for (let i = 0; i < n; i++) {
    const o = i * 9;
    for (let a = 0; a < 3; a++) {
      const p = t[o + a], q = t[o + 3 + a], r = t[o + 6 + a];
      out[i * 6 + a] = Math.min(p, q, r); out[i * 6 + 3 + a] = Math.max(p, q, r);
    }
  }
  return out;
}

export const boxesOverlap = (a: ArrayLike<number>, ao: number, b: ArrayLike<number>, bo: number, pad = 0) =>
  a[ao] <= b[bo + 3] + pad && a[ao + 3] >= b[bo] - pad && a[ao + 1] <= b[bo + 4] + pad && a[ao + 4] >= b[bo + 1] - pad &&
  a[ao + 2] <= b[bo + 5] + pad && a[ao + 5] >= b[bo + 2] - pad;

/** Gap between two boxes (0 when they overlap). */
export function boxGap(a: Box, b: Box): number {
  const dx = Math.max(0, a[0] - b[3], b[0] - a[3]), dy = Math.max(0, a[1] - b[4], b[1] - a[4]), dz = Math.max(0, a[2] - b[5], b[2] - a[5]);
  return Math.hypot(dx, dy, dz);
}

export const expandBox = (b: Box, d: number): Box => [b[0] - d, b[1] - d, b[2] - d, b[3] + d, b[4] + d, b[5] + d];

export function intersectBox(a: Box, b: Box): Box | null {
  const r: Box = [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2]), Math.min(a[3], b[3]), Math.min(a[4], b[4]), Math.min(a[5], b[5])];
  return r[0] <= r[3] && r[1] <= r[4] && r[2] <= r[5] ? r : null;
}

// ---------------------------------------------------------------- point ↔ triangle (Ericson, Real-Time Collision Detection)

/** Squared distance from point p to the triangle starting at t[o]. */
export function pointTriDist2(px: number, py: number, pz: number, t: ArrayLike<number>, o: number): number {
  const ax = t[o], ay = t[o + 1], az = t[o + 2], bx = t[o + 3], by = t[o + 4], bz = t[o + 5], cx = t[o + 6], cy = t[o + 7], cz = t[o + 8];
  const abx = bx - ax, aby = by - ay, abz = bz - az, acx = cx - ax, acy = cy - ay, acz = cz - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) return apx * apx + apy * apy + apz * apz;
  const bpx = px - bx, bpy = py - by, bpz = pz - bz;
  const d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) return bpx * bpx + bpy * bpy + bpz * bpz;
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3), qx = apx - abx * v, qy = apy - aby * v, qz = apz - abz * v;
    return qx * qx + qy * qy + qz * qz;
  }
  const cpx = px - cx, cpy = py - cy, cpz = pz - cz;
  const d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) return cpx * cpx + cpy * cpy + cpz * cpz;
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6), qx = apx - acx * w, qy = apy - acy * w, qz = apz - acz * w;
    return qx * qx + qy * qy + qz * qz;
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6)), qx = bpx - (cx - bx) * w, qy = bpy - (cy - by) * w, qz = bpz - (cz - bz) * w;
    return qx * qx + qy * qy + qz * qz;
  }
  const den = 1 / (va + vb + vc), v = vb * den, w = vc * den;
  const qx = apx - abx * v - acx * w, qy = apy - aby * v - acy * w, qz = apz - abz * v - acz * w;
  return qx * qx + qy * qy + qz * qz;
}

/** Squared distance between segments p1-q1 and p2-q2. */
export function segSegDist2(
  p1x: number, p1y: number, p1z: number, q1x: number, q1y: number, q1z: number,
  p2x: number, p2y: number, p2z: number, q2x: number, q2y: number, q2z: number,
): number {
  const d1x = q1x - p1x, d1y = q1y - p1y, d1z = q1z - p1z, d2x = q2x - p2x, d2y = q2y - p2y, d2z = q2z - p2z;
  const rx = p1x - p2x, ry = p1y - p2y, rz = p1z - p2z;
  const a = d1x * d1x + d1y * d1y + d1z * d1z, e = d2x * d2x + d2y * d2y + d2z * d2z, f = d2x * rx + d2y * ry + d2z * rz;
  let s: number, t: number;
  const EPS = 1e-12;
  if (a <= EPS && e <= EPS) return rx * rx + ry * ry + rz * rz;
  if (a <= EPS) { s = 0; t = Math.min(1, Math.max(0, f / e)); }
  else {
    const c = d1x * rx + d1y * ry + d1z * rz;
    if (e <= EPS) { t = 0; s = Math.min(1, Math.max(0, -c / a)); }
    else {
      const b = d1x * d2x + d1y * d2y + d1z * d2z, den = a * e - b * b;
      s = den > EPS ? Math.min(1, Math.max(0, (b * f - c * e) / den)) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = Math.min(1, Math.max(0, -c / a)); } else if (t > 1) { t = 1; s = Math.min(1, Math.max(0, (b - c) / a)); }
    }
  }
  const cx = p1x + d1x * s - (p2x + d2x * t), cy = p1y + d1y * s - (p2y + d2y * t), cz = p1z + d1z * s - (p2z + d2z * t);
  return cx * cx + cy * cy + cz * cz;
}

// ---------------------------------------------------------------- triangle ↔ triangle (Möller 1997)

const N1 = [0, 0, 0], N2 = [0, 0, 0], D = [0, 0, 0], E1 = [0, 0, 0], E2 = [0, 0, 0];
const I1 = [0, 0], I2 = [0, 0];
const EPS = 1e-9;

function intervals(vv0: number, vv1: number, vv2: number, d0: number, d1: number, d2: number, d0d1: number, d0d2: number, out: number[]): boolean {
  let a: number, b: number, c: number, x0: number, x1: number; // a = lone vertex projection
  if (d0d1 > 0) { a = vv2; b = vv0 - vv2; c = vv1 - vv2; x0 = d2 / (d2 - d0); x1 = d2 / (d2 - d1); }
  else if (d0d2 > 0) { a = vv1; b = vv0 - vv1; c = vv2 - vv1; x0 = d1 / (d1 - d0); x1 = d1 / (d1 - d2); }
  else if (d1 * d2 > 0 || d0 !== 0) { a = vv0; b = vv1 - vv0; c = vv2 - vv0; x0 = d0 / (d0 - d1); x1 = d0 / (d0 - d2); }
  else if (d1 !== 0) { a = vv1; b = vv0 - vv1; c = vv2 - vv1; x0 = d1 / (d1 - d0); x1 = d1 / (d1 - d2); }
  else if (d2 !== 0) { a = vv2; b = vv0 - vv2; c = vv1 - vv2; x0 = d2 / (d2 - d0); x1 = d2 / (d2 - d1); }
  else return false; // coplanar
  out[0] = a + b * x0; out[1] = a + c * x1;
  if (out[0] > out[1]) { const t = out[0]; out[0] = out[1]; out[1] = t; }
  return true;
}

/** True when triangles share a point of their interiors on a common plane (touching edges/corners don't count). */
function coplanarOverlap(t1: ArrayLike<number>, o1: number, t2: ArrayLike<number>, o2: number, nx: number, ny: number, nz: number): boolean {
  // project on the plane's dominant axis, then test interior sample points of each triangle against the other
  const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
  const u = ax >= ay && ax >= az ? 1 : 0, v = ax >= ay && ax >= az ? 2 : ay >= az ? 2 : 1;
  const P = (t: ArrayLike<number>, o: number, k: number) => [t[o + k * 3 + u], t[o + k * 3 + v]];
  const pts = (t: ArrayLike<number>, o: number) => {
    const a = P(t, o, 0), b = P(t, o, 1), c = P(t, o, 2);
    const g = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3];
    const out = [g];
    for (const q of [a, b, c]) out.push([g[0] * 0.6 + q[0] * 0.4, g[1] * 0.6 + q[1] * 0.4]);
    for (const [p, q] of [[a, b], [b, c], [c, a]]) out.push([g[0] * 0.5 + (p[0] + q[0]) * 0.25, g[1] * 0.5 + (p[1] + q[1]) * 0.25]);
    return out;
  };
  const inside = (p: number[], t: ArrayLike<number>, o: number) => {
    const a = P(t, o, 0), b = P(t, o, 1), c = P(t, o, 2);
    const s1 = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    const s2 = (c[0] - b[0]) * (p[1] - b[1]) - (c[1] - b[1]) * (p[0] - b[0]);
    const s3 = (a[0] - c[0]) * (p[1] - c[1]) - (a[1] - c[1]) * (p[0] - c[0]);
    return (s1 > 1e-12 && s2 > 1e-12 && s3 > 1e-12) || (s1 < -1e-12 && s2 < -1e-12 && s3 < -1e-12);
  };
  for (const p of pts(t1, o1)) if (inside(p, t2, o2)) return true;
  for (const p of pts(t2, o2)) if (inside(p, t1, o1)) return true;
  return false;
}

/**
 * 0 = disjoint, 1 = surfaces cross, 2 = coplanar and overlapping with the SAME facing (what z-fighting is made of).
 * Coplanar overlap with opposite facing is a flush contact between two parts and reports 0.
 */
export function triTri(t1: ArrayLike<number>, o1: number, t2: ArrayLike<number>, o2: number): 0 | 1 | 2 {
  const v0x = t1[o1], v0y = t1[o1 + 1], v0z = t1[o1 + 2], u0x = t2[o2], u0y = t2[o2 + 1], u0z = t2[o2 + 2];
  E1[0] = t1[o1 + 3] - v0x; E1[1] = t1[o1 + 4] - v0y; E1[2] = t1[o1 + 5] - v0z; E2[0] = t1[o1 + 6] - v0x; E2[1] = t1[o1 + 7] - v0y; E2[2] = t1[o1 + 8] - v0z;
  N1[0] = E1[1] * E2[2] - E1[2] * E2[1]; N1[1] = E1[2] * E2[0] - E1[0] * E2[2]; N1[2] = E1[0] * E2[1] - E1[1] * E2[0];
  let l = Math.hypot(N1[0], N1[1], N1[2]); if (l < 1e-12) return 0; N1[0] /= l; N1[1] /= l; N1[2] /= l;
  const d1 = -(N1[0] * v0x + N1[1] * v0y + N1[2] * v0z);
  let du0 = N1[0] * u0x + N1[1] * u0y + N1[2] * u0z + d1;
  let du1 = N1[0] * t2[o2 + 3] + N1[1] * t2[o2 + 4] + N1[2] * t2[o2 + 5] + d1;
  let du2 = N1[0] * t2[o2 + 6] + N1[1] * t2[o2 + 7] + N1[2] * t2[o2 + 8] + d1;
  if (Math.abs(du0) < EPS) du0 = 0; if (Math.abs(du1) < EPS) du1 = 0; if (Math.abs(du2) < EPS) du2 = 0;
  if (du0 * du1 > 0 && du0 * du2 > 0) return 0;

  E1[0] = t2[o2 + 3] - u0x; E1[1] = t2[o2 + 4] - u0y; E1[2] = t2[o2 + 5] - u0z; E2[0] = t2[o2 + 6] - u0x; E2[1] = t2[o2 + 7] - u0y; E2[2] = t2[o2 + 8] - u0z;
  N2[0] = E1[1] * E2[2] - E1[2] * E2[1]; N2[1] = E1[2] * E2[0] - E1[0] * E2[2]; N2[2] = E1[0] * E2[1] - E1[1] * E2[0];
  l = Math.hypot(N2[0], N2[1], N2[2]); if (l < 1e-12) return 0; N2[0] /= l; N2[1] /= l; N2[2] /= l;
  const d2 = -(N2[0] * u0x + N2[1] * u0y + N2[2] * u0z);
  let dv0 = N2[0] * v0x + N2[1] * v0y + N2[2] * v0z + d2;
  let dv1 = N2[0] * t1[o1 + 3] + N2[1] * t1[o1 + 4] + N2[2] * t1[o1 + 5] + d2;
  let dv2 = N2[0] * t1[o1 + 6] + N2[1] * t1[o1 + 7] + N2[2] * t1[o1 + 8] + d2;
  if (Math.abs(dv0) < EPS) dv0 = 0; if (Math.abs(dv1) < EPS) dv1 = 0; if (Math.abs(dv2) < EPS) dv2 = 0;
  if (dv0 * dv1 > 0 && dv0 * dv2 > 0) return 0;

  D[0] = N1[1] * N2[2] - N1[2] * N2[1]; D[1] = N1[2] * N2[0] - N1[0] * N2[2]; D[2] = N1[0] * N2[1] - N1[1] * N2[0];
  let ix = 0, mx = Math.abs(D[0]); const my = Math.abs(D[1]), mz = Math.abs(D[2]);
  if (my > mx) { ix = 1; mx = my; } if (mz > mx) ix = 2;
  const ok1 = intervals(t1[o1 + ix], t1[o1 + 3 + ix], t1[o1 + 6 + ix], dv0, dv1, dv2, dv0 * dv1, dv0 * dv2, I1);
  if (!ok1) {
    // coplanar: only same-facing overlap is a visual problem
    if (N1[0] * N2[0] + N1[1] * N2[1] + N1[2] * N2[2] <= 0.5) return 0;
    return coplanarOverlap(t1, o1, t2, o2, N1[0], N1[1], N1[2]) ? 2 : 0;
  }
  intervals(t2[o2 + ix], t2[o2 + 3 + ix], t2[o2 + 6 + ix], du0, du1, du2, du0 * du1, du0 * du2, I2);
  return I1[1] < I2[0] || I2[1] < I1[0] ? 0 : 1;
}

// ---------------------------------------------------------------- inside test (ray parity)

// An arbitrary direction no axis-aligned face is parallel to, so rays almost never graze an edge.
const RX = 0.81372, RY = 0.41521, RZ = 0.40937;

/** Is the point inside the closed mesh `t`? (odd number of ray crossings). Only meaningful for watertight meshes. */
export function pointInsideMesh(px: number, py: number, pz: number, t: Float32Array): boolean {
  let hits = 0;
  for (let o = 0; o < t.length; o += 9) {
    const e1x = t[o + 3] - t[o], e1y = t[o + 4] - t[o + 1], e1z = t[o + 5] - t[o + 2], e2x = t[o + 6] - t[o], e2y = t[o + 7] - t[o + 1], e2z = t[o + 8] - t[o + 2];
    const hx = RY * e2z - RZ * e2y, hy = RZ * e2x - RX * e2z, hz = RX * e2y - RY * e2x;
    const a = e1x * hx + e1y * hy + e1z * hz;
    if (Math.abs(a) < 1e-12) continue;
    const f = 1 / a, sx = px - t[o], sy = py - t[o + 1], sz = pz - t[o + 2];
    const u = f * (sx * hx + sy * hy + sz * hz);
    if (u < 0 || u > 1) continue;
    const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
    const v = f * (RX * qx + RY * qy + RZ * qz);
    if (v < 0 || u + v > 1) continue;
    if (f * (e2x * qx + e2y * qy + e2z * qz) > 1e-9) hits++;
  }
  return (hits & 1) === 1;
}

/** Quantised-position edge matching: every edge shared by exactly two triangles = closed (watertight) surface. */
export function isWatertight(t: Float32Array): boolean {
  const key = (x: number, y: number, z: number) => `${Math.round(x * 1e4)},${Math.round(y * 1e4)},${Math.round(z * 1e4)}`;
  const edges = new Map<string, number>();
  for (let o = 0; o < t.length; o += 9) {
    const k = [key(t[o], t[o + 1], t[o + 2]), key(t[o + 3], t[o + 4], t[o + 5]), key(t[o + 6], t[o + 7], t[o + 8])];
    for (let i = 0; i < 3; i++) {
      const a = k[i], b = k[(i + 1) % 3];
      if (a === b) continue;
      const e = a < b ? a + '|' + b : b + '|' + a;
      edges.set(e, (edges.get(e) ?? 0) + 1);
    }
  }
  for (const c of edges.values()) if (c !== 2) return false;
  return true;
}

export function triArea(t: ArrayLike<number>, o: number): number {
  const e1x = t[o + 3] - t[o], e1y = t[o + 4] - t[o + 1], e1z = t[o + 5] - t[o + 2], e2x = t[o + 6] - t[o], e2y = t[o + 7] - t[o + 1], e2z = t[o + 8] - t[o + 2];
  return 0.5 * Math.hypot(e1y * e2z - e1z * e2y, e1z * e2x - e1x * e2z, e1x * e2y - e1y * e2x);
}

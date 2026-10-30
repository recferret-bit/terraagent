// Pairwise geometry relations between two parts: surface distance, crossings, z-fighting, and how deeply one sits in the other.
import {
  boxGap, boxesOverlap, expandBox, intersectBox, perTriBoxes, pointInsideMesh, pointTriDist2, segSegDist2, triTri, trisBox,
} from './math';
import type { Box } from './math';
import type { P, PartDef } from './types';

const f2 = (n: number) => n.toFixed(2);

export function prepare(def: PartDef, tris: Float32Array = def.tris): P {
  const box = trisBox(tris);
  const label = `#${def.index} ${def.name} [${def.zone}${def.animType ? ', anim ' + def.animType : ''}] @(${f2((box[0] + box[3]) / 2)}, ${f2((box[1] + box[4]) / 2)}, ${f2((box[2] + box[5]) / 2)})`;
  return { def, n: tris.length / 9, tris, tb: perTriBoxes(tris), box, closed: false, label };
}

/** Unit normal of the triangle at offset `o` (zero-area triangles give a zero vector). */
function unitNormal(t: ArrayLike<number>, o: number): [number, number, number] {
  const e1x = t[o + 3] - t[o], e1y = t[o + 4] - t[o + 1], e1z = t[o + 5] - t[o + 2], e2x = t[o + 6] - t[o], e2y = t[o + 7] - t[o + 1], e2z = t[o + 8] - t[o + 2];
  const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x; const l = Math.hypot(nx, ny, nz) || 1;
  return [nx / l, ny / l, nz / l];
}

/** Relation of two parts: surface distance (0 if they cross), crossing / z-fight counts. */
export interface Rel { dist: number; crossing: boolean; crossCount: number; zfight: number; graze: number; at?: [number, number, number] }
export const FAR: Rel = { dist: Infinity, crossing: false, crossCount: 0, zfight: 0, graze: 0 };

export function candidates(p: P, region: Box): number[] {
  const out: number[] = [];
  for (let i = 0; i < p.n; i++) if (boxesOverlap(p.tb, i * 6, region as unknown as ArrayLike<number>, 0)) out.push(i);
  return out;
}

export function relate(A: P, B: P, limit: number, graze = 0.003): Rel {
  const gap = boxGap(A.box, B.box);
  if (gap > limit) return FAR;
  const region = intersectBox(expandBox(A.box, limit), expandBox(B.box, limit));
  if (!region) return FAR;
  const ca = candidates(A, region), cb = candidates(B, region);
  if (!ca.length || !cb.length) return { ...FAR, dist: Math.max(gap, limit) };
  let crossCount = 0, zfight = 0, grazing = 0, where: [number, number, number] | undefined;
  for (const ia of ca) for (const ib of cb) {
    if (!boxesOverlap(A.tb, ia * 6, B.tb, ib * 6, 1e-6)) continue;
    const r = triTri(A.tris, ia * 9, B.tris, ib * 9);
    if (r) {
      crossCount++; if (r === 2) zfight++;
      else {
        // two crossing faces that are almost parallel and almost on the same plane shimmer even though they are not exactly coplanar
        const a = A.tris, b = B.tris, oa = ia * 9, ob = ib * 9;
        const [nx, ny, nz] = unitNormal(a, oa), [mx, my, mz] = unitNormal(b, ob);
        if (nx * mx + ny * my + nz * mz > 0.998 && Math.abs(nx * (b[ob] - a[oa]) + ny * (b[ob + 1] - a[oa + 1]) + nz * (b[ob + 2] - a[oa + 2])) <= graze) grazing++;
      }
      if (!where) where = [(A.tris[ia * 9] + A.tris[ia * 9 + 3] + A.tris[ia * 9 + 6]) / 3, (A.tris[ia * 9 + 1] + A.tris[ia * 9 + 4] + A.tris[ia * 9 + 7]) / 3, (A.tris[ia * 9 + 2] + A.tris[ia * 9 + 5] + A.tris[ia * 9 + 8]) / 3];
    }
  }
  if (crossCount) return { dist: 0, crossing: true, crossCount, zfight, graze: grazing, at: where };
  // no crossing: nearest approach = vertex↔triangle both ways + edge↔edge (catches parallel rods that never share a vertex)
  let best2 = limit * limit * 4;
  const vertexPass = (X: P, cx: number[], Y: P, cy: number[]) => {
    for (const ix of cx) for (let k = 0; k < 3; k++) {
      const px = X.tris[ix * 9 + k * 3], py = X.tris[ix * 9 + k * 3 + 1], pz = X.tris[ix * 9 + k * 3 + 2];
      const d = Math.sqrt(best2);
      for (const iy of cy) {
        const o = iy * 6, tb = Y.tb;
        if (px < tb[o] - d || px > tb[o + 3] + d || py < tb[o + 1] - d || py > tb[o + 4] + d || pz < tb[o + 2] - d || pz > tb[o + 5] + d) continue;
        const d2 = pointTriDist2(px, py, pz, Y.tris, iy * 9); if (d2 < best2) best2 = d2;
      }
    }
  };
  vertexPass(A, ca, B, cb); vertexPass(B, cb, A, ca);
  if (ca.length * cb.length < 40000) {
    for (const ia of ca) for (const ib of cb) {
      const d = Math.sqrt(best2);
      if (!boxesOverlap(A.tb, ia * 6, B.tb, ib * 6, d)) continue;
      for (let e = 0; e < 3; e++) for (let f = 0; f < 3; f++) {
        const a0 = ia * 9 + e * 3, a1 = ia * 9 + ((e + 1) % 3) * 3, b0 = ib * 9 + f * 3, b1 = ib * 9 + ((f + 1) % 3) * 3;
        const d2 = segSegDist2(A.tris[a0], A.tris[a0 + 1], A.tris[a0 + 2], A.tris[a1], A.tris[a1 + 1], A.tris[a1 + 2], B.tris[b0], B.tris[b0 + 1], B.tris[b0 + 2], B.tris[b1], B.tris[b1 + 1], B.tris[b1 + 2]);
        if (d2 < best2) best2 = d2;
      }
    }
  }
  return { dist: Math.sqrt(best2), crossing: false, crossCount: 0, zfight: 0, graze: 0 };
}

/** How much of X lies inside closed part Y: fraction of X's sample points inside, and the deepest of them (m). */
export function embed(X: P, Y: P): { frac: number; depth: number } {
  if (!Y.closed) return { frac: 0, depth: 0 };
  const region = intersectBox(X.box, Y.box); if (!region) return { frac: 0, depth: 0 };
  const stride = Math.max(1, Math.floor(X.n / 300));
  let total = 0, inside = 0, depth2 = 0;
  const yc = candidates(Y, expandBox(region, 0.25));
  for (let i = 0; i < X.n; i += stride) {
    const o = i * 9;
    const pts: number[][] = [[X.tris[o], X.tris[o + 1], X.tris[o + 2]], [(X.tris[o] + X.tris[o + 3] + X.tris[o + 6]) / 3, (X.tris[o + 1] + X.tris[o + 4] + X.tris[o + 7]) / 3, (X.tris[o + 2] + X.tris[o + 5] + X.tris[o + 8]) / 3]];
    for (const [x, y, z] of pts) {
      total++;
      if (x < region[0] || x > region[3] || y < region[1] || y > region[4] || z < region[2] || z > region[5]) continue;
      if (!pointInsideMesh(x, y, z, Y.tris)) continue;
      inside++;
      let d2 = Infinity;
      for (const j of yc) { const v = pointTriDist2(x, y, z, Y.tris, j * 9); if (v < d2) d2 = v; }
      if (d2 !== Infinity && d2 > depth2) depth2 = d2;
    }
  }
  return { frac: total ? inside / total : 0, depth: Math.sqrt(depth2) };
}

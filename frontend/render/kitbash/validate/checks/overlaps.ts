// Stage 3: overlaps between parts (buried, z-fight, cutting through) and cables that clip mid-span or float at an end.
import { boxGap, pointInsideMesh } from '../math';
import { embed, prepare, relate } from '../relation';
import { at, fmt, type CheckStage } from '../context';
import type { P } from '../types';

export const overlapStage: CheckStage = (ctx) => {
  const { parts: P_, n: N, o, add, R, pairs } = ctx;
  for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) {
    const r = R(i, j);
    const A = P_[i], B = P_[j];
    if (!r.crossing) {
      // no surfaces cross, but one part can still sit entirely inside the other (invisible)
      const first = (X: P): [number, number, number] => [X.tris[0], X.tris[1], X.tris[2]];
      const inA = boxGap(A.box, B.box) === 0 && B.closed && pointInsideMesh(...first(A), B.tris);
      const inB = boxGap(A.box, B.box) === 0 && A.closed && pointInsideMesh(...first(B), A.tris);
      if (inA || inB) {
        const small = inA ? A : B, big = inA ? B : A;
        add('warn', 'BURIED_PART', `${small.label} is completely inside ${big.label}: it is invisible and only costs triangles.`, [small.def.index, big.def.index], at(small.box), 'Delete it, or pull it out so it actually shows (an inset panel must stand proud of its frame by ≥ 2 mm).');
      }
      if (o.keepPairs && r.dist < o.nearMiss) pairs.push({ a: i, b: j, dist: r.dist, crossing: false, zfight: 0, embedA: inA ? 1 : 0, embedB: inB ? 1 : 0, depth: 0 });
      continue;
    }
    if (r.zfight > 0) {
      add('error', 'COPLANAR_Z_FIGHT', `${A.label} and ${B.label} share ${r.zfight} coplanar, same-facing face${r.zfight > 1 ? 's' : ''}. They flicker against each other (z-fighting).`, [i, j], r.at, 'Offset one part by ≥ 2 mm (make the inset panel thicker/thinner than its frame) so their faces are not in the same plane.');
    }
    if (r.zfight === 0 && r.graze > 0) {
      add('warn', 'NEAR_COPLANAR', `${A.label} and ${B.label} cross at a grazing angle with faces within ${(o.grazeDist * 1000).toFixed(0)} mm of each other (${r.graze} spot${r.graze > 1 ? 's' : ''}). The edge shimmers and looks jagged.`, [i, j], r.at, 'Move one part so its face is clearly proud of (≥ 3 mm) or clearly inside the other, or tilt it by more than a few degrees.');
    }
    const eA = embed(A, B), eB = embed(B, A);
    const depth = Math.max(eA.depth, eB.depth);
    if (o.keepPairs) pairs.push({ a: i, b: j, dist: 0, crossing: true, zfight: r.zfight, embedA: eA.frac, embedB: eB.frac, depth });
    // the smaller part is the one that gets buried
    const small = A.n <= B.n ? A : B, big = small === A ? B : A, es = small === A ? eA : eB;
    if (es.frac >= o.buriedFrac) add('warn', 'BURIED_PART', `${small.label} is ${Math.round(es.frac * 100)}% inside ${big.label}: it is invisible and only costs triangles.`, [small.def.index, big.def.index], at(small.box), 'Delete it, or pull it out so it actually shows.');
    else if (depth >= o.cutDepth && Math.min(eA.frac, eB.frac) >= o.cutFrac) add('warn', 'CUTS_THROUGH', `${A.label} and ${B.label} cut through each other (${Math.round(eA.frac * 100)}% / ${Math.round(eB.frac * 100)}% inside the other, up to ${fmt(depth)} deep): both protrude, so the crossing line is visible.`, [i, j], r.at, 'Separate them so they only meet at a joint (overlap ≤ a few cm), or merge them into one shape.');
  }
};

/** The foundation slab and what is mounted on it (by `role`, never by name or part order): not a cable anchor. */
function isPlinthPart(Y: P, totalParts: number, minParts: number, grounded: boolean): boolean {
  if (!grounded || totalParts < minParts) return false;
  return Y.def.role === 'plinth' || Y.def.role === 'plinthDetail';
}

/** Height a cable must stay above: the top of the `plinth` slab(s) of a grounded model, else the ground. */
function floorY(P_: P[], grounded: boolean, minParts: number): number {
  if (!grounded) return -Infinity;
  if (P_.length < minParts) return 0;
  return P_.reduce((y, p) => (p.def.role === 'plinth' ? Math.max(y, p.box[4]) : y), 0);
}

export const cableStage: CheckStage = (ctx) => {
  const { parts: P_, o, add, R } = ctx;
  const plinthY = floorY(P_, o.grounded, o.minParts);
  for (const T of P_) {
    if (T.def.kind !== 'TubeGeometry') continue;
    const cap = Math.max(6, Math.floor(T.n * 0.14));
    const sCap = prepare(T.def, T.tris.subarray(0, cap * 9));
    const eCap = prepare(T.def, T.tris.subarray((T.n - cap) * 9));
    const inOrTouch = (end: P, Y: P) => relate(end, Y, o.contactTol + 0.01).dist <= o.contactTol || (Y.closed && (pointInsideMesh(end.tris[0], end.tris[1], end.tris[2], Y.tris) || pointInsideMesh(end.tris[end.tris.length - 3], end.tris[end.tris.length - 2], end.tris[end.tris.length - 1], Y.tris)));
    const anchors = (end: P) => P_.filter((Y) => Y !== T && Y.def.kind !== 'TubeGeometry' && !isPlinthPart(Y, P_.length, o.minParts, o.grounded) && boxGap(end.box, Y.box) <= o.contactTol && inOrTouch(end, Y));
    const sA = anchors(sCap), eA = anchors(eCap);
    for (const Y of P_) {
      if (Y === T || !Y.closed || !R(T.def.index, Y.def.index).crossing) continue;
      const isAnchor = sA.includes(Y) || eA.includes(Y);
      const lo = Math.floor(T.n * (isAnchor ? 0.28 : 0.15)), hi = Math.ceil(T.n * (isAnchor ? 0.72 : 0.85));
      let mid = 0;
      for (let i = lo; i < hi; i += 2) {
        const o9 = i * 9;
        if (pointInsideMesh((T.tris[o9] + T.tris[o9 + 3] + T.tris[o9 + 6]) / 3, (T.tris[o9 + 1] + T.tris[o9 + 4] + T.tris[o9 + 7]) / 3, (T.tris[o9 + 2] + T.tris[o9 + 5] + T.tris[o9 + 8]) / 3, Y.tris)) mid++;
      }
      if (mid >= 3) add('warn', 'CABLE_CLIPS', `${T.label} passes through ${Y.label} mid-span instead of ending on it.`, [T.def.index, Y.def.index], R(T.def.index, Y.def.index).at, 'Reduce the sag or re-route the cable so it clears the part, and let it end exactly on its two anchors.');
    }
    if (T.def.role === 'whip') continue; // a free end is the point of a whip or tendril
    if (!sA.length || !eA.length) {
      add('error', 'CABLE_FLOAT', `${T.label} has an unanchored ${!sA.length && !eA.length ? 'start and end' : !sA.length ? 'start' : 'end'} (a cable must connect two solid parts, never float in mid-air or plunge into the ground/plinth).`, [T.def.index], at(!sA.length ? sCap.box : eCap.box), 'Anchor both ends of the cable ≥ 1 cm inside solid structural parts (hull, post, junction box), not in mid-air or bare ground.');
    }
    if (T.box[1] < plinthY + 0.005) {
      add('warn', 'CABLE_CLIPS', `${T.label} sags into the ground or foundation plinth (lowest y = ${T.box[1].toFixed(2)} m).`, [T.def.index], at(T.box), 'Reduce the cable slack or raise its anchors so it hangs cleanly above the floor.');
    }
  }
};

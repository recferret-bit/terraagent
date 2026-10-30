// Stage 3: overlaps between parts (buried, z-fight, cutting through) and cables that clip mid-span.
import { boxGap, pointInsideMesh } from '../math';
import { embed } from '../relation';
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

export const cableStage: CheckStage = (ctx) => {
  const { parts: P_, add, R } = ctx;
  for (const T of P_) {
    if (T.def.kind !== 'TubeGeometry') continue;
    for (const Y of P_) {
      if (Y === T || !Y.closed || !R(T.def.index, Y.def.index).crossing) continue;
      let mid = 0;
      for (let i = Math.floor(T.n * 0.15); i < Math.ceil(T.n * 0.85); i += 2) {
        const o9 = i * 9;
        if (pointInsideMesh((T.tris[o9] + T.tris[o9 + 3] + T.tris[o9 + 6]) / 3, (T.tris[o9 + 1] + T.tris[o9 + 4] + T.tris[o9 + 7]) / 3, (T.tris[o9 + 2] + T.tris[o9 + 5] + T.tris[o9 + 8]) / 3, Y.tris)) mid++;
      }
      if (mid >= 3) add('warn', 'CABLE_CLIPS', `${T.label} passes through ${Y.label} mid-span instead of ending on it.`, [T.def.index, Y.def.index], R(T.def.index, Y.def.index).at, 'Reduce the sag or re-route the cable so it clears the part, and let it end exactly on its two anchors.');
    }
  }
};

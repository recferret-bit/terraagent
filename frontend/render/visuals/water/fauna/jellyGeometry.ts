import * as THREE from 'three';
import { JELLY_TENTACLE_LEN } from './jellyPlacement';

/**
 * Procedural low-poly jellyfish, unit scale (bell 0.32 m across, tentacles hang 0.36 m below the rim), 104 triangles:
 * an 8-sided lathed bell (dome + shallow underside, so it reads from below and through the water) and four
 * three-segment tentacle ribbons (drawn two-sided by the material).
 * `aJel` = (part 0 bell / 1 tentacle, v = 0 at the apex .. 1 at a tentacle tip, rim weight 0 apex .. 1 rim) drives
 * the bell pulse and tentacle sway in `jellyMaterial.ts`; the instance scale comes from the instance attributes.
 */

/** Bell profile from the apex down to the rim, then back in under the bell: [radius, y]. */
const PROFILE: readonly (readonly [number, number])[] = [
  [0.0, 0.2], [0.075, 0.185], [0.13, 0.14], [0.16, 0.07], [0.155, 0.0], [0.1, 0.035], [0.0, 0.05],
];
const RIM_ROW = 4;
const SIDES = 8;
const TENTACLES = 4;
const TENTACLE_SEGS = 3;
const TENTACLE_HALF_W = 0.03;

function buildBell(): { pos: number[]; jel: number[]; idx: number[] } {
  const pos: number[] = [], jel: number[] = [], idx: number[] = [];
  const rimR = PROFILE[RIM_ROW]![0];
  const rowVerts: number[][] = [];
  PROFILE.forEach(([r, y], row) => {
    const ids: number[] = [];
    const n = r === 0 ? 1 : SIDES;
    for (let s = 0; s < n; s++) {
      const a = (s / SIDES) * Math.PI * 2;
      ids.push(pos.length / 3);
      pos.push(Math.cos(a) * r, y, Math.sin(a) * r);
      jel.push(0, row <= RIM_ROW ? (row / RIM_ROW) * 0.25 : 0.25, r / rimR);
    }
    rowVerts.push(ids);
  });
  for (let row = 0; row < PROFILE.length - 1; row++) {
    const a = rowVerts[row]!, b = rowVerts[row + 1]!;
    for (let s = 0; s < SIDES; s++) {
      const s1 = (s + 1) % SIDES;
      if (a.length === 1) idx.push(a[0]!, b[s1]!, b[s]!);
      else if (b.length === 1) idx.push(a[s]!, a[s1]!, b[0]!);
      else idx.push(a[s]!, a[s1]!, b[s]!, a[s1]!, b[s1]!, b[s]!);
    }
  }
  return { pos, jel, idx };
}

/** Vertical ribbons hanging from the rim, facing outward; v runs 0.25 (rim) .. 1 (tip). */
function buildTentacles(base: number): { pos: number[]; nor: number[]; jel: number[]; idx: number[] } {
  const pos: number[] = [], nor: number[] = [], jel: number[] = [], idx: number[] = [];
  const r = PROFILE[RIM_ROW]![0] * 0.8;
  for (let t = 0; t < TENTACLES; t++) {
    const a = ((t + 0.5) / TENTACLES) * Math.PI * 2;
    const cx = Math.cos(a) * r, cz = Math.sin(a) * r;
    const tx = -Math.sin(a) * TENTACLE_HALF_W, tz = Math.cos(a) * TENTACLE_HALF_W; // ribbon width along the tangent
    const first = base + pos.length / 3;
    for (let k = 0; k <= TENTACLE_SEGS; k++) {
      const v = k / TENTACLE_SEGS;
      const y = PROFILE[RIM_ROW]![1] + 0.01 - v * JELLY_TENTACLE_LEN;
      const w = 1 - 0.6 * v; // taper
      for (const side of [-1, 1]) {
        pos.push(cx + tx * side * w, y, cz + tz * side * w);
        nor.push(Math.cos(a), 0, Math.sin(a));
        jel.push(1, 0.25 + 0.75 * v, 1);
      }
    }
    for (let k = 0; k < TENTACLE_SEGS; k++) {
      const i0 = first + k * 2;
      idx.push(i0, i0 + 1, i0 + 2, i0 + 1, i0 + 3, i0 + 2);
    }
  }
  return { pos, nor, jel, idx };
}

export function buildJellyGeometry(): THREE.BufferGeometry {
  const bell = buildBell();
  const bellGeo = new THREE.BufferGeometry();
  bellGeo.setAttribute('position', new THREE.Float32BufferAttribute(bell.pos, 3));
  bellGeo.setIndex(bell.idx);
  bellGeo.computeVertexNormals();
  const bellNor = Array.from(bellGeo.getAttribute('normal').array as Float32Array);
  bellGeo.dispose();
  const ten = buildTentacles(bell.pos.length / 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([...bell.pos, ...ten.pos], 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute([...bellNor, ...ten.nor], 3));
  geo.setAttribute('aJel', new THREE.Float32BufferAttribute([...bell.jel, ...ten.jel], 3));
  geo.setIndex([...bell.idx, ...ten.idx]);
  return geo;
}

/** 8 apex fan + 4 bands × 16 + 8 underside fan + 4 tentacles × 3 segments × 2 = 104. */
export const JELLY_TRIANGLES = SIDES + 4 * SIDES * 2 + SIDES + TENTACLES * TENTACLE_SEGS * 2;

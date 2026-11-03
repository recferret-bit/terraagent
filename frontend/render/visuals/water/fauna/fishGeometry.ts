import * as THREE from 'three';

/**
 * Procedural low-poly fish, 1 m long along +Z (nose at z = +0.5, tail tip at z = -0.5), 42 triangles:
 * a tapered 6-sided body (nose fan, two bands, peduncle cone), a forked tail fin and a dorsal fin (both two-sided).
 * `aBody` = (length position 0 nose .. 1 tail, shade 0 belly .. 1 back, accent 0 / 1) drives the tail wiggle and the
 * countershaded colouring in `fishMaterial.ts`; the instance is scaled to its body length in the vertex shader.
 */

/** Body rings: z, half width, half height, centre y. */
const RINGS: readonly (readonly [number, number, number, number])[] = [
  [0.34, 0.06, 0.085, 0.0],
  [0.1, 0.085, 0.135, 0.01],
  [-0.14, 0.06, 0.095, 0.005],
];
const NOSE: readonly [number, number] = [0.5, -0.01]; // z, y
const PEDUNCLE: readonly [number, number] = [-0.3, 0.0];
const SIDES = 6;

const lengthPos = (z: number) => 0.5 - z;

function buildBody(): { pos: number[]; body: number[]; idx: number[] } {
  const pos: number[] = [], body: number[] = [], idx: number[] = [];
  const push = (x: number, y: number, z: number, shade: number) => { pos.push(x, y, z); body.push(lengthPos(z), shade, 0); };
  push(0, NOSE[1], NOSE[0], 0.55);
  for (const [z, hw, hh, cy] of RINGS) {
    for (let s = 0; s < SIDES; s++) {
      const a = Math.PI / 2 - (s * 2 * Math.PI) / SIDES; // s = 0 on top, clockwise seen from the nose
      push(Math.cos(a) * hw, cy + Math.sin(a) * hh, z, 0.5 + 0.5 * Math.sin(a));
    }
  }
  const tail = pos.length / 3;
  push(0, PEDUNCLE[1], PEDUNCLE[0], 0.6);
  const ring = (r: number, s: number) => 1 + r * SIDES + (s % SIDES);
  for (let s = 0; s < SIDES; s++) idx.push(0, ring(0, s + 1), ring(0, s));
  for (let r = 0; r < RINGS.length - 1; r++) {
    for (let s = 0; s < SIDES; s++) {
      const a = ring(r, s), b = ring(r, s + 1), c = ring(r + 1, s), d = ring(r + 1, s + 1);
      idx.push(a, b, c, b, d, c);
    }
  }
  const last = RINGS.length - 1;
  for (let s = 0; s < SIDES; s++) idx.push(ring(last, s), ring(last, s + 1), tail);
  return { pos, body, idx };
}

/** Flat fin triangles in the YZ plane, emitted on both sides (separate vertices, normals ±X). */
type FinTri = { pts: readonly (readonly [z: number, y: number])[]; shade: number };
const FINS: readonly FinTri[] = [
  { pts: [[-0.27, 0.0], [-0.5, 0.15], [-0.43, 0.0]], shade: 0.7 }, // tail, upper lobe
  { pts: [[-0.27, 0.0], [-0.43, 0.0], [-0.5, -0.13]], shade: 0.6 }, // tail, lower lobe
  { pts: [[0.16, 0.135], [-0.1, 0.1], [-0.07, 0.24]], shade: 1 }, // dorsal
];

function buildFins(): { pos: number[]; nor: number[]; body: number[] } {
  const pos: number[] = [], nor: number[] = [], body: number[] = [];
  for (const { pts, shade } of FINS) {
    const [a, b, c] = pts as [readonly [number, number], readonly [number, number], readonly [number, number]];
    const crossX = (b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]); // x of (b - a) × (c - a)
    for (const side of [1, -1]) {
      const order = Math.sign(crossX) === side ? [a, b, c] : [a, c, b]; // CCW seen from the `side` normal
      for (const [z, y] of order) { pos.push(0, y, z); nor.push(side, 0, 0); body.push(lengthPos(z), shade, 1); }
    }
  }
  return { pos, nor, body };
}

/** One shared fish geometry (both species; the instance length and palette differ). */
export function buildFishGeometry(): THREE.BufferGeometry {
  const b = buildBody();
  const bodyGeo = new THREE.BufferGeometry();
  bodyGeo.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
  bodyGeo.setIndex(b.idx);
  bodyGeo.computeVertexNormals();
  const bodyNor = Array.from(bodyGeo.getAttribute('normal').array as Float32Array);
  bodyGeo.dispose();
  const f = buildFins();
  const base = b.pos.length / 3;
  const finIdx = Array.from({ length: f.pos.length / 3 }, (_, k) => base + k);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([...b.pos, ...f.pos], 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute([...bodyNor, ...f.nor], 3));
  geo.setAttribute('aBody', new THREE.Float32BufferAttribute([...b.body, ...f.body], 3));
  geo.setIndex([...b.idx, ...finIdx]);
  return geo;
}

export const FISH_TRIANGLES = 42;

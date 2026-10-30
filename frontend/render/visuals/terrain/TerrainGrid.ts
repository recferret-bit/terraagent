import * as THREE from 'three';
import type { HeightField } from './heightfields';

/** CPU-side data of the displaced grid: heights, normals, baked AO and triangle indices. */
export interface TerrainGridData {
  V: number; step: number;
  hs: Float32Array; pos: Float32Array; nor: Float32Array; ao: Float32Array; idx: Uint32Array;
}

type Lattice = (i: number, j: number) => number;

/** Heights/positions sampled from the field over a (N+1)² lattice spanning `span` metres. */
function sampleHeights(field: HeightField, span: number, V: number, step: number) {
  const hs = new Float32Array(V * V);
  const pos = new Float32Array(V * V * 3);
  for (let j = 0; j < V; j++) for (let i = 0; i < V; i++) {
    const x = -span / 2 + i * step, z = -span / 2 + j * step;
    const h = field.height(x, z);
    const k = j * V + i;
    hs[k] = h; pos[k * 3] = x; pos[k * 3 + 1] = h; pos[k * 3 + 2] = z;
  }
  return { hs, pos };
}

function centralNormals(H: Lattice, V: number, step: number) {
  const nor = new Float32Array(V * V * 3);
  for (let j = 0; j < V; j++) for (let i = 0; i < V; i++) {
    const dx = (H(i - 1, j) - H(i + 1, j)) / (2 * step), dz = (H(i, j - 1) - H(i, j + 1)) / (2 * step);
    const l = Math.hypot(dx, 1, dz), k = (j * V + i) * 3;
    nor[k] = dx / l; nor[k + 1] = 1 / l; nor[k + 2] = dz / l;
  }
  return nor;
}

/** Baked horizon-based ambient occlusion (8 directions × 4 radii): darkens cliff bases, gullies and dune troughs so
 *  shadowed rock reads as form instead of a flat brown smear. */
function bakeAO(hs: Float32Array, H: Lattice, V: number, step: number) {
  const ao = new Float32Array(V * V);
  const dirs = Array.from({ length: 8 }, (_, k) => [Math.cos((k / 8) * Math.PI * 2), Math.sin((k / 8) * Math.PI * 2)]);
  const radii = [1.2, 3, 6.5, 12].map((r) => Math.max(1, Math.round(r / step)));
  for (let j = 0; j < V; j++) for (let i = 0; i < V; i++) {
    const h0 = hs[j * V + i];
    let occ = 0;
    for (const [cx, cz] of dirs) {
      let m = 0;
      for (const r of radii) {
        const dh = H(Math.round(i + cx * r), Math.round(j + cz * r)) - h0;
        m = Math.max(m, dh / (r * step));                 // tangent of the horizon elevation
      }
      occ += Math.min(1, m) * 0.85 + Math.max(0, m - 1) * 0.05;
    }
    ao[j * V + i] = Math.max(0.25, 1 - occ / dirs.length);
  }
  return ao;
}

function gridIndices(N: number, V: number) {
  const idx = new Uint32Array(N * N * 6);
  let q = 0;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const a = j * V + i, c = a + 1, b = a + V, d = b + 1;
    idx[q++] = a; idx[q++] = b; idx[q++] = c;
    idx[q++] = c; idx[q++] = b; idx[q++] = d;
  }
  return idx;
}

export function buildTerrainGrid(field: HeightField, span: number, N: number): TerrainGridData {
  const step = span / N, V = N + 1;
  const { hs, pos } = sampleHeights(field, span, V, step);
  const H: Lattice = (i, j) => hs[Math.min(N, Math.max(0, j)) * V + Math.min(N, Math.max(0, i))];
  const nor = centralNormals(H, V, step);
  const ao = bakeAO(hs, H, V, step);
  return { V, step, hs, pos, nor, ao, idx: gridIndices(N, V) };
}

export function buildTerrainGeometry(g: TerrainGridData, field: HeightField, span: number): THREE.BufferGeometry {
  const { V, pos } = g;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(g.nor, 3));
  geo.setAttribute('aAO', new THREE.BufferAttribute(g.ao, 1));
  // bedrock mask (−1 = not provided → shader falls back to slope)
  const rk = new Float32Array(V * V).fill(-1);
  if (field.rock) for (let j = 0; j < V; j++) for (let i = 0; i < V; i++) rk[j * V + i] = field.rock(pos[(j * V + i) * 3], pos[(j * V + i) * 3 + 2]);
  geo.setAttribute('aRock', new THREE.BufferAttribute(rk, 1));
  geo.setIndex(new THREE.BufferAttribute(g.idx, 1));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), span);
  geo.boundingBox = new THREE.Box3(new THREE.Vector3(-span / 2, -10, -span / 2), new THREE.Vector3(span / 2, 30, span / 2));
  return geo;
}

/** half-float height texture for liquids (depth-based colouring) */
export function buildHeightTexture(hs: Float32Array, V: number): THREE.DataTexture {
  const hd = new Uint16Array(V * V);
  for (let k = 0; k < hd.length; k++) hd[k] = THREE.DataUtils.toHalfFloat(hs[k]);
  const tex = new THREE.DataTexture(hd, V, V, THREE.RedFormat, THREE.HalfFloatType);
  tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

/** Interpolates the SAME triangles the GPU renders. */
export function makeHeightSampler(g: TerrainGridData, span: number, N: number) {
  const { hs, V, step } = g;
  return (x: number, z: number) => {
    const fx = Math.min(Math.max((x + span / 2) / step, 0), N - 1e-6);
    const fz = Math.min(Math.max((z + span / 2) / step, 0), N - 1e-6);
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
    const h00 = hs[j * V + i], h10 = hs[j * V + i + 1], h01 = hs[(j + 1) * V + i], h11 = hs[(j + 1) * V + i + 1];
    return u + v <= 1 ? h00 + u * (h10 - h00) + v * (h01 - h00) : h11 + (1 - u) * (h01 - h11) + (1 - v) * (h10 - h11);
  };
}

import * as THREE from 'three';
import { cullToViewFocus, worldCellKey } from '../../../core/focusCull';
import { setMeshBounds } from './faunaBounds';

/**
 * One fauna kind (fish or jellies) split into square world cells by loop centre: one InstancedMesh per cell, so three
 * frustum-culls the fauna of an off-screen lake (or part of a big one) and `cullToFocus` hides cells off the view
 * focus, instead of one planet-wide mesh drawing everything or nothing. Each cell keeps its instances in ascending
 * placement order, so "the first `n` placed instances" (the F8 density rule) is a prefix of every cell: a density
 * change only sets `count`s.
 */
export const FAUNA_CELL_M = 64;

/** Instance buffers of a kind, 4 floats per instance each. */
export type FaunaArrays<B> = { readonly [K in keyof B]: Float32Array };

export interface FaunaKindSpec<B extends FaunaArrays<B>> {
  name: string;
  /** Base geometry; each cell mesh gets its own clone plus its slice of the instance attributes. */
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  /** The placement buffers (written by the layout before `rebuild`). */
  buffers: B;
  /** Instance attribute name → buffer key. */
  attrs: Readonly<Record<string, keyof B & string>>;
  /** Buffer whose first two items per instance are the loop centre (x, z). */
  centre: keyof B & string;
  /** Local-space box every instance of a slice can reach. */
  bounds(slice: B, n: number): THREE.Box3;
  onFrame(): void;
}

export interface FaunaBucketSet {
  readonly meshes: readonly THREE.InstancedMesh[];
  /** Instances drawn (sum of the cells' `count`). */
  readonly count: number;
  /** Re-slices the first `placed` instances of the buffers into cell meshes under `group`. */
  rebuild(placed: number): void;
  /** Draws the instances with placement index < `n`. */
  setCount(n: number): void;
  cullToFocus(): void;
  dispose(): void;
}

interface Cell { mesh: THREE.InstancedMesh; ids: number[] }

function sliceOf<B extends FaunaArrays<B>>(buffers: B, ids: readonly number[]): B {
  const out: Record<string, Float32Array> = {};
  for (const [key, src] of Object.entries(buffers) as Array<[string, Float32Array]>) {
    const dst = new Float32Array(ids.length * 4);
    ids.forEach((id, k) => dst.set(src.subarray(id * 4, id * 4 + 4), k * 4));
    out[key] = dst;
  }
  return out as unknown as B;
}

function cellMesh<B extends FaunaArrays<B>>(spec: FaunaKindSpec<B>, key: string, ids: number[]): THREE.InstancedMesh {
  const slice = sliceOf(spec.buffers, ids);
  const geo = spec.geometry.clone();
  for (const [attr, buf] of Object.entries(spec.attrs)) geo.setAttribute(attr, new THREE.InstancedBufferAttribute(slice[buf], 4));
  const mesh = new THREE.InstancedMesh(geo, spec.material, ids.length);
  mesh.name = `${spec.name} ${key}`;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  setMeshBounds(mesh, spec.bounds(slice, ids.length)); // vertices move on the GPU: bounds come from the placement
  mesh.raycast = () => {}; // never a pick target
  mesh.onBeforeRender = spec.onFrame;
  return mesh;
}

export function createFaunaBucketSet<B extends FaunaArrays<B>>(group: THREE.Group, spec: FaunaKindSpec<B>): FaunaBucketSet {
  let cells: Cell[] = [];
  let meshes: THREE.InstancedMesh[] = [];
  let count = 0;
  const clear = () => {
    for (const { mesh } of cells) { group.remove(mesh); mesh.geometry.dispose(); mesh.dispose(); }
    cells = []; meshes = [];
  };
  return {
    get meshes() { return meshes; },
    get count() { return count; },
    rebuild(placed) {
      clear();
      const byCell = new Map<string, number[]>();
      const c = spec.buffers[spec.centre];
      for (let i = 0; i < placed; i++) {
        const key = worldCellKey(c[i * 4]!, c[i * 4 + 1]!, FAUNA_CELL_M);
        let ids = byCell.get(key);
        if (!ids) byCell.set(key, (ids = []));
        ids.push(i);
      }
      for (const [key, ids] of [...byCell.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
        const mesh = cellMesh(spec, key, ids);
        cells.push({ mesh, ids });
        group.add(mesh);
      }
      meshes = cells.map((cell) => cell.mesh);
      count = 0;
    },
    setCount(n) {
      count = 0;
      for (const { mesh, ids } of cells) {
        let k = 0;
        while (k < ids.length && ids[k]! < n) k++;
        mesh.count = k;
        mesh.visible = k > 0;
        count += k;
      }
    },
    cullToFocus() { cullToViewFocus(meshes, (m) => m.boundingSphere, (m) => m.count > 0); },
    dispose: clear,
  };
}

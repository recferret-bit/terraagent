import { HEX_DIRS, hexIndex } from '@terra/sim/grid/hex';
import { tileXZ } from './hexMath';

/** Plain buffers of one chunk's smooth surface (vertices = tile centres, y = the height layer). */
export interface ChunkBuffers {
  position: Float32Array;
  normal: Float32Array;
  aAO: Float32Array;
  aRock: Float32Array;
  index: Uint32Array;
  /** Tile index of each vertex (a chunk also holds the border vertices of its neighbours' tiles). */
  vertexTile: Int32Array;
}

/**
 * Builds the surface of the tiles in `tiles`: every owned tile t=(q,r) contributes the lattice triangle (t,C,B) with
 * B=(q+1,r), C=(q,r+1) and the triangle (B',C',t) with B'=(q,r-1), C'=(q-1,r), so across all chunks each triangle is
 * built exactly once (a triangle's owner is always one of its own vertices). Normals come from the
 * full six-neighbour fan of the height layer, so they agree across chunk seams.
 */
export function buildChunk(radius: number, tiles: ArrayLike<number>, height: ArrayLike<number>): ChunkBuffers {
  const hx = hexIndex(radius);
  const local = new Map<number, number>();
  const order: number[] = [];
  const vert = (i: number) => {
    let v = local.get(i);
    if (v === undefined) { v = order.length; local.set(i, v); order.push(i); }
    return v;
  };
  const idx: number[] = [];
  for (let n = 0; n < tiles.length; n++) {
    const i = tiles[n]!, q = hx.q[i]!, r = hx.r[i]!;
    const b = hx.indexOf(q + 1, r), c = hx.indexOf(q, r + 1);
    if (b >= 0 && c >= 0) idx.push(vert(i), vert(c), vert(b));
    const b2 = hx.indexOf(q, r - 1), c2 = hx.indexOf(q - 1, r);
    if (b2 >= 0 && c2 >= 0) idx.push(vert(b2), vert(c2), vert(i));
  }
  const V = order.length;
  const position = new Float32Array(V * 3), normal = new Float32Array(V * 3);
  for (let v = 0; v < V; v++) {
    const i = order[v]!, [x, z] = tileXZ(hx.q[i]!, hx.r[i]!);
    position[v * 3] = x; position[v * 3 + 1] = height[i]!; position[v * 3 + 2] = z;
    fanNormal(radius, i, height, normal, v * 3);
  }
  return { position, normal, aAO: new Float32Array(V).fill(1), aRock: new Float32Array(V).fill(-1), index: Uint32Array.from(idx), vertexTile: Int32Array.from(order) };
}

/** Surface normal at tile `i` from the ring of its neighbours (missing neighbours are skipped). */
export function fanNormal(radius: number, i: number, height: ArrayLike<number>, out: Float32Array, o: number): void {
  const hx = hexIndex(radius);
  const q = hx.q[i]!, r = hx.r[i]!, h0 = height[i]!;
  const [x0, z0] = tileXZ(q, r);
  const ring: Array<[number, number, number] | null> = HEX_DIRS.map(([dq, dr]) => {
    const j = hx.indexOf(q + dq, r + dr);
    if (j < 0) return null;
    const [x, z] = tileXZ(q + dq, r + dr);
    return [x - x0, height[j]! - h0, z - z0];
  });
  let nx = 0, ny = 0, nz = 0;
  for (let k = 0; k < 6; k++) {
    const a = ring[k], b = ring[(k + 1) % 6];
    if (!a || !b) continue;
    nx += a[1] * b[2] - a[2] * b[1]; ny += a[2] * b[0] - a[0] * b[2]; nz += a[0] * b[1] - a[1] * b[0];
  }
  if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
  const l = Math.hypot(nx, ny, nz);
  if (l < 1e-9) { out[o] = 0; out[o + 1] = 1; out[o + 2] = 0; return; }
  out[o] = nx / l; out[o + 1] = ny / l; out[o + 2] = nz / l;
}

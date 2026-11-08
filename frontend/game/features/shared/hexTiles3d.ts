import * as THREE from 'three';
import { HEX_DIRS, indexOf, TERRAIN } from '@terra/sim';
import { HEX_WATER_LEVEL } from '@terra/render/planets/hex';
import type { Scene3dService } from './scene3d';

/** The sim's axial neighbour directions (angular order): corner `k` sits between directions `k` and `k + 1`. */
const DIRS = HEX_DIRS;
/** Corner `k` in axial offsets from the centre: the centroid of the centre and its neighbours `k`, `k + 1`. */
const CORNERS: ReadonlyArray<readonly [number, number]> = DIRS.map(([q, r], k) => [(q + DIRS[(k + 1) % 6][0]) / 3, (r + DIRS[(k + 1) % 6][1]) / 3] as const);
/** Mid-point of the side facing neighbour `k`: half-way along the lattice edge centre → neighbour `k`. */
const MIDS: ReadonlyArray<readonly [number, number]> = DIRS.map(([q, r]) => [q / 2, r / 2] as const);
/** Edge ribbon width as a share of the corner-to-centre distance. */
const EDGE_INSET = 0.22;

export interface HexDrapeOptions {
  /** Water hexes: their marks lie on the water surface (`HEX_WATER_LEVEL`), not on the lakebed. */
  isWater?: (q: number, r: number) => boolean;
  /** Height above the ground of the fill (m). */
  lift?: number;
  /** Height above the ground of the outline ribbon (m), a little over the fill. */
  edgeLift?: number;
  /** Each hex shrunk towards its centre (1: whole tile; a ghost footprint uses < 1 so the tiles read apart). */
  shrink?: number;
  /** false: fill only, no outline ribbon. */
  edge?: boolean;
}

type Push = (out: number[], aq: number, ar: number) => void;

/**
 * Ground highlight geometry of a set of hexes: triangle lists (xyz per vertex) of the merged fill of every tile and of
 * one ribbon along the outline of the union. Shared by the construction power zone, the terraform targets and the
 * placement ghosts.
 *
 * The marks are draped exactly on the rendered ground. The ground mesh is a lattice of triangles whose vertices are
 * tile centres (`chunkMesh.ts`, sampled by `heightSampler.ts`); a hex corner is the centroid of one such triangle and
 * the mid-point of a side lies on a lattice edge. So each hex is cut at its side mid-points into 12 pieces, each inside
 * ONE lattice triangle where the ground is a plane: sampling the height at the piece's own vertices (fractional axial
 * coordinates through `tileToWorld`) puts the whole piece on the surface, whatever the slope or the step next to it.
 */
export function hexTileTriangles(s3: Scene3dService, tiles: ReadonlyArray<{ q: number; r: number }>, opts: HexDrapeOptions = {}): { fill: number[]; edge: number[] } {
  const inSet = new Set(tiles.map((t) => `${t.q},${t.r}`));
  const lift = opts.lift ?? 0.04, edgeLift = opts.edgeLift ?? lift + 0.02;
  const s = opts.shrink ?? 1, inner = s * (1 - EDGE_INSET);
  const fill: number[] = [], edge: number[] = [];
  for (const t of tiles) {
    const water = opts.isWater?.(t.q, t.r) === true;
    const at = (dy: number): Push => (out, aq, ar) => {
      const p = s3.tileToWorld(t.q + aq, t.r + ar);
      out.push(p.x, (water ? Math.max(p.y, HEX_WATER_LEVEL) : p.y) + dy, p.z);
    };
    pushHexFill(at(lift), fill, s);
    if (opts.edge === false) continue;
    for (let k = 0; k < 6; k++) {
      if (!inSet.has(`${t.q + DIRS[k][0]},${t.r + DIRS[k][1]}`)) pushSideRibbon(at(edgeLift), edge, k, s, inner);
    }
  }
  return { fill, edge };
}

/** The 12 planar pieces of one hex fill: per side `k`, (centre, corner k-1, mid k) and (centre, mid k, corner k). */
function pushHexFill(v: Push, out: number[], s: number): void {
  for (let k = 0; k < 6; k++) {
    const a = CORNERS[(k + 5) % 6], m = MIDS[k], b = CORNERS[k];
    v(out, 0, 0); v(out, s * a[0], s * a[1]); v(out, s * m[0], s * m[1]);
    v(out, 0, 0); v(out, s * m[0], s * m[1]); v(out, s * b[0], s * b[1]);
  }
}

/** The outline ribbon of side `k`, split at its mid-point (and the mid-point's inset) into two planar quads. */
function pushSideRibbon(v: Push, out: number[], k: number, s: number, inner: number): void {
  const a = CORNERS[(k + 5) % 6], m = MIDS[k], b = CORNERS[k];
  const quad = (p: readonly [number, number], n: readonly [number, number]) => {
    v(out, s * p[0], s * p[1]); v(out, s * n[0], s * n[1]); v(out, inner * n[0], inner * n[1]);
    v(out, s * p[0], s * p[1]); v(out, inner * n[0], inner * n[1]); v(out, inner * p[0], inner * p[1]);
  };
  quad(a, m);
  quad(m, b);
}

/**
 * Change key of {@link hexTileTriangles} for `tiles`: every vertex it builds is a blend of the heights of a tile's
 * centre and its six neighbours, so those heights (to the centimetre) plus the water flags are all it depends on.
 * A mark whose key is unchanged needs no rebuild; a terraform job that moves the ground under it changes the key.
 */
export function hexDrapeKey(s3: Scene3dService, tiles: ReadonlyArray<{ q: number; r: number }>, isWater?: (q: number, r: number) => boolean): string {
  const heights = new Map<string, number>();
  const sample = (q: number, r: number) => {
    const k = `${q},${r}`;
    if (!heights.has(k)) heights.set(k, Math.round(s3.tileToWorld(q, r).y * 100));
  };
  const parts: string[] = [];
  for (const t of tiles) {
    sample(t.q, t.r);
    for (const [dq, dr] of DIRS) sample(t.q + dq, t.r + dr);
    parts.push(`${t.q},${t.r}${isWater?.(t.q, t.r) ? 'w' : ''}`);
  }
  parts.sort();
  const ground = [...heights].map(([k, y]) => `${k}:${y}`).sort();
  return `${parts.join('|')}#${ground.join('|')}`;
}

/** Water test over a view's terrain layer (`shallow` / `deep` tiles), for {@link HexDrapeOptions.isWater}. */
export function waterTileTest(terrain: ArrayLike<number> | undefined, radius: number | undefined): ((q: number, r: number) => boolean) | undefined {
  if (!terrain || typeof radius !== 'number') return undefined;
  return (q, r) => {
    const i = indexOf(radius, q, r);
    const code = i < 0 ? undefined : terrain[i];
    return code === TERRAIN.shallow || code === TERRAIN.deep;
  };
}

/** Replaces the geometry of `mesh` by the triangle list `positions`. */
export function setMeshPositions(mesh: THREE.Mesh, positions: number[]): void {
  mesh.geometry.dispose();
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.computeBoundingSphere();
  mesh.geometry = g;
}

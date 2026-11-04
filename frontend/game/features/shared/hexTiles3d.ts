import * as THREE from 'three';
import type { Scene3dService } from './scene3d';

/** Axial neighbour directions in angular order: corner `k` sits between directions `k` and `k + 1`. */
const DIRS: ReadonlyArray<readonly [number, number]> = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
/** Edge ribbon width as a share of the corner-to-centre distance. */
const EDGE_INSET = 0.22;

interface Vec2 { x: number; z: number }

/**
 * Ground highlight geometry of a set of hexes: triangle lists (xyz per vertex) of the merged fill of every tile and of
 * one ribbon along the outline of the union. Shared by the construction power zone and the terraform targets.
 */
export function hexTileTriangles(s3: Scene3dService, tiles: ReadonlyArray<{ q: number; r: number }>): { fill: number[]; edge: number[] } {
  const inSet = new Set(tiles.map((t) => `${t.q},${t.r}`));
  const o = s3.tileToWorld(0, 0), eq = s3.tileToWorld(1, 0), er = s3.tileToWorld(0, 1);
  const offs: Vec2[] = DIRS.map(([dq, dr]) => ({ x: dq * (eq.x - o.x) + dr * (er.x - o.x), z: dq * (eq.z - o.z) + dr * (er.z - o.z) }));
  // the corner shared by a tile and its neighbours k, k+1 is the centroid of the three centres
  const corners: Vec2[] = offs.map((a, k) => ({ x: (a.x + offs[(k + 1) % 6].x) / 3, z: (a.z + offs[(k + 1) % 6].z) / 3 }));
  const fill: number[] = [], edge: number[] = [];
  for (const t of tiles) {
    const c = s3.tileToWorld(t.q, t.r);
    const y = c.y + 0.05;
    for (let k = 0; k < 6; k++) {
      const a = corners[(k + 5) % 6], b = corners[k]; // the side facing neighbour k
      fill.push(c.x, y, c.z, c.x + a.x, y, c.z + a.z, c.x + b.x, y, c.z + b.z);
      if (inSet.has(`${t.q + DIRS[k][0]},${t.r + DIRS[k][1]}`)) continue;
      const ia = { x: a.x * (1 - EDGE_INSET), z: a.z * (1 - EDGE_INSET) }, ib = { x: b.x * (1 - EDGE_INSET), z: b.z * (1 - EDGE_INSET) };
      const ye = y + 0.02;
      edge.push(c.x + a.x, ye, c.z + a.z, c.x + b.x, ye, c.z + b.z, c.x + ib.x, ye, c.z + ib.z);
      edge.push(c.x + a.x, ye, c.z + a.z, c.x + ib.x, ye, c.z + ib.z, c.x + ia.x, ye, c.z + ia.z);
    }
  }
  return { fill, edge };
}

/** Replaces the geometry of `mesh` by the triangle list `positions`. */
export function setMeshPositions(mesh: THREE.Mesh, positions: number[]): void {
  mesh.geometry.dispose();
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.computeBoundingSphere();
  mesh.geometry = g;
}

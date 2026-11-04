import * as THREE from 'three';
import { hexDistance, placementPowerZoneSources, powerZoneTiles, type CompiledDataLike, type PowerZoneSource } from '@terra/sim';
import type { GameView } from '../../core/registry/types';
import type { Scene3dService } from '../shared/scene3d';
import { viewPlacementWorld } from '../shared/placementWorld';

/** Signal blue of the design system (`--ta-blue-hi` / `--ta-blue`): systems, here the colony's power zone. */
const ZONE_EDGE = 0x5b8cff;
const ZONE_FILL = 0x1e5bff;
/** Axial neighbour directions in angular order: corner `k` sits between directions `k` and `k + 1`. */
const DIRS: ReadonlyArray<readonly [number, number]> = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
/** Edge ribbon width as a share of the corner-to-centre distance. */
const EDGE_INSET = 0.22;
/** Rebuild at most this often while the zone is shown (terraform may move the ground under it). */
const REBUILD_MIN_MS = 400;

interface Vec2 { x: number; z: number }

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/**
 * The colony's power zone on the ground while a construction ghost is armed (owner feedback: "this area has to be
 * highlighted"): one merged translucent fill of every zone tile plus one merged edge ribbon along the union's outline.
 * The tiles come from the sim's own rule (`placementPowerZoneSources` / `powerZoneTiles`, the function `evaluatePlacement`
 * reads), so the highlight is exactly where a building may stand. Rebuilt only when a source (Hub / pylon / pylon
 * order) changes or the ground changed, never per frame.
 */
export class PowerZoneOverlay3D {
  readonly group = new THREE.Group();
  private readonly fillMat = new THREE.MeshBasicMaterial({ color: ZONE_FILL, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  private readonly edgeMat = new THREE.MeshBasicMaterial({ color: ZONE_EDGE, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  private readonly fill = new THREE.Mesh(new THREE.BufferGeometry(), this.fillMat);
  private readonly edge = new THREE.Mesh(new THREE.BufferGeometry(), this.edgeMat);
  private signature = '';
  private lastView: GameView | null = null;
  private sources: PowerZoneSource[] = [];
  private seenTiles: unknown = null;
  private builtTiles: unknown = null;
  private builtAt = -Infinity;
  private pulse = 0;

  constructor(private readonly s3: Scene3dService) {
    this.group.name = 'power-zone-overlay';
    this.group.visible = false;
    this.fill.renderOrder = 3;
    this.edge.renderOrder = 4;
    this.group.add(this.fill, this.edge);
    s3.scene.add(this.group);
  }

  /** Shows the zone of `colonyId` on `view` (`active`: a non-Hub ghost is armed), else hides it. */
  update(view: GameView | undefined, active: boolean, colonyId: number, data: CompiledDataLike, dt: number): void {
    this.group.visible = false;
    if (!active || !view) return;
    if (view !== this.lastView) { // a new sim view (a few per second), not every frame
      this.lastView = view;
      this.sources = placementPowerZoneSources(viewPlacementWorld(view), colonyId, data);
      this.seenTiles = (view as { tiles?: unknown }).tiles ?? this.seenTiles;
    }
    const sources = this.sources;
    if (sources.length === 0) return;
    const sig = sources.map((s) => `${s.kind}:${s.q},${s.r},${s.radius}`).sort().join('|');
    const groundMoved = this.seenTiles !== this.builtTiles && now() - this.builtAt > REBUILD_MIN_MS;
    if (sig !== this.signature || groundMoved) {
      this.rebuild(sources, (view as { planet?: { radius?: number } }).planet?.radius);
      this.signature = sig;
      this.builtTiles = this.seenTiles;
      this.builtAt = now();
    }
    this.pulse += dt;
    this.edgeMat.opacity = 0.7 + 0.15 * Math.sin(this.pulse * 3);
    this.group.visible = true;
  }

  private rebuild(sources: readonly PowerZoneSource[], mapRadius?: number): void {
    const inMap = (q: number, r: number) => mapRadius === undefined || hexDistance(0, 0, q, r) <= mapRadius;
    const tiles = powerZoneTiles(sources).filter((t) => inMap(t.q, t.r));
    const inZone = new Set(tiles.map((t) => `${t.q},${t.r}`));
    const o = this.s3.tileToWorld(0, 0), eq = this.s3.tileToWorld(1, 0), er = this.s3.tileToWorld(0, 1);
    const offs: Vec2[] = DIRS.map(([dq, dr]) => ({ x: dq * (eq.x - o.x) + dr * (er.x - o.x), z: dq * (eq.z - o.z) + dr * (er.z - o.z) }));
    // the corner shared by a tile and its neighbours k, k+1 is the centroid of the three centres
    const corners: Vec2[] = offs.map((a, k) => ({ x: (a.x + offs[(k + 1) % 6].x) / 3, z: (a.z + offs[(k + 1) % 6].z) / 3 }));
    const fill: number[] = [], edge: number[] = [];
    for (const t of tiles) {
      const c = this.s3.tileToWorld(t.q, t.r);
      const y = c.y + 0.05;
      for (let k = 0; k < 6; k++) {
        const a = corners[(k + 5) % 6], b = corners[k]; // the side facing neighbour k
        fill.push(c.x, y, c.z, c.x + a.x, y, c.z + a.z, c.x + b.x, y, c.z + b.z);
        if (inZone.has(`${t.q + DIRS[k][0]},${t.r + DIRS[k][1]}`)) continue;
        const ia = { x: a.x * (1 - EDGE_INSET), z: a.z * (1 - EDGE_INSET) }, ib = { x: b.x * (1 - EDGE_INSET), z: b.z * (1 - EDGE_INSET) };
        const ye = y + 0.02;
        edge.push(c.x + a.x, ye, c.z + a.z, c.x + b.x, ye, c.z + b.z, c.x + ib.x, ye, c.z + ib.z);
        edge.push(c.x + a.x, ye, c.z + a.z, c.x + ib.x, ye, c.z + ib.z, c.x + ia.x, ye, c.z + ia.z);
      }
    }
    this.setPositions(this.fill, fill);
    this.setPositions(this.edge, edge);
  }

  private setPositions(mesh: THREE.Mesh, positions: number[]): void {
    mesh.geometry.dispose();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.computeBoundingSphere();
    mesh.geometry = g;
  }

  dispose(): void {
    this.s3.scene.remove(this.group);
    this.fill.geometry.dispose();
    this.edge.geometry.dispose();
    this.fillMat.dispose();
    this.edgeMat.dispose();
  }
}

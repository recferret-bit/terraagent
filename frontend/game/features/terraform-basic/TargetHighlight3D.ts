import * as THREE from 'three';
import type { GameView } from '../../core/registry/types';
import { hexTileTriangles, setMeshPositions } from '../shared/hexTiles3d';
import type { TileCoord } from '../shared/pointer';
import type { Scene3dService } from '../shared/scene3d';
import { extractColonyOrders } from './TileOverlay';
import { colonyWorkJobs } from './workStatus';

/** Action orange of the design system (`--ta-orange`): selection and orders. The power zone is blue, so the two never read alike. */
const TARGET_FILL = 0xff7a1a;
const TARGET_EDGE = 0xffc266;

/** Every hex the colony has an open terraform job on (queued or running): orders of the host's terraform queue and `work` jobs. */
export function terraformTargetTiles(view: GameView | null | undefined, colonyId: number): TileCoord[] {
  const seen = new Map<string, TileCoord>();
  const add = (q: number, r: number) => seen.set(`${q},${r}`, { q, r });
  for (const o of extractColonyOrders(view, colonyId)) for (const j of o.jobs) add(j.q, j.r);
  for (const j of colonyWorkJobs(view, colonyId)) if (j.mode === 'terraform') add(j.q, j.r);
  return [...seen.values()];
}

/**
 * The hexes targeted for terraforming, drawn on the ground (merged translucent orange fill + outline ribbon). A hex
 * stays lit from the moment its order is queued until the host removes its job (done or cancelled). Rebuilt only when
 * the set of hexes changes.
 */
export class TargetHighlight3D {
  readonly group = new THREE.Group();
  private readonly fillMat = new THREE.MeshBasicMaterial({ color: TARGET_FILL, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  private readonly edgeMat = new THREE.MeshBasicMaterial({ color: TARGET_EDGE, transparent: true, opacity: 0.95, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  private readonly fill = new THREE.Mesh(new THREE.BufferGeometry(), this.fillMat);
  private readonly edge = new THREE.Mesh(new THREE.BufferGeometry(), this.edgeMat);
  private signature = '';
  private tiles: TileCoord[] = [];

  constructor(private readonly s3: Scene3dService) {
    this.group.name = 'terraform-targets';
    this.group.visible = false;
    this.fill.renderOrder = 5;
    this.edge.renderOrder = 6;
    this.group.add(this.fill, this.edge);
    s3.scene.add(this.group);
  }

  /** The hexes currently lit (tests and tools). */
  getTiles(): readonly TileCoord[] {
    return this.tiles;
  }

  update(view: GameView | null | undefined, colonyId: number): void {
    const tiles = terraformTargetTiles(view, colonyId);
    // the ground height is part of the key: a worked hex moves the ground the ribbon lies on
    const sig = tiles.map((t) => `${t.q},${t.r},${Math.round(this.s3.tileToWorld(t.q, t.r).y * 20)}`).sort().join('|');
    if (sig === this.signature) return;
    this.signature = sig;
    this.tiles = tiles;
    this.group.visible = tiles.length > 0;
    if (tiles.length === 0) return;
    const { fill, edge } = hexTileTriangles(this.s3, tiles);
    setMeshPositions(this.fill, fill);
    setMeshPositions(this.edge, edge);
  }

  dispose(): void {
    this.s3.scene.remove(this.group);
    this.fill.geometry.dispose();
    this.edge.geometry.dispose();
    this.fillMat.dispose();
    this.edgeMat.dispose();
  }
}

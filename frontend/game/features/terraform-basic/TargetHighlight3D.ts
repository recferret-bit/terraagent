import * as THREE from 'three';
import type { GameView } from '../../core/registry/types';
import { hexTileTriangles, setMeshPositions } from '../shared/hexTiles3d';
import type { TileCoord } from '../shared/pointer';
import type { Scene3dService } from '../shared/scene3d';
import { terraformTargetTiles } from './targets';

/** Action orange of the design system (`--ta-orange`): selection and orders. The power zone is blue, so the two never read alike. */
const TARGET_FILL = 0xff7a1a;
const TARGET_EDGE = 0xffc266;

/**
 * The hexes targeted for terraforming, drawn on the ground (merged translucent orange fill + outline ribbon). A hex
 * stays lit from the moment its order is queued until the host removes its job (done or cancelled). Rebuilt only when
 * the set of hexes changes.
 */
export class TargetHighlight3D {
  readonly group = new THREE.Group();
  // No depth test: a targeted hex must read through water (the lakebed lies below the surface), slopes and buildings.
  private readonly fillMat = new THREE.MeshBasicMaterial({ color: TARGET_FILL, transparent: true, opacity: 0.4, depthTest: false, depthWrite: false, side: THREE.DoubleSide });
  private readonly edgeMat = new THREE.MeshBasicMaterial({ color: TARGET_EDGE, transparent: true, opacity: 1, depthTest: false, depthWrite: false, side: THREE.DoubleSide });
  private readonly fill = new THREE.Mesh(new THREE.BufferGeometry(), this.fillMat);
  private readonly edge = new THREE.Mesh(new THREE.BufferGeometry(), this.edgeMat);
  private signature = '';
  private tiles: TileCoord[] = [];

  constructor(private readonly s3: Scene3dService) {
    this.group.name = 'terraform-targets';
    this.group.visible = false;
    this.fill.renderOrder = 1000;
    this.edge.renderOrder = 1001;
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

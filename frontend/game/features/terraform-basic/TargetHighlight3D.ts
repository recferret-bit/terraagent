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
  private readonly hoverGroup = new THREE.Group();
  // No depth test: a targeted hex must read through water (the lakebed lies below the surface), slopes and buildings.
  private readonly fillMat = new THREE.MeshBasicMaterial({ color: TARGET_FILL, transparent: true, opacity: 0.4, depthTest: false, depthWrite: false, side: THREE.DoubleSide });
  private readonly edgeMat = new THREE.MeshBasicMaterial({ color: TARGET_EDGE, transparent: true, opacity: 1, depthTest: false, depthWrite: false, side: THREE.DoubleSide });
  private readonly fill = new THREE.Mesh(new THREE.BufferGeometry(), this.fillMat);
  private readonly edge = new THREE.Mesh(new THREE.BufferGeometry(), this.edgeMat);
  // The hex under the armed brush: the same orange, fainter than a queued target. Same no-depth-test rule.
  private readonly hoverFillMat = new THREE.MeshBasicMaterial({ color: TARGET_FILL, transparent: true, opacity: 0.2, depthTest: false, depthWrite: false, side: THREE.DoubleSide });
  private readonly hoverEdgeMat = new THREE.MeshBasicMaterial({ color: TARGET_EDGE, transparent: true, opacity: 0.75, depthTest: false, depthWrite: false, side: THREE.DoubleSide });
  private readonly hoverFill = new THREE.Mesh(new THREE.BufferGeometry(), this.hoverFillMat);
  private readonly hoverEdge = new THREE.Mesh(new THREE.BufferGeometry(), this.hoverEdgeMat);
  private hover: TileCoord | null = null;
  private hoverSig = '';
  private signature = '';
  private tiles: TileCoord[] = [];

  constructor(private readonly s3: Scene3dService) {
    this.group.name = 'terraform-targets';
    this.group.visible = false;
    this.fill.renderOrder = 1000;
    this.edge.renderOrder = 1001;
    this.group.add(this.fill, this.edge);
    this.hoverFill.renderOrder = 998;
    this.hoverEdge.renderOrder = 999;
    this.hoverFill.visible = this.hoverEdge.visible = false;
    s3.scene.add(this.group, this.hoverGroup);
    this.hoverGroup.name = 'terraform-hover';
    this.hoverGroup.add(this.hoverFill, this.hoverEdge);
  }

  /** The hex under the armed brush (`null`: none). Drawn like a target, fainter; rebuilt only when the hex or its ground height changes. */
  setHover(tile: TileCoord | null): void {
    this.hover = tile;
    const show = tile !== null;
    this.hoverFill.visible = this.hoverEdge.visible = show;
    if (!tile) { this.hoverSig = ''; return; }
    const sig = `${tile.q},${tile.r},${Math.round(this.s3.tileToWorld(tile.q, tile.r).y * 20)}`;
    if (sig === this.hoverSig) return;
    this.hoverSig = sig;
    const { fill, edge } = hexTileTriangles(this.s3, [tile]);
    setMeshPositions(this.hoverFill, fill);
    setMeshPositions(this.hoverEdge, edge);
  }

  /** The hex currently previewed under the brush (tests and tools). */
  getHover(): TileCoord | null {
    return this.hover;
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
    this.s3.scene.remove(this.group, this.hoverGroup);
    this.hoverFill.geometry.dispose();
    this.hoverEdge.geometry.dispose();
    this.hoverFillMat.dispose();
    this.hoverEdgeMat.dispose();
    this.fill.geometry.dispose();
    this.edge.geometry.dispose();
    this.fillMat.dispose();
    this.edgeMat.dispose();
  }
}

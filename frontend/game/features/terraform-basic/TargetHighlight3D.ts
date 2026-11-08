import * as THREE from 'three';
import { indexOf, TERRAIN } from '@terra/sim';
import type { GameView } from '../../core/registry/types';
import { hexDrapeKey, hexTileTriangles, setMeshPositions, waterTileTest } from '../shared/hexTiles3d';
import type { TileCoord } from '../shared/pointer';
import type { Scene3dService } from '../shared/scene3d';
import { slopeDiscOrTile, terraformTargetTiles } from './targets';

/**
 * Dark blue, kept apart from the power zone (`0x1e5bff` / `0x5b8cff`) so a build ghost and a
 * terraform disc do not read as the same mark. Transparent enough to see dune sand through it.
 */
const TARGET_FILL = 0x0e2a80;
const TARGET_EDGE = 0x163888;

/** Ground decal: depth-tested so a worker or a dune in front of it covers it, no depth write, pulled onto the mesh. */
function decalMat(color: number, opacity: number, offset: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: offset,
    polygonOffsetUnits: offset,
  });
}

/**
 * The hexes targeted for terraforming, drawn on the ground (merged translucent fill + outline ribbon). A hex
 * stays lit from the moment its order is queued until the host removes its job (done or cancelled). A slope
 * hex lights the dune disc the job will clear. Rebuilt only when the set of hexes or their ground height changes.
 */
export class TargetHighlight3D {
  readonly group = new THREE.Group();
  private readonly hoverGroup = new THREE.Group();
  private readonly fillMat = decalMat(TARGET_FILL, 0.32, -2);
  private readonly edgeMat = decalMat(TARGET_EDGE, 0.55, -3);
  private readonly fill = new THREE.Mesh(new THREE.BufferGeometry(), this.fillMat);
  private readonly edge = new THREE.Mesh(new THREE.BufferGeometry(), this.edgeMat);
  private readonly hoverFillMat = decalMat(TARGET_FILL, 0.18, -2);
  private readonly hoverEdgeMat = decalMat(TARGET_EDGE, 0.4, -3);
  private readonly hoverFill = new THREE.Mesh(new THREE.BufferGeometry(), this.hoverFillMat);
  private readonly hoverEdge = new THREE.Mesh(new THREE.BufferGeometry(), this.hoverEdgeMat);
  private hover: TileCoord | null = null;
  private hoverSig = '';
  private signature = '';
  private tiles: TileCoord[] = [];
  private view: GameView | null | undefined = null;
  /** Views carry `tiles` only when they changed. The disc is read from the last layers we saw. */
  private groundTiles: GameView['tiles'] | null = null;
  private groundRadius: number | undefined;

  constructor(private readonly s3: Scene3dService) {
    this.group.name = 'terraform-targets';
    this.group.visible = false;
    this.fill.renderOrder = 22;
    this.edge.renderOrder = 23;
    this.group.add(this.fill, this.edge);
    this.hoverFill.renderOrder = 20;
    this.hoverEdge.renderOrder = 21;
    this.hoverFill.visible = this.hoverEdge.visible = false;
    s3.scene.add(this.group, this.hoverGroup);
    this.hoverGroup.name = 'terraform-hover';
    this.hoverGroup.add(this.hoverFill, this.hoverEdge);
  }

  /** A view whose `tiles` are the last ground layers, so a slope disc or crater disc can be listed after a blob-only update. */
  private withGround(view: GameView | null | undefined): GameView | null | undefined {
    const incomingTiles = view?.tiles ?? view?.sim?.view?.tiles;
    if (incomingTiles?.terrain) this.groundTiles = incomingTiles;
    const incomingRadius = view?.planet?.radius ?? view?.sim?.view?.planet?.radius;
    if (typeof incomingRadius === 'number') this.groundRadius = incomingRadius;
    if (!view || !this.groundTiles || this.groundRadius === undefined) return view;
    const planet = {
      id: view.planet?.id ?? view.sim?.view?.planet?.id ?? '',
      type: view.planet?.type ?? view.sim?.view?.planet?.type ?? '',
      radius: this.groundRadius,
    };
    const blobs = view.blobs ?? view.sim?.view?.blobs;
    return { ...view, planet, tiles: this.groundTiles, ...(blobs ? { blobs } : {}) };
  }

  private hasHoleTile(tiles: readonly TileCoord[]): boolean {
    const terrain = this.groundTiles?.terrain;
    const radius = this.groundRadius;
    if (!terrain || typeof radius !== 'number') return false;
    for (const t of tiles) {
      const i = indexOf(radius, t.q, t.r);
      if (i >= 0 && terrain[i] === TERRAIN.hole) return true;
    }
    return false;
  }

  /** The hex under the armed brush (`null`: none). A slope hex previews the whole dune disc; a hole hex previews the crater. */
  setHover(tile: TileCoord | null): void {
    this.hover = tile;
    const tiles = tile ? slopeDiscOrTile(this.view, tile) : [];
    this.hoverFill.visible = this.hoverEdge.visible = tiles.length > 0;
    if (tiles.length === 0) { this.hoverSig = ''; return; }
    const isWater = this.isWater();
    const hole = this.hasHoleTile(tiles);
    const sig = `${hexDrapeKey(this.s3, tiles, isWater)}${hole ? ':hole' : ''}`;
    if (sig === this.hoverSig) return;
    this.hoverSig = sig;
    const { fill, edge } = hexTileTriangles(this.s3, tiles, hole ? { isWater, lift: 0.14, edgeLift: 0.17 } : { isWater });
    setMeshPositions(this.hoverFill, fill);
    setMeshPositions(this.hoverEdge, edge);
  }

  /** Water hexes of the last ground layers seen: their marks lie on the water surface. */
  private isWater(): ((q: number, r: number) => boolean) | undefined {
    return waterTileTest(this.groundTiles?.terrain, this.groundRadius);
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
    this.view = this.withGround(view);
    const tiles = terraformTargetTiles(this.view, colonyId);
    const isWater = this.isWater();
    const hole = this.hasHoleTile(tiles);
    // the ground the mark is draped on is part of the key: a worked hex (or its neighbour) moves it
    const sig = `${hexDrapeKey(this.s3, tiles, isWater)}${hole ? ':hole' : ''}`;
    if (sig !== this.signature) {
      this.signature = sig;
      this.tiles = tiles;
      this.group.visible = tiles.length > 0;
      if (tiles.length > 0) {
        const { fill, edge } = hexTileTriangles(this.s3, tiles, hole ? { isWater, lift: 0.14, edgeLift: 0.17 } : { isWater });
        setMeshPositions(this.fill, fill);
        setMeshPositions(this.edge, edge);
      }
    }
    if (this.hover) this.setHover(this.hover);
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

import * as THREE from 'three';
import { hexDistance, placementPowerZoneSources, powerZoneTiles, type CompiledDataLike, type PowerZoneSource } from '@terra/sim';
import type { GameView } from '../../core/registry/types';
import type { Scene3dService } from '../shared/scene3d';
import { viewPlacementWorld } from '../shared/placementWorld';
import { hexTileTriangles, setMeshPositions, waterTileTest } from '../shared/hexTiles3d';

/** Signal blue of the design system (`--ta-blue-hi` / `--ta-blue`): systems, here the colony's power zone. */
const ZONE_EDGE = 0x5b8cff;
const ZONE_FILL = 0x1e5bff;
/** Rebuild at most this often while the zone is shown (terraform may move the ground under it). */
const REBUILD_MIN_MS = 400;

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
    const terrain = (this.seenTiles as { terrain?: ArrayLike<number> } | null)?.terrain;
    // draped on the ground (on the water surface over a lake), see `hexTileTriangles`
    const { fill, edge } = hexTileTriangles(this.s3, tiles, { isWater: waterTileTest(terrain, mapRadius) });
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

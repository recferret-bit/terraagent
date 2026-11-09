import * as THREE from 'three';
import { hexDrapeKey, hexTileTriangles, setMeshPositions } from './hexTiles3d';
import type { Scene3dService } from './scene3d';

/** Each footprint hex is drawn a little smaller than its tile, so neighbouring tiles read apart. */
const FOOTPRINT_SHRINK = 0.96;

/** One footprint tile of a placement ghost: where, whether that tile is valid, and whether it is water. */
export interface FootprintTile { q: number; r: number; valid: boolean; water?: boolean }

const footprintMat = (color: number): THREE.MeshBasicMaterial =>
  new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: 0.38, depthWrite: false, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });

const isWater = (tiles: ReadonlyArray<FootprintTile>, q: number, r: number): boolean =>
  tiles.some((t) => t.q === q && t.r === r && t.water === true);

/**
 * The translucent hex footprint of a placement ghost, draped on the ground (`hexTileTriangles`): one merged mesh of
 * the valid tiles and one of the invalid tiles. Rebuilt only when the tiles, their validity or the ground under them
 * change. Shared by the Hub ghost and the construction ghost.
 */
export class HexFootprint3D {
  readonly group = new THREE.Group();
  readonly okMat: THREE.MeshBasicMaterial;
  readonly badMat: THREE.MeshBasicMaterial;
  readonly ok: THREE.Mesh;
  readonly bad: THREE.Mesh;
  private key = '';

  constructor(private readonly s3: Scene3dService, colors: { ok: number; bad: number }) {
    this.okMat = footprintMat(colors.ok);
    this.badMat = footprintMat(colors.bad);
    this.ok = new THREE.Mesh(new THREE.BufferGeometry(), this.okMat);
    this.bad = new THREE.Mesh(new THREE.BufferGeometry(), this.badMat);
    this.ok.name = 'ghost-footprint-ok';
    this.bad.name = 'ghost-footprint-bad';
    this.ok.renderOrder = this.bad.renderOrder = 5;
    this.ok.visible = this.bad.visible = false;
    this.group.name = 'ghost-footprint';
    this.group.add(this.ok, this.bad);
  }

  update(tiles: ReadonlyArray<FootprintTile>): void {
    const key = `${tiles.map((t) => (t.valid ? '+' : '-')).join('')}#${hexDrapeKey(this.s3, tiles, (q, r) => isWater(tiles, q, r))}`;
    if (key === this.key) return;
    this.key = key;
    this.build(this.ok, tiles.filter((t) => t.valid));
    this.build(this.bad, tiles.filter((t) => !t.valid));
  }

  /** Pulses both materials (`k` 0.7..1). */
  setPulse(k: number): void {
    this.okMat.opacity = 0.3 + 0.1 * k;
    this.badMat.opacity = 0.34 + 0.1 * k;
  }

  private build(mesh: THREE.Mesh, tiles: ReadonlyArray<FootprintTile>): void {
    mesh.visible = tiles.length > 0;
    if (tiles.length === 0) return;
    const water = (q: number, r: number) => isWater(tiles, q, r);
    const { fill } = hexTileTriangles(this.s3, tiles, { shrink: FOOTPRINT_SHRINK, edge: false, lift: 0.06, isWater: water });
    setMeshPositions(mesh, fill);
  }

  dispose(): void {
    this.ok.geometry.dispose();
    this.bad.geometry.dispose();
    this.okMat.dispose();
    this.badMat.dispose();
  }
}

/**
 * Swaps a ghost body's mesh materials for `mats.ok` or `mats.bad` when validity changes, disposing replaced
 * one-off archetype materials while preserving shared geometry (FF-16).
 */
export function applyGhostMaterialTint(
  body: THREE.Object3D | null,
  currentTint: boolean | null,
  valid: boolean,
  mats: { ok: THREE.Material; bad: THREE.Material },
): boolean | null {
  if (!body || currentTint === valid) return currentTint;
  const m = valid ? mats.ok : mats.bad;
  const ghostMats = new Set<THREE.Material>([mats.ok, mats.bad]);
  const replaced = new Set<THREE.Material>();
  body.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    for (const old of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (old && !ghostMats.has(old)) replaced.add(old);
    }
    mesh.material = m;
  });
  for (const old of replaced) old.dispose();
  return valid;
}

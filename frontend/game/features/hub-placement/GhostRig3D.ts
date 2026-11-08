import * as THREE from 'three';
import { createArchetypeMesh } from '@terra/render/kitbash';
import { applyGhostMaterialTint, HexFootprint3D } from '../shared/hexFootprint3d';
import type { Scene3dService } from '../shared/scene3d';
import type { HubGhostState } from './GhostEvaluator';

const VALID = 0x39ff88;
const INVALID = 0xff3b3b;
const FOOTPRINT = 'building.commandHub';

/** What the rig needs from the placement controller. */
export interface GhostRigSource {
  isPlacementActive(): boolean;
  getGhostState(): HubGhostState;
}

/** Translucent 3D footprint (draped on the ground, tinted per tile) plus a ghost Hub mesh, tinted green/red by validity. */
export class GhostRig3D {
  readonly group = new THREE.Group();
  private readonly footprint: HexFootprint3D;
  private readonly bodyMats = { ok: this.mat(VALID, 0.45), bad: this.mat(INVALID, 0.5) };
  private body: THREE.Object3D | null = null;
  private bodyBiome = '';
  /** Validity the body is tinted for (`null`: not tinted yet). */
  private bodyTint: boolean | null = null;
  private pulse = 0;

  constructor(private readonly s3: Scene3dService) {
    this.group.name = 'hub-ghost-3d';
    this.group.visible = false;
    this.footprint = new HexFootprint3D(s3, { ok: VALID, bad: INVALID });
    this.group.add(this.footprint.group);
    s3.scene.add(this.group);
  }

  private mat(color: number, opacity: number): THREE.MeshBasicMaterial {
    return new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide });
  }

  private ensureBody(): void {
    const biome = this.s3.biomeKey();
    if (this.body && this.bodyBiome === biome) return;
    if (this.body) this.group.remove(this.body);
    this.bodyBiome = biome;
    this.bodyTint = null;
    try {
      this.body = createArchetypeMesh(FOOTPRINT, biome);
      const projRig = this.body.getObjectByName('entity-projector-rig');
      if (projRig) this.body.remove(projRig);
      this.body.traverse((o) => { o.castShadow = false; o.receiveShadow = false; });
      this.group.add(this.body);
    } catch { this.body = null; }
  }

  /**
   * Swaps the body's materials for the ghost material when the validity changes. The archetype's own material (one
   * per `createArchetypeMesh` call) is disposed when first replaced; the geometry is the catalog's shared cache and
   * is never disposed here (FF-16).
   */
  private tint(valid: boolean): void {
    this.bodyTint = applyGhostMaterialTint(this.body, this.bodyTint, valid, this.bodyMats);
  }

  update(src: GhostRigSource, dt: number): void {
    const on = src.isPlacementActive();
    this.group.visible = on;
    if (!on) return;
    const g = src.getGhostState();
    this.pulse += dt;
    const k = 0.85 + 0.15 * Math.sin(this.pulse * 5);
    this.footprint.update(g.footprintTiles);
    this.footprint.setPulse(k);
    this.ensureBody();
    if (this.body) {
      const c = this.s3.tileToWorld(g.q, g.r);
      this.body.position.set(c.x, c.y, c.z);
      this.tint(g.valid);
    }
  }

  dispose(): void {
    this.s3.scene.remove(this.group);
    this.footprint.dispose();
    for (const m of Object.values(this.bodyMats)) m.dispose();
  }
}

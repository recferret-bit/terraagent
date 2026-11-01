import * as THREE from 'three';
import { createArchetypeMesh } from '@terra/render/kitbash';
import type { Scene3dService } from '../entities/services';
import type { HubGhostState } from './GhostEvaluator';

const VALID = 0x39ff88;
const INVALID = 0xff3b3b;
const HEX_R = 2 / Math.sqrt(3); // TILE_M / √3 (pointy-top circumradius)
const FOOTPRINT = 'building.commandHub';

/** What the rig needs from the placement controller. */
export interface GhostRigSource {
  isPlacementActive(): boolean;
  getGhostState(): HubGhostState;
}

const hexGeo = (): THREE.BufferGeometry => {
  const g = new THREE.CircleGeometry(HEX_R * 0.96, 6);
  g.rotateX(-Math.PI / 2);
  g.rotateY(Math.PI / 6);
  return g;
};

/** Translucent 3D footprint (one hex per tile, tinted per tile) plus a ghost Hub mesh, tinted green/red by validity. */
export class GhostRig3D {
  readonly group = new THREE.Group();
  private readonly geo = hexGeo();
  private readonly tiles: THREE.Mesh[] = [];
  private readonly mats = { ok: this.mat(VALID, 0.38), bad: this.mat(INVALID, 0.42) };
  private readonly bodyMats = { ok: this.mat(VALID, 0.45), bad: this.mat(INVALID, 0.5) };
  private body: THREE.Object3D | null = null;
  private bodyBiome = '';
  private pulse = 0;

  constructor(private readonly s3: Scene3dService) {
    this.group.name = 'hub-ghost-3d';
    this.group.visible = false;
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
    try {
      this.body = createArchetypeMesh(FOOTPRINT, biome);
      this.body.traverse((o) => { o.castShadow = false; o.receiveShadow = false; });
      this.group.add(this.body);
    } catch { this.body = null; }
  }

  private tint(root: THREE.Object3D, m: THREE.Material): void {
    root.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).material = m; });
  }

  update(src: GhostRigSource, dt: number): void {
    const on = src.isPlacementActive();
    this.group.visible = on;
    if (!on) return;
    const g = src.getGhostState();
    this.pulse += dt;
    const k = 0.85 + 0.15 * Math.sin(this.pulse * 5);
    while (this.tiles.length < g.footprintTiles.length) {
      const m = new THREE.Mesh(this.geo, this.mats.ok);
      m.renderOrder = 5;
      this.tiles.push(m); this.group.add(m);
    }
    this.tiles.forEach((m, i) => {
      const t = g.footprintTiles[i];
      m.visible = !!t;
      if (!t) return;
      const p = this.s3.tileToWorld(t.q, t.r);
      m.position.set(p.x, p.y + 0.12, p.z);
      m.material = t.valid ? this.mats.ok : this.mats.bad;
    });
    this.mats.ok.opacity = 0.3 + 0.1 * k; this.mats.bad.opacity = 0.34 + 0.1 * k;
    this.ensureBody();
    if (this.body) {
      const c = this.s3.tileToWorld(g.q, g.r);
      this.body.position.set(c.x, c.y, c.z);
      this.tint(this.body, g.valid ? this.bodyMats.ok : this.bodyMats.bad);
    }
  }

  dispose(): void {
    this.s3.scene.remove(this.group);
    this.geo.dispose();
    for (const m of [...Object.values(this.mats), ...Object.values(this.bodyMats)]) m.dispose();
  }
}

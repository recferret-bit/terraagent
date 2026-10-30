import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { tickArchetypeMesh, type FittedModel } from '@shared/engine/visuals/space/placeholders';
import { lerp, smoother } from '../math';
import type { DescentContext, FramePart, FrameState } from './FrameState';

/** Hatch/ramp opening and the hero walking out after touchdown; also ticks the idle animation of the pod models. */
export class Touchdown implements FramePart {
  private hatchMat = new THREE.MeshStandardMaterial({ color: 0x9aa2ad, metalness: 0.6, roughness: 0.4 });
  private hatchGeo: RoundedBoxGeometry;
  private hatchLight = new THREE.MeshStandardMaterial({ color: 0x113344, emissive: 0x30d8ff, emissiveIntensity: 3.5 });
  private hatchLightGeo: RoundedBoxGeometry;
  private pivot = new THREE.Group(); private hinge = new THREE.Group();
  private delivered = false;

  constructor(private ctx: DescentContext, private podRoot: THREE.Object3D, private pod: FittedModel, private carrier: FittedModel,
    private hero: FittedModel, private podH: number, private podR: number) {
    this.hatchGeo = new RoundedBoxGeometry(podR * 0.85, podH * 0.5, 0.1, 3, 0.04);
    this.hatchLightGeo = new RoundedBoxGeometry(podR * 0.7, 0.07, 0.07, 2, 0.02);
    this.pivot.add(this.hinge);
    const hatch = new THREE.Mesh(this.hatchGeo, this.hatchMat); hatch.position.y = podH * 0.25; hatch.castShadow = true;
    const strip = new THREE.Mesh(this.hatchLightGeo, this.hatchLight); strip.position.set(0, podH * 0.5 - 0.1, 0.06);
    this.hinge.add(hatch, strip); this.pivot.visible = false; podRoot.add(this.pivot);
    hero.root.visible = false;
  }

  update(f: FrameState) {
    const tn = f.tn, { fd, fdYaw, podLand, L } = this.ctx.traj, { podH, podR, hero } = this;
    const td = tn >= 33.95;
    this.pivot.visible = td;
    if (td) {
      const slide = smoother(34.0, 34.35, tn), ramp = smoother(34.3, 34.75, tn);
      this.pivot.rotation.set(0, fdYaw - this.podRoot.rotation.y, 0);
      this.pivot.position.set(0, 0, 0);
      this.hinge.position.set(0, -podH * 0.5 + podH * 0.07 + 0.0, podR * (0.55 + 0.45 * slide));
      this.hinge.rotation.x = 1.75 * ramp;
      this.hatchLight.emissiveIntensity = 3.5 * slide;
    }
    const hp = smoother(34.35, 34.95, tn);
    hero.root.visible = tn >= 34.3 && !this.delivered;
    if (hero.root.visible) {
      hero.root.position.set(lerp(podLand.x + fd.x * podR * 0.3, L.x, hp), L.y + 0.05 * Math.abs(Math.sin(hp * Math.PI * 4)) * (hp < 1 ? 1 : 0), lerp(podLand.z + fd.z * podR * 0.3, L.z, hp));
      hero.root.rotation.set(0, fdYaw, 0);
    }
    if (!this.delivered) tickArchetypeMesh(hero.mesh, tn);
    tickArchetypeMesh(this.pod.mesh, tn); tickArchetypeMesh(this.carrier.mesh, tn);
  }

  /** Detaches the hero mesh into the game scene and returns it. */
  handHero(): THREE.Object3D {
    const mesh = this.hero.mesh;
    this.ctx.scene.attach(mesh);
    this.hero.root.removeFromParent();
    mesh.visible = true;
    this.delivered = true;
    return mesh;
  }

  dispose() {
    for (const g of [this.hatchGeo, this.hatchLightGeo]) g.dispose();
    for (const m of [this.hatchMat, this.hatchLight]) m.dispose();
    if (!this.delivered) this.hero.dispose();
    else this.hero.root.removeFromParent();
  }
}

import * as THREE from 'three';
import { createFlames, type Flames } from '../../descent/Flames';
import { acquireModel, tickArchetypeMesh, type FittedModel } from './placeholders';

/** Cosmetic cargo flight using the existing colony pod and its HDR retro engines. */
export class CargoFlight {
  private readonly model: FittedModel;
  private elapsed = 0;
  private readonly flames: Flames;
  constructor(scene: THREE.Scene, biome: string,
    private readonly pad: { x: number; y: number; z: number },
    private readonly direction: 'export' | 'import') {
    this.model = acquireModel('ship.dropPod', biome, { size: 1.5, mode: 'height', force: true });
    this.flames = createFlames([0, 1, 2, 3].map((i) => {
      const a = i * Math.PI / 2 + Math.PI / 4;
      return { pos: new THREE.Vector3(Math.cos(a) * 1.28, 0.5, Math.sin(a) * 1.28),
        dir: new THREE.Vector3(Math.cos(a) * 0.43, -0.9, Math.sin(a) * 0.43) };
    }));
    this.model.mesh.add(this.flames.group);
    this.model.root.name = `cargo-flight:${direction}`;
    scene.add(this.model.root);
    this.update(0);
  }

  update(dt: number): boolean {
    this.elapsed += Math.max(0, dt);
    const t = Math.min(1, this.elapsed / 6);
    const flight = this.direction === 'export' ? t : 1 - t;
    const altitude = 24 * flight * flight;
    this.model.root.position.set(this.pad.x, this.pad.y + altitude, this.pad.z);
    this.flames.group.visible = flight > 0.015;
    this.flames.u.uI.value = Math.min(1, flight * 5);
    this.flames.u.uTime.value = this.elapsed;
    tickArchetypeMesh(this.model.mesh, this.elapsed, 0);
    return this.elapsed < 6.5;
  }

  dispose(): void { this.flames.dispose(); this.model.dispose(); }
}

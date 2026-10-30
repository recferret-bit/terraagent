import * as THREE from 'three';
import { smoothstep } from '../math';
import type { DropRig } from '@terra/render/descent/dropRig';
import type { DescentContext, FramePart, FrameState } from './FrameState';

/** Heat shield: attached to the pod (glowing in the plasma) until 23 s, then a free-falling copy. */
export class HeatShield implements FramePart {
  private free: THREE.Mesh;

  constructor(private ctx: DescentContext, private rig: DropRig, private podH: number) {
    this.free = new THREE.Mesh(rig.shieldGeo, rig.shieldMat);
    this.free.visible = false; this.free.castShadow = true;
    ctx.root.add(this.free);
  }

  update(f: FrameState) {
    const tn = f.tn, { detach23, v23 } = this.ctx.traj;
    const free = tn >= 23;
    this.rig.shield.visible = !free;
    if (free) {
      const tau = tn - 23;
      this.free.visible = tau < 4.5;
      this.free.position.set(detach23.x + 0.6 * tau, detach23.y + v23 * tau - 4.9 * tau * tau + 0.5 * v23 * 0 - this.podH / 2 + 0.02, detach23.z);
      this.free.rotation.set(0.7 * tau, 1.4 * tau, 0.5 * tau);
    } else this.free.visible = false;
    this.rig.shieldMat.emissiveIntensity = 1.1 * f.P * (1 - smoothstep(23, 26, tn));
  }
}

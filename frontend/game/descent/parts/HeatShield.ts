import * as THREE from 'three';
import { smoothstep } from '../math';
import type { DropRig } from '@terra/render/descent/dropRig';
import type { DescentContext, FramePart, FrameState } from './FrameState';

const DETACH = 23;

/**
 * Heat shield + landing gear: the rig shield covers the pod base (glowing in the plasma) until 23 s, then a free-falling
 * copy separates from exactly where it sat and the pod shows its built-in base; the legs deploy once the shield is gone.
 */
export class HeatShield implements FramePart {
  private free: THREE.Mesh;
  /** World pose of the attached shield at the detach instant (pod pose at 23 s × the rig shield's local offset). */
  private readonly start = new THREE.Vector3();
  private readonly q0 = new THREE.Quaternion();
  private readonly qTumble = new THREE.Quaternion();
  private readonly tumble = new THREE.Euler();

  constructor(private ctx: DescentContext, private rig: DropRig, podH: number) {
    this.free = new THREE.Mesh(rig.shieldGeo, rig.shieldMat);
    this.free.visible = false; this.free.castShadow = true; this.free.name = 'descent:shieldFree';
    ctx.root.add(this.free);
    // the pod root sits at podBase + podH/2 with the trajectory attitude; the rig shield hangs off it at its local offset
    this.q0.setFromEuler(ctx.traj.podRot(DETACH, new THREE.Euler()));
    this.start.copy(rig.shield.position).applyQuaternion(this.q0).add(ctx.traj.detach23);
    this.start.y += podH / 2;
  }

  update(f: FrameState) {
    const tn = f.tn, { v23 } = this.ctx.traj;
    const free = tn >= DETACH;
    this.rig.setShieldAttached(!free);
    this.rig.setLegDeploy(smoothstep(24.5, 27.5, tn));
    if (free) {
      const tau = tn - DETACH;
      this.free.visible = tau < 4.5;
      this.free.position.set(this.start.x + 0.6 * tau, this.start.y + v23 * tau - 4.9 * tau * tau, this.start.z);
      this.free.quaternion.copy(this.q0).multiply(this.qTumble.setFromEuler(this.tumble.set(0.7 * tau, 1.4 * tau, 0.5 * tau)));
    } else this.free.visible = false;
    this.rig.shieldMat.emissiveIntensity = 1.1 * f.P * (1 - smoothstep(23, 26, tn));
  }
}

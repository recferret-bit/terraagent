import * as THREE from 'three';
import type { FittedModel } from '@shared/engine/visuals/space/placeholders';
import { smoother, smoothstep } from '../math';
import type { DropRig } from '../dropRig';
import { Y0 } from '../constants';
import type { DescentContext, FramePart, FrameState } from './FrameState';

export const bayGlowAt = (tn: number) => 3.5 * smoother(0.6, 2.5, tn) * (1 - 0.6 * smoothstep(4, 6, tn));

/** The carrier drifting away overhead, its clamp arms opening and the bay light fading. */
export class CarrierBay implements FramePart {
  constructor(private ctx: DescentContext, private carrier: FittedModel, private rig: DropRig, private pod: FittedModel, private podH: number) {
    for (const m of [pod, carrier]) m.root.traverse((ob) => { const mm = (ob as THREE.Mesh).material as (THREE.Material & { fog?: boolean }) | undefined; if (mm) mm.fog = false; });
  }

  update(f: FrameState) {
    const tn = f.tn, { pod0 } = this.ctx.traj;
    const cDrift = smoother(4, 14, tn);
    this.carrier.root.visible = tn < 14.6 && this.ctx.startAt < 6; // a late start means the menu stage already played the release
    this.carrier.root.position.set(pod0.x - 100 * cDrift, Y0 + this.podH - 0.4 + 60 * cDrift, pod0.z - 80 * cDrift);
    this.carrier.root.rotation.set(0.02 * Math.sin(tn * 0.6), 0.3 + 0.05 * cDrift, 0);
    this.rig.setOpen(smoother(2.2, 3.8, tn));
    this.rig.setBayGlow(bayGlowAt(tn));
    this.pod.root.visible = true;
  }

  dispose() { this.rig.dispose(); this.carrier.dispose(); }
}

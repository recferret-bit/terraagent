import * as THREE from 'three';
import { smoother } from '../math';
import { createCanopy, type Canopy } from '../fx/Canopy';
import type { DescentContext, FramePart, FrameState } from './FrameState';

/** Parachute: deploys at 23 s, inflates, then is cut loose and flies off under the retro burn. */
export class ChuteFx implements FramePart {
  private canopy: Canopy;

  constructor(private ctx: DescentContext, podRoot: THREE.Object3D, podH: number, podR: number) {
    const { spec } = ctx;
    this.canopy = createCanopy(podH / 2, podR, new THREE.Color(spec.palette.accent).lerp(new THREE.Color(0xff6a2a), 0.5), 0xe8e4da);
    podRoot.add(this.canopy.group);
  }

  update(f: FrameState) {
    const tn = f.tn, c = this.canopy;
    const dep = smoother(23.1, 24.4, tn), x = smoother(23.6, 25.2, tn);
    const infl = x * (1 + 0.12 * Math.sin(Math.PI * x));
    const rel = smoother(29.3, 31, tn);
    c.update(tn, dep * (1 - rel), infl * (1 - 0.5 * rel), this.ctx.sunDir);
    c.group.position.set(14 * rel, 28 * rel * rel, -6 * rel);
    c.group.scale.setScalar(1 - 0.85 * rel);
    if (rel >= 1) c.group.visible = false;
  }

  dispose() { this.canopy.dispose(); }
}

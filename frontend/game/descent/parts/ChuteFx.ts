import * as THREE from 'three';
import { isDayNightOn } from '@terra/render/core/dayNightConfig';
import { smoother } from '../math';
import { createCanopy, type Canopy } from '../fx/Canopy';
import type { DescentContext, FramePart, FrameState } from './FrameState';

/** Parachute: deploys at 23 s, inflates, then is cut loose and flies off under the retro burn. */
export class ChuteFx implements FramePart {
  private canopy: Canopy;
  private lightTint = new THREE.Color(1, 1, 1);
  private sunVec = new THREE.Vector3(0, 1, 0);
  private moonTint = new THREE.Color(0x1f3052);

  constructor(private ctx: DescentContext, podRoot: THREE.Object3D, podH: number, podR: number) {
    const { spec } = ctx;
    this.canopy = createCanopy(podH / 2, podR, new THREE.Color(spec.palette.accent).lerp(new THREE.Color(0xff6a2a), 0.5), 0xe8e4da);
    podRoot.add(this.canopy.group);
  }

  update(f: FrameState) {
    const tn = f.tn, c = this.canopy, target = f.solar;
    const dep = smoother(23.1, 24.4, tn), x = smoother(23.6, 25.2, tn);
    const infl = x * (1 + 0.12 * Math.sin(Math.PI * x));
    const rel = smoother(29.3, 31, tn);

    if (target && isDayNightOn()) {
      const nightScale = 0.16 + 0.32 * target.nightBrightness;
      this.lightTint.copy(target.sunColor).multiplyScalar(0.22 + 0.78 * target.daylight);
      this.lightTint.lerp(this.moonTint, target.nightFactor * (1 - nightScale));
      if (f.thr > 0.01) {
        this.lightTint.r += 0.55 * f.thr;
        this.lightTint.g += 0.25 * f.thr;
      }
      this.sunVec.copy(target.keySunDir);
    } else {
      this.lightTint.setRGB(1, 1, 1);
      this.sunVec.copy(this.ctx.sunDir);
    }

    c.update(tn, dep * (1 - rel), infl * (1 - 0.5 * rel), this.sunVec, this.lightTint);
    c.group.position.set(14 * rel, 28 * rel * rel, -6 * rel);
    c.group.scale.setScalar(1 - 0.85 * rel);
    if (rel >= 1) c.group.visible = false;
  }

  dispose() { this.canopy.dispose(); }
}

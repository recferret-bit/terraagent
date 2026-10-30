import * as THREE from 'three';
import { smoothstep } from '../math';
import { streakSpeed } from '../timeline';
import { createPlasma, type Plasma } from '../fx/Plasma';
import { createStreakField, type StreakField } from '../fx/Streaks';
import { DECK } from '../constants';
import type { DescentContext, FramePart, FrameState } from './FrameState';

/** Reentry plasma sheath around the pod + the speed streaks (wind in freefall, hot streaks in the plasma, cloud-deck rush). */
export class ReentryFx implements FramePart {
  private streaks: StreakField;
  private plasma: Plasma;
  private scroll = 0;
  private atmCol: THREE.Color;
  private colA = new THREE.Color(); private colB = new THREE.Color();

  constructor(private ctx: DescentContext, podR: number, podH: number) {
    this.atmCol = new THREE.Color(ctx.spec.orbital.atmosphereColor);
    this.streaks = createStreakField(240, 40, 4.5, 110, ctx.spec.seed);
    ctx.root.add(this.streaks.mesh);
    this.plasma = createPlasma(podR, podH);
    this.plasma.group.position.y = 0; ctx.root.add(this.plasma.group);
  }

  reset() { this.scroll = 0; }

  update(f: FrameState) {
    const { plasma, streaks, colA, colB } = this, tn = f.tn, P = f.P;
    // ---------- plasma
    plasma.group.visible = f.plasmaI > 0.01;
    plasma.group.position.copy(f.podCenter);
    plasma.u.uI.value = f.plasmaI; plasma.u.uTime.value = tn;
    plasma.u.uCool.value.setRGB(1.4, 0.32, 0.05).lerp(this.atmCol, 0.2);
    plasma.u.uAtm.value.copy(this.atmCol).lerp(colA.setRGB(0.9, 0.3, 1.0), 0.35);
    // ---------- streaks
    const sp = streakSpeed(tn);
    this.scroll += sp * f.dtn / this.ctx.tScale; // streak scroll in "authored seconds"
    f.cb = tn > 17 ? 1 - smoothstep(0, 28, Math.abs(f.camPos.y - DECK)) : 0;
    const wind = 0.16 * smoothstep(9, 13, tn) * (1 - smoothstep(21, 25, tn)) + 0.25 * f.cb;
    streaks.u.uIntensity.value = wind + 0.9 * P;
    streaks.mesh.visible = streaks.u.uIntensity.value > 0.003;
    streaks.u.uColA.value.setRGB(0.55, 0.7, 1.0).lerp(colA.setRGB(1.6, 0.5, 0.1), P);
    streaks.u.uColB.value.setRGB(0.9, 0.95, 1.0).lerp(colB.setRGB(2.0, 1.3, 0.7), P);
    streaks.u.uPod.value.copy(f.podCenter); streaks.u.uScroll.value = this.scroll; streaks.u.uLen.value = 2.5 + 0.1 * sp;
  }

  dispose() { this.streaks.dispose(); this.plasma.dispose(); }
}

import * as THREE from 'three';
import type { DescentHandoff } from '../../../../game/descent/types';
import { tickArchetypeMesh } from '../../visuals/space/placeholders';
import { win } from '../stage/math';
import { planDeploy } from './DeployPlan';
import { stepHold, stepDive } from './DeployFlight';
import { TB, TC, type Deploy, type DeployHost } from './types';

/** Deploy: carrier fly-by → bay release → scale-dive into the real planet (ends on the descent's frame). */
export class DeploySequence {
  private deploy: Deploy | null = null;

  constructor(private readonly host: DeployHost) {}

  get active() { return this.deploy !== null; }

  begin(h: DescentHandoff, opts: { biomeKey?: string }) {
    if (this.deploy) throw new Error('deploy already running');
    const { deploy, result } = planDeploy(this.host, h, opts);
    this.deploy = deploy;
    return result;
  }

  progress() { return this.deploy ? Math.min(1, this.deploy.T / TC) : 0; }

  tn() {
    if (!this.deploy) return 0;
    const T = this.deploy.T, st = this.deploy.h.startAt;
    return T < TB ? THREE.MathUtils.lerp(0, 4, T / TB) : THREE.MathUtils.lerp(4, st, Math.min(1, (T - TB) / (TC - TB)));
  }

  update(dt: number, time: number) {
    const d = this.deploy; if (!d) return;
    d.T = Math.min(TC, d.T + dt);
    const T = d.T;
    if (T <= TB) stepHold(this.host, d, T); else stepDive(this.host, d, T);
    this.host.camera.updateMatrixWorld();
    tickArchetypeMesh(d.rig.pod.mesh, time);
    this.grade(d, T);
  }

  /** Lighting / grading converge to the descent's frame (sun direction already identical by construction). */
  private grade(d: Deploy, T: number) {
    const { scene, viewport, sun } = this.host;
    const { sunLight, hemi, rim } = sun;
    const l = win(0.5, TC - 0.5, T);
    sunLight.intensity = THREE.MathUtils.lerp(d.sunI0, d.h.sunIntensity, l);
    sunLight.color.copy(d.sunC0).lerp(d.h.sunColor, l);
    hemi.color.copy(d.hemi0[0]).lerp(d.h.hemiColor, l); hemi.groundColor.copy(d.hemi0[1]).lerp(d.h.hemiGround, l);
    hemi.intensity = THREE.MathUtils.lerp(d.hemi0[2], d.h.hemiIntensity, l);
    rim.intensity = d.rim0 * (1 - l);
    scene.environmentIntensity = THREE.MathUtils.lerp(d.env0, d.h.envIntensity, l);
    viewport.renderer.toneMappingExposure = THREE.MathUtils.lerp(d.exp0, d.h.exposure, l);
    viewport.bloom.strength = THREE.MathUtils.lerp(d.bloom0, d.h.bloom, l);
    sun.flare.setFade(1 - win(0.0, 2.0, T));
  }

  dispose() { this.deploy?.rig.dispose(); this.deploy = null; }
}

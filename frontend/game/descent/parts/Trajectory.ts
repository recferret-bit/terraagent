import * as THREE from 'three';
import type { PlanetSurface } from '@shared/engine/planets/surface/types';
import { smoother, smoothstep } from '../math';
import { altCurve } from '../timeline';
import { R, Y0 } from '../constants';

/** Where the pod lands and how it gets there: position + attitude as pure functions of the authored time. */
export class Trajectory {
  readonly L: THREE.Vector3;
  readonly fd = new THREE.Vector3(0.6, 0, 0.8).normalize();       // hero walks out along this (towards the gameplay camera)
  readonly fdYaw = Math.atan2(this.fd.x, this.fd.z);
  readonly podLand: THREE.Vector3;
  readonly lat0 = new THREE.Vector2(-90, 60);                       // pod's lateral offset at release (drifts to the landing spot)
  readonly pod0: THREE.Vector3;
  /** Globe centre (landing site maps to the top of the globe). */
  readonly C: THREE.Vector3;
  /** Where the heat shield separates (t = 23 s) and its vertical speed there. */
  readonly detach23: THREE.Vector3;
  readonly v23 = (altCurve(23.02) - altCurve(22.98)) / 0.04;

  constructor(private surface: PlanetSurface) {
    this.L = surface.landingSite.clone();
    this.podLand = new THREE.Vector3(this.L.x - this.fd.x * 2.6, 0, this.L.z - this.fd.z * 2.6);
    this.podLand.y = surface.heightAt(this.podLand.x, this.podLand.z);
    this.pod0 = new THREE.Vector3(this.podLand.x + this.lat0.x, Y0, this.podLand.z + this.lat0.y);
    this.C = new THREE.Vector3(this.L.x, -R - 6, this.L.z);
    this.detach23 = this.pos(23, new THREE.Vector3());
  }

  /** Pod base position (altitude curve + terrain once close). */
  pos(tn: number, out: THREE.Vector3) {
    const s = smoother(4, 34, tn);
    const yRel = altCurve(tn);
    const x = this.podLand.x + this.lat0.x * (1 - s), z = this.podLand.z + this.lat0.y * (1 - s);
    const g = this.surface.heightAt(x, z) * smoothstep(80, 0, yRel);
    return out.set(x, yRel + g - 4.0 * smoothstep(34.55, 35, tn), z);
  }

  /** Pod attitude: tumble after release, slow sway under the chute. */
  podRot(tn: number, out: THREE.Euler) {
    const tum = smoothstep(4, 4.6, tn) * (1 - smoothstep(8, 13, tn));
    const sway = 0.07 * Math.sin(tn * 1.1) * smoothstep(24, 26, tn) * (1 - smoothstep(30, 33, tn));
    return out.set(0.35 * Math.sin(1.3 * (tn - 4)) * tum + sway * 0.5, 2.4 * smoother(4, 12, tn), 0.5 * Math.sin(0.9 * (tn - 4) + 1) * tum + sway, 'YXZ');
  }
}

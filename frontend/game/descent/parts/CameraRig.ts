import * as THREE from 'three';
import { clamp, makeCurve, smoother, smoothstep } from '../math';
import { CUT_POSE } from '@terra/render/descent/dropRig';
import { D2R, FINAL_POS, FINAL_TARGET, R } from '../constants';
import type { FittedModel } from '@terra/render/visuals/space/placeholders';
import type { DescentContext, FramePart, FrameState } from './FrameState';

const camPhi = makeCurve([[3.6, 112], [8, 96], [11, 88], [15, 85], [17, 100], [21, 130], [23, 150], [26, 160], [29, 150]]);
const camEps = makeCurve([[3.6, -12], [5.2, -2], [6.8, 18], [8, 32], [11, 48], [15, 58], [17, 22], [21, 10], [23, 12], [26, 14], [29, 18]]);
const camLnD = makeCurve([[3.6, Math.log(46)], [8, Math.log(52)], [11, Math.log(38)], [15, Math.log(22)], [17, Math.log(17)], [21, Math.log(15)], [23, Math.log(26)], [26, Math.log(38)], [29, Math.log(40)]]);
const camLookY = makeCurve([[3.6, 0], [8, 2], [15, 0], [23, 3], [26, 6], [29, 4]]);

/** Chase camera: authored orbit around the pod, carrier-locked hand-off shot at the start, shake, FOV and clip planes. */
export class CameraRig implements FramePart {
  private saved: { near: number; far: number; fov: number };
  private cq = new THREE.Quaternion();
  private tmpA = new THREE.Vector3(); private tmpB = new THREE.Vector3(); private tmpC = new THREE.Vector3();

  constructor(private ctx: DescentContext, private carrier: FittedModel) {
    const { camera } = ctx;
    this.saved = { near: camera.near, far: camera.far, fov: camera.fov };
  }

  /** Camera pose for authored second `tn` around pod centre `pc` (pure; shared with the menu hand-off). */
  static curve(tn: number, pc: THREE.Vector3, outPos: THREE.Vector3, outTgt: THREE.Vector3) {
    const k = clamp(tn, 3.6, 29), ph = camPhi(k) * D2R, ep = camEps(k) * D2R, D = Math.exp(camLnD(k));
    outPos.set(pc.x + D * Math.cos(ep) * Math.cos(ph), pc.y + D * Math.sin(ep), pc.z + D * Math.cos(ep) * Math.sin(ph));
    outTgt.set(pc.x, pc.y + camLookY(k), pc.z);
    const e = smoother(29, 34, tn);
    if (e > 0) { if (e >= 1) { outPos.copy(FINAL_POS); outTgt.copy(FINAL_TARGET); } else { outPos.lerp(FINAL_POS, e); outTgt.lerp(FINAL_TARGET, e); } }
  }

  static fov(tn: number) { return 28 + 8 * smoothstep(13, 17, tn) * (1 - smoothstep(25, 31, tn)); }

  update(f: FrameState) {
    const { camera, startAt, traj } = this.ctx, tn = f.tn, { camPos, camTgt } = f;
    CameraRig.curve(tn, f.podCenter, camPos, camTgt);
    this.applyCarrierCut(f, startAt);
    this.shake(f);
    camera.position.copy(camPos);
    camera.fov = CameraRig.fov(tn);
    const dPod = camPos.distanceTo(f.podCenter);
    camera.near = clamp(dPod * 0.02, 0.3, 300);
    camera.far = Math.max(4000, camPos.distanceTo(traj.C) + R * 1.6);
    camera.updateProjectionMatrix();
    camera.lookAt(camTgt);
    camera.updateMatrixWorld();
  }

  /** Carrier-locked hand-off shot (same carrier-local pose the menu stage dollies into), released as the pod drops. */
  private applyCarrierCut(f: FrameState, startAt: number) {
    const { camera } = this.ctx, { camPos, camTgt } = f, { tmpA, tmpB, tmpC } = this, carrier = this.carrier.root;
    const cw = startAt < 4 ? 1 - smoother(startAt + 1.4, 6.4, f.tn) : 0;
    camera.up.set(0, 1, 0);
    if (cw <= 0) return;
    carrier.updateWorldMatrix(true, false);
    carrier.getWorldQuaternion(this.cq);
    tmpA.copy(CUT_POSE.cam); carrier.localToWorld(tmpA);
    tmpB.copy(CUT_POSE.target); carrier.localToWorld(tmpB);
    camPos.lerp(tmpA, cw); camTgt.lerp(tmpB, cw);
    tmpC.copy(CUT_POSE.up).applyQuaternion(this.cq);
    camera.up.lerp(tmpC, cw).normalize();
  }

  private shake(f: FrameState) {
    const tn = f.tn, { camPos } = f;
    const shakeEnv = 1 - smoothstep(31, 33.5, tn);
    const amp = (0.05 * smoothstep(9, 15, tn) + 0.3 * f.plasmaI + 0.5 * Math.exp(-Math.pow((tn - 24.1) / 0.35, 2)) + 0.05 * f.thr) * shakeEnv;
    if (amp > 1e-4) {
      camPos.x += amp * (Math.sin(tn * 37.1) + 0.6 * Math.sin(tn * 71.3 + 2));
      camPos.y += amp * (Math.sin(tn * 43.7 + 1) + 0.6 * Math.sin(tn * 67.1 + 4));
      camPos.z += amp * (Math.sin(tn * 31.9 + 3) + 0.6 * Math.sin(tn * 59.3));
    }
  }

  /** Leave the camera at the gameplay pose with its original clip planes. */
  restore() {
    const { camera } = this.ctx;
    camera.up.set(0, 1, 0);
    camera.fov = 28; camera.near = this.saved.near; camera.far = this.saved.far; camera.updateProjectionMatrix();
    camera.position.copy(FINAL_POS); camera.lookAt(FINAL_TARGET); camera.updateMatrixWorld();
  }
}

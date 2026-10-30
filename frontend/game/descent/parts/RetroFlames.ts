import * as THREE from 'three';
import type { FittedModel } from '@terra/render/visuals/space/placeholders';
import { createFlames, type Flames } from '../fx/Flames';
import type { FramePart, FrameState } from './FrameState';

/** Retro jets on the pod model's 4 real nozzles (model space: ring r≈1.42 at y≈0.43, tilted 0.45 rad outward). */
export class RetroFlames implements FramePart {
  private flames: Flames;

  constructor(podRoot: THREE.Object3D, pod: FittedModel) {
    podRoot.updateMatrixWorld(true);
    const toPodRoot = new THREE.Matrix4().copy(podRoot.matrixWorld).invert().multiply(pod.mesh.matrixWorld);
    const nozzles = [0, 1, 2, 3].map((i) => {
      const a = (i * Math.PI) / 2 + Math.PI / 4;
      const tilt = new THREE.Euler(-Math.sin(a) * 0.45, 0, Math.cos(a) * 0.45);
      const pos = new THREE.Vector3(Math.cos(a) * 1.44, 0.4, Math.sin(a) * 1.44).applyMatrix4(toPodRoot);
      const dir = new THREE.Vector3(0, -1, 0).applyEuler(tilt).transformDirection(toPodRoot);
      return { pos, dir };
    });
    this.flames = createFlames(nozzles);
    podRoot.add(this.flames.group);
  }

  update(f: FrameState) {
    const tn = f.tn, fl = this.flames;
    fl.group.visible = f.thr > 0.01;
    const ign = 1 + 0.45 * Math.exp(-Math.pow((tn - 29.25) / 0.25, 2));         // ignition kick
    fl.u.uI.value = f.thr * ign * (0.9 + 0.1 * Math.sin(tn * 40)); fl.u.uTime.value = tn;
  }

  dispose() { this.flames.dispose(); }
}

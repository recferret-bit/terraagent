import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { acquireModel, type FittedModel } from '../visuals/space/placeholders';

/**
 * Drop hardware shared by the menu stage (deploy dolly) and the descent, so both sides of the camera cut show the
 * exact same carrier underside: bay light plate, two clamp arms, the docked pod and its heat shield.
 * Everything is built in the CARRIER ROOT'S LOCAL (native model) units and parented to `carrier.root`, so it scales
 * with whatever size each scene gives the carrier.
 */
export const POD_HEIGHT = 3.4;       // descent pod height (world units in the descent, where the carrier is unscaled)

/** Camera pose for the menu→descent hand-off, in carrier-root local units (root origin = hull bottom-centre, nose +Z, belly -Y). */
export const CUT_POSE = {
  cam: new THREE.Vector3(-30, -10.5, 33),
  target: new THREE.Vector3(1.5, -1.0, -2.5),
  up: new THREE.Vector3(0, 1, 0),
};

export interface DropRig {
  /** Child of carrier.root. */
  readonly group: THREE.Group;
  /** Pod + shield, positioned at the docked pod centre (carrier-local). */
  readonly podRig: THREE.Group;
  readonly pod: FittedModel;
  readonly shield: THREE.Mesh;
  readonly podH: number; readonly podR: number;
  readonly dockedCentre: THREE.Vector3;
  /** 0..1 clamp-arm opening. */
  setOpen(open: number): void;
  setBayGlow(intensity: number): void;
  /** Shared materials/geos so the descent can reuse them for its free-flying shield copy. */
  readonly shieldGeo: THREE.BufferGeometry; readonly shieldMat: THREE.MeshStandardMaterial;
  dispose(): void;
}

export interface DropRigOptions {
  biomeKey: string;
  /** World scale of carrier.root in the scene that hosts the rig (rig sizes are expressed in descent world units). */
  carrierScale: number;
  /** Pod yaw relative to the carrier. */
  podYaw?: number;
  /** Attach pod + shield under the carrier (stage) or leave them for the caller to parent elsewhere (descent). */
  attachPod?: boolean;
}

export function createDropRig(carrierRoot: THREE.Object3D, opts: DropRigOptions): DropRig {
  const k = 1 / opts.carrierScale;                     // descent world units → carrier-local units
  const pod = acquireModel('ship.dropPod', opts.biomeKey, { size: POD_HEIGHT, mode: 'height', minRatio: 0.6, maxRatio: 2 });
  const podH = pod.size.y, podR = Math.max(pod.size.x, pod.size.z) * 0.5;
  const group = new THREE.Group(); group.name = 'dropRig';

  // pod centre hangs 0.4 below the hull bottom (matches the descent's docking offset)
  const dockedCentre = new THREE.Vector3(0, (-podH / 2 + 0.4) * k, 0);

  const shieldGeo = new THREE.SphereGeometry(podR * 1.12, 28, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2).scale(1, 0.5, 1);
  const shieldMat = new THREE.MeshStandardMaterial({ color: 0x2a2623, roughness: 0.9, metalness: 0.2, emissive: 0xff5a14, emissiveIntensity: 0 });
  const shield = new THREE.Mesh(shieldGeo, shieldMat); shield.castShadow = true;
  shield.position.set(0, -podH / 2 + 0.02, 0);

  const podRig = new THREE.Group(); podRig.name = 'dropRig:pod';
  pod.root.position.set(0, -podH / 2, 0);
  podRig.add(pod.root, shield);
  if (opts.attachPod) {
    podRig.position.copy(dockedCentre);
    podRig.scale.setScalar(k);
    podRig.rotation.y = opts.podYaw ?? 0;
    group.add(podRig);
  }

  const armGeo = new RoundedBoxGeometry(0.16, podH * 0.9, 0.2, 2, 0.05);
  const armMat = new THREE.MeshStandardMaterial({ color: 0x30343c, metalness: 0.7, roughness: 0.45 });
  const arms = [-1, 1].map((s) => {
    const piv = new THREE.Group(); const m = new THREE.Mesh(armGeo, armMat);
    m.position.y = -podH * 0.45; m.castShadow = true; piv.add(m);
    piv.scale.setScalar(k); piv.position.set(s * (podR + 0.12) * k, 0, 0); piv.userData.s = s;
    group.add(piv); return piv;
  });
  const bayGeo = new RoundedBoxGeometry(podR * 2.6, 0.12, podR * 2.6, 2, 0.04);
  const bayMat = new THREE.MeshStandardMaterial({ color: 0x082030, emissive: 0x30d8ff, emissiveIntensity: 0 });
  const bay = new THREE.Mesh(bayGeo, bayMat); bay.scale.setScalar(k); bay.position.y = -0.02 * k;
  group.add(bay);
  carrierRoot.add(group);

  return {
    group, podRig, pod, shield, podH, podR, dockedCentre, shieldGeo, shieldMat,
    setOpen(open) { for (const a of arms) a.rotation.z = a.userData.s * 1.0 * open; },
    setBayGlow(i) { bayMat.emissiveIntensity = i; },
    dispose() {
      group.removeFromParent(); podRig.removeFromParent();
      pod.dispose();
      for (const g of [shieldGeo, armGeo, bayGeo]) g.dispose();
      for (const m of [shieldMat, armMat, bayMat]) m.dispose();
    },
  };
}

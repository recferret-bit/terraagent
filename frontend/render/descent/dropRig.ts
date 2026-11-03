import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { acquireModel, type FittedModel } from '../visuals/space/placeholders';
import { createPodGear } from './podGear';

/**
 * Drop hardware shared by the menu stage (deploy dolly) and the descent, so both sides of the camera cut show the
 * exact same carrier underside: bay hatch ring, two clamp arms, the docked pod (legs stowed) and its heat shield.
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
  /** Rig shield on the pod (the archetype's own shield hidden) or jettisoned (rig shield hidden, built-in base back). */
  setShieldAttached(attached: boolean): void;
  /** Landing legs: 0 retracted into the hull (flight, the rig's default), 1 deployed as built. */
  setLegDeploy(deploy: number): void;
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

/**
 * Jettisonable ablative shield, in pod-archetype native units with the origin on the pod's axis at its bottom plane.
 * It replaces the archetype's built-in shield + rim band while attached (`podGear` hides those) and continues the
 * petal cone (outer r 1.25 at y 0.48) with a ~1 cm seam, its top tucked up inside the petals. Sized from the hull
 * profile, NOT from the fitted bbox radius (`podR` includes the splayed landing legs, r≈1.84).
 */
const SHIELD_PROFILE: [number, number][] = [[0, -0.01], [0.7, 0.01], [1.08, 0.12], [1.21, 0.28], [1.26, 0.42], [1.26, 0.49], [1.1, 0.53], [0, 0.53]];
/** Hull radius the clamp arms grip (shield rim), native units. */
const HULL_R = 1.26;
/** Bay hatch ring around the docked pod's top (native pod units): bevelled gunmetal disc + a thin cyan light ring. */
const BAY_PROFILE: [number, number][] = [[0, -0.07], [1.42, -0.07], [1.52, -0.03], [1.52, 0.03], [0, 0.03]];
const BAY_LIGHT_R = 1.36;

function buildShield(scale: number) {
  const geo = new THREE.LatheGeometry(SHIELD_PROFILE.map(([r, y]) => new THREE.Vector2(r * scale, y * scale)), 32);
  // charred ablative bronze: mid albedo so the key light reads on it (0x2a2623 / rough 0.9 rendered as a black blob)
  const mat = new THREE.MeshStandardMaterial({ color: 0x6b5a4b, roughness: 0.72, metalness: 0.35, emissive: 0xff5a14, emissiveIntensity: 0 });
  return { geo, mat };
}

function buildBay(scale: number, frameMat: THREE.Material) {
  const plateGeo = new THREE.LatheGeometry(BAY_PROFILE.map(([r, y]) => new THREE.Vector2(r * scale, y * scale)), 40);
  const lightGeo = new THREE.TorusGeometry(BAY_LIGHT_R * scale, 0.035 * scale, 6, 48).rotateX(Math.PI / 2).translate(0, -0.085 * scale, 0);
  const lightMat = new THREE.MeshStandardMaterial({ color: 0x0d2a36, emissive: 0x30d8ff, emissiveIntensity: 0 });
  const group = new THREE.Group(); group.name = 'dropRig:bay';
  const plate = new THREE.Mesh(plateGeo, frameMat); plate.receiveShadow = true;
  group.add(plate, new THREE.Mesh(lightGeo, lightMat));
  return { group, plateGeo, lightGeo, lightMat };
}

export function createDropRig(carrierRoot: THREE.Object3D, opts: DropRigOptions): DropRig {
  const k = 1 / opts.carrierScale;                     // descent world units → carrier-local units
  // spaceLit: the colony FoV shroud / night / projector uniforms must not darken the pod in orbit (see spaceLighting.ts)
  const pod = acquireModel('ship.dropPod', opts.biomeKey, { size: POD_HEIGHT, mode: 'height', minRatio: 0.6, maxRatio: 2 }, { spaceLit: true });
  const podH = pod.size.y, podR = Math.max(pod.size.x, pod.size.z) * 0.5, fitScale = pod.root.scale.x;
  const group = new THREE.Group(); group.name = 'dropRig';

  // pod centre hangs 0.4 below the hull bottom (matches the descent's docking offset)
  const dockedCentre = new THREE.Vector3(0, (-podH / 2 + 0.4) * k, 0);

  const { geo: shieldGeo, mat: shieldMat } = buildShield(fitScale);
  const shield = new THREE.Mesh(shieldGeo, shieldMat); shield.castShadow = true; shield.name = 'dropRig:shield';
  shield.position.set(0, -podH / 2, 0);

  const podRig = new THREE.Group(); podRig.name = 'dropRig:pod';
  // the fitted root is centred on the bbox, which the 3 splayed legs push 0.25 m off the hull axis: put the AXIS on the
  // rig origin so shield, bay ring and clamp arms are concentric with the hull
  pod.root.position.set(-pod.mesh.position.x * fitScale, -podH / 2, -pod.mesh.position.z * fitScale);
  podRig.add(pod.root, shield);
  const gear = createPodGear(pod.mesh);
  gear.setShieldAttached(true); gear.setLegDeploy(0);
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
    piv.scale.setScalar(k); piv.position.set(s * (HULL_R * fitScale + 0.14) * k, 0, 0); piv.userData.s = s;
    group.add(piv); return piv;
  });
  // bay hatch: was a 4.2 m flat emissive slab that bloomed into an unlit-looking cyan square under the hull
  const bay = buildBay(fitScale, armMat);
  bay.group.scale.setScalar(k);
  group.add(bay.group);
  carrierRoot.add(group);

  return {
    group, podRig, pod, shield, podH, podR, dockedCentre, shieldGeo, shieldMat,
    setOpen(open) { for (const a of arms) a.rotation.z = a.userData.s * 1.0 * open; },
    setBayGlow(i) { bay.lightMat.emissiveIntensity = i; },
    setShieldAttached(attached) { shield.visible = attached; gear.setShieldAttached(attached); },
    setLegDeploy(d) { gear.setLegDeploy(d); },
    dispose() {
      group.removeFromParent(); podRig.removeFromParent();
      pod.dispose();
      for (const g of [shieldGeo, armGeo, bay.plateGeo, bay.lightGeo]) g.dispose();
      for (const m of [shieldMat, armMat, bay.lightMat]) m.dispose();
    },
  };
}

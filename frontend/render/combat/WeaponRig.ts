import * as THREE from 'three';
import { evalBipedBodyPoint, evalSpiderBodyPoint } from '../particles/toolOrigins';
import type { WeaponRigDefinition } from './weaponRigs';

const Z = new THREE.Vector3(0, 0, 1);
const ONE = new THREE.Vector3(1, 1, 1);
/** GPU steering with an exact CPU pose mirror for muzzle sockets and diagnostics. */
export class WeaponRig {
  private readonly poseMatrices = [new THREE.Matrix4(), new THREE.Matrix4(), new THREE.Matrix4()];
  private kicks = [0, 0];
  private readonly recoilAge = [1, 1];
  private nextBarrel = 0;
  private target: THREE.Vector3 | null = null;
  private launchLift = 0;

  constructor(readonly mesh: THREE.Object3D, readonly definition: WeaponRigDefinition) {
    const u = mesh.userData.uniforms;
    if (u?.uWeaponPivot) {
      u.uWeaponPivot.value.fromArray(definition.pivot);
      u.uWeaponLeftPivot.value.fromArray(definition.sockets[0]!.pivot);
      u.uWeaponRightPivot.value.fromArray((definition.sockets[1] ?? definition.sockets[0])!.pivot);
      u.uWeaponCarrier.value = definition.carrier === 'spider' ? 9 : definition.carrier === 'biped' ? 8 : 0;
    }
  }

  aim(target: THREE.Vector3 | null, launchLift = 0): void {
    this.target = target?.clone() ?? null;
    this.launchLift = launchLift;
    this.update(0);
  }

  update(dt: number): void {
    this.kicks = this.recoilAge.map((age, i) => {
      const t = this.recoilAge[i] = Math.min(1, age + dt);
      // Fast compression, then a damped return with zero overshoot or sideways motion.
      if (t < 0.025) return 0.04 * Math.sin(t / 0.025 * Math.PI / 2);
      const u = Math.min(1, (t - 0.025) / 0.19);
      return 0.04 * (1 - u * u * (3 - 2 * u));
    });
    const def = this.definition;
    if (this.target && def.chassisAim) {
      const world = this.mesh.getWorldPosition(new THREE.Vector3());
      const local = this.mesh.parent ? this.mesh.parent.worldToLocal(this.target.clone()) : this.target;
      const origin = this.mesh.parent ? this.mesh.parent.worldToLocal(world) : world;
      this.mesh.rotation.y = Math.atan2(local.x - origin.x, local.z - origin.z);
    }
    this.mesh.updateWorldMatrix(true, false);
    const u = this.mesh.userData.uniforms;
    if (u?.uWeaponTarget) {
      if (this.target) u.uWeaponTarget.value.copy(this.mesh.worldToLocal(this.target.clone()));
      u.uWeaponEnabled.value = this.target ? 1 : 0;
      u.uWeaponLift.value = this.launchLift;
      u.uWeaponRecoil.value.set(this.kicks[0], this.kicks[1]);
      u.uWeaponOffsetY.value = this.offsetY;
    }
  }

  /** CPU mirror only for emission sockets / diagnostics, never per-vertex or a runtime bone chain. */
  get matrices(): readonly THREE.Matrix4[] {
    const def = this.definition;
    const target = this.target ? this.mesh.worldToLocal(this.target.clone()) : null;
    const pivot = this.local(def.pivot);
    const mount = pivot.clone();
    if (def.carrier) {
      const u = this.mesh.userData.uniforms;
      const bodyPoint = def.carrier === 'spider' ? evalSpiderBodyPoint : evalBipedBodyPoint;
      mount.fromArray(bodyPoint(...def.pivot, (u?.uTime?.value ?? 0) * 5, u?.uWalkWeight?.value ?? 0, u?.uWorkWeight?.value ?? 0));
      mount.y -= this.offsetY;
    }
    const yaw = target ? Math.atan2(target.x - mount.x, target.z - mount.z) : 0;
    const headRotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    this.poseMatrices[0].compose(mount, headRotation, ONE).multiply(new THREE.Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z));
    def.sockets.forEach((socket, i) => {
      const rest = this.local(socket.pivot);
      const anchor = rest.clone().applyMatrix4(this.poseMatrices[0]);
      const direction = target ? target.clone().sub(anchor) : Z.clone().applyQuaternion(headRotation);
      direction.y += this.launchLift;
      direction.normalize();
      const rotation = new THREE.Quaternion().setFromUnitVectors(Z, direction);
      anchor.addScaledVector(direction, -this.kicks[i]!);
      this.poseMatrices[i + 1]!.compose(anchor, rotation, ONE)
        .multiply(new THREE.Matrix4().makeTranslation(-rest.x, -rest.y, -rest.z));
    });
    return this.poseMatrices;
  }

  fire(target: THREE.Vector3, launchLift = 0, recoil = true): { from: THREE.Vector3; barrel: number } {
    const barrel = this.nextBarrel++ % this.definition.sockets.length;
    this.recoilAge[barrel] = recoil ? 0 : 1;
    this.kicks[barrel] = 0;
    this.aim(target, launchLift);
    return { from: this.muzzle(barrel), barrel };
  }

  muzzle(barrel = 0): THREE.Vector3 {
    this.mesh.updateWorldMatrix(true, false);
    const matrices = this.matrices;
    return this.local(this.definition.sockets[barrel]!.muzzle)
      .applyMatrix4(matrices[barrel + 1]!).applyMatrix4(this.mesh.matrixWorld);
  }

  direction(barrel = 0): THREE.Vector3 {
    return Z.clone().transformDirection(this.matrices[barrel + 1]!).transformDirection(this.mesh.matrixWorld);
  }

  private get offsetY(): number { return (this.mesh as THREE.Mesh).geometry?.userData.stripOffsetY ?? 0; }
  private local(point: THREE.Vector3Tuple): THREE.Vector3 { return new THREE.Vector3(...point).add(new THREE.Vector3(0, -this.offsetY, 0)); }
}

// Keep runtime controllers out of serializable Object3D.userData (the rig references its mesh).
const meshRigs = new WeakMap<THREE.Object3D, WeaponRig>();
export function attachWeaponRig(mesh: THREE.Object3D, definition: WeaponRigDefinition): WeaponRig {
  const rig = new WeaponRig(mesh, definition);
  meshRigs.set(mesh, rig);
  return rig;
}
export function getWeaponRig(mesh: THREE.Object3D): WeaponRig | undefined { return meshRigs.get(mesh); }

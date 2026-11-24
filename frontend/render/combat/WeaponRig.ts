import * as THREE from 'three';
import { evalBipedBodyPoint, evalSpiderBodyPoint } from '../particles/toolOrigins';
import { resolveSocketSide, type WeaponRigDefinition } from './weaponRigs';

const Z = new THREE.Vector3(0, 0, 1);
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const ONE = new THREE.Vector3(1, 1, 1);

function wrapAngle(rad: number): number {
  return Math.atan2(Math.sin(rad), Math.cos(rad));
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / Math.max(1e-6, edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** GPU steering with an exact CPU pose mirror for muzzle sockets, smooth slewing, recoil and barrel heat. */
export class WeaponRig {
  private readonly poseMatrices: THREE.Matrix4[];
  private readonly sidePivots: [THREE.Vector3Tuple, THREE.Vector3Tuple];
  private readonly sideMuzzles: [THREE.Vector3Tuple, THREE.Vector3Tuple];
  private kicks = [0, 0];
  private readonly recoilAge = [1, 1];
  private bodyRecoilAge = 1;
  private bodyRecoilKick = 0;
  private readonly bodyRecoilDir = new THREE.Vector3(0, 0, 1);
  private nextBarrel = 0;
  private readonly activeSocketBySide: [number, number] = [0, 0];
  private target: THREE.Vector3 | null = null;
  private launchLift = 0;
  private yaw = 0;
  private pitch = 0;
  private readonly leftDir = new THREE.Vector3(0, 0, 1);
  private readonly rightDir = new THREE.Vector3(0, 0, 1);
  private readonly sideHeat: [number, number] = [0, 0];
  private updatedTime = 0;

  constructor(readonly mesh: THREE.Object3D, readonly definition: WeaponRigDefinition) {
    this.poseMatrices = Array.from({ length: Math.max(3, 1 + definition.sockets.length) }, () => new THREE.Matrix4());
    const firstLeft = definition.sockets.findIndex((_, i) => resolveSocketSide(definition, i) === 0);
    const firstRight = definition.sockets.findIndex((_, i) => resolveSocketSide(definition, i) === 1);
    this.activeSocketBySide[0] = firstLeft >= 0 ? firstLeft : 0;
    this.activeSocketBySide[1] = firstRight >= 0 ? firstRight : this.activeSocketBySide[0];
    const avgPoint = (side: 0 | 1, pick: 'pivot' | 'muzzle'): THREE.Vector3Tuple => {
      const list = definition.sockets.filter((_, i) => resolveSocketSide(definition, i) === side);
      if (list.length === 0) return definition.sockets[0]![pick];
      const sum: THREE.Vector3Tuple = [0, 0, 0];
      for (const s of list) { sum[0] += s[pick][0]; sum[1] += s[pick][1]; sum[2] += s[pick][2]; }
      return [sum[0] / list.length, sum[1] / list.length, sum[2] / list.length];
    };
    this.sidePivots = [avgPoint(0, 'pivot'), avgPoint(1, 'pivot')];
    this.sideMuzzles = [avgPoint(0, 'muzzle'), avgPoint(1, 'muzzle')];
    const u = mesh.userData.uniforms;
    if (u?.uWeaponPivot) {
      u.uWeaponPivot.value.fromArray(definition.pivot);
      u.uWeaponLeftPivot.value.fromArray(this.sidePivots[0]);
      u.uWeaponRightPivot.value.fromArray(this.sidePivots[1]);
      if (u.uWeaponLeftMuzzle) u.uWeaponLeftMuzzle.value.fromArray(this.sideMuzzles[0]);
      if (u.uWeaponRightMuzzle) u.uWeaponRightMuzzle.value.fromArray(this.sideMuzzles[1]);
      u.uWeaponCarrier.value = definition.carrier === 'spider' ? 9 : definition.carrier === 'biped' ? 8 : 0;
      if (u.uWeaponHeatScale) u.uWeaponHeatScale.value = definition.heatScale ?? 1;
      if (u.uWeaponSideHeat) u.uWeaponSideHeat.value.set(1, 1);
      if (u.uWeaponOffsetY) u.uWeaponOffsetY.value = this.offsetY;
      if (u.uWeaponBodyScale) {
        u.uWeaponBodyScale.value.set(
          definition.bodyRecoilPushM ?? (definition.carrier === 'spider' ? 0.085 : 0.052),
          definition.bodyRecoilDropM ?? (definition.carrier === 'spider' ? 0.055 : 0.025),
          definition.bodyRecoilPitchRad ?? (definition.carrier === 'spider' ? 0.085 : 0.055),
        );
      }
      if (u.uWeaponChassisRecoil) u.uWeaponChassisRecoil.value = definition.chassisRecoil === false ? 0 : 1;
    }
  }

  get hasSlewed(): boolean { return this.updatedTime > 0; }
  get currentYaw(): number { return this.yaw; }
  get barrelHeat(): number { return Math.max(this.sideHeat[0], this.sideHeat[1]); }
  barrelHeatFor(barrel = 0): number {
    return this.sideHeat[resolveSocketSide(this.definition, barrel % this.definition.sockets.length)];
  }

  aim(target: THREE.Vector3 | null, launchLift = 0): void {
    this.target = target?.clone() ?? null;
    this.launchLift = launchLift;
    this.syncTransform(0);
  }

  /** Clears combat target, launch arc lift, turret heading, heat, and recoil uniforms when a pooled mesh is recycled. */
  reset(): void {
    this.target = null;
    this.launchLift = 0;
    this.nextBarrel = 0;
    this.kicks = [0, 0];
    this.recoilAge[0] = 1;
    this.recoilAge[1] = 1;
    this.bodyRecoilAge = 1;
    this.bodyRecoilKick = 0;
    this.bodyRecoilDir.set(0, 0, 1);
    this.yaw = 0;
    this.pitch = 0;
    this.leftDir.set(0, 0, 1);
    this.rightDir.set(0, 0, 1);
    this.sideHeat[0] = 0;
    this.sideHeat[1] = 0;
    this.updatedTime = 0;
    (this.mesh.userData as { turretYaw?: number }).turretYaw = 0;
    this.uploadUniforms();
  }

  update(dt: number): void {
    if (dt > 0) this.updatedTime += dt;
    const dur = Math.max(0.12, this.definition.recoilDurationS ?? 0.32);
    const kickMax = this.definition.barrelRecoilM ?? 0.12;
    const peak = Math.min(0.045, dur * 0.14);
    this.kicks = this.recoilAge.map((age, i) => {
      const next = Math.min(dur, age * dur + Math.max(0, dt));
      this.recoilAge[i] = next / dur;
      if (kickMax <= 0 || next >= dur) return 0;
      if (next < peak) return kickMax * Math.sin((next / peak) * (Math.PI / 2));
      const u = Math.min(1, (next - peak) / (dur - peak));
      return kickMax * (1 - u * u * (3 - 2 * u));
    });
    const bodyDur = Math.max(0.18, dur * 1.15);
    this.bodyRecoilAge = Math.min(1, this.bodyRecoilAge + Math.max(0, dt) / bodyDur);
    if (this.bodyRecoilAge >= 1) {
      this.bodyRecoilKick = 0;
    } else {
      const rise = Math.min(1, this.bodyRecoilAge / 0.12);
      const fall = (1 - this.bodyRecoilAge) * (1 - this.bodyRecoilAge);
      this.bodyRecoilKick = Math.sin(rise * Math.PI * 0.5) * fall;
    }
    const coolRate = this.definition.heatCooldownPerS ?? 0.22;
    if (dt > 0) {
      this.sideHeat[0] = Math.max(0, this.sideHeat[0] - dt * coolRate);
      this.sideHeat[1] = Math.max(0, this.sideHeat[1] - dt * coolRate);
    }

    if (this.target && this.definition.chassisAim && dt > 0) {
      const world = this.mesh.getWorldPosition(new THREE.Vector3());
      const local = this.mesh.parent ? this.mesh.parent.worldToLocal(this.target.clone()) : this.target;
      const origin = this.mesh.parent ? this.mesh.parent.worldToLocal(world) : world;
      const desired = Math.atan2(local.x - origin.x, local.z - origin.z);
      const d = wrapAngle(desired - this.mesh.rotation.y);
      const step = (this.definition.turnSpeedRadPerS ?? 5.0) * dt;
      this.mesh.rotation.y = wrapAngle(this.mesh.rotation.y + THREE.MathUtils.clamp(d, -step, step));
    }
    this.syncTransform(dt);
  }

  private evalMount(): THREE.Vector3 {
    const def = this.definition;
    const pivot = this.local(def.pivot);
    const mount = pivot.clone();
    if (def.carrier) {
      const u = this.mesh.userData.uniforms;
      const bodyPoint = def.carrier === 'spider' ? evalSpiderBodyPoint : evalBipedBodyPoint;
      mount.fromArray(bodyPoint(...def.pivot, (u?.uTime?.value ?? 0) * 5, u?.uWalkWeight?.value ?? 0, u?.uWorkWeight?.value ?? 0));
      mount.y -= this.offsetY;
    }
    return mount;
  }

  private evalBodyRecoilDelta(pos: THREE.Vector3): THREE.Vector3 {
    const def = this.definition;
    const kick = this.bodyRecoilKick;
    if (def.chassisRecoil === false || kick <= 0.0001) return new THREE.Vector3();
    const isSpider = def.carrier === 'spider';
    const baseH = isSpider ? 0.65 : 0.35;
    const minY = isSpider ? 0.05 : 0.25;
    const w = THREE.MathUtils.clamp((pos.y + this.offsetY - minY) / baseH, 0, 1);
    const pushScale = def.bodyRecoilPushM ?? (isSpider ? 0.085 : 0.052);
    const dropScale = def.bodyRecoilDropM ?? (isSpider ? 0.055 : 0.025);
    const pitchScale = def.bodyRecoilPitchRad ?? (isSpider ? 0.085 : 0.055);
    const hx = -this.bodyRecoilDir.x;
    const hz = -this.bodyRecoilDir.z;
    const pushDist = pushScale * kick * w;
    const dropY = -dropScale * kick * w;
    const pitchAmt = pitchScale * kick * w;
    const relX = pos.x;
    const relY = pos.y - (0.72 - this.offsetY);
    const relZ = pos.z;
    const along = relX * -hx + relZ * -hz;
    return new THREE.Vector3(
      hx * (pushDist + relY * pitchAmt),
      dropY + along * pitchAmt,
      hz * (pushDist + relY * pitchAmt),
    );
  }

  private syncTransform(dt: number): void {
    this.mesh.updateWorldMatrix(true, false);
    const def = this.definition;
    const mount = this.evalMount();
    const pivot = this.local(def.pivot);
    const targetLocal = this.target ? this.mesh.worldToLocal(this.target.clone()) : null;

    let yawErr = 0;
    let pitchErr = 0;
    if (targetLocal) {
      const dx = targetLocal.x - mount.x;
      const dz = targetLocal.z - mount.z;
      const desiredYaw = Math.atan2(dx, dz);
      yawErr = wrapAngle(desiredYaw - this.yaw);
      if (dt > 0) {
        const maxTurn = (def.turnSpeedRadPerS ?? 5.0) * dt;
        this.yaw = wrapAngle(this.yaw + THREE.MathUtils.clamp(yawErr, -maxTurn, maxTurn));
        yawErr = wrapAngle(desiredYaw - this.yaw);
      }
      const horiz = Math.max(1e-4, Math.hypot(dx, dz));
      const desiredPitch = THREE.MathUtils.clamp(
        Math.atan2((targetLocal.y + this.launchLift) - mount.y, horiz),
        -0.55,
        1.15,
      );
      pitchErr = desiredPitch - this.pitch;
      if (dt > 0) {
        const maxPitch = 5.5 * dt;
        this.pitch += THREE.MathUtils.clamp(pitchErr, -maxPitch, maxPitch);
        pitchErr = desiredPitch - this.pitch;
      }
    } else if (dt > 0) {
      const relax = 2.5 * dt;
      this.pitch += THREE.MathUtils.clamp(0 - this.pitch, -relax, relax);
    }

    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const coaxial = new THREE.Vector3(Math.sin(this.yaw) * cp, sp, Math.cos(this.yaw) * cp).normalize();
    const headRotation = new THREE.Quaternion().setFromAxisAngle(Y_AXIS, this.yaw);
    const convWeight = targetLocal
      ? (1 - smoothstep(0.02, 0.14, Math.abs(yawErr))) * (1 - smoothstep(0.02, 0.14, Math.abs(pitchErr)))
      : 0;

    const resolveSideDir = (side: 0 | 1, out: THREE.Vector3) => {
      if (!targetLocal || convWeight <= 0.0001) {
        out.copy(coaxial);
        return;
      }
      const rest = this.local(this.sidePivots[side]);
      const anchor = rest.clone().sub(pivot).applyQuaternion(headRotation).add(mount);
      const aimed = targetLocal.clone().sub(anchor);
      aimed.y += this.launchLift;
      if (aimed.lengthSq() < 1e-8) out.copy(coaxial);
      else out.copy(coaxial).lerp(aimed.normalize(), convWeight).normalize();
    };
    resolveSideDir(0, this.leftDir);
    resolveSideDir(1, this.rightDir);

    (this.mesh.userData as { turretYaw?: number }).turretYaw = this.yaw;
    this.uploadUniforms();
  }

  private uploadUniforms(): void {
    const u = this.mesh.userData?.uniforms;
    if (!u?.uWeaponYaw) return;
    u.uWeaponYaw.value = this.yaw;
    u.uWeaponLeftDir.value.copy(this.leftDir);
    u.uWeaponRightDir.value.copy(this.rightDir);
    u.uWeaponRecoil.value.set(this.kicks[0], this.kicks[1]);
    u.uWeaponRecoilBody.value.set(this.bodyRecoilDir.x, this.bodyRecoilDir.y, this.bodyRecoilDir.z, this.bodyRecoilKick);
    const maxHeat = Math.max(this.sideHeat[0], this.sideHeat[1]);
    u.uWeaponHeat.value = maxHeat;
    if (u.uWeaponSideHeat) {
      if (maxHeat > 1e-5) u.uWeaponSideHeat.value.set(this.sideHeat[0] / maxHeat, this.sideHeat[1] / maxHeat);
      else u.uWeaponSideHeat.value.set(1, 1);
    }
    u.uWeaponHeatScale.value = this.definition.heatScale ?? 1;
    u.uWeaponOffsetY.value = this.offsetY;
  }

  /** CPU mirror only for emission sockets / diagnostics, never per-vertex or a runtime bone chain. */
  get matrices(): readonly THREE.Matrix4[] {
    const def = this.definition;
    const mount = this.evalMount();
    const headRec = this.evalBodyRecoilDelta(mount);
    const pivot = this.local(def.pivot);
    const headRotation = new THREE.Quaternion().setFromAxisAngle(Y_AXIS, this.yaw);
    this.poseMatrices[0]
      .compose(mount.clone().add(headRec), headRotation, ONE)
      .multiply(new THREE.Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z));
    def.sockets.forEach((_, i) => {
      const side = resolveSocketSide(def, i);
      const rest = this.local(this.sidePivots[side]);
      const anchor = rest.clone().applyMatrix4(this.poseMatrices[0]);
      const direction = (side === 0 ? this.leftDir : this.rightDir).clone().normalize();
      const rotation = new THREE.Quaternion().setFromUnitVectors(Z, direction);
      anchor.addScaledVector(direction, -this.kicks[side]!);
      this.poseMatrices[i + 1]!.compose(anchor, rotation, ONE)
        .multiply(new THREE.Matrix4().makeTranslation(-rest.x, -rest.y, -rest.z));
    });
    return this.poseMatrices;
  }

  /** True when the turret head and next barrel are aligned on the same line as `target`. */
  isAligned(target: THREE.Vector3, launchLift = 0, maxAngleRad = 0.045): boolean {
    this.mesh.updateWorldMatrix(true, false);
    const barrelIdx = this.nextBarrel % this.definition.sockets.length;
    const muzzle = this.muzzle(barrelIdx);
    const desired = target.clone().sub(muzzle);
    desired.y += launchLift;
    if (desired.lengthSq() < 1e-8) return true;
    desired.normalize();
    const current = this.direction(barrelIdx);
    if (current.dot(desired) < Math.cos(maxAngleRad)) return false;
    const local = this.mesh.worldToLocal(target.clone());
    const mount = this.evalMount();
    const desiredYaw = Math.atan2(local.x - mount.x, local.z - mount.z);
    return Math.abs(wrapAngle(desiredYaw - this.yaw)) <= maxAngleRad;
  }

  /** Immediately sets orientation to aim straight at `target` (used only on initial spawn or direct math tests). */
  snapAim(target: THREE.Vector3, launchLift = 0): void {
    this.target = target.clone();
    this.launchLift = launchLift;
    this.mesh.updateWorldMatrix(true, false);
    if (this.definition.chassisAim) {
      const world = this.mesh.getWorldPosition(new THREE.Vector3());
      const local = this.mesh.parent ? this.mesh.parent.worldToLocal(target.clone()) : target;
      const origin = this.mesh.parent ? this.mesh.parent.worldToLocal(world) : world;
      this.mesh.rotation.y = Math.atan2(local.x - origin.x, local.z - origin.z);
      this.mesh.updateWorldMatrix(true, false);
    }
    const targetLocal = this.mesh.worldToLocal(target.clone());
    const mount = this.evalMount();
    const dx = targetLocal.x - mount.x;
    const dz = targetLocal.z - mount.z;
    this.yaw = Math.atan2(dx, dz);
    this.pitch = THREE.MathUtils.clamp(
      Math.atan2((targetLocal.y + launchLift) - mount.y, Math.max(1e-4, Math.hypot(dx, dz))),
      -0.55,
      1.15,
    );
    this.syncTransform(0);
  }

  /** Trigger recoil, suspension kickback, and barrel heating WITHOUT teleporting turret orientation. */
  triggerFire(recoil = true, heatGainOverride?: number): { from: THREE.Vector3; barrel: number } {
    const barrel = this.nextBarrel++ % this.definition.sockets.length;
    const side = resolveSocketSide(this.definition, barrel);
    this.activeSocketBySide[side] = barrel;
    this.recoilAge[side] = recoil ? 0 : 1;
    this.kicks[side] = 0;
    if (recoil) {
      this.bodyRecoilAge = 0;
      this.bodyRecoilKick = 0;
      this.bodyRecoilDir.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)).normalize();
      if ((this.definition.heatScale ?? 1) > 0) {
        const gain = heatGainOverride ?? this.definition.heatGain ?? 0.34;
        this.sideHeat[side] = Math.min(1, this.sideHeat[side] + gain);
      }
    }
    this.syncTransform(0);
    return { from: this.muzzle(barrel), barrel };
  }

  fire(target: THREE.Vector3, launchLift = 0, recoil = true): { from: THREE.Vector3; barrel: number } {
    this.snapAim(target, launchLift);
    return this.triggerFire(recoil);
  }

  muzzle(barrel = 0): THREE.Vector3 {
    this.mesh.updateWorldMatrix(true, false);
    const matrices = this.matrices;
    return this.local(this.definition.sockets[barrel]!.muzzle)
      .applyMatrix4(matrices[barrel + 1]!).applyMatrix4(this.mesh.matrixWorld);
  }

  /** Returns the turret breech port for spent brass casing ejection + world ground Y beneath the shooter. */
  ejectOrigin(barrel = 0): { pos: THREE.Vector3; groundY: number } {
    this.mesh.updateWorldMatrix(true, false);
    const sock = this.definition.sockets[barrel] ?? this.definition.sockets[0]!;
    const portZ = this.definition.ejectZ ?? this.definition.pivot[2];
    const localPort = this.local([sock.pivot[0], sock.pivot[1] + 0.06, portZ]);
    const pos = localPort.applyMatrix4(this.matrices[0]!).applyMatrix4(this.mesh.matrixWorld);
    const groundY = this.mesh.getWorldPosition(new THREE.Vector3()).y;
    return { pos, groundY };
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

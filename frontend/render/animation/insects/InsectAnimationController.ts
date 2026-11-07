import * as THREE from 'three';
import { InsectInertia } from './InsectInertia';
import { insectPartMatrix, type InsectPose } from './pose';
import { INSECT_SCALE, INSECT_SPECIES, SPECIES_CODE } from './rig';

export type InsectState = 'idle' | 'moving' | 'windup' | 'attack' | 'recovery' | 'hurt' | 'dying' | 'dead';
export interface InsectActionView {
  state: 'idle' | 'moving' | 'windup' | 'attack' | 'recovery';
  startedTick: number; durationTicks: number; targetId?: number | null;
}
const smooth = (t: number) => { const u = Math.max(0, Math.min(1, t)); return u * u * (3 - 2 * u); };

/** Presentation follows authoritative phase timestamps; it never selects targets or deals damage. */
export class InsectAnimationController {
  private action: InsectActionView = { state: 'idle', startedTick: -1, durationTicks: 1 };
  private age = 0;
  private readonly chargeMotion = new InsectInertia();
  private readonly strikeMotion = new InsectInertia();
  private lastReleaseTick = -1;
  private nextSac = 0;
  private releasedSac = 0;
  private moving = false;
  private hurtRemaining = 0;
  private deathAge: number | null = null;
  readonly species: number;

  constructor(readonly mesh: THREE.Object3D) {
    this.species = SPECIES_CODE[INSECT_SPECIES[mesh.userData.archetypeId ?? mesh.name]!];
    this.update(0);
  }
  sync(action: InsectActionView | undefined, simTick: number): void {
    if (this.deathAge !== null) return;
    if (!action) {
      this.action = { state: 'idle', startedTick: -1, durationTicks: 1 };
      this.age = 0;
      this.update(0);
      return;
    }
    if (action.state === 'attack' && action.startedTick > this.lastReleaseTick) {
      this.lastReleaseTick = action.startedTick;
      this.releasedSac = this.nextSac;
      this.nextSac = 1 - this.nextSac;
      // Contact remains tied to the authoritative release; recovery carries momentum afterward.
      this.strikeMotion.snap(1);
    }
    const elapsed = Math.max(0, (simTick - action.startedTick) / 5);
    if (action.state !== this.action.state || action.startedTick !== this.action.startedTick) this.age = elapsed;
    else this.age = Math.max(this.age, elapsed);
    this.action = { ...action };
    this.update(0);
  }
  setMoving(moving: boolean): void { this.moving = moving; }
  hit(): void { if (this.deathAge === null) this.hurtRemaining = 0.22; }
  die(): void { if (this.deathAge === null) { this.deathAge = 0; this.moving = false; } }
  /** An authoritative correction restored this insect after a predicted death. */
  revive(): void {
    this.deathAge = null;
    this.hurtRemaining = 0;
    this.lastReleaseTick = -1;
    this.action = { state: 'idle', startedTick: -1, durationTicks: 1 };
    this.age = 0;
    this.chargeMotion.snap(0);
    this.strikeMotion.snap(0);
    this.update(0);
  }
  get state(): InsectState {
    if (this.deathAge !== null) return this.deathAge >= 0.9 ? 'dead' : 'dying';
    if (this.hurtRemaining > 0) return 'hurt';
    if (this.action.state === 'idle' || this.action.state === 'moving') return this.moving ? 'moving' : 'idle';
    return this.action.state;
  }
  get phase(): number { return Math.min(1, this.age / Math.max(0.2, this.action.durationTicks / 5)); }
  get emissionSide(): number { return this.releasedSac; }
  get corpseDone(): boolean { return (this.deathAge ?? 0) >= 2.4; }
  get pose(): InsectPose {
    const state = this.action.state;
    const death = this.deathAge === null ? 0 : smooth(this.deathAge / 0.9);
    const charge = this.chargeMotion.value;
    const strike = this.strikeMotion.value;
    return { species: this.species, time: this.mesh.userData.uniforms?.uTime?.value ?? 0,
      walk: this.deathAge === null && (state === 'idle' || state === 'moving') && this.moving ? 1 : 0,
      sacSide: (state === 'windup' ? this.nextSac : this.releasedSac) === 0 ? -1 : 1,
      charge, strike, hurt: Math.sin(Math.min(1, this.hurtRemaining / 0.22) * Math.PI), death };
  }
  update(dt: number): void {
    this.age += Math.max(0, dt);
    this.hurtRemaining = Math.max(0, this.hurtRemaining - Math.max(0, dt));
    if (this.deathAge !== null) this.deathAge += Math.max(0, dt);
    const chargeTarget = this.action.state === 'windup' ? smooth(this.phase) : 0;
    const strikeTarget = this.action.state === 'attack' ? 1 - 0.45 * smooth(this.phase) : 0;
    this.chargeMotion.step(chargeTarget, Math.max(0, dt), 18);
    this.strikeMotion.step(strikeTarget, Math.max(0, dt), this.species === 1 ? 9 : 11);
    const p = this.pose;
    const u = this.mesh.userData.uniforms;
    if (!u?.uInsectAction) return;
    u.uInsectAction.value.set(p.charge, p.strike, p.hurt, p.death);
    u.uInsectSpecies.value = this.species;
    u.uInsectWalk.value = p.walk;
    u.uInsectSacSide.value = p.sacSide;
  }
  socket(kind: 'projectile' | 'melee', side = this.emissionSide): THREE.Vector3 {
    const isSac = kind === 'projectile' && this.species === 2;
    const sign = side % 2 === 0 ? -1 : 1;
    const socket = isSac ? new THREE.Vector3(sign * 0.28, 1.24, -0.84)
      : this.species === 1 ? new THREE.Vector3(0, 1.02, 1.29) : new THREE.Vector3(0, 0.61, this.species === 0 ? 1.14 : 0.98);
    const part = isSac ? { group: 6, pivot: [sign * 0.18, 0.95, -0.77] as THREE.Vector3Tuple, anim: 69 }
      : { group: 2, pivot: [0, 0, 0] as THREE.Vector3Tuple, anim: 9 };
    this.mesh.updateWorldMatrix(true, false);
    return socket.multiplyScalar(INSECT_SCALE[this.species] ?? 1).applyMatrix4(insectPartMatrix(part, this.pose)).applyMatrix4(this.mesh.matrixWorld);
  }
}
const controllers = new WeakMap<THREE.Object3D, InsectAnimationController>();
export function attachInsectAnimator(mesh: THREE.Object3D): InsectAnimationController {
  const controller = new InsectAnimationController(mesh);
  controllers.set(mesh, controller);
  return controller;
}
export function getInsectAnimator(mesh: THREE.Object3D): InsectAnimationController | undefined { return controllers.get(mesh); }

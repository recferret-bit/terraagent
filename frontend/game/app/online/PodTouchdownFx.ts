import * as THREE from 'three';
import type { PlanetKind } from '@terra/render/planets/PlanetSpec';
import { createFlames, type Flames } from '../../descent/fx/Flames';
import { createGroundFX, type GroundFX } from '../../descent/fx/GroundFX';
import { clamp, smoother, smoothstep } from '../../descent/math';
import { POD_EGRESS_YAW, PodImpactRig } from './PodImpactRig';

const POD_NOZZLES = [0, 1, 2, 3].map((i) => {
  const a = (i * Math.PI) / 2 + Math.PI / 4;
  const r = 1.44;
  const tilt = 0.45;
  return {
    pos: new THREE.Vector3(Math.cos(a) * r, 0.4, Math.sin(a) * r),
    dir: new THREE.Vector3(Math.cos(a) * Math.sin(tilt), -Math.cos(tilt), Math.sin(a) * Math.sin(tilt)).normalize(),
  };
});

/** Duration (s) of the final retro-burn descent onto the hex pad (`0.00s -> 1.75s`). */
export const POD_TOUCHDOWN_DESCENT_S = 1.75;
/** End timestamp (s) of the post-touchdown retro-engine stop animation (`1.75s -> 2.35s`). */
export const POD_ENGINE_STOP_END_S = 2.35;
/** Duration (s) after touchdown during which the pod sits closed in the impact crater with NO UI (`2.00s`). */
export const POD_IMPACT_WAIT_S = 2.0;
/** Timestamp (s) when the 2s post-impact wait ends and the pod shell begins opening (`1.75s + 2.00s = 3.75s`). */
export const POD_WAIT_END_S = POD_TOUCHDOWN_DESCENT_S + POD_IMPACT_WAIT_S;
/** Duration (s) of pod petal opening, hero explorer rollout, and pod shell retraction (`1.25s`). */
export const POD_EGRESS_DURATION_S = 1.25;
/** Total surface landing state-machine duration (`0.00s -> 5.00s`). */
export const POD_TOUCHDOWN_TOTAL_S = POD_WAIT_END_S + POD_EGRESS_DURATION_S;
/** Initial drop altitude (m) above the hex landing pad at the start of `retro` (`t = 0`). */
export const POD_TOUCHDOWN_START_ALT_M = 21;

export type PodLandingMode = 'full' | 'short' | 'skip';

export type PodLandingStateName =
  | 'orbit' | 'release' | 'freefall' | 'reentry' | 'chute'
  | 'approach' | 'retro' | 'impact_wait' | 'egress' | 'done';

export const POD_FULL_STATE_ORDER: readonly PodLandingStateName[] = [
  'orbit', 'release', 'freefall', 'reentry', 'chute', 'approach', 'retro', 'impact_wait', 'egress', 'done',
];

export const POD_SHORT_STATE_ORDER: readonly PodLandingStateName[] = [
  'retro', 'impact_wait', 'egress', 'done',
];

export type PodLandingPhase = 'descending' | 'engine-stop' | 'impact-wait' | 'opening' | 'settled';

export interface PodTouchdownState {
  readonly active: boolean;
  readonly descending: boolean;
  readonly mode: PodLandingMode;
  readonly state: PodLandingStateName;
  readonly phase: PodLandingPhase;
  readonly elapsed: number;
  readonly podLift: number;
  readonly thrust: number;
  readonly dustIntensity: number;
  readonly podVisible: boolean;
  readonly egressRigVisible: boolean;
  readonly podOpenProgress: number;
  readonly podDismantleProgress: number;
  readonly craterVisible: boolean;
  readonly hqVisible: boolean;
  readonly heroEgressProgress: number;
  readonly uiVisible: boolean;
  /** `0..1` seismic camera shake intensity (retro ground-effect rumble + touchdown impact jolt). */
  readonly cameraShake: number;
}

/**
 * Strict pod landing state machine supporting:
 * - `'full'` mode (from space: `orbit -> release -> freefall -> reentry -> chute -> approach -> retro -> impact_wait -> egress -> done`)
 * - `'short'` mode (from final landing approach: `retro -> impact_wait -> egress -> done`)
 * - `'skip'` mode (already landed: `'done'`)
 *
 * Surface sequence (`0.00s .. 5.00s`):
 * 1. `'retro'` (`0.00 .. 1.75s`, phase `'descending'`): pod drops from `24m` to `0m` on 4 retro-thruster flames.
 * 2. `'impact_wait'` (`1.75 .. 3.75s`, phases `'engine-stop'` then `'impact-wait'`): touchdown spawns the 3D impact
 *    crater, shockwave rings, flying debris, and dust/ember burst while engines throttle off (`1.75 .. 2.35s`). For a
 *    full `2.0s` after touchdown (`1.75 .. 3.75s`), the closed pod rests in the crater with **no HUD interface** and
 *    the hero explorer still inside (`hqVisible = false`, `uiVisible = false`).
 * 3. `'egress'` (`3.75 .. 5.00s`, phase `'opening'`): pod petals and front ramp swing open, the hero explorer robot
 *    (`robot.hero`) emerges and drives down the ramp onto the hex tile, and the opened pod shell retracts into the
 *    crater so no pod remains in place (`uiVisible = false` until egress completes).
 * 4. `'done'` (`>= 5.00s`, phase `'settled'`): pod is gone (`podVisible = false`), impact crater remains on the tile,
 *    hero explorer robot is deployed and selected (`hqVisible = true`), and gameplay HUD appears (`uiVisible = true`).
 */
export class PodTouchdownFx {
  readonly thrLight = new THREE.PointLight(0xffb070, 0, 18, 2);
  readonly impactRig: PodImpactRig;
  private flames: Flames | null = null;
  private attachedPodMesh: THREE.Object3D | null = null;
  private groundFx: GroundFX | null = null;
  private groundKind: PlanetKind | null = null;
  private mode: PodLandingMode;
  private spacePhase: PodLandingStateName | null = null;
  private elapsed = 0;
  private time = 0;
  private wasSimDescending = false;
  private lastPodEntityId: number | null = null;
  private podRemoved = false;
  private lastCameraShake = 0;
  private readonly groundPos = new THREE.Vector3();

  constructor(
    private readonly scene: THREE.Scene,
    private enabled = true,
    mode?: PodLandingMode,
  ) {
    this.mode = mode ?? (enabled ? 'short' : 'skip');
    this.thrLight.name = 'pod-retro-light';
    this.scene.add(this.thrLight);
    this.impactRig = new PodImpactRig(this.scene);
    if (!this.enabled || this.mode === 'skip') {
      this.enabled = false;
      this.mode = 'skip';
      this.elapsed = POD_TOUCHDOWN_TOTAL_S + 1;
    }
  }

  getMode(): PodLandingMode {
    return this.mode;
  }

  setMode(mode: PodLandingMode): void {
    this.mode = mode;
    if (mode === 'skip') {
      this.setEnabled(false);
    } else {
      this.enabled = true;
    }
  }

  setSpacePhase(phase: PodLandingStateName | null): void {
    const wasSpace = this.spacePhase !== null;
    this.spacePhase = phase;
    if (phase !== null && this.mode !== 'full') {
      this.mode = 'full';
    } else if (phase === null && wasSpace && this.enabled) {
      this.elapsed = 0;
      this.wasSimDescending = false;
    }
  }

  getSpacePhase(): PodLandingStateName | null {
    return this.spacePhase;
  }

  isSpacePhaseActive(): boolean {
    return this.spacePhase !== null;
  }

  getStateOrder(): readonly PodLandingStateName[] {
    return this.mode === 'full' ? POD_FULL_STATE_ORDER : POD_SHORT_STATE_ORDER;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.mode = 'skip';
      this.spacePhase = null;
      this.elapsed = POD_TOUCHDOWN_TOTAL_S + 1;
      this.hideFx();
      this.impactRig.setSettled();
    } else if (this.mode === 'skip') {
      this.mode = 'short';
    }
  }

  restart(mode: PodLandingMode = this.mode === 'skip' ? 'short' : this.mode): void {
    this.mode = mode;
    this.enabled = mode !== 'skip';
    this.spacePhase = null;
    this.podRemoved = false;
    this.elapsed = this.enabled ? 0 : POD_TOUCHDOWN_TOTAL_S + 1;
  }

  hasTouchedDown(): boolean {
    return !this.spacePhase && (!this.enabled || this.elapsed >= POD_TOUCHDOWN_DESCENT_S);
  }

  isHqDeployed(): boolean {
    return !this.spacePhase && (!this.enabled || this.elapsed >= POD_TOUCHDOWN_TOTAL_S);
  }

  getCameraShake(): number {
    return this.lastCameraShake;
  }

  private ensureFlames(podMesh: THREE.Object3D): Flames {
    if (this.flames && this.attachedPodMesh === podMesh) return this.flames;
    if (this.flames && this.attachedPodMesh) {
      this.attachedPodMesh.remove(this.flames.group);
      this.flames.dispose();
    }
    this.flames = createFlames(POD_NOZZLES);
    this.flames.group.name = 'pod-retro-flames';
    podMesh.add(this.flames.group);
    this.attachedPodMesh = podMesh;
    return this.flames;
  }

  private ensureGroundFx(kind: PlanetKind): GroundFX | null {
    if (this.groundFx && this.groundKind === kind) return this.groundFx;
    if (this.groundFx) {
      this.scene.remove(this.groundFx.group);
      this.groundFx.dispose();
      this.groundFx = null;
    }
    this.groundKind = kind;
    try {
      if (typeof document !== 'undefined') {
        const probe = document.createElement('canvas');
        if (probe.getContext('2d')) {
          this.groundFx = createGroundFX(kind, 101);
          this.groundFx.group.name = 'pod-ground-fx';
          this.scene.add(this.groundFx.group);
        }
      }
    } catch {
      this.groundFx = null;
    }
    return this.groundFx;
  }

  private hideFx(): void {
    if (this.flames) this.flames.group.visible = false;
    if (this.groundFx) this.groundFx.group.visible = false;
    this.thrLight.intensity = 0;
  }

  private buildSettledState(visible: boolean): PodTouchdownState {
    return {
      active: false,
      descending: false,
      mode: this.mode,
      state: 'done',
      phase: 'settled',
      elapsed: this.elapsed,
      podLift: 0,
      thrust: 0,
      dustIntensity: 0,
      podVisible: false,
      egressRigVisible: visible,
      podOpenProgress: 1,
      podDismantleProgress: visible ? 0 : 1,
      craterVisible: visible,
      hqVisible: true,
      heroEgressProgress: 1,
      uiVisible: true,
      cameraShake: 0,
    };
  }

  computeState(simDescending: boolean, _simProgress: number, podEntityId?: number | null): PodTouchdownState {
    if (this.spacePhase) {
      return {
        active: true,
        descending: true,
        mode: this.mode,
        state: this.spacePhase,
        phase: 'descending',
        elapsed: 0,
        podLift: POD_TOUCHDOWN_START_ALT_M,
        thrust: 0,
        dustIntensity: 0,
        podVisible: false,
        egressRigVisible: false,
        podOpenProgress: 0,
        podDismantleProgress: 0,
        craterVisible: false,
        hqVisible: false,
        heroEgressProgress: 0,
        uiVisible: false,
        cameraShake: 0,
      };
    }

    const isNewPod =
      typeof podEntityId === 'number' &&
      ((this.lastPodEntityId !== null && podEntityId !== this.lastPodEntityId) || this.podRemoved);
    if (typeof podEntityId === 'number') {
      this.lastPodEntityId = podEntityId;
      this.podRemoved = false;
    } else if (podEntityId === null && !simDescending) {
      this.podRemoved = true;
    }

    if (simDescending && (isNewPod || (!this.wasSimDescending && (!this.enabled || this.elapsed >= POD_TOUCHDOWN_TOTAL_S)))) {
      this.restart('short');
    }
    if (this.wasSimDescending && !simDescending && this.elapsed === 0 && typeof requestAnimationFrame === 'undefined') {
      this.elapsed = POD_TOUCHDOWN_TOTAL_S + 1;
    }
    this.wasSimDescending = simDescending;

    if (this.podRemoved && !simDescending) {
      this.hideFx();
      this.impactRig.hide();
      return this.buildSettledState(false);
    }

    if (!this.enabled || this.elapsed >= POD_TOUCHDOWN_TOTAL_S) {
      return this.buildSettledState(true);
    }

    return this.computeActiveSurfaceState(this.elapsed);
  }

  private computeActiveSurfaceState(t: number): PodTouchdownState {
    if (t < POD_TOUCHDOWN_DESCENT_S) {
      const u = clamp(t / POD_TOUCHDOWN_DESCENT_S, 0, 1);
      const decel = 1 - smoothstep(0, 1, u);
      const podLift = POD_TOUCHDOWN_START_ALT_M * decel * decel;
      const ignite = this.mode === 'full' ? 1 : smoothstep(0, 0.22, t);
      const prox = clamp(1 - podLift / 22, 0, 1);
      const retroRumble = smoothstep(0.52, 1.0, u) * 0.22;
      return {
        active: true,
        descending: true,
        mode: this.mode,
        state: 'retro',
        phase: 'descending',
        elapsed: t,
        podLift,
        thrust: ignite,
        dustIntensity: ignite * prox * prox,
        podVisible: true,
        egressRigVisible: false,
        podOpenProgress: 0,
        podDismantleProgress: 0,
        craterVisible: false,
        hqVisible: false,
        heroEgressProgress: 0,
        uiVisible: false,
        cameraShake: retroRumble,
      };
    }

    if (t < POD_WAIT_END_S) {
      const thrust = 1 - smoothstep(POD_TOUCHDOWN_DESCENT_S, POD_ENGINE_STOP_END_S, t);
      const dust = (1 - smoothstep(POD_TOUCHDOWN_DESCENT_S, POD_WAIT_END_S, t)) * 0.92;
      const dtImpact = Math.max(0, t - POD_TOUCHDOWN_DESCENT_S);
      const primaryJolt = Math.exp(-dtImpact * 3.8) * (1 - smoothstep(0, 1.25, dtImpact));
      const aftershock = 0.34 * Math.exp(-Math.pow((dtImpact - 0.2) / 0.14, 2));
      return {
        active: true,
        descending: false,
        mode: this.mode,
        state: 'impact_wait',
        phase: t < POD_ENGINE_STOP_END_S ? 'engine-stop' : 'impact-wait',
        elapsed: t,
        podLift: 0,
        thrust,
        dustIntensity: dust,
        podVisible: true,
        egressRigVisible: false,
        podOpenProgress: 0,
        podDismantleProgress: 0,
        craterVisible: true,
        hqVisible: false,
        heroEgressProgress: 0,
        uiVisible: false,
        cameraShake: clamp(primaryJolt + aftershock, 0, 1),
      };
    }

    const u = clamp((t - POD_WAIT_END_S) / POD_EGRESS_DURATION_S, 0, 1);
    return {
      active: true,
      descending: false,
      mode: this.mode,
      state: 'egress',
      phase: 'opening',
      elapsed: t,
      podLift: 0,
      thrust: 0,
      dustIntensity: (1 - u) * 0.28,
      podVisible: false,
      egressRigVisible: true,
      podOpenProgress: smoother(0, 0.55, u),
      podDismantleProgress: 0,
      craterVisible: true,
      hqVisible: u >= 0.12,
      heroEgressProgress: smoother(0.12, 0.85, u),
      uiVisible: false,
      cameraShake: 0,
    };
  }

  update(
    dt: number,
    podMesh: THREE.Object3D | null,
    groundY: number,
    simDescending: boolean,
    simProgress: number,
    planetKind: PlanetKind = 'forestRock',
  ): PodTouchdownState {
    const step = Math.max(0, dt);
    this.time += step;
    if (this.enabled && !this.spacePhase && podMesh && this.elapsed < POD_TOUCHDOWN_TOTAL_S) {
      this.elapsed += step;
    }

    const podEntityId = podMesh
      ? typeof podMesh.userData?.entityId === 'number'
        ? Number(podMesh.userData.entityId)
        : undefined
      : null;
    const state = this.computeState(simDescending, simProgress, podEntityId);
    this.lastCameraShake = podMesh ? state.cameraShake : 0;
    if (!podMesh) {
      this.hideFx();
      this.impactRig.hide();
      return state;
    }

    const impactAge = Math.max(0, state.elapsed - POD_TOUCHDOWN_DESCENT_S);
    this.groundPos.set(podMesh.position.x, groundY, podMesh.position.z);
    this.impactRig.update({
      time: this.time,
      pos: this.groundPos,
      yaw: POD_EGRESS_YAW,
      craterVisible: state.craterVisible,
      sinceTouchdown: impactAge,
      egressRigVisible: state.egressRigVisible,
      podOpenProgress: state.podOpenProgress,
      podDismantleProgress: state.podDismantleProgress,
    });

    if (state.thrust <= 0.001 && state.dustIntensity <= 0.001) {
      this.hideFx();
      podMesh.rotation.x = 0;
      podMesh.rotation.z = 0;
      return state;
    }

    const flames = this.ensureFlames(podMesh);
    flames.group.visible = state.thrust > 0.01 && state.podVisible;
    flames.u.uI.value = state.thrust;
    flames.u.uTime.value = this.time;

    const wobble = state.podLift > 0.05 ? clamp(state.podLift / POD_TOUCHDOWN_START_ALT_M, 0, 1) : 0;
    podMesh.rotation.x = Math.sin(this.time * 4.3) * 0.045 * wobble;
    podMesh.rotation.z = Math.cos(this.time * 3.7) * 0.045 * wobble;

    const flicker = 0.88 + 0.12 * Math.sin(this.time * 47) * Math.cos(this.time * 31);
    this.thrLight.position.set(podMesh.position.x, podMesh.position.y + 0.4, podMesh.position.z);
    this.thrLight.intensity = state.thrust * 9 * flicker;

    const gfx = this.ensureGroundFx(planetKind);
    if (gfx) {
      gfx.group.visible = state.dustIntensity > 0.005;
      this.groundPos.set(podMesh.position.x, groundY, podMesh.position.z);
      gfx.update(this.time, this.groundPos, state.dustIntensity, 800);
    }

    return state;
  }

  dispose(): void {
    if (this.flames) {
      this.attachedPodMesh?.remove(this.flames.group);
      this.flames.dispose();
      this.flames = null;
      this.attachedPodMesh = null;
    }
    if (this.groundFx) {
      this.scene.remove(this.groundFx.group);
      this.groundFx.dispose();
      this.groundFx = null;
    }
    this.impactRig.dispose();
    this.scene.remove(this.thrLight);
    this.thrLight.dispose();
  }
}


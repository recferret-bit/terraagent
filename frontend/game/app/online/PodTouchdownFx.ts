import * as THREE from 'three';
import { enqueueDeferredDispose } from '@terra/render/core/deferredDispose';
import type { PlanetKind } from '@terra/render/planets/PlanetSpec';
import { getSharedTerrainPrep } from '@terra/render/planets/prep';
import { createFlames, type Flames } from '../../descent/fx/Flames';
import { createGroundFX, type GroundFX } from '../../descent/fx/GroundFX';
import { clamp } from '../../descent/math';
import { POD_EGRESS_YAW, PodImpactRig } from './PodImpactRig';
import {
  buildSettledPodState,
  buildSpacePodState,
  computeActivePodSurfaceState,
  POD_ENGINE_STOP_END_S,
  POD_EGRESS_DURATION_S,
  POD_FULL_STATE_ORDER,
  POD_IMPACT_WAIT_S,
  POD_SHORT_STATE_ORDER,
  POD_TOUCHDOWN_DESCENT_S,
  POD_TOUCHDOWN_START_ALT_M,
  POD_TOUCHDOWN_TOTAL_S,
  POD_WAIT_END_S,
  type ColonyLoadMode,
  type PodLandingMode,
  type PodLandingPhase,
  type PodLandingStateName,
  type PodTouchdownState,
} from './podTouchdownState';

const POD_NOZZLES = [0, 1, 2, 3].map((i) => {
  const a = (i * Math.PI) / 2 + Math.PI / 4;
  const r = 1.44;
  const tilt = 0.45;
  return {
    pos: new THREE.Vector3(Math.cos(a) * r, 0.4, Math.sin(a) * r),
    dir: new THREE.Vector3(Math.cos(a) * Math.sin(tilt), -Math.cos(tilt), Math.sin(a) * Math.sin(tilt)).normalize(),
  };
});

export {
  POD_ENGINE_STOP_END_S,
  POD_EGRESS_DURATION_S,
  POD_FULL_STATE_ORDER,
  POD_IMPACT_WAIT_S,
  POD_SHORT_STATE_ORDER,
  POD_TOUCHDOWN_DESCENT_S,
  POD_TOUCHDOWN_START_ALT_M,
  POD_TOUCHDOWN_TOTAL_S,
  POD_WAIT_END_S,
  type ColonyLoadMode,
  type PodLandingMode,
  type PodLandingPhase,
  type PodLandingStateName,
  type PodTouchdownState,
};

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
  private groundAttemptedKind: PlanetKind | null = null;
  private mode: PodLandingMode;
  private spacePhase: PodLandingStateName | null = null;
  private skipLocked = false;
  private elapsed = 0;
  private time = 0;
  private wasSimDescending = false;
  private lastPodEntityId: number | null = null;
  private podRemoved = false;
  private hasGroundPos = false;
  private landedResourcesUnloaded = false;
  private lastCameraShake = 0;
  private readonly groundPos = new THREE.Vector3();

  constructor(
    private readonly scene: THREE.Scene,
    private enabled = true,
    mode?: PodLandingMode,
    deferBuild = false,
  ) {
    this.mode = mode ?? (enabled ? 'short' : 'skip');
    this.thrLight.name = 'pod-retro-light';
    this.scene.add(this.thrLight);
    const skipInit = !this.enabled || this.mode === 'skip';
    this.impactRig = new PodImpactRig(this.scene, deferBuild || skipInit);
    if (skipInit) {
      this.enabled = false;
      this.mode = 'skip';
      this.elapsed = POD_TOUCHDOWN_TOTAL_S + 1;
    }
  }

  getMode(): PodLandingMode {
    return this.mode;
  }

  setSkipLocked(locked: boolean): void {
    this.skipLocked = locked;
    if (locked) this.setEnabled(false);
  }

  isSkipLocked(): boolean {
    return this.skipLocked;
  }

  setMode(mode: PodLandingMode): void {
    if (this.skipLocked && mode !== 'skip') return;
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
    // Keep `thrLight.visible = false` while `DescentRunner` owns the scene's single `PointLight` (`GroundFx.light`),
    // then flip `thrLight.visible = true` (intensity 0) on surface handoff so `NUM_POINT_LIGHTS` stays constant (= 1).
    this.thrLight.visible = phase === null;
    if (phase !== null) this.thrLight.intensity = 0;
    if (phase !== null && this.mode !== 'full') {
      this.mode = 'full';
    } else if (phase === null && wasSpace && this.enabled) {
      this.elapsed = 0;
      this.wasSimDescending = false;
      this.landedResourcesUnloaded = false;
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
    if (this.skipLocked && enabled) return;
    this.enabled = enabled;
    if (!enabled) {
      this.mode = 'skip';
      this.spacePhase = null;
      this.thrLight.visible = true;
      this.elapsed = POD_TOUCHDOWN_TOTAL_S + 1;
      this.lastCameraShake = 0;
      this.hideFx();
      if (this.hasGroundPos) {
        this.unloadLandingFx(false);
        this.impactRig.setSettled(this.groundPos);
      } else {
        this.unloadLandingFx(true);
      }
    } else if (this.mode === 'skip') {
      this.mode = 'short';
      this.landedResourcesUnloaded = false;
    }
  }

  restart(mode: PodLandingMode = this.mode === 'skip' ? 'short' : this.mode): void {
    if (this.skipLocked && mode !== 'skip') return;
    this.mode = mode;
    this.enabled = mode !== 'skip';
    this.spacePhase = null;
    this.thrLight.visible = true;
    this.podRemoved = false;
    this.hasGroundPos = false;
    this.landedResourcesUnloaded = false;
    if (this.enabled) this.impactRig.ensureBuilt();
    this.elapsed = this.enabled ? 0 : POD_TOUCHDOWN_TOTAL_S + 1;
  }

  hasTouchedDown(): boolean {
    return !this.spacePhase && (!this.enabled || this.podRemoved || this.elapsed >= POD_TOUCHDOWN_DESCENT_S);
  }

  isHqDeployed(): boolean {
    return !this.spacePhase && (!this.enabled || this.podRemoved || this.elapsed >= POD_TOUCHDOWN_TOTAL_S);
  }

  /** Pure non-mutating surface touchdown snapshot for external HUD synchronization. */
  peekSurfaceState(): { elapsed: number; podLift: number; touchedDown: boolean; settled: boolean } {
    const settled = !this.enabled || this.podRemoved || this.elapsed >= POD_TOUCHDOWN_TOTAL_S;
    if (this.spacePhase || settled) {
      return { elapsed: this.elapsed, podLift: settled ? 0 : POD_TOUCHDOWN_START_ALT_M, touchedDown: settled, settled };
    }
    const u = clamp(this.elapsed / POD_TOUCHDOWN_DESCENT_S, 0, 1);
    const decel = 1 - u;
    const podLift = this.elapsed < POD_TOUCHDOWN_DESCENT_S ? POD_TOUCHDOWN_START_ALT_M * decel * decel : 0;
    return { elapsed: this.elapsed, podLift, touchedDown: this.elapsed >= POD_TOUCHDOWN_DESCENT_S, settled: false };
  }

  getCameraShake(): number {
    return this.enabled ? this.lastCameraShake : 0;
  }

  private ensureFlames(podMesh: THREE.Object3D): Flames {
    if (this.flames && this.attachedPodMesh === podMesh) return this.flames;
    if (this.flames && this.attachedPodMesh) {
      const prev = this.flames;
      this.attachedPodMesh.remove(prev.group);
      enqueueDeferredDispose(() => prev.dispose());
    }
    this.flames = createFlames(POD_NOZZLES);
    this.flames.group.name = 'pod-retro-flames';
    podMesh.add(this.flames.group);
    this.attachedPodMesh = podMesh;
    return this.flames;
  }

  private ensureGroundFx(kind: PlanetKind): GroundFX | null {
    if (this.groundAttemptedKind === kind) return this.groundFx;
    if (this.groundFx) {
      const prev = this.groundFx;
      this.scene.remove(prev.group);
      this.groundFx = null;
      enqueueDeferredDispose(() => prev.dispose());
    }
    this.groundKind = kind;
    this.groundAttemptedKind = kind;
    try {
      if (typeof document !== 'undefined' && typeof HTMLCanvasElement !== 'undefined') {
        const isJsdom = typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent);
        const isMocked = 'mock' in (HTMLCanvasElement.prototype.getContext as unknown as object);
        if (!isJsdom || isMocked) {
          const probe = document.createElement('canvas');
          if (probe.getContext('2d')) {
            this.groundFx = createGroundFX(kind, 101);
            this.groundFx.group.name = 'pod-ground-fx';
            this.scene.add(this.groundFx.group);
          }
        }
      }
    } catch {
      this.groundFx = null;
    }
    return this.groundFx;
  }

  /**
   * Builds one landing-FX stage per frame (`waves` -> `egress` -> `GroundFX` -> `Flames`) while airborne so
   * neither `syncView` nor surface retro handoff triggers a synchronous multi-mesh / Canvas2D construction spike.
   * Returns `true` once all stages needed right now are built.
   */
  stepPrewarm(planetKind: PlanetKind, podMesh?: THREE.Object3D | null): boolean {
    if (!this.enabled || this.skipLocked) return true;
    this.landedResourcesUnloaded = false;
    if (!this.impactRig.isWavesBuilt) {
      this.impactRig.ensureWavesBuilt();
      return false;
    }
    if (!this.impactRig.isEgressBuilt) {
      this.impactRig.ensureEgressBuilt();
      return false;
    }
    if (this.groundAttemptedKind !== planetKind) {
      const gfx = this.ensureGroundFx(planetKind);
      if (gfx) gfx.group.visible = false;
      return false;
    }
    if (podMesh && (!this.flames || this.attachedPodMesh !== podMesh)) {
      const f = this.ensureFlames(podMesh);
      f.group.visible = false;
      return false;
    }
    return true;
  }

  /**
   * Eagerly pre-builds retro-thruster flames, ground dust particles, and impact/egress meshes while still in space so
   * the `tn = 32s` retro handoff, `1.75s` touchdown, and `3.75s` petal opening allocate zero GPU objects mid-frame.
   */
  prewarm(planetKind: PlanetKind, podMesh?: THREE.Object3D | null): THREE.Object3D[] {
    if (!this.enabled || this.skipLocked) return [];
    this.landedResourcesUnloaded = false;
    this.impactRig.ensureBuilt();
    const roots: THREE.Object3D[] = [this.impactRig.root];
    if (podMesh) {
      const f = this.ensureFlames(podMesh);
      f.group.visible = false;
      roots.push(f.group);
    }
    const gfx = this.ensureGroundFx(planetKind);
    if (gfx) {
      gfx.group.visible = false;
      roots.push(gfx.group);
    }
    return roots;
  }

  /**
   * Unloads transient landing VFX (`Flames`, `GroundFX`, `PodImpactRig` shockwaves/debris, and optionally the opened
   * egress shell once the pod entity leaves the world) plus terminates any background terrain preload worker.
   */
  unloadLandingFx(includeEgressShell = false): void {
    this.thrLight.intensity = 0;
    if (!this.landedResourcesUnloaded) {
      this.landedResourcesUnloaded = true;
      if (this.flames) {
        const f = this.flames;
        this.attachedPodMesh?.remove(f.group);
        this.flames = null;
        this.attachedPodMesh = null;
        enqueueDeferredDispose(() => f.dispose());
      }
      if (this.groundFx) {
        const gfx = this.groundFx;
        this.scene.remove(gfx.group);
        this.groundFx = null;
        enqueueDeferredDispose(() => gfx.dispose());
      }
      this.groundKind = null;
      this.groundAttemptedKind = null;
      this.impactRig.unloadWaves();
      getSharedTerrainPrep().unloadLanded(true);
    }
    if (includeEgressShell) {
      this.impactRig.unloadAll();
    }
  }

  private hideFx(): void {
    if (this.flames) this.flames.group.visible = false;
    if (this.groundFx) this.groundFx.group.visible = false;
    this.thrLight.intensity = 0;
  }

  private buildSettledState(visible: boolean): PodTouchdownState {
    return buildSettledPodState(this.mode, this.elapsed, visible);
  }

  computeState(simDescending: boolean, _simProgress: number, podEntityId?: number | null): PodTouchdownState {
    if (this.skipLocked) {
      this.wasSimDescending = simDescending;
      this.hideFx();
      this.impactRig.hide();
      return this.buildSettledState(false);
    }
    if (this.spacePhase) {
      return buildSpacePodState(this.mode, this.spacePhase);
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
      this.unloadLandingFx(true);
      return this.buildSettledState(false);
    }

    if (!this.enabled || this.elapsed >= POD_TOUCHDOWN_TOTAL_S) {
      if (this.elapsed >= POD_TOUCHDOWN_TOTAL_S && !simDescending) {
        this.unloadLandingFx(false);
      }
      return this.buildSettledState(true);
    }

    return computeActivePodSurfaceState(this.mode, this.elapsed);
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
    this.hasGroundPos = true;
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
      gfx.update(this.time, this.groundPos, state.dustIntensity, 800, state.thrust);
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
    this.groundKind = null;
    this.groundAttemptedKind = null;
    this.impactRig.dispose();
    this.scene.remove(this.thrLight);
    this.thrLight.dispose();
  }
}


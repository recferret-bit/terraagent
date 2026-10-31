import * as THREE from 'three';
import type { PlanetKind } from '@terra/render/planets/PlanetSpec';
import { createFlames, type Flames } from '../../descent/fx/Flames';
import { createGroundFX, type GroundFX } from '../../descent/fx/GroundFX';
import { clamp, smoothstep } from '../../descent/math';

const POD_NOZZLES = [0, 1, 2, 3].map((i) => {
  const a = (i * Math.PI) / 2 + Math.PI / 4;
  const r = 1.44;
  const tilt = 0.45;
  return {
    pos: new THREE.Vector3(Math.cos(a) * r, 0.4, Math.sin(a) * r),
    dir: new THREE.Vector3(Math.cos(a) * Math.sin(tilt), -Math.cos(tilt), Math.sin(a) * Math.sin(tilt)).normalize(),
  };
});

/** Duration (s) of the final retro-burn descent onto the hex pad. */
export const POD_TOUCHDOWN_DESCENT_S = 1.75;
/** End timestamp (s) of the post-touchdown retro-engine stop animation (`1.75s -> 2.35s`). */
export const POD_ENGINE_STOP_END_S = 2.35;
/** Total duration (s) including ground dust settling (`0s -> 2.65s`). */
export const POD_TOUCHDOWN_TOTAL_S = 2.65;
/** Initial drop altitude (m) above the hex landing pad at `t = 0`. */
export const POD_TOUCHDOWN_START_ALT_M = 24;

export type PodLandingPhase = 'descending' | 'engine-stop' | 'settled';

export interface PodTouchdownState {
  readonly phase: PodLandingPhase;
  readonly elapsed: number;
  readonly podLift: number;
  readonly thrust: number;
  readonly dustIntensity: number;
  readonly hqVisible: boolean;
}

/**
 * Drives the final landing animation when planet gameplay starts on the surface:
 * - Retro-thruster descent (`0 .. 1.75 s`): pod drops from `24 m` to `0 m` on its 4 angled retro nozzles with dynamic
 *   thruster light and biome-matched ground dust plume.
 * - Engine stop animation (`1.75 .. 2.35 s`): upon touchdown (`y = 0`), the 4 retro-thruster flames throttle down,
 *   shrink into the nozzles, and cut off (`uI: 1 -> 0`) while the thruster light and dust plume settle and the HQ unit
 *   deploys.
 */
export class PodTouchdownFx {
  readonly thrLight = new THREE.PointLight(0xffb070, 0, 18, 2);
  private flames: Flames | null = null;
  private attachedPodMesh: THREE.Object3D | null = null;
  private groundFx: GroundFX | null = null;
  private groundKind: PlanetKind | null = null;
  private elapsed = 0;
  private time = 0;
  private wasSimDescending = false;
  private readonly groundPos = new THREE.Vector3();

  constructor(
    private readonly scene: THREE.Scene,
    private enabled = true,
  ) {
    this.thrLight.name = 'pod-retro-light';
    this.scene.add(this.thrLight);
    if (!this.enabled) {
      this.elapsed = POD_TOUCHDOWN_TOTAL_S + 1;
    }
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.elapsed = POD_TOUCHDOWN_TOTAL_S + 1;
      this.hideFx();
    }
  }

  restart(): void {
    this.elapsed = 0;
  }

  hasTouchedDown(): boolean {
    return !this.enabled || this.elapsed >= POD_TOUCHDOWN_DESCENT_S;
  }

  isHqDeployed(): boolean {
    return !this.enabled || this.elapsed >= POD_TOUCHDOWN_DESCENT_S + 0.15;
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

  computeState(simDescending: boolean, _simProgress: number): PodTouchdownState {
    if (this.wasSimDescending && !simDescending && this.elapsed === 0) {
      this.elapsed = POD_TOUCHDOWN_DESCENT_S + 0.15;
    }
    this.wasSimDescending = simDescending;
    if (!this.enabled || this.elapsed >= POD_TOUCHDOWN_TOTAL_S) {
      return { phase: 'settled', elapsed: this.elapsed, podLift: 0, thrust: 0, dustIntensity: 0, hqVisible: true };
    }

    const t = this.elapsed;
    if (t < POD_TOUCHDOWN_DESCENT_S) {
      const u = clamp(t / POD_TOUCHDOWN_DESCENT_S, 0, 1);
      const decel = 1 - smoothstep(0, 1, u);
      const podLift = POD_TOUCHDOWN_START_ALT_M * decel * decel;
      const ignite = smoothstep(0, 0.22, t);
      const prox = clamp(1 - podLift / 22, 0, 1);
      return {
        phase: 'descending',
        elapsed: t,
        podLift,
        thrust: ignite,
        dustIntensity: ignite * prox * prox,
        hqVisible: false,
      };
    }

    const thrust = 1 - smoothstep(POD_TOUCHDOWN_DESCENT_S, POD_ENGINE_STOP_END_S, t);
    const dust = (1 - smoothstep(POD_TOUCHDOWN_DESCENT_S, POD_TOUCHDOWN_TOTAL_S, t)) * 0.85;
    return {
      phase: t < POD_ENGINE_STOP_END_S ? 'engine-stop' : 'settled',
      elapsed: t,
      podLift: 0,
      thrust,
      dustIntensity: dust,
      hqVisible: t >= POD_TOUCHDOWN_DESCENT_S + 0.15,
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
    if (this.enabled && podMesh && this.elapsed < POD_TOUCHDOWN_TOTAL_S) {
      this.elapsed += step;
    }

    const state = this.computeState(simDescending, simProgress);
    if (!podMesh || (state.thrust <= 0.001 && state.dustIntensity <= 0.001)) {
      this.hideFx();
      if (podMesh) {
        podMesh.rotation.x = 0;
        podMesh.rotation.z = 0;
      }
      return state;
    }

    const flames = this.ensureFlames(podMesh);
    flames.group.visible = state.thrust > 0.01;
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
    this.scene.remove(this.thrLight);
    this.thrLight.dispose();
  }
}

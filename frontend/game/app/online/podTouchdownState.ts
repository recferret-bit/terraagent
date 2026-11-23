import { clamp, smoother, smoothstep } from '../../descent/math';

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

export type ColonyLoadMode = 'pod' | 'direct' | 'instant';

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

export function buildSettledPodState(mode: PodLandingMode, elapsed: number, visible: boolean): PodTouchdownState {
  return {
    active: false,
    descending: false,
    mode,
    state: 'done',
    phase: 'settled',
    elapsed,
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

export function buildSpacePodState(mode: PodLandingMode, state: PodLandingStateName): PodTouchdownState {
  return {
    active: true,
    descending: true,
    mode,
    state,
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

export function computeActivePodSurfaceState(mode: PodLandingMode, t: number): PodTouchdownState {
  if (t < POD_TOUCHDOWN_DESCENT_S) {
    const u = clamp(t / POD_TOUCHDOWN_DESCENT_S, 0, 1);
    const decel = 1 - u;
    const podLift = POD_TOUCHDOWN_START_ALT_M * decel * decel;
    const ignite = mode === 'full' ? 1 : smoothstep(0, 0.22, t);
    const prox = clamp(1 - podLift / 22, 0, 1);
    const retroRumble = smoothstep(0.52, 1.0, u) * 0.22;
    return {
      active: true, descending: true, mode, state: 'retro', phase: 'descending', elapsed: t, podLift,
      thrust: ignite, dustIntensity: ignite * prox * prox, podVisible: true, egressRigVisible: false,
      podOpenProgress: 0, podDismantleProgress: 0, craterVisible: false, hqVisible: false,
      heroEgressProgress: 0, uiVisible: false, cameraShake: retroRumble,
    };
  }

  if (t < POD_WAIT_END_S) {
    const thrust = 1 - smoothstep(POD_TOUCHDOWN_DESCENT_S, POD_ENGINE_STOP_END_S, t);
    const dust = (1 - smoothstep(POD_TOUCHDOWN_DESCENT_S, POD_WAIT_END_S, t)) * 0.92;
    const dtImpact = Math.max(0, t - POD_TOUCHDOWN_DESCENT_S);
    const primaryJolt = Math.exp(-dtImpact * 3.8) * (1 - smoothstep(0, 1.25, dtImpact));
    const aftershock = 0.34 * Math.exp(-Math.pow((dtImpact - 0.2) / 0.14, 2));
    return {
      active: true, descending: false, mode, state: 'impact_wait',
      phase: t < POD_ENGINE_STOP_END_S ? 'engine-stop' : 'impact-wait', elapsed: t, podLift: 0,
      thrust, dustIntensity: dust, podVisible: true, egressRigVisible: false,
      podOpenProgress: 0, podDismantleProgress: 0, craterVisible: true, hqVisible: false,
      heroEgressProgress: 0, uiVisible: false, cameraShake: clamp(primaryJolt + aftershock, 0, 1),
    };
  }

  const u = clamp((t - POD_WAIT_END_S) / POD_EGRESS_DURATION_S, 0, 1);
  return {
    active: true, descending: false, mode, state: 'egress', phase: 'opening', elapsed: t, podLift: 0,
    thrust: 0, dustIntensity: (1 - u) * 0.28, podVisible: false, egressRigVisible: true,
    podOpenProgress: smoother(0, 0.55, u), podDismantleProgress: 0, craterVisible: true,
    hqVisible: u >= 0.12, heroEgressProgress: smoother(0.12, 0.85, u), uiVisible: false, cameraShake: 0,
  };
}

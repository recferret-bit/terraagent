import { ENTITY_KIND, ENTITY_STATE } from '../../ecs/columns';

/**
 * The ONE definition of "does this entity show its lights" (owner rule: building lights go dark without energy).
 *
 * It is a pure function of data every host already replicates: the entity `state` column that the power system
 * (`evaluate.ts`, `shedding.ts`, `overload.ts`, `thermal.ts`) writes (so brownout shedding by group, an unattached
 * building, an overloaded pylon, a fuel-less plant are all covered), its kind, its construction stage and the night
 * factor. The server, `?host=local` and the renderer all read the same value; nobody else decides "lit".
 *
 * `BuildingLightState` is the base class (default policy); a kind with another rule registers a subclass with
 * `registerLightState` (see `SolarLightState`, `UnlitLightState`).
 */

/** What a light policy needs to know about one entity. */
export interface LightSubject {
  kind: number;
  /** `ENTITY_STATE.*` (the power system's verdict is part of it). */
  state: number;
  /** Quantized construction stage 0..1 (1 when built). */
  buildStage?: number;
}

/** States in which a building has no energy for its lights, whatever the hour. */
const DARK_STATES: ReadonlySet<number> = new Set([
  ENTITY_STATE.offlineBrownout, // shed by the brownout (its group was cut)
  ENTITY_STATE.offlineUnpowered, // not on a powered grid
  ENTITY_STATE.offlineNoGrid, // no cable to the hub (W03)
  ENTITY_STATE.offlineOverload, // overloaded pylon
  ENTITY_STATE.offlineNoFuel, // a generator with no fuel
  ENTITY_STATE.inert,
]);

/** Night factor (0 day .. 1 night) above which lights matter at all. */
export const LIGHTS_RELEVANT_NIGHT = 0.05;

export class BuildingLightState {
  /** True while the entity has the energy to run its lights (its state is not an offline state). */
  isPowered(subject: LightSubject): boolean {
    return !DARK_STATES.has(subject.state);
  }

  /** Whether the entity has lights at all (a policy for a light-less kind returns false). */
  emitsLight(_subject: LightSubject): boolean {
    return true;
  }

  /** Lights only matter once it is dark enough to see them. */
  isNightRelevant(nightFactor: number): boolean {
    return nightFactor > LIGHTS_RELEVANT_NIGHT;
  }

  /**
   * Target lit level 0..1 (what projectors and emissive parts fade towards): 0 when dark, a dim glow while waiting
   * or being built, 1 when powered and finished. Independent of the hour so a dead building also reads as dead by day.
   */
  level(subject: LightSubject, _nightFactor: number): number {
    if (!this.emitsLight(subject) || !this.isPowered(subject)) return 0;
    if (subject.state === ENTITY_STATE.waiting) return 0.18;
    if (subject.state === ENTITY_STATE.constructing) {
      return 0.35 + 0.65 * Math.max(0, Math.min(1, subject.buildStage ?? 0));
    }
    return 1;
  }

  /** The yes/no form: a night-relevant hour and a lit level above zero. */
  shouldEmitLight(subject: LightSubject, nightFactor: number): boolean {
    return this.isNightRelevant(nightFactor) && this.level(subject, nightFactor) > 0.005;
  }
}

/** Solar arrays make no light of their own at night (their panels produce nothing and shed no glow). */
export class SolarLightState extends BuildingLightState {
  override level(subject: LightSubject, nightFactor: number): number {
    return nightFactor > 0.5 ? 0 : super.level(subject, nightFactor);
  }
}

/** A kind without lights: always dark, whatever its power state. */
export class UnlitLightState extends BuildingLightState {
  override emitsLight(): boolean {
    return false;
  }
}

const DEFAULT_POLICY = new BuildingLightState();
const policies = new Map<number, BuildingLightState>([[ENTITY_KIND.solar, new SolarLightState()]]);

/** Registers (or replaces) the light policy of an entity kind. */
export function registerLightState(kind: number, policy: BuildingLightState): void {
  policies.set(kind, policy);
}

/** The light policy of a kind (the base `BuildingLightState` unless a subclass is registered). */
export function lightStateFor(kind: number): BuildingLightState {
  return policies.get(kind) ?? DEFAULT_POLICY;
}

/** Entry point: the target lit level 0..1 of one entity (what the renderer fades to). */
export function entityLightLevel(subject: LightSubject, nightFactor: number): number {
  return lightStateFor(subject.kind).level(subject, nightFactor);
}

/** Entry point: whether one entity casts light now (night-relevant and lit). */
export function entityShouldEmitLight(subject: LightSubject, nightFactor: number): boolean {
  return lightStateFor(subject.kind).shouldEmitLight(subject, nightFactor);
}

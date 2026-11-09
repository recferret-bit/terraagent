import * as THREE from 'three';
import type { ArchetypeLightSource } from './archetypeLights';

/**
 * The ONE spot-cone definition of an archetype light, shared by the GPU projector that lights the ground
 * (`entityVisionSync` / playground `SpawnSet` -> `ColonyVisionAndLights`) and the visible beam mesh
 * (`EntityProjectorRig`). Before this module each of the three used its own angle, so the drawn beam never matched
 * the lit pool (owner W05: "beam is stretched, while it must be geometrically right").
 *
 * All values are in the archetype's model space (the rig is a child of the mesh, so mesh scale/yaw apply on top).
 */

/** `cosOuter` clamp: the cone half-angle stays between ~35° and ~59°. */
export const PROJECTOR_COS_MIN = 0.52;
export const PROJECTOR_COS_MAX = 0.82;
/** The lit spread at the target is `max(coneBottomRadius, poolRadius) * PROJECTOR_SPREAD`. */
export const PROJECTOR_SPREAD = 1.55;
/** Inner (full-strength) cone: `cosInner = mix(cosOuter, 1, PROJECTOR_INNER_MIX)`; mirrors `ColonyVisionAndLights` GLSL. */
export const PROJECTOR_INNER_MIX = 0.42;

export interface ProjectorCone {
  /** Lamp position (cone apex). */
  readonly apex: THREE.Vector3;
  /** Unit axis from the lamp toward the authored target. */
  readonly axis: THREE.Vector3;
  /** Distance lamp -> authored target. */
  readonly targetDistance: number;
  /** Cosine of the outer half-angle (spot falls to 0 here); what the GPU projector uploads. */
  readonly cosOuter: number;
  /** Cosine of the inner half-angle (full strength inside). */
  readonly cosInner: number;
  /** Light range (distance attenuation `(1 - d / range)^2` reaches 0 here). */
  readonly range: number;
}

/** Cosine of the GPU projector's outer half-angle for `src` (independent of mesh scale: both lengths scale). */
export function projectorCosOuter(src: Readonly<ArchetypeLightSource>): number {
  const len = Math.max(1e-4, Math.hypot(src.target[0] - src.pos[0], src.target[1] - src.pos[1], src.target[2] - src.pos[2]));
  const spread = Math.max(src.coneBottomRadius, src.poolRadius) * PROJECTOR_SPREAD;
  return THREE.MathUtils.clamp(len / Math.hypot(len, spread), PROJECTOR_COS_MIN, PROJECTOR_COS_MAX);
}

/** The spot cone of `src` in model space; `rangeScale` is the per-kind range factor of the game (`scaleForKind`). */
export function projectorConeFromSource(src: Readonly<ArchetypeLightSource>, rangeScale = 1): ProjectorCone {
  const apex = new THREE.Vector3(src.pos[0], src.pos[1], src.pos[2]);
  const axis = new THREE.Vector3(src.target[0], src.target[1], src.target[2]).sub(apex);
  const targetDistance = axis.length();
  if (targetDistance > 1e-4) axis.divideScalar(targetDistance);
  else axis.set(0, -1, 0);
  const cosOuter = projectorCosOuter(src);
  return {
    apex,
    axis,
    targetDistance,
    cosOuter,
    cosInner: THREE.MathUtils.lerp(cosOuter, 1, PROJECTOR_INNER_MIX),
    range: Math.max(0.1, src.range * rangeScale),
  };
}

/**
 * Half-angle of the visible beam: where the GPU spot's smoothstep is 0.5 (midway between outer and inner cosines),
 * i.e. the perceived edge of the lit pool.
 */
export function beamHalfAngle(cone: ProjectorCone): number {
  return Math.acos(THREE.MathUtils.clamp((cone.cosOuter + cone.cosInner) * 0.5, -1, 1));
}

export interface BeamRay {
  /** Start on the lamp aperture. */
  readonly origin: THREE.Vector3;
  /** Unit direction of this cone generator. */
  readonly dir: THREE.Vector3;
  /** Length: to the ground plane (plus `sink`) when the generator descends onto it within `range`, else `range`. */
  readonly length: number;
  /** True when the generator ends on the ground (false: it fades out at `range`). */
  readonly hitsGround: boolean;
}

export interface BeamRayOptions {
  /** Model-space height of the ground plane under the lamp (the authored target's y). */
  readonly groundY: number;
  /** How far below the ground plane a ground-hitting generator continues (hidden by the depth test on flat ground;
   *  keeps the beam reaching the terrain in dips). Default 0. */
  readonly sink?: number;
  /** Lamp aperture radius at the apex (default 0). */
  readonly aperture?: number;
  /** Generators around the axis (default 24). */
  readonly segments?: number;
  /** Half-angle override (default `beamHalfAngle(cone)`). */
  readonly halfAngle?: number;
}

const _u = new THREE.Vector3();
const _v = new THREE.Vector3();

/**
 * The generator lines of the beam cone: each leaves the lamp aperture at the beam half-angle around the cone axis and
 * stops where it meets the ground plane `y = groundY - sink` (if that is within `range`) or at `range`. On flat ground
 * the ends of the ground-hitting generators therefore trace exactly the lit footprint of the GPU spot.
 */
export function buildBeamRays(cone: ProjectorCone, opts: BeamRayOptions): BeamRay[] {
  const segments = Math.max(3, Math.floor(opts.segments ?? 24));
  const half = opts.halfAngle ?? beamHalfAngle(cone);
  const sink = Math.max(0, opts.sink ?? 0);
  const aperture = Math.max(0, opts.aperture ?? 0);
  const planeY = opts.groundY - sink;
  const ref = Math.abs(cone.axis.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  _u.crossVectors(cone.axis, ref).normalize();
  _v.crossVectors(cone.axis, _u).normalize();
  const cosH = Math.cos(half);
  const sinH = Math.sin(half);
  const rays: BeamRay[] = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const radial = new THREE.Vector3().addScaledVector(_u, Math.cos(a)).addScaledVector(_v, Math.sin(a));
    const origin = cone.apex.clone().addScaledVector(radial, aperture);
    const dir = cone.axis.clone().multiplyScalar(cosH).addScaledVector(radial, sinH).normalize();
    let length = cone.range;
    let hitsGround = false;
    if (dir.y < -1e-4 && origin.y > planeY) {
      const t = (planeY - origin.y) / dir.y;
      if (t < cone.range) {
        length = t;
        hitsGround = true;
      }
    }
    rays.push({ origin, dir, length, hitsGround });
  }
  return rays;
}

/** Brightness along the beam at distance `d` from the lamp: the GPU projector's `(1 - d / range)^2`. */
export function beamFalloff(d: number, range: number): number {
  const n = THREE.MathUtils.clamp(1 - d / Math.max(0.1, range), 0, 1);
  return n * n;
}

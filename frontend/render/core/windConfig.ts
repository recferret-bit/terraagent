import * as THREE from 'three';
import { createLabStore } from './labStore';

/**
 * Visual-only planetary wind (F8 → WIND). One shared state drives tree sway, ambient dust/pollen drift, dune ripple
 * orientation and the water's wave direction, so everything on screen agrees on where the wind blows. It is not a
 * game rule: nothing in `shared/sim` reads it.
 *
 * OFF = calm air (effective strength 0): trees stand still apart from a faint idle sway, dust only wobbles, water
 * keeps a small residual swell.
 */
export interface WindParams {
  /** Direction the wind blows TOWARD, degrees in world xz (0 = +x, 90 = +z). */
  directionDeg: number;
  /** 0 = calm, 1 = steady breeze, 2 = gale. */
  strength: number;
  /** How much gust fronts (travelling downwind) modulate the strength, 0..1. */
  gust: number;
  /** Small-scale direction/strength jitter for foliage flutter and particle wobble, 0..1. */
  turbulence: number;
}

/** atan2(0.6, 0.8): the old hard-coded hex terrain wind `[0.8, 0.6]`. */
export const DEFAULT_WIND_PARAMS: Readonly<WindParams> = {
  directionDeg: 36.87,
  strength: 0.8,
  gust: 0.45,
  turbulence: 0.35,
};

export const WIND_RANGES = {
  directionDeg: [0, 360],
  strength: [0, 2],
  gust: [0, 1],
  turbulence: [0, 1],
} as const satisfies Record<keyof WindParams, readonly [number, number]>;

const store = createLabStore<WindParams>({
  key: 'terraagent.wind',
  version: 1,
  urlFlag: 'wind',
  defaultOn: true,
  defaults: DEFAULT_WIND_PARAMS,
  ranges: WIND_RANGES,
});

/** Speed (m/s) at which gust fronts and drift travel downwind, per unit of `strength`. */
const GUST_FRONT_MPS = 6;
const MAX_TICK_S = 0.1;

const uniforms = {
  /** Unit vector, world xz, the direction the wind blows toward. */
  uWindDir: { value: new THREE.Vector2(0.8, 0.6) },
  /** Effective strength (0 when the WIND tab is off). */
  uWindStrength: { value: DEFAULT_WIND_PARAMS.strength },
  uWindGust: { value: DEFAULT_WIND_PARAMS.gust },
  uWindTurb: { value: DEFAULT_WIND_PARAMS.turbulence },
  /** Metres gust fronts have travelled downwind (integrated on the CPU so a slider move never jumps the field). */
  uWindPhase: { value: 0 },
  /** Accumulated downwind displacement (m, xz), integrated on the CPU: particles add it so direction changes curve. */
  uWindDrift: { value: new THREE.Vector2(0, 0) },
  /** Seconds since start, for flutter that must not depend on any one material's clock. */
  uWindTime: { value: 0 },
};

function applyParams(): void {
  const p = store.get();
  const a = THREE.MathUtils.degToRad(p.directionDeg);
  uniforms.uWindDir.value.set(Math.cos(a), Math.sin(a));
  uniforms.uWindStrength.value = store.isOn() ? p.strength : 0;
  uniforms.uWindGust.value = p.gust;
  uniforms.uWindTurb.value = p.turbulence;
}
applyParams();
store.onChange(applyParams);

let lastTickMs = -1;

/**
 * Advances the wind clocks from real time. Safe to call any number of times per frame (dt is measured, not passed);
 * `createColonyViewport().render()` calls it once per frame for every 3D page.
 */
export function tickWindClock(nowMs = performance.now()): void {
  if (lastTickMs < 0) { lastTickMs = nowMs; return; }
  const dt = Math.min(MAX_TICK_S, Math.max(0, (nowMs - lastTickMs) / 1000));
  lastTickMs = nowMs;
  if (dt <= 0) return;
  const speed = uniforms.uWindStrength.value * GUST_FRONT_MPS;
  uniforms.uWindPhase.value += speed * dt;
  uniforms.uWindDrift.value.addScaledVector(uniforms.uWindDir.value, speed * dt);
  uniforms.uWindTime.value += dt;
}

/** The shared wind uniforms. Assign these objects (not copies) into a material's uniforms so all stay in sync. */
export function getWindUniforms(): typeof uniforms {
  return uniforms;
}

/**
 * Uniform declarations + helpers. `windStrengthAt(p)` is the local gusty strength (>= 0) at world xz `p`;
 * `windGustAt(p)` the gust envelope in [-1, 1] (0 = mean).
 */
export const WIND_GLSL = /* glsl */ `
uniform vec2 uWindDir;
uniform float uWindStrength, uWindGust, uWindTurb, uWindPhase, uWindTime;
uniform vec2 uWindDrift;
float windGustAt(vec2 p) {
  float along = dot(p, uWindDir) - uWindPhase;
  float across = dot(p, vec2(-uWindDir.y, uWindDir.x));
  float g = sin(along * 0.085 + sin(across * 0.031) * 1.6) * 0.6 + sin(along * 0.21 + across * 0.07 + 1.3) * 0.4;
  return clamp(g, -1.0, 1.0);
}
float windStrengthAt(vec2 p) {
  return max(0.0, uWindStrength * (1.0 + uWindGust * windGustAt(p)));
}
`;

export const isWindOn = (): boolean => store.isOn();
export const setWind = (on: boolean): boolean => store.setOn(on);
export const toggleWind = (): boolean => store.toggle();
export const getWindParams = (): Readonly<WindParams> => store.get();
export const setWindParams = (patch: Partial<WindParams>): Readonly<WindParams> => store.set(patch);
export const resetWindParams = (): Readonly<WindParams> => store.reset();
export const onWindChange = (fn: (on: boolean, params: Readonly<WindParams>) => void): (() => void) => store.onChange(fn);

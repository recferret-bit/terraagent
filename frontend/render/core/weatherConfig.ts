import * as THREE from 'three';
import { getWindParams } from './windConfig';

export type RainLevel = 'none' | 'minor' | 'heavy';

export type WeatherActionKind =
  | 'meteor'
  | 'twister'
  | 'lightning'
  | 'storm'
  | 'rain-minor'
  | 'rain-heavy'
  | 'clear'
  | 'twister-ready';

export interface WeatherParams {
  /** Rain precipitation intensity (0 = dry, 0.01..0.5 = minor rain, > 0.5 = heavy rain). */
  rainIntensity: number;
  /** Whether full storm atmosphere (dark clouds + rain + lightning) is active. */
  stormActive: boolean;
  /** Storm cloud ambient darkening factor (0..1). */
  stormDarkness: number;
  /** Screen & sky flash intensity multiplier for lightning and meteor impacts (0..2). */
  lightningFlash: number;
  /** Meteor eclipse shadow coverage scale (0.5..2.0). */
  meteorShadowScale: number;
  /** Twister 3D funnel height in meters (8..28). */
  twisterHeight: number;
}

export const DEFAULT_WEATHER_PARAMS: WeatherParams = {
  rainIntensity: 0,
  stormActive: false,
  stormDarkness: 0,
  lightningFlash: 1.0,
  meteorShadowScale: 1.0,
  twisterHeight: 18.0,
};

export const WEATHER_RANGES = {
  rainIntensity: [0, 1],
  stormDarkness: [0, 1],
  lightningFlash: [0, 2],
  meteorShadowScale: [0.5, 2.0],
  twisterHeight: [8, 28],
} as const;

const ON_KEY = 'terraagent.weather';
const PARAMS_KEY = 'terraagent.weather.params.v1';

function clampNum(v: unknown, range: readonly [number, number], fallback: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(range[1], Math.max(range[0], n));
}

function sanitizeWeatherPatch(base: WeatherParams, patch: Partial<WeatherParams>): WeatherParams {
  return {
    rainIntensity: patch.rainIntensity !== undefined
      ? clampNum(patch.rainIntensity, WEATHER_RANGES.rainIntensity, base.rainIntensity)
      : base.rainIntensity,
    stormActive: patch.stormActive !== undefined ? Boolean(patch.stormActive) : base.stormActive,
    stormDarkness: patch.stormDarkness !== undefined
      ? clampNum(patch.stormDarkness, WEATHER_RANGES.stormDarkness, base.stormDarkness)
      : base.stormDarkness,
    lightningFlash: patch.lightningFlash !== undefined
      ? clampNum(patch.lightningFlash, WEATHER_RANGES.lightningFlash, base.lightningFlash)
      : base.lightningFlash,
    meteorShadowScale: patch.meteorShadowScale !== undefined
      ? clampNum(patch.meteorShadowScale, WEATHER_RANGES.meteorShadowScale, base.meteorShadowScale)
      : base.meteorShadowScale,
    twisterHeight: patch.twisterHeight !== undefined
      ? clampNum(patch.twisterHeight, WEATHER_RANGES.twisterHeight, base.twisterHeight)
      : base.twisterHeight,
  };
}

function readInitialOn(): boolean {
  try {
    const q = new URLSearchParams(location.search).get('weather');
    if (q === '0' || q === 'false') return false;
    if (q === '1' || q === 'true') return true;
    const saved = localStorage.getItem(ON_KEY);
    return saved === null ? true : saved === '1';
  } catch {
    return true;
  }
}

function readInitialParams(): WeatherParams {
  try {
    const raw = localStorage.getItem(PARAMS_KEY);
    if (!raw) return { ...DEFAULT_WEATHER_PARAMS };
    return sanitizeWeatherPatch(DEFAULT_WEATHER_PARAMS, JSON.parse(raw) as Partial<WeatherParams>);
  } catch {
    return { ...DEFAULT_WEATHER_PARAMS };
  }
}

let enabled = readInitialOn();
let params: WeatherParams = readInitialParams();
let lastUserWeatherEditMs = -10_000;
let lastWeatherTickMs = -1;

const listeners = new Set<(params: Readonly<WeatherParams>, on: boolean) => void>();
const userEditListeners = new Set<(params: Readonly<WeatherParams>, on: boolean) => void>();

/**
 * Shared GPU weather uniforms. Assign these objects directly into terrain, water, and foliage
 * material uniforms so wetness, puddles, and rain ripples stay synchronized across all shaders.
 */
const weatherUniforms = {
  /** Active rain precipitation intensity (0..1). */
  uRainIntensity: { value: 0 },
  /** Ground & foliage surface wetness (0 = dry, 1 = soaked; ramps up in rain, dries over time when sunny). */
  uWetness: { value: 0 },
  /** Puddle coverage & radius level on flat ground (0 = evaporated, 1 = full puddles; grows in rain, shrinks in sun). */
  uPuddleLevel: { value: 0 },
  /** Storm overcast darkness factor (0..1). */
  uStormDarkness: { value: 0 },
  /** Monotonic weather animation clock in seconds. */
  uWeatherTime: { value: 0 },
  /** Radial water electrocution intensity around lightning strike on water (0..1.5, decays over ~1.05s). */
  uWaterElectroIntensity: { value: 0 },
  /** World-space XZ origin of the latest lightning strike on water. */
  uWaterElectroOrigin: { value: new THREE.Vector2(0, 0) },
  /** Radial puddle electrocution intensity around lightning strike on land (0..1.5, decays over ~1.05s). */
  uPuddleElectroIntensity: { value: 0 },
  /** World-space XZ origin of the latest lightning strike on land for interconnected puddle electrocution. */
  uPuddleElectroOrigin: { value: new THREE.Vector2(0, 0) },
};

export function triggerWaterElectrocution(wx: number, wz: number, intensity = 1.0): void {
  weatherUniforms.uWaterElectroOrigin.value.set(wx, wz);
  weatherUniforms.uWaterElectroIntensity.value = Math.max(
    weatherUniforms.uWaterElectroIntensity.value,
    Math.min(1.5, intensity),
  );
}

export function triggerPuddleElectrocution(wx: number, wz: number, intensity = 1.0): void {
  weatherUniforms.uPuddleElectroOrigin.value.set(wx, wz);
  weatherUniforms.uPuddleElectroIntensity.value = Math.max(
    weatherUniforms.uPuddleElectroIntensity.value,
    Math.min(1.5, intensity),
  );
}

function syncUniformTargets(): void {
  const effRain = enabled ? params.rainIntensity : 0;
  const effStorm = enabled ? (params.stormActive ? Math.max(0.75, params.stormDarkness) : params.stormDarkness) : 0;
  weatherUniforms.uRainIntensity.value = effRain;
  weatherUniforms.uStormDarkness.value = effStorm;
}
syncUniformTargets();

/** Returns the shared GPU weather uniforms (`uRainIntensity`, `uWetness`, `uPuddleLevel`, `uStormDarkness`, `uWeatherTime`). */
export function getWeatherUniforms(): typeof weatherUniforms {
  return weatherUniforms;
}

/**
 * Advances weather clocks, ground/tree wetness, and puddle accumulation/evaporation each frame.
 * When raining, wetness and puddles gradually build up; when sunny/dry, they slowly dry and shrink over time.
 */
export function tickWeatherClock(nowMs = performance.now()): void {
  syncUniformTargets();
  if (lastWeatherTickMs < 0) {
    lastWeatherTickMs = nowMs;
    return;
  }
  const dt = Math.min(0.1, Math.max(0, (nowMs - lastWeatherTickMs) / 1000));
  lastWeatherTickMs = nowMs;
  if (dt <= 0) return;

  weatherUniforms.uWeatherTime.value += dt;
  if (weatherUniforms.uWaterElectroIntensity.value > 0) {
    weatherUniforms.uWaterElectroIntensity.value = Math.max(0, weatherUniforms.uWaterElectroIntensity.value - dt * 0.95);
  }
  if (weatherUniforms.uPuddleElectroIntensity.value > 0) {
    weatherUniforms.uPuddleElectroIntensity.value = Math.max(0, weatherUniforms.uPuddleElectroIntensity.value - dt * 0.95);
  }
  const effRain = weatherUniforms.uRainIntensity.value;

  if (effRain > 0.01) {
    const targetWet = Math.min(1.0, 0.48 + effRain * 0.62);
    const wetRate = (0.22 + effRain * 0.38) * dt;
    if (weatherUniforms.uWetness.value < targetWet) {
      weatherUniforms.uWetness.value = Math.min(targetWet, weatherUniforms.uWetness.value + wetRate);
    } else {
      weatherUniforms.uWetness.value = Math.max(targetWet, weatherUniforms.uWetness.value - 0.08 * dt);
    }

    const targetPuddle = Math.min(1.0, 0.38 + effRain * 0.72);
    const puddleGrowRate = (0.12 + effRain * 0.24) * dt;
    if (weatherUniforms.uPuddleLevel.value < targetPuddle) {
      weatherUniforms.uPuddleLevel.value = Math.min(targetPuddle, weatherUniforms.uPuddleLevel.value + puddleGrowRate);
    }
  } else {
    // Dry out gradually when sunny / clear
    weatherUniforms.uWetness.value = Math.max(0, weatherUniforms.uWetness.value - 0.065 * dt);
    weatherUniforms.uPuddleLevel.value = Math.max(0, weatherUniforms.uPuddleLevel.value - 0.045 * dt);
  }
}

function notify(source: 'user' | 'sync'): void {
  syncUniformTargets();
  for (const fn of listeners) fn(params, enabled);
  if (source === 'user') {
    lastUserWeatherEditMs = performance.now();
    for (const fn of userEditListeners) fn(params, enabled);
  }
}

export const isWeatherOn = (): boolean => enabled;

export function setWeather(on: boolean, source: 'user' | 'sync' = 'user'): boolean {
  const next = Boolean(on);
  const changed = enabled !== next;
  enabled = next;
  if (changed && source === 'user') {
    if (!enabled) {
      params = sanitizeWeatherPatch(params, { rainIntensity: 0, stormActive: false, stormDarkness: 0 });
    } else if (params.rainIntensity <= 0.01 && !params.stormActive) {
      params = sanitizeWeatherPatch(params, { rainIntensity: 0.35 });
    }
    try { localStorage.setItem(PARAMS_KEY, JSON.stringify(params)); } catch { /* ignore */ }
  }
  if (changed) {
    try { localStorage.setItem(ON_KEY, enabled ? '1' : '0'); } catch { /* ignore */ }
    notify(source);
  }
  return enabled;
}

export const toggleWeather = (): boolean => setWeather(!enabled, 'user');

export const getWeatherParams = (): Readonly<WeatherParams> => params;

export function setWeatherParams(
  patch: Partial<WeatherParams>,
  source: 'user' | 'sync' = 'user',
): Readonly<WeatherParams> {
  const next = sanitizeWeatherPatch(params, patch);
  const changed =
    next.rainIntensity !== params.rainIntensity ||
    next.stormActive !== params.stormActive ||
    next.stormDarkness !== params.stormDarkness ||
    next.lightningFlash !== params.lightningFlash ||
    next.meteorShadowScale !== params.meteorShadowScale ||
    next.twisterHeight !== params.twisterHeight;
  params = next;
  if (source === 'user' && (params.rainIntensity > 0.01 || params.stormActive) && !enabled) {
    enabled = true;
    try { localStorage.setItem(ON_KEY, '1'); } catch { /* ignore */ }
  }
  if (changed || source === 'user') {
    try { localStorage.setItem(PARAMS_KEY, JSON.stringify(params)); } catch { /* ignore */ }
    notify(source);
  }
  return params;
}

export function resetWeatherParams(): Readonly<WeatherParams> {
  params = { ...DEFAULT_WEATHER_PARAMS };
  try { localStorage.setItem(PARAMS_KEY, JSON.stringify(params)); } catch { /* ignore */ }
  notify('user');
  return params;
}

export function onWeatherChange(fn: (params: Readonly<WeatherParams>, on: boolean) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function onWeatherUserEdit(fn: (params: Readonly<WeatherParams>, on: boolean) => void): () => void {
  userEditListeners.add(fn);
  return () => {
    userEditListeners.delete(fn);
  };
}

export function isUserEditingWeather(nowMs = performance.now(), windowMs = 2000): boolean {
  return nowMs - lastUserWeatherEditMs < windowMs;
}

/** Classifies numeric `rainIntensity` into `'none' | 'minor' | 'heavy'`. */
export function getRainLevel(rainIntensity = params.rainIntensity): RainLevel {
  if (rainIntensity <= 0.01) return 'none';
  if (rainIntensity <= 0.5) return 'minor';
  return 'heavy';
}

/**
 * Twister availability rule: Twister is ONLY available when wind is HIGH (`strength >= 1.2`, i.e. >= 120%)
 * AND rain is MINOR (`0.01 < rainIntensity <= 0.5`).
 */
export function isTwisterAvailable(
  windStrength = getWindParams().strength,
  rainIntensity = params.rainIntensity,
): boolean {
  return windStrength >= 1.2 && getRainLevel(rainIntensity) === 'minor';
}

export function getTwisterAvailabilityHint(
  windStrength = getWindParams().strength,
  rainIntensity = params.rainIntensity,
): string {
  const highWind = windStrength >= 1.2;
  const rainLevel = getRainLevel(rainIntensity);
  const minorRain = rainLevel === 'minor';
  if (highWind && minorRain) {
    return `READY (Wind HIGH ${Math.round(windStrength * 100)}% + Rain MINOR ${Math.round(rainIntensity * 100)}%)`;
  }
  const missing: string[] = [];
  if (!highWind) missing.push(`HIGH wind (>=120%, now ${Math.round(windStrength * 100)}%)`);
  if (!minorRain) missing.push(`MINOR rain (1..50%, now ${rainLevel.toUpperCase()} ${Math.round(rainIntensity * 100)}%)`);
  return `LOCKED — Needs ${missing.join(' & ')}`;
}

export type WeatherActionListener = (action: WeatherActionKind, payload?: { q?: number; r?: number }) => void;

const actionListeners = new Set<WeatherActionListener>();

export function onWeatherAction(fn: WeatherActionListener): () => void {
  actionListeners.add(fn);
  return () => {
    actionListeners.delete(fn);
  };
}

export function triggerWeatherAction(action: WeatherActionKind, payload?: { q?: number; r?: number }): void {
  for (const fn of actionListeners) {
    fn(action, payload);
  }
}
